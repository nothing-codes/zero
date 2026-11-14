import type { AppState } from "../types";
import { decryptState, encryptState, identityBackup, isEncryptedState, type EncryptedState } from "./e2ee";
import { deviceId } from "./devices";
import { supabase } from "./supabase";

/**
 * Cloud backup на Supabase.
 *
 * Локальное состояние остаётся источником истины (localStorage), а облако
 * получает резервную копию. Так приложение работает и без интернета.
 * SQL-схема таблицы лежит в supabase/schema.sql.
 *
 * Вход теперь по email (Gmail), поэтому в колонке `phone` таблицы
 * `zero_states` хранится нормализованный email — это просто ключ аккаунта.
 * Колонка сохранена для совместимости со старой схемой.
 */
export const CLOUD_TABLE = "zero_states";

export type CloudState = Pick<AppState, "version" | "user" | "chats" | "calls" | "settings"> & {
  /** Приватный ключ шифрования — нужен для входа с другого устройства. */
  identity?: EncryptedState | null;
  /** Устройство, сделавшее последнюю запись (чтобы не применять своё же эхо). */
  device?: string;
  /** Время записи в миллисекундах — защита от применения устаревшей копии. */
  savedAt?: number;
};

export interface CloudSnapshot extends CloudState {
  updated_at?: string;
}

export function accountKey(email: string) {
  return email.trim().toLowerCase();
}

export async function saveCloudState(email: string, state: AppState): Promise<void> {
  const key = accountKey(email);
  if (!key || !state.user) return;

  const identity = await identityBackup(key).catch(() => null);
  const payload: CloudState = {
    version: state.version,
    user: state.user,
    chats: state.chats,
    calls: state.calls,
    settings: state.settings,
    device: deviceId(),
    savedAt: Date.now(),
    ...(identity ? { identity } : {}),
  };

  const encrypted = await encryptState(payload, key);
  const { error } = await supabase
    .from(CLOUD_TABLE)
    .upsert({ phone: key, state: encrypted, updated_at: new Date().toISOString() }, { onConflict: "phone" });

  if (error) throw error;
}

export async function loadCloudState(email: string): Promise<CloudSnapshot | null> {
  const key = accountKey(email);
  if (!key) return null;

  const { data, error } = await supabase
    .from(CLOUD_TABLE)
    .select("state, updated_at")
    .eq("phone", key)
    .maybeSingle<{ state: unknown; updated_at: string }>();

  if (error || !data?.state) return null;

  if (isEncryptedState(data.state)) {
    try {
      const decrypted = await decryptState<CloudState>(data.state, key);
      return decrypted ? { ...decrypted, updated_at: data.updated_at } : null;
    } catch {
      // Ключ этого устройства не подходит — облачная копия недоступна.
      return null;
    }
  }

  // Старые незашифрованные копии: читаем один раз, при следующем сохранении
  // они перезапишутся зашифрованными.
  const legacy = data.state as CloudState;
  if (!legacy || typeof legacy !== "object") return null;
  return { ...legacy, updated_at: data.updated_at };
}

/**
 * Живая синхронизация всей копии аккаунта: как только другое устройство
 * сохраняет настройки/профиль/чаты, оно присылает зашифрованный снимок сюда.
 */
export function subscribeCloudState(
  email: string,
  onChange: (snapshot: CloudSnapshot) => void,
) {
  const key = accountKey(email);
  if (!key) return null;
  return supabase
    .channel(`zero-state-${key.replace(/[^a-z0-9]/gi, "-")}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: CLOUD_TABLE,
        filter: `phone=eq.${key}`,
      },
      (event) => {
        const row = event.new as { state?: unknown; updated_at?: string } | null;
        if (!row?.state) return;
        void (async () => {
          try {
            let snapshot: CloudState | null = null;
            if (isEncryptedState(row.state)) {
              snapshot = await decryptState<CloudState>(row.state, key);
            } else if (row.state && typeof row.state === "object") {
              snapshot = row.state as CloudState;
            }
            if (snapshot) onChange({ ...snapshot, updated_at: row.updated_at });
          } catch {
            /* ключ ещё не готов или чужое устройство — попробуем позже */
          }
        })();
      },
    )
    .subscribe();
}
