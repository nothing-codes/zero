import type { MessagePayload, PinnedMusic, User } from "../types";
import { decryptPayload, encryptPayload, isEncryptedPayload, publicKeyFor, refreshPeerKey } from "./e2ee";
import { supabase } from "./supabase";

/**
 * Настоящий чат между разными аккаунтами.
 *
 * Профили — `zero_profiles`, сообщения — `zero_messages`. Обе таблицы и
 * Realtime-подписка создаются в `supabase/schema.sql`.
 *
 * Ключ аккаунта — email (как и в `zero_states`), потому что приложение
 * входит по Gmail через Supabase Auth. Пара участников диалога хранится в
 * поле `conversation` в отсортированном виде: `a@mail|b@mail`.
 */
export const PROFILE_TABLE = "zero_profiles";
export const MESSAGE_TABLE = "zero_messages";

export interface ZeroProfile {
  email: string;
  username: string;
  name: string;
  avatar: string | null;
  banner?: string | null;
  bio: string;
  status: string;
  pinnedMusic?: PinnedMusic | null;
}

export interface RemoteMessageRow {
  id: string;
  client_id: string | null;
  conversation: string;
  sender_email: string;
  recipient_email: string;
  sender_name: string;
  sender_username: string;
  sender_avatar: string | null;
  payload: MessagePayload;
  read_at: string | null;
  created_at: string;
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeUsername(value: string) {
  return value.trim().replace(/^@/, "").toLowerCase();
}

export function conversationKey(a: string, b: string) {
  return [normalizeEmail(a), normalizeEmail(b)].sort().join("|");
}

/** Создаёт или обновляет публичный профиль пользователя (для поиска). */
export async function upsertProfile(user: User): Promise<void> {
  const email = normalizeEmail(user.email);
  if (!email) return;
  const username = normalizeUsername(user.username);
  if (!username) return;
  const publicKey = await publicKeyFor(email);

  const { error } = await supabase.from(PROFILE_TABLE).upsert(
    {
      email,
      username,
      name: user.name,
      avatar: user.avatar ?? null,
      banner: user.banner ?? null,
      bio: user.bio ?? "",
      status: user.status ?? "",
      pinned_music: user.pinnedMusic ?? null,
      public_key: publicKey,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "email" },
  );

  if (error) throw error;
}

/**
 * Ищет профиль аккаунта по email. По нему вход отличает существующий
 * аккаунт (вход) от нового (регистрация), даже если на этом устройстве
 * ещё нет локальной копии.
 */
export async function findRemoteAccount(
  email: string,
): Promise<(ZeroProfile & { createdAt?: number }) | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  const { data, error } = await supabase
    .from(PROFILE_TABLE)
    .select("email,username,name,avatar,banner,bio,status,pinned_music,created_at")
    .eq("email", normalized)
    .maybeSingle<Record<string, unknown>>();

  if (error) throw error;
  if (data) {
    return {
      ...normalizeProfileRow(data),
      createdAt: data.created_at ? new Date(String(data.created_at)).getTime() : undefined,
    };
  }

  // Совместимость со старыми аккаунтами: профиль мог ещё не создаться,
  // но облачная копия (`zero_states`) или переписка уже есть. Тогда это
  // точно существующий пользователь, а не новая регистрация.
  const { data: cloud, error: cloudError } = await supabase
    .from("zero_states")
    .select("phone")
    .eq("phone", normalized)
    .maybeSingle<{ phone: string }>();
  if (cloudError) throw cloudError;

  // Имя и @username могли сохраниться в отправленных сообщениях.
  const { data: rows } = await supabase
    .from(MESSAGE_TABLE)
    .select("sender_name,sender_username,sender_avatar")
    .eq("sender_email", normalized)
    .order("created_at", { ascending: false })
    .limit(1);
  const row = (rows?.[0] ?? null) as
    | { sender_name?: string; sender_username?: string; sender_avatar?: string | null }
    | null;

  if (!cloud && !row) return null;

  const fallbackUsername =
    normalized.split("@")[0].replace(/[^a-z0-9_]/g, "_").slice(0, 24) || "user";

  return {
    email: normalized,
    username: normalizeUsername(row?.sender_username ?? "") || fallbackUsername,
    name: row?.sender_name || fallbackUsername,
    avatar: row?.sender_avatar ?? null,
    bio: "",
    status: "На связи",
  };
}

/** Занят ли @username другим аккаунтом. */
export async function isUsernameTaken(username: string, email: string): Promise<boolean> {
  const handle = normalizeUsername(username);
  if (!handle) return false;
  const { data, error } = await supabase
    .from(PROFILE_TABLE)
    .select("email,username")
    .ilike("username", handle)
    .limit(20);
  if (error) throw error;
  // `_` в LIKE — подстановочный символ, поэтому сверяем username точно.
  return (data ?? []).some(
    (row) =>
      normalizeUsername((row as { username: string }).username) === handle &&
      normalizeEmail((row as { email: string }).email) !== normalizeEmail(email),
  );
}

/** Ищет людей строго по @username. */
export async function searchProfiles(
  query: string,
  excludeEmail: string,
): Promise<ZeroProfile[]> {
  const q = query
    .trim()
    .replace(/^@/, "")
    // Запятые/скобки ломают синтаксис PostgREST-фильтра, а % и * — подстановки.
    // Подчёркивание оставляем: оно часто встречается в @username.
    .replace(/[%*,()]/g, " ")
    .trim()
    .toLowerCase();
  if (q.length < 2) return [];

  const { data, error } = await supabase
    .from(PROFILE_TABLE)
    .select("email,username,name,avatar,banner,bio,status,pinned_music")
    .ilike("username", `%${q}%`)
    .neq("email", normalizeEmail(excludeEmail))
    .limit(20);

  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(normalizeProfileRow);
}

/** Приводит строку `zero_profiles` к виду профиля приложения. */
export function normalizeProfileRow(row: Record<string, unknown>): ZeroProfile {
  return {
    email: normalizeEmail(String(row.email ?? "")),
    username: normalizeUsername(String(row.username ?? "")),
    name: String(row.name ?? row.username ?? ""),
    avatar: (row.avatar as string | null) ?? null,
    banner: (row.banner as string | null) ?? null,
    bio: String(row.bio ?? ""),
    status: String(row.status ?? ""),
    pinnedMusic: (row.pinned_music as ZeroProfile["pinnedMusic"]) ?? null,
  };
}

/** Публичный профиль по email — для карточки собеседника. */
export async function loadProfile(email: string): Promise<ZeroProfile | null> {
  const target = normalizeEmail(email);
  if (!target) return null;
  const { data, error } = await supabase
    .from(PROFILE_TABLE)
    .select("email,username,name,avatar,banner,bio,status,pinned_music")
    .eq("email", target)
    .maybeSingle<Record<string, unknown>>();
  if (error) throw error;
  return data ? normalizeProfileRow(data) : null;
}

/** Вся история диалога между двумя людьми, от старых к новым. */
export async function loadConversation(
  meEmail: string,
  peerEmail: string,
): Promise<RemoteMessageRow[]> {
  const key = conversationKey(meEmail, peerEmail);
  const { data, error } = await supabase
    .from(MESSAGE_TABLE)
    .select(
      "id,client_id,conversation,sender_email,recipient_email,sender_name,sender_username,sender_avatar,payload,read_at,created_at",
    )
    .eq("conversation", key)
    // Берём последние 500 сообщений (а не первые): в долгой переписке
    // важнее свежие, а не самые старые.
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) throw error;
  const rows = ((data ?? []) as RemoteMessageRow[]).reverse();
  return Promise.all(rows.map((row) => decryptRemoteRow(row, meEmail)));
}

/**
 * Последние входящие сообщения. Нужны при входе: Realtime ловит только
 * сообщения, пришедшие пока приложение открыто, а этот запрос "догоняет"
 * то, что написали, пока пользователь был офлайн.
 */
export async function loadRecentIncoming(
  meEmail: string,
  limit = 200,
): Promise<RemoteMessageRow[]> {
  const email = normalizeEmail(meEmail);
  if (!email) return [];
  const { data, error } = await supabase
    .from(MESSAGE_TABLE)
    .select(
      "id,client_id,conversation,sender_email,recipient_email,sender_name,sender_username,sender_avatar,payload,read_at,created_at",
    )
    .eq("recipient_email", email)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  const rows = (data ?? []) as RemoteMessageRow[];
  return Promise.all(rows.map((row) => decryptRemoteRow(row, email)));
}

/** Расшифровывает одно сообщение, пришедшее через Realtime. */
export async function decryptRemoteRow(
  row: RemoteMessageRow,
  meEmail: string,
): Promise<RemoteMessageRow> {
  const me = normalizeEmail(meEmail);
  const sender = normalizeEmail(row.sender_email);
  const peer = sender === me ? row.recipient_email : row.sender_email;
  const payload = await decryptPayload(me, peer, row.payload);
  const broken =
    isEncryptedPayload(row.payload) &&
    payload.kind === "text" &&
    payload.text === "Зашифрованное сообщение";
  if (!broken) return { ...row, payload };

  // Собеседник мог сохранить публичный ключ на секунду позже сообщения.
  // Даём профилю шанс появиться и пробуем ещё раз без вечной задержки.
  await new Promise((resolve) => window.setTimeout(resolve, 1200));
  refreshPeerKey(peer);
  const retry = await decryptPayload(me, peer, row.payload);
  return { ...row, payload: retry };
}

const syncedProfiles = new Set<string>();

/** Гарантирует, что публичный ключ отправителя уже лежит в профиле. */
async function ensureOwnProfile(user: User) {
  const email = normalizeEmail(user.email);
  if (!email || syncedProfiles.has(email)) return;
  try {
    await upsertProfile(user);
    syncedProfiles.add(email);
  } catch {
    // Повторим при следующем сообщении — без блокировки отправки.
  }
}

export async function sendRemoteMessage(input: {
  from: User;
  toEmail: string;
  toUsername: string;
  toName: string;
  payload: MessagePayload;
  clientId: string;
  at: number;
}): Promise<string> {
  const fromEmail = normalizeEmail(input.from.email);
  const toEmail = normalizeEmail(input.toEmail);
  if (!fromEmail || !toEmail) throw new Error("missing-email");

  await ensureOwnProfile(input.from);
  const payload = await encryptPayload(fromEmail, toEmail, input.payload);

  const { data, error } = await supabase
    .from(MESSAGE_TABLE)
    .insert({
      conversation: conversationKey(fromEmail, toEmail),
      client_id: input.clientId,
      sender_email: fromEmail,
      recipient_email: toEmail,
      sender_name: input.from.name,
      sender_username: normalizeUsername(input.from.username),
      sender_avatar: input.from.avatar ?? null,
      payload: payload as unknown as MessagePayload,
      created_at: new Date(input.at).toISOString(),
    })
    .select("id")
    .single();

  if (error) throw error;
  return String(data.id);
}

/** Отмечает все входящие сообщения от собеседника как прочитанные. */
export async function markConversationRead(
  meEmail: string,
  peerEmail: string,
): Promise<void> {
  const email = normalizeEmail(meEmail);
  const peer = normalizeEmail(peerEmail);
  if (!email || !peer) return;

  const { error } = await supabase
    .from(MESSAGE_TABLE)
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_email", email)
    .eq("sender_email", peer)
    .is("read_at", null);

  if (error) throw error;
}

/** Сохраняет новую версию своего сообщения в базе. */
export async function editRemoteMessage(input: {
  id?: string;
  clientId: string;
  senderEmail: string;
  peerEmail: string;
  payload: MessagePayload;
}): Promise<void> {
  const email = normalizeEmail(input.senderEmail);
  if (!email) throw new Error("missing-email");
  const payload = await encryptPayload(email, input.peerEmail, input.payload);

  let query = supabase
    .from(MESSAGE_TABLE)
    .update({ payload: payload as unknown as MessagePayload })
    .eq("sender_email", email);

  query = input.id ? query.eq("id", input.id) : query.eq("client_id", input.clientId);

  const { error } = await query;
  if (error) throw error;
}

/**
 * Правит сообщение группы: у каждого получателя свой шифр, поэтому
 * обновляем копии построчно, а не одним запросом.
 */
export async function editGroupMessage(input: {
  senderEmail: string;
  recipients: { email: string }[];
  clientId: string;
  payload: MessagePayload;
}): Promise<void> {
  const sender = normalizeEmail(input.senderEmail);
  if (!sender) throw new Error("missing-email");
  const copies = await Promise.all(
    input.recipients
      .map((recipient) => normalizeEmail(recipient.email))
      .filter((email) => Boolean(email))
      .map(async (email) => ({
        email,
        payload: await encryptPayload(sender, email, input.payload),
      })),
  );
  for (const copy of copies) {
    const { error } = await supabase
      .from(MESSAGE_TABLE)
      .update({ payload: copy.payload as unknown as MessagePayload })
      .eq("sender_email", sender)
      .eq("client_id", input.clientId)
      .eq("recipient_email", copy.email);
    if (error) throw error;
  }
}

/** Удаляет сообщение из базы у всех участников. */
export async function deleteRemoteMessage(input: {
  id?: string;
  clientId: string;
  meEmail: string;
}): Promise<void> {
  let query = supabase.from(MESSAGE_TABLE).delete();
  if (input.id) {
    query = query.eq("id", input.id);
  } else {
    const email = normalizeEmail(input.meEmail);
    if (!email) throw new Error("missing-email");
    query = query.eq("client_id", input.clientId).eq("sender_email", email);
  }

  const { error } = await query;
  if (error) throw error;
}

/** Полностью очищает диалог в базе (для «Очистить историю»). */
export async function deleteConversation(
  meEmail: string,
  peerEmail: string,
): Promise<void> {
  const me = normalizeEmail(meEmail);
  const peer = normalizeEmail(peerEmail);
  if (!me || !peer) return;
  const { error } = await supabase
    .from(MESSAGE_TABLE)
    .delete()
    .eq("conversation", conversationKey(me, peer));
  if (error) throw error;
}

/** Удаляет пачку сообщений по id (используется для групп). */
export async function deleteRemoteMessagesByIds(ids: string[]): Promise<void> {
  const unique = [...new Set(ids.filter(Boolean))];
  for (let index = 0; index < unique.length; index += 80) {
    const chunk = unique.slice(index, index + 80);
    if (chunk.length === 0) continue;
    const { error } = await supabase.from(MESSAGE_TABLE).delete().in("id", chunk);
    if (error) throw error;
  }
}

/** Удаляет мои копии групповых сообщений по client_id. */
export async function deleteOwnMessagesByClientIds(
  meEmail: string,
  clientIds: string[],
): Promise<void> {
  const me = normalizeEmail(meEmail);
  const unique = [...new Set(clientIds.filter(Boolean))];
  if (!me || unique.length === 0) return;
  for (let index = 0; index < unique.length; index += 80) {
    const chunk = unique.slice(index, index + 80);
    const { error } = await supabase
      .from(MESSAGE_TABLE)
      .delete()
      .eq("sender_email", me)
      .in("client_id", chunk);
    if (error) throw error;
  }
}

/** Сохраняет блокировку пользователя. Сервер сам отклонит @zero. */
export async function blockRemoteUser(input: {
  blockerEmail: string;
  blockedEmail?: string | null;
  blockedUsername?: string | null;
}): Promise<void> {
  const blocker = normalizeEmail(input.blockerEmail);
  if (!blocker) throw new Error("missing-email");
  const { error } = await supabase.from("zero_blocks").insert({
    blocker_email: blocker,
    blocked_email: input.blockedEmail ? normalizeEmail(input.blockedEmail) : null,
    blocked_username: input.blockedUsername ? normalizeUsername(input.blockedUsername) : null,
  });
  if (error) throw error;
}

/** Подписка на входящие сообщения текущего пользователя через Realtime. */
export function subscribeToIncoming(
  meEmail: string,
  onRow: (row: RemoteMessageRow) => void,
  onUpdate?: (row: RemoteMessageRow) => void,
  onPeerUpdate?: (row: RemoteMessageRow) => void,
  onDelete?: (row: Partial<RemoteMessageRow>) => void,
) {
  const email = normalizeEmail(meEmail);
  const channelName = `zero-chat-${email.replace(/[^a-z0-9]/gi, "-")}`;

  let channel = supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: MESSAGE_TABLE,
        filter: `recipient_email=eq.${email}`,
      },
      (event) => {
        const row = event.new as RemoteMessageRow | null;
        if (row?.id) onRow(row);
      },
    );

  if (onUpdate) {
    channel = channel.on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: MESSAGE_TABLE,
        filter: `sender_email=eq.${email}`,
      },
      (event) => {
        const row = event.new as RemoteMessageRow | null;
        if (row?.id) onUpdate(row);
      },
    );
  }

  if (onPeerUpdate) {
    channel = channel.on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: MESSAGE_TABLE,
        filter: `recipient_email=eq.${email}`,
      },
      (event) => {
        const row = event.new as RemoteMessageRow | null;
        if (row?.id) onPeerUpdate(row);
      },
    );
  }

  if (onDelete) {
    channel = channel.on(
      "postgres_changes",
      {
        event: "DELETE",
        schema: "public",
        table: MESSAGE_TABLE,
      },
      (event) => {
        const row = event.old as Partial<RemoteMessageRow> | null;
        if (row?.id) onDelete(row);
      },
    );
  }

  return channel.subscribe();
}
