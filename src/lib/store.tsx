import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  AppState,
  CallRecord,
  Chat,
  GroupMember,
  Message,
  MessageGroupInfo,
  MessageKind,
  MessagePayload,
  MessageStatus,
  MediaEncryption,
  Settings,
  ToastData,
  User,
} from "../types";
import { createInitialState, DEFAULT_SETTINGS, STATE_VERSION } from "./data";
import { loadCloudState, saveCloudState, subscribeCloudState, type CloudSnapshot } from "./cloud";
import { supabase } from "./supabase";
import {
  blockRemoteUser,
  deleteConversation,
  deleteOwnMessagesByClientIds,
  deleteRemoteMessage,
  deleteRemoteMessagesByIds,
  decryptRemoteRow,
  editGroupMessage,
  editRemoteMessage,
  loadConversation,
  loadProfile,
  loadRecentAccount,
  markConversationRead,
  normalizeEmail,
  normalizeProfileRow,
  normalizeUsername,
  sendRemoteMessage,
  subscribeToIncoming,
  undecryptable,
  upsertProfile,
  type RemoteMessageRow,
  type ZeroProfile,
} from "./chat";
import {
  applyPollVotes,
  castPollVote,
  loadPollVotes,
  pollIdOf,
  subscribePollVotes,
} from "./polls";
import { deviceId, deviceStillActive, registerDevice, subscribeDeviceRevoked } from "./devices";
import { subscribePresence } from "./presence";
import { deleteStoragePaths, storagePathFromUrl } from "./files";
import { isZeroIdentity } from "./identity";
import { migrateLegacyContent } from "./migrate";
import { haptic, isAudioFile, stripEmoji, uid } from "./utils";
import {
  playTone,
  setBadge,
  showExternalNotification,
} from "./feedback";

const STORAGE_KEY = "zero:state:v1";
export const SAVED_CHAT_ID = "c_saved";

function savedChat(): Chat {
  return {
    id: SAVED_CHAT_ID,
    name: "Избранное",
    saved: true,
    unread: 0,
    messages: [],
    historyLoaded: true,
  };
}

function withSavedChat(chats: Chat[]): Chat[] {
  if (chats.some((chat) => chat.id === SAVED_CHAT_ID || chat.saved)) return chats;
  return [savedChat(), ...chats];
}

/** Похоже ли значение на почту (старые копии могли сохранять email в имени). */
function looksLikeEmail(value?: string | null): boolean {
  return Boolean(value && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim()));
}

/** Если имя потерялось и подставилась почта — показываем @username. */
function preferredName(name?: string | null, username?: string | null): string {
  const cleanName = stripEmoji(name ?? "");
  const handle = (username ?? "").trim().replace(/^@/, "");
  if (handle && (!cleanName || looksLikeEmail(cleanName))) return handle;
  return cleanName || handle;
}

function cleanUser(user: User | null): User | null {
  if (!user) return user;
  // Убираем дефолтную картинку из ранней версии — теперь у профиля чёрная аватарка.
  const next = user.avatar === "/avatar-me.svg" ? { ...user, avatar: null } : user;
  return {
    ...next,
    email: (next.email ?? "").trim().toLowerCase(),
    name: preferredName(next.name, next.username),
    bio: stripEmoji(next.bio),
    status: stripEmoji(next.status),
  };
}

function cleanChats(chats: Chat[]): Chat[] {
  return chats.map((chat) => ({
    ...chat,
    // Чат Zero — настоящий аккаунт: сообщения и файлы уходят на сервер.
    remote: chat.id === "c_zero" ? true : chat.remote,
    typing: false,
    name: preferredName(chat.name, chat.username),
    messages: chat.messages.map((message) => {
      const next = {
        ...message,
        fresh: false,
        text: message.text ? stripEmoji(message.text) : message.text,
        sender: message.sender ? stripEmoji(message.sender) : message.sender,
        forwardedFrom: message.forwardedFrom ? stripEmoji(message.forwardedFrom) : message.forwardedFrom,
      };
      if (next.photo?.caption) {
        next.photo = { ...next.photo, caption: stripEmoji(next.photo.caption) };
      }
      if (next.file?.name) {
        next.file = { ...next.file, name: stripEmoji(next.file.name) };
      }
      if (next.location) {
        next.location = {
          ...next.location,
          title: stripEmoji(next.location.title),
          subtitle: next.location.subtitle ? stripEmoji(next.location.subtitle) : next.location.subtitle,
        };
      }
      if (next.poll) {
        next.poll = {
          ...next.poll,
          question: stripEmoji(next.poll.question),
          options: next.poll.options.map((option) => ({ ...option, text: stripEmoji(option.text) })),
        };
      }
      if (next.voice?.src?.startsWith("blob:")) {
        next.voice = { ...next.voice, src: undefined };
      }
      if (next.videoNote?.src?.startsWith("blob:")) {
        next.videoNote = { ...next.videoNote, src: undefined };
      }
      return next;
    }),
  }));
}

function mergeState(raw: unknown): AppState {
  const base = createInitialState();
  if (!raw || typeof raw !== "object") return base;
  const parsed = raw as Partial<AppState>;
  if (!Array.isArray(parsed.chats) || !Array.isArray(parsed.calls)) return base;

  const version = typeof parsed.version === "number" ? parsed.version : 1;
  // v2: убираем старые демо-чаты — остаётся только чат с Zero.
  const chats =
    version < 2
      ? (JSON.parse(JSON.stringify(base.chats)) as Chat[])
      : withSavedChat(cleanChats(parsed.chats));

  const accounts: Record<string, User> = {};
  for (const [key, account] of Object.entries(parsed.accounts ?? {})) {
    const next = cleanUser(account);
    if (next) accounts[key] = next;
  }

  const chatAccounts: Record<string, Chat[]> = {};
  for (const [key, chats] of Object.entries(parsed.chatAccounts ?? {})) {
    if (Array.isArray(chats)) chatAccounts[accountKey(key)] = withSavedChat(cleanChats(chats));
  }

  return {
    version: STATE_VERSION,
    onboarded: Boolean(parsed.onboarded),
    user: cleanUser(parsed.user ?? null),
    accounts,
    chatAccounts,
    chats,
    calls: parsed.calls,
    settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
  };
}

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialState();
    return mergeState(JSON.parse(raw));
  } catch {
    return createInitialState();
  }
}

function accountKey(email: string) {
  return email.trim().toLowerCase();
}

/** Устойчивый ключ чата: id на разных устройствах разные. */
function chatKeyOf(chat: Chat): string {
  if (chat.saved) return "saved";
  if (chat.id === "c_zero") return "c_zero";
  if (chat.group?.key) return `group:${chat.group.key}`;
  if (chat.email) return `email:${normalizeEmail(chat.email)}`;
  return `id:${chat.id}`;
}

function messageKeyOf(message: Message): string {
  return message.remoteId ? `r:${message.remoteId}` : `i:${message.id}`;
}

function mergeMessages(local: Message[], remote: Message[]): Message[] {
  const map = new Map<string, Message>();
  for (const message of remote) map.set(messageKeyOf(message), message);
  for (const message of local) {
    const key = messageKeyOf(message);
    const other = map.get(key);
    map.set(
      key,
      other
        ? {
            ...message,
            ...other,
            id: message.id,
            chatId: message.chatId,
            fromMe: message.fromMe,
            fresh: message.fresh,
            status: message.status ?? other.status,
            sender: message.sender ?? other.sender,
            senderAvatar: other.senderAvatar ?? message.senderAvatar,
          }
        : message,
    );
  }
  return [...map.values()].sort((a, b) => a.at - b.at);
}

function mergeRemoteChats(localChats: Chat[], remoteChats: Chat[]): Chat[] {
  const local = new Map(localChats.map((chat) => [chatKeyOf(chat), chat]));
  const seen = new Set<string>();
  const result: Chat[] = [];

  for (const remote of remoteChats) {
    const key = chatKeyOf(remote);
    seen.add(key);
    const mine = local.get(key);
    if (!mine) {
      result.push(remote);
      continue;
    }
    result.push({
      ...mine,
      name: remote.name || mine.name,
      username: remote.username ?? mine.username,
      email: remote.email ?? mine.email,
      phone: remote.phone ?? mine.phone,
      avatar: remote.avatar ?? mine.avatar,
      verified: remote.verified ?? mine.verified,
      group: remote.group ?? mine.group,
      pinnedChat: remote.pinnedChat ?? mine.pinnedChat,
      muted: remote.muted ?? mine.muted,
      saved: Boolean(mine.saved || remote.saved),
      remote: Boolean(mine.remote || remote.remote),
      historyLoaded: Boolean(mine.historyLoaded || remote.historyLoaded),
      messages: mergeMessages(mine.messages, remote.messages),
    });
  }

  // Локальные чаты, которых ещё нет в облаке, не теряем.
  for (const chat of localChats) {
    if (!seen.has(chatKeyOf(chat))) result.push(chat);
  }
  return withSavedChat(result);
}

function mergeCalls(local: CallRecord[], remote: CallRecord[]): CallRecord[] {
  const map = new Map<string, CallRecord>();
  for (const call of remote) map.set(call.id, call);
  for (const call of local) if (!map.has(call.id)) map.set(call.id, call);
  return [...map.values()].sort((a, b) => b.at - a.at);
}

/** Применяет снимок другого устройства и возвращает тот же объект, если ничего не изменилось. */
function applyCloudSnapshot(prev: AppState, snapshot: CloudSnapshot): AppState {
  if (!prev.user) return prev;
  const email = accountKey(prev.user.email || prev.user.phone || "");

  const user: User = snapshot.user
    ? { ...prev.user, ...snapshot.user, id: prev.user.id, createdAt: prev.user.createdAt }
    : prev.user;
  const settings: Settings = snapshot.settings
    ? { ...DEFAULT_SETTINGS, ...snapshot.settings }
    : prev.settings;
  const calls = Array.isArray(snapshot.calls)
    ? mergeCalls(prev.calls, snapshot.calls)
    : prev.calls;
  const chats = Array.isArray(snapshot.chats)
    ? mergeRemoteChats(prev.chats, cleanChats(snapshot.chats))
    : prev.chats;

  const same =
    JSON.stringify(user) === JSON.stringify(prev.user) &&
    JSON.stringify(settings) === JSON.stringify(prev.settings) &&
    JSON.stringify(calls) === JSON.stringify(prev.calls) &&
    JSON.stringify(chats) === JSON.stringify(prev.chats);
  if (same) return prev;

  return {
    ...prev,
    user,
    accounts: email ? { ...prev.accounts, [email]: user } : prev.accounts,
    settings,
    calls,
    chats,
  };
}

/** Восстанавливает аккаунт из публичного профиля на новом устройстве. */
function userFromProfile(profile: ZeroProfile & { createdAt?: number }): User {
  const email = accountKey(profile.email);
  const handle = normalizeUsername(profile.username);
  const fallback = handle || email.split("@")[0] || "user";
  return {
    id: uid("u"),
    name: preferredName(profile.name, handle) || fallback,
    username:
      handle ||
      fallback.replace(/[^a-z0-9_]/g, "_").slice(0, 24) ||
      "user",
    email,
    bio: stripEmoji(profile.bio ?? ""),
    status: stripEmoji(profile.status ?? "") || "На связи",
    avatar: profile.avatar ?? null,
    banner: profile.banner ?? null,
    pinnedMusic: profile.pinnedMusic ?? null,
    createdAt: profile.createdAt ?? Date.now(),
  };
}

function previewOf(message: Message): string {
  switch (message.kind) {
    case "sticker":
      return "Стикер";
    case "voice":
      return `Голосовое сообщение · ${message.voice?.duration ?? 0} сек`;
    case "videoNote":
      return "Видеосообщение";
    case "photo":
      return message.photo?.caption ? `Фото · ${message.photo.caption}` : "Фотография";
    case "file":
      return isAudioFile(message.file)
        ? `Музыка · ${message.file?.name ?? ""}`
        : `Файл · ${message.file?.name ?? ""}`;
    case "location":
      return `Геопозиция · ${message.location?.title ?? ""}`;
    case "poll":
      return `Опрос · ${message.poll?.question ?? ""}`;
    default:
      return message.text ?? "";
  }
}

function groupInfoOf(chat: Chat): MessageGroupInfo | undefined {
  if (!chat.group?.key) return undefined;
  return {
    key: chat.group.key,
    title: chat.name,
    kind: chat.group.kind ?? "group",
    members: chat.group.memberList?.map((member) => member.email) ?? [],
    ownerEmail: chat.group.ownerEmail,
    avatar: chat.avatar ?? null,
  };
}

function payloadOf(message: Message, chat?: Chat): MessagePayload {
  return {
    kind: message.kind,
    text: message.text,
    sticker: message.sticker,
    voice: message.voice,
    videoNote: message.videoNote,
    photo: message.photo,
    file: message.file,
    location: message.location,
    poll: message.poll,
    replyTo: message.replyTo,
    forwardedFrom: message.forwardedFrom,
    edited: message.edited,
    system: message.system,
    group: chat ? groupInfoOf(chat) : message.group,
  };
}

export function chatPreview(chat: Chat): string {
  const last = chat.messages[chat.messages.length - 1];
  if (!last) return chat.saved ? "Личные заметки" : "Нет сообщений";
  if (chat.typing) return "печатает…";
  if (last.fromMe) {
    return last.kind === "text" ? `Вы: ${last.text ?? ""}` : `Вы: ${previewOf(last)}`;
  }
  const prefix = chat.group && last.sender ? `${last.sender}: ` : "";
  return `${prefix}${previewOf(last)}`;
}

export type SendPayload = MessagePayload;

interface StoreValue {
  state: AppState;
  user: User | null;
  totalUnread: number;
  toast: ToastData | null;
  dismissToast: () => void;
  setOnboarded: () => void;
  /** Входит в существующий аккаунт; профиль из базы нужен на новом устройстве. */
  loginExisting: (
    email: string,
    profile?: (ZeroProfile & { createdAt?: number }) | null,
  ) => User | null;
  completeSignup: (input: {
    email: string;
    name: string;
    username: string;
    avatar?: string | null;
    bio?: string;
    status?: string;
  }) => void;
  logout: () => void;
  updateProfile: (patch: Partial<User>) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  sendMessage: (chatId: string, data: SendPayload) => string | undefined;
  setMessageMediaSource: (chatId: string, messageId: string, kind: "voice" | "videoNote" | "file", src: string, enc?: MediaEncryption) => void;
  receiveMessage: (
    chatId: string,
    data: SendPayload,
    meta?: { id?: string; at?: number },
  ) => void;
  loadChatHistory: (chatId: string) => Promise<void>;
  forwardMessage: (targetChatId: string, messageId: string) => void;
  setActiveChat: (id: string | null) => void;
  setTyping: (chatId: string, typing: boolean) => void;
  markRead: (chatId: string) => void;
  markAllRead: () => void;
  setDraft: (chatId: string, draft: string) => void;
  togglePinChat: (chatId: string) => void;
  deleteChat: (chatId: string) => void;
  restoreChat: (chat: Chat) => void;
  react: (chatId: string, messageId: string, emoji: string) => void;
  deleteMessage: (chatId: string, messageId: string) => Promise<boolean>;
  editMessage: (chatId: string, messageId: string, text: string) => Promise<boolean>;
  pinMessage: (chatId: string, messageId: string) => void;
  votePoll: (chatId: string, messageId: string, optionId: string) => void;
  openOrCreateChat: (contact: {
    name: string;
    username?: string;
    email?: string;
    phone?: string;
    online?: boolean;
    lastSeen?: number;
    avatar?: string | null;
    remote?: boolean;
  }) => string;
  createGroup: (input: {
    name: string;
    kind: "group" | "channel";
    avatar?: string | null;
    description?: string;
    members: GroupMember[];
  }) => string;
  updateGroup: (
    chatId: string,
    patch: { name?: string; avatar?: string | null; description?: string },
  ) => void;
  addGroupMembers: (chatId: string, members: GroupMember[]) => void;
  removeGroupMember: (chatId: string, email: string) => void;
  addCall: (call: Omit<CallRecord, "id" | "at">) => void;
  clearMessages: (chatId: string) => Promise<boolean>;
  blockChat: (chatId: string) => Promise<boolean>;
  syncPollVotes: (chatId: string) => Promise<void>;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(loadState);
  const stateRef = useRef(state);
  const activeChatRef = useRef<string | null>(null);
  const cloudPulledFor = useRef<string | null>(null);
  const lastCloudSync = useRef(0);
  const syncedFor = useRef<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const [toast, setToast] = useState<ToastData | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const commit = useCallback((updater: (prev: AppState) => AppState) => {
    const next = updater(stateRef.current);
    stateRef.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage full */
    }
  }, [state]);

  // Восстанавливаем резервную копию из Supabase один раз за сессию, если в
  // облаке больше сообщений, чем локально. Локальные данные не перетираются.
  useEffect(() => {
    const currentUser = state.user;
    if (!currentUser) {
      cloudPulledFor.current = null;
      return;
    }
    if (cloudPulledFor.current === currentUser.id) return;
    cloudPulledFor.current = currentUser.id;

    void (async () => {
      try {
        const remote = await loadCloudState(currentUser.email || currentUser.phone || "");
        if (!remote?.chats) return;
        commit((prev) => {
          if (prev.user?.id !== currentUser.id) return prev;
          // Локальное состояние — источник истины. Восстанавливаем облачную
          // копию только на новом устройстве, где ещё нет живой истории.
          // Иначе удалённые чаты и очищенная история «возвращались» бы.
          const hasRealHistory = prev.chats.some(
            (chat) =>
              !chat.saved &&
              chat.id !== "c_zero" &&
              (chat.remote || chat.group || chat.messages.length > 3),
          );
          if (hasRealHistory) return prev;
          // На новом устройстве локально только стандартные чаты — облачную
          // копию принимаем целиком, даже если сообщений в ней пока немного.
          const freshDevice = prev.chats.every(
            (chat) => chat.id === "c_saved" || chat.id === "c_zero",
          );
          const localMessages = prev.chats.reduce((sum, chat) => sum + chat.messages.length, 0);
          const remoteMessages = remote.chats.reduce((sum, chat) => sum + chat.messages.length, 0);
          if (!freshDevice && remoteMessages <= localMessages) return prev;
          return {
            ...prev,
            chats: withSavedChat(cleanChats(remote.chats)),
            calls: Array.isArray(remote.calls) ? remote.calls : prev.calls,
            settings: { ...prev.settings, ...remote.settings },
          };
        });
      } catch {
        /* офлайн — продолжаем с локальным состоянием */
      }
    })();
  }, [state.user, commit]);

  // Тихий backup в Supabase (debounce, локальное состояние важнее).
  useEffect(() => {
    if (!state.user) return;
    const account = state.user.email || state.user.phone || "";
    if (!account) return;
    const timer = window.setTimeout(() => {
      void saveCloudState(account, state).catch(() => undefined);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [state]);

  // Живая синхронизация всей копии аккаунта между устройствами: настройки,
  // профиль, чаты и звонки применяются сразу, без перезагрузки.
  useEffect(() => {
    const current = state.user;
    if (!current?.email) return;
    const email = normalizeEmail(current.email);

    const applyRemote = (snapshot: CloudSnapshot) => {
      // Своё же эхо после сохранения игнорируем.
      if (snapshot.device && snapshot.device === deviceId()) return;
      const stamp =
        snapshot.savedAt ??
        (snapshot.updated_at ? Date.parse(snapshot.updated_at) : 0);
      if (stamp && stamp <= lastCloudSync.current) return;
      lastCloudSync.current = stamp || Date.now();

      commit((prev) => {
        if (!prev.user || normalizeEmail(prev.user.email) !== email) return prev;
        return applyCloudSnapshot(prev, snapshot);
      });
    };

    const channel = subscribeCloudState(email, applyRemote);
    // Запасной догон на случай, если Realtime для таблицы ещё не включён.
    const timer = window.setInterval(() => {
      void loadCloudState(email)
        .then((snapshot) => {
          if (snapshot) applyRemote(snapshot);
        })
        .catch(() => undefined);
    }, 15_000);

    return () => {
      window.clearInterval(timer);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [state.user?.email, commit]);

  // Публичный профиль: по нему другие люди находят вас через @username.
  // Запись идёт с задержкой и строго по очереди: иначе ответы upsert могли
  // приходить в старом порядке и «перезаписывать» закреплённую музыку null.
  const profileWrite = useRef<Promise<void>>(Promise.resolve());
  const profileSyncTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!state.user?.email) return;
    migrateLegacyContent(state.user.email);

    const user = state.user;
    const settings = state.settings;
    if (profileSyncTimer.current) window.clearTimeout(profileSyncTimer.current);
    profileSyncTimer.current = window.setTimeout(() => {
      profileSyncTimer.current = null;
      profileWrite.current = profileWrite.current
        .catch(() => undefined)
        .then(() => upsertProfile(user, settings))
        .catch(() => undefined);
    }, 320);

    return () => {
      if (profileSyncTimer.current) {
        window.clearTimeout(profileSyncTimer.current);
        profileSyncTimer.current = null;
      }
    };
  }, [state.user, state.settings.lastSeen, state.settings.profilePhoto, state.settings.phoneNumber]);

  // При входе берём профиль с сервера, чтобы удалённые баннер и музыка
  // не оставались в локальной копии.
  useEffect(() => {
    const current = state.user;
    if (!current?.email) return;
    const email = normalizeEmail(current.email);
    let cancelled = false;

    void loadProfile(email)
      .then((profile) => {
        if (cancelled) return;
        commit((prev) => {
          if (!prev.user || normalizeEmail(prev.user.email) !== email) return prev;
          const next: User = profile
            ? {
                ...prev.user,
                name: profile.name || prev.user.name,
                username: profile.username || prev.user.username,
                avatar: profile.avatar ?? null,
                banner: profile.banner ?? null,
                bio: profile.bio,
                status: profile.status || prev.user.status,
                // Пустой ответ сервера не должен снимать закреплённую музыку:
                // иначе трек «сам» открепляется при каждой синхронизации.
                pinnedMusic: profile.pinnedMusic ?? prev.user.pinnedMusic ?? null,
              }
            : {
                ...prev.user,
                banner: null,
                pinnedMusic: prev.user.pinnedMusic ?? null,
              };
          const changed =
            next.name !== prev.user.name ||
            next.username !== prev.user.username ||
            next.avatar !== prev.user.avatar ||
            next.banner !== prev.user.banner ||
            next.bio !== prev.user.bio ||
            next.status !== prev.user.status ||
            JSON.stringify(next.pinnedMusic ?? null) !== JSON.stringify(prev.user.pinnedMusic ?? null);
          if (!changed) return prev;
          return { ...prev, user: next, accounts: { ...prev.accounts, [email]: next } };
        });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [state.user?.email, commit]);

  // Профиль, изменённый на другом устройстве, сразу появляется здесь.
  useEffect(() => {
    const current = state.user;
    if (!current?.email) return;
    const email = normalizeEmail(current.email);
    const channel = supabase
      .channel(`zero-profile-${email.replace(/[^a-z0-9]/gi, "-")}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "zero_profiles",
          filter: `email=eq.${email}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown> | null;
          if (!row) return;
          const profile = normalizeProfileRow(row);
          commit((prev) => {
            if (!prev.user || normalizeEmail(prev.user.email) !== email) return prev;
            const next: User = {
              ...prev.user,
              name: profile.name || prev.user.name,
              username: profile.username || prev.user.username,
              avatar: profile.avatar ?? null,
              banner: profile.banner ?? null,
              bio: profile.bio,
              status: profile.status || prev.user.status,
              pinnedMusic: profile.pinnedMusic ?? prev.user.pinnedMusic ?? null,
            };
            const changed =
              next.name !== prev.user.name ||
              next.username !== prev.user.username ||
              next.avatar !== prev.user.avatar ||
              next.banner !== prev.user.banner ||
              next.bio !== prev.user.bio ||
              next.status !== prev.user.status ||
              JSON.stringify(next.pinnedMusic ?? null) !== JSON.stringify(prev.user.pinnedMusic ?? null);
            if (!changed) return prev;
            return {
              ...prev,
              user: next,
              accounts: { ...prev.accounts, [email]: next },
            };
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "zero_profiles" },
        (payload) => {
          const old = payload.old as { email?: string } | null;
          if (!old?.email || normalizeEmail(old.email) !== email) return;
          commit((prev) => {
            if (!prev.user || normalizeEmail(prev.user.email) !== email) return prev;
            if (!prev.user.banner && !prev.user.pinnedMusic) return prev;
            const next: User = { ...prev.user, banner: null, pinnedMusic: null };
            return { ...prev, user: next, accounts: { ...prev.accounts, [email]: next } };
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [state.user?.email, commit]);

  // Онлайн-статусы в реальном времени. Presence обновляет точку у аватара
  // и «был(а) в сети…» у всех собеседников, а не только после сообщения.
  useEffect(() => {
    const currentUser = state.user;
    if (!currentUser?.email) return;
    const session = subscribePresence(
      {
        email: currentUser.email,
        name: currentUser.name,
        username: currentUser.username,
        avatar: currentUser.avatar,
        lastSeenVisibility: state.settings.lastSeen,
      },
      (map) => {
        commit((prev) => ({
          ...prev,
          chats: prev.chats.map((chat) => {
            if (!chat.email || chat.group || chat.saved) return chat;
            const entry = map[normalizeEmail(chat.email)];
            if (entry) {
              if (!entry.online) {
                if (!chat.online && chat.lastSeen === undefined) return chat;
                return { ...chat, online: false, lastSeen: undefined };
              }
              if (chat.online && chat.lastSeen) return chat;
              return { ...chat, online: true, lastSeen: Math.max(chat.lastSeen ?? 0, entry.at) };
            }
            if (!chat.online) return chat;
            return { ...chat, online: false, lastSeen: Date.now() };
          }),
        }));
      },
    );
    return () => session.stop();
  }, [state.user?.id, state.user?.name, state.user?.username, state.user?.avatar, state.settings.lastSeen, commit]);

  // Активные устройства: регистрируем этот браузер, обновляем heartbeat и
  // мгновенно выходим, если сеанс завершили на другом устройстве.
  useEffect(() => {
    const email = state.user?.email;
    if (!email) return;
    const account = normalizeEmail(email);
    let cancelled = false;
    let registered = false;

    const revoke = () => {
      if (cancelled) return;
      commit((prev) => {
        if (!prev.user || normalizeEmail(prev.user.email) !== account) return prev;
        const key = accountKey(prev.user.email || prev.user.phone || "");
        return {
          ...prev,
          user: null,
          accounts: key ? { ...prev.accounts, [key]: prev.user } : prev.accounts,
        };
      });
    };

    const check = async () => {
      try {
        const active = await deviceStillActive(account);
        if (!active && registered) revoke();
      } catch {
        /* сеть недоступна — проверим позже */
      }
    };

    void registerDevice(account)
      .then(() => { registered = true; })
      .catch(() => undefined);

    const channel = subscribeDeviceRevoked(account, revoke);
    const heartbeat = window.setInterval(() => {
      void registerDevice(account).catch(() => undefined);
    }, 4 * 60_000);
    const watchdog = window.setInterval(() => { void check(); }, 15_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(heartbeat);
      window.clearInterval(watchdog);
      document.removeEventListener("visibilitychange", onVisible);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [state.user?.email, commit]);

  // Theme + motion preferences
  useEffect(() => {
    const root = document.documentElement;
    const meta = document.querySelector('meta[name="theme-color"]');
    const apply = () => {
      const dark =
        state.settings.theme === "dark" ||
        (state.settings.theme === "system" &&
          window.matchMedia("(prefers-color-scheme: dark)").matches);
      root.classList.toggle("dark", dark);
      root.classList.toggle("light", !dark);
      root.classList.toggle("reduce-motion", state.settings.reducedMotion);
      if (meta) meta.setAttribute("content", dark ? "#0b0b0c" : "#fbfbfb");
    };
    apply();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    if (state.settings.theme === "system") {
      media.addEventListener("change", apply);
      return () => media.removeEventListener("change", apply);
    }
  }, [state.settings.theme, state.settings.reducedMotion]);

  const totalUnread = useMemo(
    () => state.chats.reduce((sum, chat) => sum + (chat.muted ? 0 : chat.unread), 0),
    [state.chats],
  );

  useEffect(() => {
    if (state.settings.notifications) setBadge(totalUnread);
    else setBadge(0);
  }, [totalUnread, state.settings.notifications]);

  const dismissToast = useCallback(() => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = null;
    setToast(null);
  }, []);

  const pushToast = useCallback((data: ToastData) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast(data);
    toastTimer.current = window.setTimeout(() => {
      setToast(null);
      toastTimer.current = null;
    }, 4600);
  }, []);

  const markRead = useCallback(
    (chatId: string) => {
      const current = stateRef.current;
      const chat = current.chats.find((item) => item.id === chatId);
      const meEmail = current.user?.email ? normalizeEmail(current.user.email) : "";
      const peerEmail = chat?.email ? normalizeEmail(chat.email) : "";
      const hasUnread =
        Boolean(chat) &&
        (chat!.unread > 0 || chat!.messages.some((m) => m.fresh && !m.fromMe));
      const shouldSendReceipt =
        Boolean(chat) &&
        Boolean(meEmail) &&
        current.settings.readReceipts &&
        hasUnread &&
        (Boolean(chat?.remote) || Boolean(chat?.group));

      commit((prev) => ({
        ...prev,
        chats: prev.chats.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                unread: 0,
                messages: chat.messages.map((m) => (m.fresh ? { ...m, fresh: false } : m)),
              }
            : chat,
        ),
      }));

      if (shouldSendReceipt) {
        if (chat?.group) {
          for (const member of chat.group.memberList ?? []) {
            if (!member.email || normalizeEmail(member.email) === meEmail) continue;
            void markConversationRead(meEmail, member.email).catch(() => undefined);
          }
        } else if (peerEmail) {
          void markConversationRead(meEmail, peerEmail).catch(() => undefined);
        }
      }
    },
    [commit],
  );

  const setTyping = useCallback(
    (chatId: string, typing: boolean) => {
      commit((prev) => ({
        ...prev,
        chats: prev.chats.map((chat) => (chat.id === chatId ? { ...chat, typing } : chat)),
      }));
    },
    [commit],
  );

  const receiveMessage = useCallback(
    (chatId: string, data: SendPayload, meta?: { id?: string; at?: number; sender?: string; avatar?: string | null }) => {
      const chat = stateRef.current.chats.find((c) => c.id === chatId);
      if (!chat) return;
      if (meta?.id && chat.messages.some((message) => message.id === meta.id)) return;
      const message: Message = {
        id: meta?.id ?? uid("m"),
        chatId,
        fromMe: false,
        at: meta?.at ?? Date.now(),
        status: undefined,
        sender: meta?.sender,
        senderAvatar: meta?.avatar ?? null,
        ...data,
        fresh: true,
        remoteId: meta?.id,
      };
      const isOpen = activeChatRef.current === chatId;
      commit((prev) => ({
        ...prev,
        chats: prev.chats.map((c) =>
          c.id === chatId
            ? {
                ...c,
                typing: false,
                unread: isOpen ? 0 : c.unread + 1,
                messages: [...c.messages, message],
              }
            : c,
        ),
      }));

      if (stateRef.current.settings.sound) playTone("receive");
      if (stateRef.current.settings.vibration) haptic([8, 26, 8]);

      if (!isOpen && !chat.muted) {
        const text = previewOf(message);
        pushToast({
          id: message.id,
          chatId,
          name: chat.name,
          avatar: chat.avatar,
          text,
          kind: message.kind,
          at: message.at,
        });
      }
      if (
        !chat.muted &&
        stateRef.current.settings.push &&
        typeof document !== "undefined" &&
        (document.hidden || !document.hasFocus())
      ) {
        void showExternalNotification(chat.name, previewOf(message), chatId);
      }
    },
    [commit, pushToast],
  );

  const updateMessageStatus = useCallback(
    (chatId: string, messageId: string, status: MessageStatus) => {
      commit((prev) => ({
        ...prev,
        chats: prev.chats.map((c) =>
          c.id === chatId
            ? {
                ...c,
                messages: c.messages.map((m) => {
                  if (m.id !== messageId) return m;
                  // «Прочитано» не понижается до «отправлено», даже если
                  // подтверждение вставки пришло позже подтверждения чтения.
                  if (m.status === "read" && status !== "read") return m;
                  return m.status === status ? m : { ...m, status };
                }),
              }
            : c,
        ),
      }));
    },
    [commit],
  );

  const pushToRemote = useCallback(
    async (chat: Chat, message: Message, data: SendPayload): Promise<boolean> => {
      const current = stateRef.current.user;
      if (!current?.email || chat.group) return false;
      // Избранное синхронизируется через тот же канал: заметка самому себе.
      const toEmail = chat.saved ? normalizeEmail(current.email) : chat.email;
      if (!toEmail) return false;
      try {
        const remoteId = await sendRemoteMessage({
          from: current,
          toEmail,
          toUsername: chat.saved ? current.username : chat.username ?? "",
          toName: chat.saved ? current.name : chat.name,
          payload: data,
          clientId: message.id,
          at: message.at,
        });
        commit((prev) => ({
          ...prev,
          chats: prev.chats.map((c) =>
            c.id === chat.id
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === message.id ? { ...m, remoteId } : m,
                  ),
                }
              : c,
          ),
        }));
        return true;
      } catch {
        return false;
      }
    },
    [commit],
  );

  const pushGroupToRemote = useCallback(
    async (chat: Chat, message: Message, data: SendPayload): Promise<boolean> => {
      const current = stateRef.current.user;
      const members = chat.group?.memberList?.filter((member) => member.email) ?? [];
      if (!current?.email || members.length === 0) return false;
      const payload = payloadOf(message, chat);
      const results = await Promise.allSettled(
        members.map((member) =>
          sendRemoteMessage({
            from: current,
            toEmail: member.email,
            toUsername: member.username ?? "",
            toName: member.name,
            payload,
            clientId: message.id,
            at: message.at,
          }),
        ),
      );
      const remoteId = results.find(
        (result): result is PromiseFulfilledResult<string> => result.status === "fulfilled",
      )?.value;
      if (!remoteId) return false;
      commit((prev) => ({
        ...prev,
        chats: prev.chats.map((c) =>
          c.id === chat.id
            ? {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === message.id ? { ...m, remoteId } : m,
                ),
              }
            : c,
        ),
      }));
      return true;
    },
    [commit],
  );

  const sendMessage = useCallback(
    (chatId: string, data: SendPayload): string | undefined => {
      const chat = stateRef.current.chats.find((c) => c.id === chatId);
      if (!chat) return undefined;
      const message: Message = {
        id: uid("m"),
        chatId,
        fromMe: true,
        at: Date.now(),
        status: "sending",
        ...data,
        ...(chat.group ? { group: groupInfoOf(chat) } : {}),
      };
      commit((prev) => ({
        ...prev,
        chats: prev.chats.map((c) =>
          c.id === chatId
            ? { ...c, unread: 0, draft: "", messages: [...c.messages, message] }
            : c,
        ),
      }));

      if (stateRef.current.settings.sound) playTone("send");
      if (stateRef.current.settings.vibration) haptic(6);

      // Голосовые и видеокружки сначала получают локальный blob-URL, а в
      // Supabase уходят после загрузки файла (см. setMessageMediaSource).
      const pendingMedia =
        (data.kind === "voice" && data.voice?.src?.startsWith("blob:")) ||
        (data.kind === "videoNote" && data.videoNote?.src?.startsWith("blob:")) ||
        (data.kind === "file" && Boolean(data.file?.pending));
      if (!pendingMedia) {
        if (chat.group) {
          void pushGroupToRemote(chat, message, data).then((ok) => {
            if (ok) updateMessageStatus(chatId, message.id, "sent");
          });
        } else if (chat.remote || chat.saved) {
          void pushToRemote(chat, message, data).then((ok) => {
            if (ok) updateMessageStatus(chatId, message.id, "sent");
          });
        } else {
          updateMessageStatus(chatId, message.id, "sent");
        }
      }

      return message.id;
    },
    [commit, pushGroupToRemote, pushToRemote, updateMessageStatus],
  );

  const setMessageMediaSource = useCallback(
    (chatId: string, messageId: string, kind: "voice" | "videoNote" | "file", src: string, enc?: MediaEncryption) => {
      commit((prev) => ({
        ...prev,
        chats: prev.chats.map((chat) => {
          if (chat.id !== chatId) return chat;
          return {
            ...chat,
            messages: chat.messages.map((message) => {
              if (message.id !== messageId) return message;
              if (kind === "voice" && message.voice) {
                return { ...message, voice: { ...message.voice, src, enc } };
              }
              if (kind === "videoNote" && message.videoNote) {
                return { ...message, videoNote: { ...message.videoNote, src, enc } };
              }
              if (kind === "file" && message.file) {
                return { ...message, file: { ...message.file, src, enc, pending: false } };
              }
              return message;
            }),
          };
        }),
      }));

      // Файл загружен — теперь сообщение можно отправить собеседнику.
      const chat = stateRef.current.chats.find((item) => item.id === chatId);
      const message = chat?.messages.find((item) => item.id === messageId);
      if (!chat || !message) return;
      const payload: SendPayload = {
        ...(kind === "voice"
          ? { kind: "voice" as const, voice: message.voice }
          : kind === "videoNote"
            ? { kind: "videoNote" as const, videoNote: message.videoNote }
            : { kind: "file" as const, file: message.file }),
        ...(chat.group ? { group: groupInfoOf(chat) } : {}),
      };
      if (!chat.group && !chat.email && !chat.saved) {
        // Локальный чат: файл загружен, сообщение готово.
        updateMessageStatus(chatId, messageId, "sent");
        return;
      }
      const push = chat.group
        ? pushGroupToRemote(chat, message, payload)
        : pushToRemote(chat, message, payload);
      void push.then((ok) => {
        if (ok) updateMessageStatus(chatId, messageId, "sent");
      });
    },
    [commit, pushGroupToRemote, pushToRemote, updateMessageStatus],
  );

  const forwardMessage = useCallback(
    (targetChatId: string, messageId: string) => {
      const sourceChat = stateRef.current.chats.find((c) =>
        c.messages.some((m) => m.id === messageId),
      );
      if (!sourceChat) return;
      const original = sourceChat.messages.find((m) => m.id === messageId);
      if (!original) return;
      const forwardedFrom = original.fromMe ? stateRef.current.user?.name ?? "Вы" : sourceChat.name;
      const clone: Message = {
        ...original,
        id: uid("m"),
        chatId: targetChatId,
        fromMe: true,
        at: Date.now(),
        status: "sending",
        forwardedFrom,
        replyTo: undefined,
        pinned: false,
        fresh: false,
        reactions: undefined,
        group: undefined,
      };
      commit((prev) => ({
        ...prev,
        chats: prev.chats.map((c) =>
          c.id === targetChatId
            ? { ...c, unread: 0, messages: [...c.messages, clone] }
            : c,
        ),
      }));
      if (stateRef.current.settings.sound) playTone("send");

      const target = stateRef.current.chats.find((c) => c.id === targetChatId);
      if (target) {
        if (target.group) {
          void pushGroupToRemote(target, clone, payloadOf(clone, target)).then((ok) => {
            if (ok) updateMessageStatus(targetChatId, clone.id, "sent");
          });
        } else if (target.remote) {
          void pushToRemote(target, clone, payloadOf(clone, target)).then((ok) => {
            if (ok) updateMessageStatus(targetChatId, clone.id, "sent");
          });
        } else {
          updateMessageStatus(targetChatId, clone.id, "sent");
        }
      }
    },
    [commit, pushGroupToRemote, pushToRemote, updateMessageStatus],
  );

  const setActiveChat = useCallback((id: string | null) => {
    activeChatRef.current = id;
    if (id) {
      const chat = stateRef.current.chats.find((c) => c.id === id);
      if (chat && chat.unread > 0) {
        commit((prev) => ({
          ...prev,
          chats: prev.chats.map((c) => (c.id === id ? { ...c, unread: 0 } : c)),
        }));
      }
    }
  }, [commit]);

  const setDraft = useCallback(
    (chatId: string, draft: string) => {
      commit((prev) => ({
        ...prev,
        chats: prev.chats.map((c) => (c.id === chatId ? { ...c, draft } : c)),
      }));
    },
    [commit],
  );

  const togglePinChat = useCallback(
    (chatId: string) => {
      commit((prev) => ({
        ...prev,
        chats: prev.chats.map((c) =>
          c.id === chatId ? { ...c, pinnedChat: !c.pinnedChat } : c,
        ),
      }));
    },
    [commit],
  );

  const deleteChat = useCallback(
    (chatId: string) => {
      const chat = stateRef.current.chats.find((item) => item.id === chatId);
      const me = stateRef.current.user;

      // Удаляем сразу — интерфейс не должен ждать сеть.
      commit((prev) => ({ ...prev, chats: prev.chats.filter((c) => c.id !== chatId) }));
      if (!chat?.group || !me?.email) return;

      // Для группы/канала удаляем и серверные копии сообщений, чтобы при
      // следующем входе история не «всплыла» обратно. Личные чаты
      // удаляются только локально, как в Telegram.
      const remoteIds = chat.messages
        .map((message) => message.remoteId)
        .filter((value): value is string => Boolean(value));
      const ownClientIds = chat.messages
        .filter((message) => message.fromMe)
        .map((message) => message.id);
      void (async () => {
        try {
          await deleteRemoteMessagesByIds(remoteIds);
          await deleteOwnMessagesByClientIds(me.email, ownClientIds);
        } catch {
          /* офлайн — локальное удаление уже выполнено */
        }
      })();
    },
    [commit],
  );

  const restoreChat = useCallback(
    (chat: Chat) => {
      commit((prev) => ({
        ...prev,
        chats: prev.chats.some((c) => c.id === chat.id) ? prev.chats : [...prev.chats, chat],
      }));
    },
    [commit],
  );

  const react = useCallback(
    (chatId: string, messageId: string, emoji: string) => {
      commit((prev) => ({
        ...prev,
        chats: prev.chats.map((chat) => {
          if (chat.id !== chatId) return chat;
          return {
            ...chat,
            messages: chat.messages.map((msg) => {
              if (msg.id !== messageId) return msg;
              const reactions = [...(msg.reactions ?? [])];
              const existing = reactions.find((r) => r.emoji === emoji);
              const mineBefore = reactions.find((r) => r.mine);
              let next = reactions;
              if (existing?.mine) {
                next = reactions
                  .map((r) => (r.emoji === emoji ? { ...r, count: r.count - 1, mine: false } : r))
                  .filter((r) => r.count > 0);
              } else {
                next = reactions
                  .map((r) =>
                    r.mine ? { ...r, count: Math.max(0, r.count - 1), mine: false } : r,
                  )
                  .filter((r) => r.count > 0);
                const found = next.find((r) => r.emoji === emoji);
                if (found) {
                  next = next.map((r) =>
                    r.emoji === emoji ? { ...r, count: r.count + 1, mine: true } : r,
                  );
                } else {
                  next = [...next, { emoji, count: mineBefore?.emoji === emoji ? 2 : 1, mine: true }];
                }
              }
              return { ...msg, reactions: next };
            }),
          };
        }),
      }));
    },
    [commit],
  );

  const editMessage = useCallback(
    async (chatId: string, messageId: string, text: string) => {
      const current = stateRef.current;
      const chat = current.chats.find((item) => item.id === chatId);
      const message = chat?.messages.find((item) => item.id === messageId);
      const value = text.trim();
      if (!chat || !message || !message.fromMe || message.kind !== "text" || !value) {
        return false;
      }

      const payload: MessagePayload = { ...payloadOf(message, chat), text: value, edited: true };
      const meEmail = current.user?.email ?? "";
      if (chat.group) {
        try {
          await editGroupMessage({
            senderEmail: meEmail,
            recipients: chat.group.memberList ?? [],
            clientId: message.id,
            payload,
          });
        } catch {
          return false;
        }
      } else if ((chat.remote && chat.email) || chat.saved) {
        try {
          await editRemoteMessage({
            id: message.remoteId,
            clientId: message.id,
            senderEmail: meEmail,
            peerEmail: chat.email ?? meEmail,
            payload,
          });
        } catch {
          return false;
        }
      }

      commit((prev) => ({
        ...prev,
        chats: prev.chats.map((item) =>
          item.id === chatId
            ? {
                ...item,
                messages: item.messages.map((m) =>
                  m.id === messageId ? { ...m, text: value, edited: true } : m,
                ),
              }
            : item,
        ),
      }));
      return true;
    },
    [commit],
  );

  const deleteMessage = useCallback(
    async (chatId: string, messageId: string) => {
      const current = stateRef.current;
      const chat = current.chats.find((item) => item.id === chatId);
      const message = chat?.messages.find((item) => item.id === messageId);
      if (!chat || !message) return false;

      const pending = message.status === "sending" && !message.remoteId;
      if ((chat.remote || chat.saved) && !pending) {
        try {
          await deleteRemoteMessage({
            id: message.remoteId,
            clientId: message.id,
            meEmail: current.user?.email ?? "",
          });
        } catch {
          return false;
        }
      }

      const mediaUrls = [
        message.photo?.src,
        message.voice?.src,
        message.videoNote?.src,
        message.file?.src,
      ].filter((value): value is string => Boolean(value));

      const usedElsewhere = new Set<string>();
      for (const item of current.chats) {
        for (const other of item.messages) {
          if (item.id === chatId && other.id === messageId) continue;
          const urls = [
            other.photo?.src,
            other.voice?.src,
            other.videoNote?.src,
            other.file?.src,
          ];
          for (const url of urls) if (url) usedElsewhere.add(url);
        }
      }

      const paths = mediaUrls
        .filter((url) => !usedElsewhere.has(url))
        .map((url) => storagePathFromUrl(url))
        .filter((path): path is string => Boolean(path));

      commit((prev) => ({
        ...prev,
        chats: prev.chats.map((item) =>
          item.id === chatId
            ? { ...item, messages: item.messages.filter((m) => m.id !== messageId) }
            : item,
        ),
      }));

      if (paths.length > 0) {
        void deleteStoragePaths(paths).catch(() => undefined);
      }
      return true;
    },
    [commit],
  );

  const blockChat = useCallback(
    async (chatId: string) => {
      const current = stateRef.current;
      const chat = current.chats.find((item) => item.id === chatId);
      const blocker = current.user?.email ?? "";
      if (!chat || !blocker) return false;
      if (isZeroIdentity(chat)) return false;
      try {
        await blockRemoteUser({
          blockerEmail: blocker,
          blockedEmail: chat.email ?? null,
          blockedUsername: chat.username ?? null,
        });
        return true;
      } catch {
        return false;
      }
    },
    [],
  );

  const pinMessage = useCallback(
    (chatId: string, messageId: string) => {
      commit((prev) => ({
        ...prev,
        chats: prev.chats.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                messages: chat.messages.map((m) => {
                  if (m.id === messageId) return { ...m, pinned: !m.pinned };
                  return m.pinned ? { ...m, pinned: false } : m;
                }),
              }
            : chat,
        ),
      }));
    },
    [commit],
  );

  const applyVotesToPolls = useCallback(
    (pollIds: string[], votes: Awaited<ReturnType<typeof loadPollVotes>>) => {
      const ids = new Set(pollIds.filter(Boolean));
      if (ids.size === 0) return;
      const me = normalizeEmail(stateRef.current.user?.email ?? "");
      commit((prev) => {
        let anyChanged = false;
        const chats = prev.chats.map((chat) => {
          let chatChanged = false;
          const messages = chat.messages.map((message) => {
            if (!message.poll) return message;
            const pollId = pollIdOf(message.poll, message.remoteId ?? message.id);
            if (!ids.has(pollId)) return message;
            const relevant = votes.filter((vote) => vote.poll_id === pollId);
            chatChanged = true;
            return {
              ...message,
              poll: applyPollVotes(message.poll, relevant, me),
            };
          });
          if (!chatChanged) return chat;
          anyChanged = true;
          return { ...chat, messages };
        });
        return anyChanged ? { ...prev, chats } : prev;
      });
    },
    [commit],
  );

  const refreshPollVotes = useCallback(
    async (pollIds: string[]) => {
      const ids = [...new Set(pollIds.filter(Boolean))];
      if (ids.length === 0) return;
      try {
        const votes = await loadPollVotes(ids);
        applyVotesToPolls(ids, votes);
      } catch {
        /* офлайн: останутся локальные значения */
      }
    },
    [applyVotesToPolls],
  );

  const syncPollVotes = useCallback(
    async (chatId: string) => {
      const chat = stateRef.current.chats.find((item) => item.id === chatId);
      if (!chat) return;
      const ids = chat.messages
        .filter((message) => message.poll)
        .map((message) => pollIdOf(message.poll, message.remoteId ?? message.id));
      await refreshPollVotes(ids);
    },
    [refreshPollVotes],
  );

  const votePoll = useCallback(
    (chatId: string, messageId: string, optionId: string) => {
      const current = stateRef.current;
      const message = current.chats
        .find((chat) => chat.id === chatId)
        ?.messages.find((item) => item.id === messageId);
      const poll = message?.poll;
      const me = current.user?.email ?? "";
      if (!message || !poll || !me) return;

      const previous = poll.options.find((option) => option.voted)?.id ?? null;
      const nextVoted = previous === optionId ? null : optionId;
      const pollId = pollIdOf(poll, message.remoteId ?? message.id);

      // Мгновенный отклик интерфейса; затем база подтвердит результат.
      commit((prev) => ({
        ...prev,
        chats: prev.chats.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                messages: chat.messages.map((item) => {
                  if (item.id !== messageId || !item.poll) return item;
                  const options = item.poll.options.map((option) => {
                    let votes = option.votes;
                    let voted = option.voted;
                    if (option.id === previous) {
                      votes = Math.max(0, votes - 1);
                      voted = false;
                    }
                    if (option.id === nextVoted) {
                      votes += 1;
                      voted = true;
                    }
                    if (option.id !== nextVoted) voted = false;
                    return { ...option, votes, voted };
                  });
                  return { ...item, poll: { ...item.poll, options } };
                }),
              }
            : chat,
        ),
      }));

      void castPollVote({ pollId, optionId, voterEmail: me })
        .then(() => refreshPollVotes([pollId]))
        .catch(() => refreshPollVotes([pollId]));
    },
    [commit, refreshPollVotes],
  );

  // Любой голос в любом опросе обновляет счётчики у всех участников.
  useEffect(() => {
    if (!state.user?.email) return;
    const pending = new Set<string>();
    let timer: number | null = null;
    const flush = () => {
      const ids = [...pending];
      pending.clear();
      timer = null;
      void refreshPollVotes(ids);
    };
    const channel = subscribePollVotes((pollId) => {
      pending.add(pollId);
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(flush, 140);
    });
    return () => {
      if (timer) window.clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [state.user?.email, refreshPollVotes]);

  const openOrCreateChat = useCallback(
    (contact: {
      name: string;
      username?: string;
      email?: string;
      phone?: string;
      online?: boolean;
      lastSeen?: number;
      avatar?: string | null;
      remote?: boolean;
    }) => {
      const email = normalizeEmail(contact.email ?? "");
      const username = normalizeUsername(contact.username ?? "");
      // Не склеиваем разных людей с одинаковым именем: имя — только запасной
      // ключ, когда у контакта нет ни email, ни @username. Иначе сообщение
      // могло уйти не тому человеку.
      const byEmail = email
        ? stateRef.current.chats.find(
            (c) => Boolean(c.email) && normalizeEmail(c.email ?? "") === email,
          )
        : undefined;
      // @username — уникальный ключ. Чат без email можно "повысить" до
      // настоящего, но чужой email при этом не перезаписываем.
      const byUsername =
        !byEmail && username
          ? stateRef.current.chats.find(
              (c) =>
                normalizeUsername(c.username ?? "") === username &&
                (!email || !c.email),
            )
          : undefined;
      const existing =
        byEmail ??
        byUsername ??
        (email || username
          ? undefined
          : stateRef.current.chats.find((c) => c.name === contact.name));
      if (existing) {
        const nextEmail = email && !existing.email ? email : undefined;
        const nextUsername = username && !existing.username ? username : undefined;
        const nextAvatar = contact.avatar && !existing.avatar ? contact.avatar : undefined;
        const nextRemote = email && !existing.remote ? true : undefined;
        // Старые копии могли сохранить почту вместо имени — заменяем её на
        // настоящее имя или @username, когда оно стало известно.
        const incomingName = stripEmoji(contact.name ?? "");
        const nextName =
          incomingName &&
          !looksLikeEmail(incomingName) &&
          (!existing.name || looksLikeEmail(existing.name))
            ? incomingName
            : undefined;
        if (nextEmail || nextUsername || nextAvatar || nextRemote || nextName) {
          commit((prev) => ({
            ...prev,
            chats: prev.chats.map((c) =>
              c.id === existing.id
                ? {
                    ...c,
                    name: nextName ?? c.name,
                    email: nextEmail ?? c.email,
                    username: nextUsername ?? c.username,
                    avatar: nextAvatar ?? c.avatar,
                    remote: nextRemote ?? c.remote,
                  }
                : c,
            ),
          }));
        }
        return existing.id;
      }
      const id = uid("c");
      const isRemote = Boolean(email) || Boolean(contact.remote);
      const chat: Chat = {
        id,
        name: contact.name,
        username: username || undefined,
        email: email || undefined,
        phone: contact.phone,
        online: contact.online,
        lastSeen: contact.lastSeen,
        avatar: contact.avatar ?? null,
        unread: 0,
        messages: [],
        remote: isRemote,
        historyLoaded: !isRemote,
      };
      commit((prev) => ({ ...prev, chats: [chat, ...prev.chats] }));
      return id;
    },
    [commit],
  );

  /**
   * Приглашение в группу/канал: каждому участнику уходит служебная запись с
   * описанием группы. Благодаря ей чат появляется сразу после добавления, а
   * не только после первого сообщения.
   */
  const shareGroupWithMembers = useCallback(
    (chatId: string, members: GroupMember[]) => {
      const current = stateRef.current.user;
      const chat = stateRef.current.chats.find((item) => item.id === chatId);
      const group = chat ? groupInfoOf(chat) : undefined;
      if (!current?.email || !group) return;
      const payload: MessagePayload = { kind: "text", text: "", system: true, group };
      for (const member of members) {
        const email = normalizeEmail(member.email);
        if (!email || email === normalizeEmail(current.email)) continue;
        void sendRemoteMessage({
          from: current,
          toEmail: email,
          toUsername: member.username ?? "",
          toName: member.name || email.split("@")[0],
          payload,
          clientId: uid("m"),
          at: Date.now(),
        }).catch(() => undefined);
      }
    },
    [],
  );

  const createGroup = useCallback(
    (input: {
      name: string;
      kind: "group" | "channel";
      avatar?: string | null;
      description?: string;
      members: GroupMember[];
    }) => {
      const current = stateRef.current.user;
      const ownerEmail = normalizeEmail(current?.email ?? "");
      const unique = new Map<string, GroupMember>();
      for (const member of input.members) {
        const email = normalizeEmail(member.email);
        if (!email || email === ownerEmail) continue;
        unique.set(email, { ...member, email });
      }
      const memberList = [...unique.values()];
      const id = uid("g");
      const chat: Chat = {
        id,
        name: stripEmoji(input.name) || (input.kind === "channel" ? "Новый канал" : "Новая группа"),
        avatar: input.avatar ?? null,
        unread: 0,
        messages: [],
        remote: memberList.length > 0,
        historyLoaded: true,
        group: {
          key: uid("gk"),
          kind: input.kind,
          members: memberList.length + 1,
          memberList,
          ownerEmail,
          description: input.description?.trim() || "",
        },
      };
      commit((prev) => ({ ...prev, chats: [chat, ...prev.chats] }));
      shareGroupWithMembers(id, memberList);
      return id;
    },
    [commit, shareGroupWithMembers],
  );

  const updateGroup = useCallback(
    (chatId: string, patch: { name?: string; avatar?: string | null; description?: string }) => {
      commit((prev) => ({
        ...prev,
        chats: prev.chats.map((chat) => {
          if (chat.id !== chatId || !chat.group) return chat;
          return {
            ...chat,
            name: patch.name !== undefined ? stripEmoji(patch.name) || chat.name : chat.name,
            avatar: patch.avatar !== undefined ? patch.avatar : chat.avatar,
            group: {
              ...chat.group,
              description:
                patch.description !== undefined ? patch.description.trim() : chat.group.description,
            },
          };
        }),
      }));
      // Новое название/аватар/описание сразу видны всем участникам.
      const chat = stateRef.current.chats.find((item) => item.id === chatId);
      if (chat?.group?.memberList?.length) shareGroupWithMembers(chatId, chat.group.memberList);
    },
    [commit, shareGroupWithMembers],
  );

  const addGroupMembers = useCallback(
    (chatId: string, members: GroupMember[]) => {
      const ownerEmail = normalizeEmail(stateRef.current.user?.email ?? "");
      const chat = stateRef.current.chats.find((item) => item.id === chatId);
      const known = new Set(
        (chat?.group?.memberList ?? []).map((member) => normalizeEmail(member.email)),
      );
      const added = members.filter((member) => {
        const email = normalizeEmail(member.email);
        if (!email || email === ownerEmail || known.has(email)) return false;
        known.add(email);
        return true;
      });
      commit((prev) => ({
        ...prev,
        chats: prev.chats.map((chat) => {
          if (chat.id !== chatId || !chat.group) return chat;
          const list = [...(chat.group.memberList ?? [])];
          const knownInList = new Set(list.map((member) => normalizeEmail(member.email)));
          for (const member of members) {
            const email = normalizeEmail(member.email);
            if (!email || email === ownerEmail || knownInList.has(email)) continue;
            knownInList.add(email);
            list.push({ ...member, email });
          }
          return {
            ...chat,
            remote: chat.remote || list.length > 0,
            group: { ...chat.group, memberList: list, members: list.length + 1 },
          };
        }),
      }));
      if (added.length > 0) shareGroupWithMembers(chatId, added);
    },
    [commit, shareGroupWithMembers],
  );

  const removeGroupMember = useCallback(
    (chatId: string, email: string) => {
      const target = normalizeEmail(email);
      commit((prev) => ({
        ...prev,
        chats: prev.chats.map((chat) => {
          if (chat.id !== chatId || !chat.group) return chat;
          const list = (chat.group.memberList ?? []).filter(
            (member) => normalizeEmail(member.email) !== target,
          );
          return {
            ...chat,
            group: { ...chat.group, memberList: list, members: list.length + 1 },
          };
        }),
      }));
    },
    [commit],
  );

  const openOrCreateGroup = useCallback(
    (info: MessageGroupInfo) => {
      const me = normalizeEmail(stateRef.current.user?.email ?? "");
      const existing = stateRef.current.chats.find((chat) => chat.group?.key === info.key);
      if (existing) {
        const list = [...(existing.group?.memberList ?? [])];
        const known = new Set(list.map((member) => normalizeEmail(member.email)));
        for (const rawEmail of info.members) {
          const email = normalizeEmail(rawEmail);
          if (!email || email === me || known.has(email)) continue;
          known.add(email);
          list.push({ email, name: email.split("@")[0] });
        }
        if (
          list.length !== (existing.group?.memberList ?? []).length ||
          existing.name !== (info.title || existing.name) ||
          existing.avatar !== (info.avatar ?? existing.avatar) ||
          !existing.remote
        ) {
          commit((prev) => ({
            ...prev,
            chats: prev.chats.map((chat) =>
              chat.id === existing.id
                ? {
                    ...chat,
                    name: info.title || chat.name,
                    avatar: info.avatar !== undefined ? info.avatar : chat.avatar,
                    remote: true,
                    group: {
                      ...chat.group,
                      key: info.key,
                      kind: info.kind,
                      ownerEmail: info.ownerEmail ?? chat.group?.ownerEmail,
                      memberList: list,
                      members: list.length + 1,
                    },
                  }
                : chat,
            ),
          }));
        }
        return existing.id;
      }

      const memberList: GroupMember[] = [];
      const known = new Set<string>();
      for (const rawEmail of info.members) {
        const email = normalizeEmail(rawEmail);
        if (!email || email === me || known.has(email)) continue;
        known.add(email);
        memberList.push({ email, name: email.split("@")[0] });
      }
      const id = uid("g");
      const chat: Chat = {
        id,
        name: info.title || (info.kind === "channel" ? "Канал" : "Группа"),
        avatar: info.avatar ?? null,
        unread: 0,
        messages: [],
        remote: true,
        historyLoaded: true,
        group: {
          key: info.key,
          kind: info.kind,
          members: memberList.length + 1,
          memberList,
          ownerEmail: info.ownerEmail,
        },
      };
      commit((prev) => ({ ...prev, chats: [chat, ...prev.chats] }));
      return id;
    },
    [commit],
  );

  /** Подгружает историю диалога из Supabase при открытии чата. */
  const loadChatHistory = useCallback(
    async (chatId: string) => {
      const chat = stateRef.current.chats.find((item) => item.id === chatId);
      const me = stateRef.current.user;
      if (!chat || !me?.email) return;

      const myEmail = normalizeEmail(me.email);
      let rows: RemoteMessageRow[];

      if (chat.group?.key) {
        const groupKey = chat.group.key;
        const emails = (chat.group.memberList ?? [])
          .map((member) => normalizeEmail(member.email))
          .filter((email) => Boolean(email) && email !== myEmail);
        if (emails.length === 0) {
          commit((prev) => ({
            ...prev,
            chats: prev.chats.map((item) =>
              item.id === chatId ? { ...item, historyLoaded: true } : item,
            ),
          }));
          return;
        }
        const lists = await Promise.all(
          emails.map((email) => loadConversation(myEmail, email).catch(() => [])),
        );
        // Каждое сообщение группы лежит отдельной строкой у каждого
        // получателя, поэтому без дедупликации по client_id одна и та же
        // реплика появлялась несколько раз и пузыри «смешивались».
        const seen = new Set<string>();
        rows = lists
          .flat()
          .filter((row) => row.payload.group?.key === groupKey)
          .filter((row) => !row.payload.system)
          .filter((row) => {
            const key = row.client_id || `${row.sender_email}|${row.created_at}|${row.id}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      } else if (chat.saved) {
        try {
          rows = (await loadConversation(myEmail, myEmail)).filter(
            (row) => !row.payload.group,
          );
        } catch {
          return;
        }
      } else {
        if (!chat.remote || !chat.email) return;
        try {
          rows = (await loadConversation(myEmail, chat.email)).filter(
            (row) => !row.payload.group,
          );
        } catch {
          return;
        }
      }

      const remoteMessages: Message[] = rows.map((row) => {
        const mine = normalizeEmail(row.sender_email) === myEmail;
        return {
          id: row.id,
          chatId,
          fromMe: mine,
          at: new Date(row.created_at).getTime(),
          status: mine ? (row.read_at ? "read" : "sent") : undefined,
          sender: mine ? undefined : row.sender_name || row.sender_username,
          senderAvatar: mine ? null : row.sender_avatar ?? null,
          remoteId: row.id,
          ...row.payload,
        };
      });
      const remoteIds = new Set(remoteMessages.map((message) => message.id));
      const clientIds = new Set(
        rows.map((row) => row.client_id).filter((value): value is string => Boolean(value)),
      );
      const times = remoteMessages.map((message) => message.at);
      const firstAt = times.length > 0 ? Math.min(...times) : 0;
      const lastAt = times.length > 0 ? Math.max(...times) : 0;

      commit((prev) => ({
        ...prev,
        chats: prev.chats.map((item) => {
          if (item.id !== chatId) return item;
          const localOnly = item.messages.filter((message) => {
            if (remoteIds.has(message.id) || clientIds.has(message.id)) return false;
            if (!message.remoteId) return true;
            // Сообщение пришло из базы, но в загруженном окне его нет —
            // значит его удалили у всех. Старую историю за пределами 500
            // последних сообщений не трогаем.
            if (rows.length === 0) return false;
            return message.at < firstAt - 1 || message.at > lastAt + 1;
          });
          const merged = [...localOnly, ...remoteMessages].sort((a, b) => a.at - b.at);
          return { ...item, messages: merged, historyLoaded: true };
        }),
      }));
      void syncPollVotes(chatId);
    },
    [commit, syncPollVotes],
  );

  /**
   * Применяет пачку сообщений из базы в обе стороны. Так изменения с другого
   * устройства аккаунта появляются здесь сразу и без дублей.
   */
  const applySyncedRows = useCallback(
    (rows: RemoteMessageRow[], meEmail: string) => {
      const email = normalizeEmail(meEmail);
      if (!email || rows.length === 0) return;

      const byChat = new Map<string, RemoteMessageRow[]>();
      for (const row of rows) {
        const sender = normalizeEmail(row.sender_email);
        const own = sender === email;
        const group = row.payload.group;
        let chatId: string | undefined;

        if (group) {
          chatId = openOrCreateGroup(group);
        } else if (own) {
          const peer = normalizeEmail(row.recipient_email);
          if (!peer) continue;
          if (peer === email) {
            // Заметки «Избранное» летят на сервер как сообщение самому себе.
            chatId = stateRef.current.chats.find((chat) => chat.saved)?.id ?? SAVED_CHAT_ID;
          } else {
            const existing = stateRef.current.chats.find(
              (chat) => Boolean(chat.email) && normalizeEmail(chat.email ?? "") === peer,
            );
            chatId = openOrCreateChat({
              name: existing?.name || peer.split("@")[0],
              email: peer,
              username: existing?.username,
              avatar: existing?.avatar ?? null,
              remote: true,
            });
          }
        } else {
          chatId = openOrCreateChat({
            name: preferredName(row.sender_name, row.sender_username) || sender,
            username: row.sender_username,
            email: sender,
            avatar: row.sender_avatar,
            remote: true,
          });
        }

        if (!chatId) continue;
        const list = byChat.get(chatId) ?? [];
        list.push(row);
        byChat.set(chatId, list);
      }

      for (const [chatId, list] of byChat) {
        commit((prev) => ({
          ...prev,
          chats: prev.chats.map((chat) => {
            if (chat.id !== chatId) return chat;
            let changed = false;
            let addedIncoming = 0;
            const messages = [...chat.messages];

            for (const row of list) {
              if (row.payload.system) continue;
              const own = normalizeEmail(row.sender_email) === email;
              const remoteId = row.id;
              const clientId = row.client_id || undefined;
              const index = messages.findIndex(
                (message) =>
                  message.remoteId === remoteId ||
                  message.id === remoteId ||
                  (clientId && (message.id === clientId || message.remoteId === clientId)),
              );

              if (index >= 0) {
                const existing = messages[index];
                const status = own
                  ? row.read_at
                    ? ("read" as const)
                    : existing.status === "read"
                      ? ("read" as const)
                      : ("sent" as const)
                  : existing.status;
                if (
                  existing.remoteId !== remoteId ||
                  (own && existing.status !== status) ||
                  row.payload.edited
                ) {
                  messages[index] = {
                    ...existing,
                    ...(row.payload.edited ? row.payload : {}),
                    remoteId,
                    status,
                  };
                  changed = true;
                }
                continue;
              }

              messages.push({
                id: own ? clientId ?? remoteId : remoteId,
                chatId,
                fromMe: own,
                at: new Date(row.created_at).getTime() || Date.now(),
                status: own ? (row.read_at ? "read" : "sent") : undefined,
                sender: own ? undefined : row.sender_name || row.sender_username || normalizeEmail(row.sender_email),
                senderAvatar: own ? null : row.sender_avatar ?? null,
                remoteId,
                fresh: !own && activeChatRef.current !== chatId,
                ...row.payload,
              });
              if (!own) addedIncoming += 1;
              changed = true;
            }

            if (!changed) return chat;
            return {
              ...chat,
              typing: false,
              unread: activeChatRef.current === chatId ? 0 : chat.unread + addedIncoming,
              messages: messages.sort((a, b) => a.at - b.at),
            };
          }),
        }));
      }
    },
    [commit, openOrCreateChat, openOrCreateGroup],
  );

  // Realtime: входящие сообщения от других людей приходят сразу, без
  // перезагрузки. Чат создаётся автоматически, если его ещё нет.
  useEffect(() => {
    const currentUser = state.user;
    if (!currentUser?.email) return;
    const email = normalizeEmail(currentUser.email);
    const channel = subscribeToIncoming(
      email,
      (row) => {
        void decryptRemoteRow(row, email).then((decrypted) => {
          if (undecryptable(decrypted.payload)) return;
          const senderEmail = normalizeEmail(decrypted.sender_email);
          if (senderEmail === email) return;
          const senderUsername = normalizeUsername(decrypted.sender_username);
          const group = decrypted.payload.group;
          // openOrCreateChat/openOrCreateGroup сами найдут существующий чат
          // по email, @username или ключу группы.
          const chatId = group
            ? openOrCreateGroup(group)
            : openOrCreateChat({
                name: preferredName(decrypted.sender_name, decrypted.sender_username) || senderEmail,
                username: senderUsername,
                email: senderEmail,
                avatar: decrypted.sender_avatar,
                online: true,
                remote: true,
              });
          // Служебная запись только создаёт/обновляет группу, но не является
          // сообщением в ленте.
          if (decrypted.payload.system) return;
          receiveMessage(chatId, decrypted.payload, {
            id: decrypted.id,
            at: new Date(decrypted.created_at).getTime() || Date.now(),
            sender: decrypted.sender_name || decrypted.sender_username || senderEmail,
            avatar: decrypted.sender_avatar,
          });
        }).catch(() => undefined);
      },
      (row) => {
        if (!row.read_at) return;
        const peerEmail = normalizeEmail(row.recipient_email);
        commit((prev) => ({
          ...prev,
          chats: prev.chats.map((chat) => {
            if (!chat.email || normalizeEmail(chat.email) !== peerEmail) return chat;
            let changed = false;
            const messages = chat.messages.map((message) => {
              if (message.remoteId !== row.id && message.id !== row.client_id) return message;
              if (message.status === "read") return message;
              changed = true;
              return { ...message, status: "read" as const };
            });
            return changed ? { ...chat, messages } : chat;
          }),
        }));
      },
      (row) => {
        const peerEmail = normalizeEmail(row.sender_email);
        if (peerEmail === email) return;
        void decryptRemoteRow(row, email).then((decrypted) => {
          if (undecryptable(decrypted.payload)) return;
          commit((prev) => ({
            ...prev,
            chats: prev.chats.map((chat) => {
              if (!chat.email || normalizeEmail(chat.email) !== peerEmail) return chat;
              let changed = false;
              const messages = chat.messages.map((message) => {
                if (message.remoteId !== decrypted.id && message.id !== decrypted.client_id) return message;
                changed = true;
                return {
                  ...message,
                  ...decrypted.payload,
                  id: message.id,
                  chatId: message.chatId,
                  fromMe: message.fromMe,
                  at: message.at,
                  fresh: message.fresh,
                  status: message.status,
                  sender: message.sender,
                  remoteId: message.remoteId ?? decrypted.id,
                };
              });
              return changed ? { ...chat, messages } : chat;
            }),
          }));
        }).catch(() => undefined);
      },
      (row) => {
        const rowId = row.id;
        if (!rowId) return;
        commit((prev) => ({
          ...prev,
          chats: prev.chats.map((chat) => {
            const messages = chat.messages.filter(
              (message) => message.remoteId !== rowId && message.id !== rowId,
            );
            return messages.length === chat.messages.length ? chat : { ...chat, messages };
          }),
        }));
      },
      // Своё сообщение, отправленное с другого устройства аккаунта.
      (row) => {
        void decryptRemoteRow(row, email)
          .then((decrypted) => {
            if (undecryptable(decrypted.payload)) return;
            applySyncedRows([decrypted], email);
          })
          .catch(() => undefined);
      },
    );

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [state.user?.id, openOrCreateChat, openOrCreateGroup, receiveMessage, applySyncedRows, commit]);

  // Полная синхронизация аккаунта в обе стороны. Realtime даёт мгновенную
  // доставку, а периодический догон гарантирует, что новые сообщения с
  // других устройств появятся даже после обрыва соединения.
  useEffect(() => {
    const currentUser = state.user;
    if (!currentUser?.email) {
      syncedFor.current = null;
      return;
    }
    const email = normalizeEmail(currentUser.email);
    let cancelled = false;
    let running = false;

    const run = async () => {
      if (cancelled || running) return;
      running = true;
      try {
        const rows = await loadRecentAccount(email);
        if (!cancelled && rows.length > 0) applySyncedRows(rows, email);
      } catch {
        /* сеть вернётся — догоним на следующем проходе */
      } finally {
        running = false;
      }
    };

    void run();
    const timer = window.setInterval(() => { void run(); }, 10_000);
    const onOnline = () => { void run(); };
    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [state.user?.email, applySyncedRows]);

  const addCall = useCallback(
    (call: Omit<CallRecord, "id" | "at">) => {
      commit((prev) => ({
        ...prev,
        calls: [{ ...call, id: uid("call"), at: Date.now() }, ...prev.calls],
      }));
    },
    [commit],
  );

  const clearMessages = useCallback(
    async (chatId: string) => {
      const current = stateRef.current;
      const chat = current.chats.find((item) => item.id === chatId);
      const me = current.user?.email ?? "";
      if (!chat) return false;

      const remoteIds = chat.messages
        .map((message) => message.remoteId)
        .filter((value): value is string => Boolean(value));
      const ownClientIds = chat.messages
        .filter((message) => message.fromMe)
        .map((message) => message.id);

      // Сначала чистим интерфейс — история исчезает мгновенно.
      commit((prev) => ({
        ...prev,
        chats: prev.chats.map((item) =>
          item.id === chatId ? { ...item, messages: [], unread: 0 } : item,
        ),
      }));

      if (!chat.remote || !me) return true;
      try {
        if (chat.group) {
          await Promise.all([
            deleteRemoteMessagesByIds(remoteIds),
            deleteOwnMessagesByClientIds(me, ownClientIds),
          ]);
        } else if (chat.email) {
          await deleteConversation(me, chat.email);
        }
        return true;
      } catch {
        return false;
      }
    },
    [commit],
  );

  const loginExisting = useCallback(
    (
      email: string,
      profile?: (ZeroProfile & { createdAt?: number }) | null,
    ) => {
      const key = accountKey(profile?.email || email);
      if (!key) return null;

      // Данные профиля берём с сервера: удалённые баннер и музыка не должны
      // возвращаться из локальной копии.
      const local = stateRef.current.accounts[key];
      const server = profile ? userFromProfile({ ...profile, email: key }) : null;
      const account = local
        ? server
          ? {
              ...local,
              ...server,
              // Пустое имя на сервере не должно затирать локальное и не должно
              // превращаться в почту — оставляем сохранённое имя или @username.
              name: preferredName(profile?.name, profile?.username) || local.name,
              username: normalizeUsername(profile?.username ?? "") || local.username,
              pinnedMusic: server.pinnedMusic ?? local.pinnedMusic ?? null,
              id: local.id,
              createdAt: local.createdAt,
            }
          : local
        : server;
      if (!account) return null;

      commit((prev) => {
        if (
          prev.onboarded &&
          prev.user?.id === account.id &&
          prev.user?.email === account.email
        ) {
          return prev;
        }
        // Уходя с другого аккаунта, сохраняем его чаты отдельно и
        // восстанавливаем чаты того, в который входим.
        const previousKey = prev.user
          ? accountKey(prev.user.email || prev.user.phone || "")
          : "";
        const chatAccounts = { ...(prev.chatAccounts ?? {}) };
        if (previousKey) chatAccounts[previousKey] = prev.chats;
        const restored = chatAccounts[key];
        return {
          ...prev,
          user: account,
          onboarded: true,
          accounts: { ...prev.accounts, [key]: account },
          chatAccounts,
          chats: restored
            ? withSavedChat(cleanChats(restored))
            : withSavedChat(cleanChats(createInitialState().chats)),
        };
      });
      return account;
    },
    [commit],
  );

  const completeSignup = useCallback(
    (input: {
      email: string;
      name: string;
      username: string;
      avatar?: string | null;
      bio?: string;
      status?: string;
    }) => {
      const key = accountKey(input.email);
      // Если аккаунт уже появился (повторный клик, восстановление сессии),
      // не создаём второй профиль с тем же email — просто входим.
      const existing = stateRef.current.accounts[key];
      if (existing) {
        commit((prev) => {
          const previousKey = prev.user
            ? accountKey(prev.user.email || prev.user.phone || "")
            : "";
          const chatAccounts = { ...(prev.chatAccounts ?? {}) };
          if (previousKey && previousKey !== key) chatAccounts[previousKey] = prev.chats;
          const restored = chatAccounts[key];
          return {
            ...prev,
            user: existing,
            onboarded: true,
            chatAccounts,
            chats: restored
              ? withSavedChat(cleanChats(restored))
              : withSavedChat(cleanChats(createInitialState().chats)),
          };
        });
        return;
      }
      const user: User = {
        id: uid("u"),
        name: stripEmoji(input.name) || "Пользователь",
        username:
          input.username.trim().replace(/^@/, "") ||
          stripEmoji(input.name).toLowerCase().replace(/\s+/g, "_").slice(0, 24) ||
          "user",
        email: key,
        bio: stripEmoji(input.bio ?? ""),
        status: stripEmoji(input.status ?? "") || "На связи",
        avatar: input.avatar ?? null,
        createdAt: Date.now(),
      };
      commit((prev) => ({
        ...prev,
        user,
        onboarded: true,
        accounts: { ...prev.accounts, [key]: user },
        chatAccounts: {
          ...(prev.chatAccounts ?? {}),
          ...(prev.user
            ? { [accountKey(prev.user.email || prev.user.phone || "")]: prev.chats }
            : {}),
        },
        chats: withSavedChat(cleanChats(createInitialState().chats)),
      }));
    },
    [commit],
  );

  const logout = useCallback(() => {
    const user = stateRef.current.user;
    const key = user ? accountKey(user.email || user.phone || "") : "";
    commit((prev) => ({
      ...prev,
      user: null,
      accounts: user && key
        ? { ...prev.accounts, [key]: user }
        : prev.accounts,
      // Чат предыдущего аккаунта остаётся только в его ячейке и больше не
      // показывается при входе в другой аккаунт на этом устройстве.
      chatAccounts: user && key
        ? { ...(prev.chatAccounts ?? {}), [key]: prev.chats }
        : prev.chatAccounts,
      chats: withSavedChat(cleanChats(createInitialState().chats)),
    }));
    activeChatRef.current = null;
  }, [commit]);

  const updateProfile = useCallback(
    (patch: Partial<User>) => {
      const clean: Partial<User> = { ...patch };
      if (typeof clean.name === "string") clean.name = stripEmoji(clean.name);
      if (typeof clean.bio === "string") clean.bio = stripEmoji(clean.bio);
      if (typeof clean.status === "string") clean.status = stripEmoji(clean.status);
      commit((prev) => {
        if (!prev.user) return prev;
        const nextUser = { ...prev.user, ...clean };
        return {
          ...prev,
          user: nextUser,
          accounts: {
            ...prev.accounts,
            [accountKey(nextUser.email || nextUser.phone || "")]: nextUser,
          },
        };
      });
    },
    [commit],
  );

  const updateSettings = useCallback(
    (patch: Partial<Settings>) => {
      commit((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } }));
    },
    [commit],
  );

  const markAllRead = useCallback(() => {
    commit((prev) => ({
      ...prev,
      chats: prev.chats.map((c) => ({ ...c, unread: 0 })),
    }));
  }, [commit]);

  const setOnboarded = useCallback(() => {
    commit((prev) => ({ ...prev, onboarded: true }));
  }, [commit]);

  const value = useMemo<StoreValue>(() => {
    return {
      state,
      user: state.user,
      totalUnread,
      toast,
      dismissToast,
      setOnboarded,
      loginExisting,
      completeSignup,
      logout,
      updateProfile,
      updateSettings,
      sendMessage,
      setMessageMediaSource,
      receiveMessage,
      loadChatHistory,
      forwardMessage,
      setActiveChat,
      setTyping,
      markRead,
      markAllRead,
      setDraft,
      togglePinChat,
      deleteChat,
      restoreChat,
      react,
      deleteMessage,
      editMessage,
      pinMessage,
      votePoll,
      syncPollVotes,
      openOrCreateChat,
      createGroup,
      updateGroup,
      addGroupMembers,
      removeGroupMember,
      addCall,
      clearMessages,
      blockChat,
    };
  }, [
    state,
    totalUnread,
    toast,
    dismissToast,
    setOnboarded,
    loginExisting,
    completeSignup,
    logout,
    updateProfile,
    updateSettings,
    sendMessage,
    setMessageMediaSource,
    receiveMessage,
    loadChatHistory,
    forwardMessage,
    setActiveChat,
    setTyping,
    markRead,
    markAllRead,
    setDraft,
    togglePinChat,
    deleteChat,
    restoreChat,
    react,
    deleteMessage,
    editMessage,
    pinMessage,
    votePoll,
    syncPollVotes,
    openOrCreateChat,
    createGroup,
    updateGroup,
    addGroupMembers,
    removeGroupMember,
    addCall,
    clearMessages,
    blockChat,
  ]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const value = useContext(StoreContext);
  if (!value) throw new Error("useStore must be used inside StoreProvider");
  return value;
}

export function useAuthedStore() {
  const value = useStore();
  if (!value.user) throw new Error("useAuthedStore requires a signed-in user");
  return value as StoreValue & { user: User };
}

export { STORAGE_KEY };
