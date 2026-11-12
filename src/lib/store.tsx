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
  Message,
  MessageKind,
  MessageStatus,
  Settings,
  ToastData,
  User,
} from "../types";
import { createInitialState, DEFAULT_SETTINGS, STATE_VERSION } from "./data";
import { loadCloudState, saveCloudState } from "./cloud";
import { haptic, stripEmoji, uid } from "./utils";
import {
  playTone,
  setBadge,
  showExternalNotification,
} from "./feedback";

const STORAGE_KEY = "zero:state:v1";

function cleanUser(user: User | null): User | null {
  if (!user) return user;
  // Убираем дефолтную картинку из ранней версии — теперь у профиля чёрная аватарка.
  const next = user.avatar === "/avatar-me.svg" ? { ...user, avatar: null } : user;
  return {
    ...next,
    email: (next.email ?? "").trim().toLowerCase(),
    name: stripEmoji(next.name),
    bio: stripEmoji(next.bio),
    status: stripEmoji(next.status),
  };
}

function cleanChats(chats: Chat[]): Chat[] {
  return chats.map((chat) => ({
    ...chat,
    typing: false,
    name: stripEmoji(chat.name),
    autoReply: chat.autoReply?.map(stripEmoji),
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
      : cleanChats(parsed.chats);

  const accounts: Record<string, User> = {};
  for (const [key, account] of Object.entries(parsed.accounts ?? {})) {
    const next = cleanUser(account);
    if (next) accounts[key] = next;
  }

  return {
    version: STATE_VERSION,
    onboarded: Boolean(parsed.onboarded),
    user: cleanUser(parsed.user ?? null),
    accounts,
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
      return `Файл · ${message.file?.name ?? ""}`;
    case "location":
      return `Геопозиция · ${message.location?.title ?? ""}`;
    case "poll":
      return `Опрос · ${message.poll?.question ?? ""}`;
    default:
      return message.text ?? "";
  }
}

export function chatPreview(chat: Chat): string {
  const last = chat.messages[chat.messages.length - 1];
  if (!last) return "Нет сообщений";
  if (chat.typing) return "печатает…";
  const prefix =
    last.kind === "text"
      ? ""
      : last.kind === "sticker"
        ? ""
        : last.kind === "voice"
          ? ""
          : last.kind === "photo"
            ? ""
            : "";
  if (last.fromMe && last.kind === "text") return `Вы: ${last.text ?? ""}`;
  if (last.fromMe) return `Вы: ${previewOf(last)}`;
  return `${prefix}${previewOf(last)}`;
}

export interface SendPayload {
  kind: MessageKind;
  text?: string;
  sticker?: string;
  voice?: Message["voice"];
  videoNote?: Message["videoNote"];
  photo?: Message["photo"];
  file?: Message["file"];
  location?: Message["location"];
  poll?: Message["poll"];
  replyTo?: string;
  forwardedFrom?: string;
}

interface StoreValue {
  state: AppState;
  user: User | null;
  totalUnread: number;
  toast: ToastData | null;
  dismissToast: () => void;
  setOnboarded: () => void;
  loginExisting: (email: string) => User | null;
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
  setMessageMediaSource: (chatId: string, messageId: string, kind: "voice" | "videoNote", src: string) => void;
  receiveMessage: (chatId: string, data: SendPayload) => void;
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
  deleteMessage: (chatId: string, messageId: string) => void;
  pinMessage: (chatId: string, messageId: string) => void;
  votePoll: (chatId: string, messageId: string, optionId: string) => void;
  openOrCreateChat: (contact: {
    name: string;
    username?: string;
    phone?: string;
    online?: boolean;
    lastSeen?: number;
    avatar?: string | null;
  }) => string;
  addCall: (call: Omit<CallRecord, "id" | "at">) => void;
  clearMessages: (chatId: string) => void;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(loadState);
  const stateRef = useRef(state);
  const activeChatRef = useRef<string | null>(null);
  const cloudPulledFor = useRef<string | null>(null);
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
          const localMessages = prev.chats.reduce((sum, chat) => sum + chat.messages.length, 0);
          const remoteMessages = remote.chats.reduce((sum, chat) => sum + chat.messages.length, 0);
          if (remoteMessages <= localMessages) return prev;
          return {
            ...prev,
            chats: remote.chats,
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
    }, 1600);
    return () => window.clearTimeout(timer);
  }, [state]);

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
    (chatId: string, data: SendPayload) => {
      const chat = stateRef.current.chats.find((c) => c.id === chatId);
      if (!chat) return;
      const message: Message = {
        id: uid("m"),
        chatId,
        fromMe: false,
        at: Date.now(),
        status: undefined,
        ...data,
        fresh: true,
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
        if (
          stateRef.current.settings.push &&
          typeof document !== "undefined" &&
          document.hidden
        ) {
          showExternalNotification(chat.name, text, chatId);
        }
      }
    },
    [commit, pushToast],
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

      const setStatus = (status: MessageStatus) => {
        commit((prev) => ({
          ...prev,
          chats: prev.chats.map((c) =>
            c.id === chatId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === message.id && m.status !== status ? { ...m, status } : m,
                  ),
                }
              : c,
          ),
        }));
      };

      window.setTimeout(() => setStatus("sent"), 520);
      window.setTimeout(() => {
        if (stateRef.current.settings.readReceipts) setStatus("read");
      }, 1500);

      if (chat.autoReply && chat.autoReply.length > 0 && !chat.group) {
        const replies = chat.autoReply;
        const outgoing = chat.messages.filter((m) => m.fromMe).length;
        const reply = replies[outgoing % replies.length];
        window.setTimeout(() => {
          const exists = stateRef.current.chats.some((c) => c.id === chatId);
          if (exists) setTyping(chatId, true);
        }, 850);
        window.setTimeout(() => {
          const exists = stateRef.current.chats.some((c) => c.id === chatId);
          if (exists) {
            receiveMessage(chatId, {
              kind: "text",
              text: reply,
            });
          }
        }, 2600);
      }

      return message.id;
    },
    [commit, receiveMessage, setTyping],
  );

  const setMessageMediaSource = useCallback(
    (chatId: string, messageId: string, kind: "voice" | "videoNote", src: string) => {
      commit((prev) => ({
        ...prev,
        chats: prev.chats.map((chat) => {
          if (chat.id !== chatId) return chat;
          return {
            ...chat,
            messages: chat.messages.map((message) => {
              if (message.id !== messageId) return message;
              if (kind === "voice" && message.voice) {
                return { ...message, voice: { ...message.voice, src } };
              }
              if (kind === "videoNote" && message.videoNote) {
                return { ...message, videoNote: { ...message.videoNote, src } };
              }
              return message;
            }),
          };
        }),
      }));
    },
    [commit],
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
      window.setTimeout(() => {
        commit((prev) => ({
          ...prev,
          chats: prev.chats.map((c) =>
            c.id === targetChatId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === clone.id ? { ...m, status: "sent" } : m,
                  ),
                }
              : c,
          ),
        }));
      }, 500);
    },
    [commit],
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
      commit((prev) => ({ ...prev, chats: prev.chats.filter((c) => c.id !== chatId) }));
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

  const deleteMessage = useCallback(
    (chatId: string, messageId: string) => {
      commit((prev) => ({
        ...prev,
        chats: prev.chats.map((chat) =>
          chat.id === chatId
            ? { ...chat, messages: chat.messages.filter((m) => m.id !== messageId) }
            : chat,
        ),
      }));
    },
    [commit],
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

  const votePoll = useCallback(
    (chatId: string, messageId: string, optionId: string) => {
      commit((prev) => ({
        ...prev,
        chats: prev.chats.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                messages: chat.messages.map((msg) => {
                  if (msg.id !== messageId || !msg.poll) return msg;
                  const options = msg.poll.options.map((option) => {
                    if (option.id === optionId) {
                      return {
                        ...option,
                        voted: !option.voted,
                        votes: option.voted ? Math.max(0, option.votes - 1) : option.votes + 1,
                      };
                    }
                    if (option.voted) {
                      return { ...option, voted: false, votes: Math.max(0, option.votes - 1) };
                    }
                    return option;
                  });
                  return { ...msg, poll: { ...msg.poll, options } };
                }),
              }
            : chat,
        ),
      }));
    },
    [commit],
  );

  const openOrCreateChat = useCallback(
    (contact: {
      name: string;
      username?: string;
      phone?: string;
      online?: boolean;
      lastSeen?: number;
      avatar?: string | null;
    }) => {
      const existing = stateRef.current.chats.find(
        (c) =>
          c.name === contact.name ||
          (contact.username && c.username === contact.username),
      );
      if (existing) return existing.id;
      const id = uid("c");
      const chat: Chat = {
        id,
        name: contact.name,
        username: contact.username,
        phone: contact.phone,
        online: contact.online,
        lastSeen: contact.lastSeen,
        avatar: contact.avatar ?? null,
        unread: 0,
        messages: [],
        autoReply: ["Привет! Рад тебя видеть здесь.", "На связи.", "Давай созвонимся позже?"],
      };
      commit((prev) => ({ ...prev, chats: [chat, ...prev.chats] }));
      return id;
    },
    [commit],
  );

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
    (chatId: string) => {
      commit((prev) => ({
        ...prev,
        chats: prev.chats.map((c) =>
          c.id === chatId ? { ...c, messages: [], unread: 0 } : c,
        ),
      }));
    },
    [commit],
  );

  const loginExisting = useCallback(
    (email: string) => {
      const key = accountKey(email);
      const account = stateRef.current.accounts[key] ?? null;
      if (!account) return null;
      commit((prev) => ({ ...prev, user: account, onboarded: true }));
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
      const user: User = {
        id: uid("u"),
        name: stripEmoji(input.name) || "Пользователь",
        username:
          input.username.trim().replace(/^@/, "") ||
          stripEmoji(input.name).toLowerCase().replace(/\s+/g, "_").slice(0, 24) ||
          "user",
        email: key,
        verified: true,
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
      pinMessage,
      votePoll,
      openOrCreateChat,
      addCall,
      clearMessages,
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
    pinMessage,
    votePoll,
    openOrCreateChat,
    addCall,
    clearMessages,
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
