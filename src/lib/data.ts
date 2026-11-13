import type { AppState, CallRecord, Chat, Message, PollOption, User } from "../types";
import { makeWave, uid } from "./utils";

export interface Country {
  iso: string;
  name: string;
  dial: string;
  digits: number;
  groups: number[];
}

export const COUNTRIES: Country[] = [
  { iso: "BY", name: "Беларусь", dial: "+375", digits: 9, groups: [2, 3, 2, 2] },
  { iso: "RU", name: "Россия", dial: "+7", digits: 10, groups: [3, 3, 2, 2] },
];

export const REACTION_EMOJI: string[] = [];
export const EMOJI: string[] = [];
export const STICKERS: string[] = [];
export const STICKER_PACKS: any[] = [];

export interface Contact {
  id: string;
  name: string;
  username: string;
  phone: string;
  email?: string;
  avatar?: string | null;
  online: boolean;
  lastSeen?: number;
  bio: string;
}

const now = Date.now();
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

function at(msAgo: number) {
  return now - msAgo;
}

function m(partial: Omit<Message, "id" | "at"> & { id?: string; at: number }): Message {
  return { ...partial, id: partial.id ?? uid("m") };
}

export const STATE_VERSION = 3;

const zeroId = "c_zero";

export const SEED_CHATS: Chat[] = [
  {
    id: zeroId,
    name: "Zero",
    username: "zero",
    email: "zero@gmail.com",
    verified: true,
    avatar: "/icon-512.png",
    unread: 1,
    messages: [
      m({ chatId: zeroId, fromMe: false, kind: "text", at: at(46 * MIN), text: "Добро пожаловать в Zero." }),
      m({ chatId: zeroId, fromMe: false, kind: "text", at: at(44 * MIN), text: "Здесь тихо: ни рекламы, ни рекомендаций. Только вы и ваши люди." }),
      m({ chatId: zeroId, fromMe: false, kind: "text", at: at(26 * MIN), text: "Ваша почта защищена. Начните общение.", fresh: true }),
    ],
  }
];

export const CONTACTS: Contact[] = [];

export const SEED_CALLS: CallRecord[] = [];

export const DEFAULT_SETTINGS = {
  theme: "dark" as const,
  notifications: true,
  push: false,
  sound: true,
  vibration: true,
  readReceipts: true,
  lastSeen: "contacts" as const,
  profilePhoto: "contacts" as const,
  phoneNumber: "contacts" as const,
  twoFactor: false,
  reducedMotion: false,
  compact: false,
};

export function createInitialState(): AppState {
  return {
    version: STATE_VERSION,
    onboarded: false,
    user: null,
    accounts: {},
    chats: SEED_CHATS,
    calls: SEED_CALLS,
    settings: { ...DEFAULT_SETTINGS },
  };
}