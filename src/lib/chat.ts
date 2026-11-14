import type { MessagePayload, User } from "../types";
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
  bio: string;
  status: string;
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

  const { error } = await supabase.from(PROFILE_TABLE).upsert(
    {
      email,
      username,
      name: user.name,
      avatar: user.avatar ?? null,
      bio: user.bio ?? "",
      status: user.status ?? "",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "email" },
  );

  if (error) throw error;
}

/** Ищет людей по @username, email или имени. */
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
    .select("email,username,name,avatar,bio,status")
    .or(`username.ilike.%${q}%,email.ilike.%${q}%,name.ilike.%${q}%`)
    .neq("email", normalizeEmail(excludeEmail))
    .limit(20);

  if (error) throw error;
  return (data ?? []) as ZeroProfile[];
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
  return ((data ?? []) as RemoteMessageRow[]).reverse();
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
  return (data ?? []) as RemoteMessageRow[];
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
      payload: input.payload,
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

/** Подписка на входящие сообщения текущего пользователя через Realtime. */
export function subscribeToIncoming(
  meEmail: string,
  onRow: (row: RemoteMessageRow) => void,
  onUpdate?: (row: RemoteMessageRow) => void,
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

  return channel.subscribe();
}
