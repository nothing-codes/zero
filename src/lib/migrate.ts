import type { MediaEncryption, MessagePayload } from "../types";
import { MESSAGE_TABLE, normalizeEmail } from "./chat";
import { encryptBlob, encryptPayload, isEncryptedPayload } from "./e2ee";
import { deleteStoragePaths, storagePathFromUrl } from "./files";
import { MEDIA_BUCKET } from "./media";
import { supabase } from "./supabase";

/**
 * Ленивая миграция старых незашифрованных сообщений.
 *
 * Пока клиент открыт, все участники диалога доступны по публичным ключам, а
 * приватный ключ устройства уже создан. Этого достаточно, чтобы переписать
 * старые payload'ы и вложения в зашифрованном виде. Строки, которые сейчас
 * зашифровать нельзя (у собеседника ещё нет ключа), остаются как есть и будут
 * обработаны при следующем запуске.
 */

const MEDIA_KINDS = ["photo", "voice", "videoNote", "file"] as const;
type MediaKind = (typeof MEDIA_KINDS)[number];

interface LegacyRow {
  id: string;
  sender_email: string;
  recipient_email: string;
  payload: MessagePayload;
}

interface MediaLike {
  src?: string;
  enc?: MediaEncryption;
}

const started = new Set<string>();

function mediaOf(payload: MessagePayload, kind: MediaKind): MediaLike | undefined {
  return (payload as unknown as Record<string, MediaLike | undefined>)[kind];
}

function withMedia(payload: MessagePayload, kind: MediaKind, media: MediaLike): MessagePayload {
  return { ...payload, [kind]: media } as MessagePayload;
}

async function migrateRow(row: LegacyRow, email: string, oldUrls: Map<string, string>) {
  const sender = normalizeEmail(row.sender_email);
  const recipient = normalizeEmail(row.recipient_email);
  if (sender !== email && recipient !== email) return;
  const peer = sender === email ? recipient : sender;
  if (!peer) return;

  const hasLegacyMedia = MEDIA_KINDS.some((kind) => {
    const media = mediaOf(row.payload, kind);
    return Boolean(media?.src && !media.enc);
  });

  // Сообщения без вложений перешифровываем сразу, одним проходом.
  if (!hasLegacyMedia) {
    const envelope = await encryptPayload(email, peer, row.payload);
    const { error } = await supabase
      .from(MESSAGE_TABLE)
      .update({ payload: envelope as unknown as MessagePayload })
      .eq("id", row.id);
    if (error) throw error;
    return;
  }

  // Сразу проверяем, что ключ беседы выводится: у собеседника опубликован
  // ключ. Иначе не тратим трафик на скачивание вложений.
  try {
    await encryptPayload(email, peer, row.payload);
  } catch {
    return;
  }

  let payload = row.payload;
  for (const kind of MEDIA_KINDS) {
    const media = mediaOf(payload, kind);
    if (!media?.src || media.enc) continue;
    const src = media.src;
    try {
      const response = await fetch(src, { cache: "no-store" });
      if (!response.ok) throw new Error(`media-${response.status}`);
      const encrypted = await encryptBlob(await response.blob());
      const path = `enc/migrated/${kind}/${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 10)}.bin`;
      const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, encrypted.blob, {
        contentType: "application/octet-stream",
        cacheControl: "31536000",
        upsert: false,
      });
      if (error) throw error;
      const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);
      payload = withMedia(payload, kind, { ...media, src: data.publicUrl, enc: encrypted.enc });
      const oldPath = storagePathFromUrl(src);
      if (oldPath) oldUrls.set(src, oldPath);
    } catch {
      // Вложение не удалось перешить — оставляем строку целиком, попробуем
      // при следующем запуске.
      return;
    }
  }

  const envelope = await encryptPayload(email, peer, payload);
  const { error } = await supabase
    .from(MESSAGE_TABLE)
    .update({ payload: envelope as unknown as MessagePayload })
    .eq("id", row.id);
  if (error) throw error;
}

async function run(email: string) {
  const { data, error } = await supabase
    .from(MESSAGE_TABLE)
    .select("id,sender_email,recipient_email,payload")
    .limit(1000);
  if (error || !data) return;

  const rows = data as LegacyRow[];
  const pending = rows.filter((row) => !isEncryptedPayload(row.payload));
  if (pending.length === 0) return;

  const oldUrls = new Map<string, string>();
  for (const row of pending) {
    await migrateRow(row, email, oldUrls).catch(() => undefined);
  }

  if (oldUrls.size === 0) return;

  // Старые файлы удаляем только если на них больше никто не ссылается.
  const { data: latest } = await supabase.from(MESSAGE_TABLE).select("payload").limit(1000);
  const text = JSON.stringify(latest ?? []);
  const orphaned = [...oldUrls].filter(([url]) => !text.includes(url)).map(([, path]) => path);
  if (orphaned.length > 0) {
    await deleteStoragePaths(orphaned).catch(() => undefined);
  }
}

/** Запускает миграцию один раз за сессию для текущего аккаунта. */
export function migrateLegacyContent(meEmail: string): void {
  const email = normalizeEmail(meEmail);
  if (!email || started.has(email)) return;
  started.add(email);
  void run(email).catch(() => undefined);
}
