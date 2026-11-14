export type ThemeMode = "dark" | "light" | "system";
export type Visibility = "all" | "contacts" | "nobody";

export interface Settings {
  theme: ThemeMode;
  notifications: boolean;
  push: boolean;
  sound: boolean;
  vibration: boolean;
  readReceipts: boolean;
  lastSeen: Visibility;
  profilePhoto: Visibility;
  phoneNumber: Visibility;
  twoFactor: boolean;
  reducedMotion: boolean;
  compact: boolean;
}

export interface PinnedMusic {
  title: string;
  artist: string;
  src: string;
  enc?: MediaEncryption;
  mime: string;
  size: number;
}

export interface User {
  id: string;
  name: string;
  username: string;
  email: string;
  phone?: string;
  dial?: string;
  verified?: boolean;
  bio: string;
  status: string;
  avatar: string | null;
  banner?: string | null;
  /** Музыка, закреплённая в профиле. */
  pinnedMusic?: PinnedMusic | null;
  /** Личные стикеры (сжатые картинки), сохранённые из чата. */
  stickers?: string[];
  createdAt: number;
}

export type MessageKind =
  | "text"
  | "sticker"
  | "voice"
  | "videoNote"
  | "photo"
  | "file"
  | "location"
  | "poll";

export type MessageStatus = "sending" | "sent" | "read";

export interface Reaction {
  emoji: string;
  count: number;
  mine?: boolean;
}

export interface PollOption {
  id: string;
  text: string;
  votes: number;
  voted?: boolean;
}

export interface Poll {
  /** Стабильный id для голосования в базе (одинаковый у всех участников). */
  id?: string;
  question: string;
  options: PollOption[];
}

export interface MediaEncryption {
  /** Сырой AES-ключ в base64 — хранится только внутри зашифрованного payload. */
  key: string;
  iv: string;
  mime: string;
  size: number;
}

export interface MessageVoice {
  duration: number;
  waveform: number[];
  src?: string;
  enc?: MediaEncryption;
}

export interface MessageVideoNote {
  duration: number;
  seed: number;
  src?: string;
  enc?: MediaEncryption;
}

export interface MessagePhoto {
  seed?: number;
  src?: string;
  enc?: MediaEncryption;
  wide?: boolean;
  caption?: string;
}

export interface MessageFile {
  name: string;
  size: number;
  ext: string;
  mime?: string;
  src?: string;
  enc?: MediaEncryption;
  pending?: boolean;
}

export interface MessageLocation {
  title: string;
  subtitle?: string;
  seed: number;
}

export interface Message {
  id: string;
  chatId: string;
  fromMe: boolean;
  at: number;
  kind: MessageKind;
  status?: MessageStatus;
  text?: string;
  sticker?: string;
  voice?: MessageVoice;
  videoNote?: MessageVideoNote;
  photo?: MessagePhoto;
  file?: MessageFile;
  location?: MessageLocation;
  poll?: Poll;
  replyTo?: string;
  forwardedFrom?: string;
  pinned?: boolean;
  fresh?: boolean;
  edited?: boolean;
  sender?: string;
  reactions?: Reaction[];
  /** Группа/канал, к которому относится сообщение (для маршрутизации). */
  group?: MessageGroupInfo;
  /** Идентификатор сообщения в базе Zero (для дедупликации Realtime). */
  remoteId?: string;
}

/** Данные сообщения без служебных полей — то, что уходит в Supabase. */
export interface MessagePayload {
  kind: MessageKind;
  text?: string;
  sticker?: string;
  voice?: MessageVoice;
  videoNote?: MessageVideoNote;
  photo?: MessagePhoto;
  file?: MessageFile;
  location?: MessageLocation;
  poll?: Poll;
  replyTo?: string;
  forwardedFrom?: string;
  edited?: boolean;
  /** Описание группы/канала — едет внутри зашифрованного payload. */
  group?: MessageGroupInfo;
}

export interface MessageGroupInfo {
  key: string;
  title: string;
  kind: "group" | "channel";
  members: string[];
  ownerEmail?: string;
}

export interface GroupMember {
  email: string;
  name: string;
  username?: string;
  avatar?: string | null;
}

export interface ChatGroup {
  key?: string;
  kind?: "group" | "channel";
  members?: number;
  memberList?: GroupMember[];
  ownerEmail?: string;
  description?: string;
}

export interface Chat {
  id: string;
  name: string;
  username?: string;
  phone?: string;
  email?: string;
  verified?: boolean;
  unread: number;
  messages: Message[];
  avatar?: string | null;
  online?: boolean;
  lastSeen?: number;
  typing?: boolean;
  draft?: string;
  pinnedChat?: boolean;
  muted?: boolean;
  group?: ChatGroup;
  /** Чат «Избранное» — личные заметки. */
  saved?: boolean;
  /** Чат с реальным пользователем, сообщения хранятся в Supabase. */
  remote?: boolean;
  /** История из Supabase уже подгружена. */
  historyLoaded?: boolean;
}

export interface CallRecord {
  id: string;
  chatId: string;
  name: string;
  direction: "in" | "out" | "missed";
  duration: number;
  at: number;
}

export interface AppState {
  version: number;
  onboarded: boolean;
  user: User | null;
  accounts: Record<string, User>;
  chats: Chat[];
  calls: CallRecord[];
  settings: Settings;
}

export interface ToastData {
  id: string;
  chatId: string;
  name: string;
  avatar?: string | null;
  text: string;
  kind: MessageKind;
  at: number;
}
