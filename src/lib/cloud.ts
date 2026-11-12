import type { AppState } from "../types";
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

export type CloudState = Pick<AppState, "version" | "user" | "chats" | "calls" | "settings">;

export interface CloudSnapshot extends CloudState {
  updated_at?: string;
}

export function accountKey(email: string) {
  return email.trim().toLowerCase();
}

export async function saveCloudState(email: string, state: AppState): Promise<void> {
  const key = accountKey(email);
  if (!key || !state.user) return;

  const payload: CloudState = {
    version: state.version,
    user: state.user,
    chats: state.chats,
    calls: state.calls,
    settings: state.settings,
  };

  const { error } = await supabase
    .from(CLOUD_TABLE)
    .upsert({ phone: key, state: payload, updated_at: new Date().toISOString() }, { onConflict: "phone" });

  if (error) throw error;
}

export async function loadCloudState(email: string): Promise<CloudSnapshot | null> {
  const key = accountKey(email);
  if (!key) return null;

  const { data, error } = await supabase
    .from(CLOUD_TABLE)
    .select("state, updated_at")
    .eq("phone", key)
    .maybeSingle<{ state: CloudState; updated_at: string }>();

  if (error || !data?.state) return null;
  return { ...data.state, updated_at: data.updated_at };
}
