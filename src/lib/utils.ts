import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const EASE_OUT = [0.16, 1, 0.3, 1] as const;
export const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;

export const SPRING_PRESS = { type: "spring", stiffness: 500, damping: 30, mass: 0.6 } as const;
export const SPRING_PANEL = { type: "spring", stiffness: 420, damping: 40, mass: 0.5 } as const;
export const SPRING_LAYOUT = { type: "spring", stiffness: 360, damping: 32, mass: 0.6 } as const;

let counter = 0;
export function uid(prefix = "id") {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter}_${Math.random().toString(36).slice(2, 7)}`;
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Z";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu;

/** Убирает эмодзи/пиктограммы из пользовательских строк. */
export function stripEmoji(value: string) {
  return value.replace(EMOJI_RE, "").replace(/[ \t]{2,}/g, " ").trim();
}

const MONTHS = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const WEEKDAYS_FULL = [
  "воскресенье",
  "понедельник",
  "вторник",
  "среду",
  "четверг",
  "пятницу",
  "субботу",
];

export function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

export function timeOf(at: number) {
  const d = new Date(at);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function isSameDay(a: number, b: number) {
  const d1 = new Date(a);
  const d2 = new Date(b);
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

export function dayStart(at: number) {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function dayLabel(at: number, now = Date.now()) {
  const diffDays = Math.round((dayStart(now) - dayStart(at)) / 86_400_000);
  if (diffDays === 0) return "Сегодня";
  if (diffDays === 1) return "Вчера";
  const d = new Date(at);
  const label = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === new Date(now).getFullYear() ? label : `${label} ${d.getFullYear()}`;
}

export function listTime(at: number, now = Date.now()) {
  const diffDays = Math.round((dayStart(now) - dayStart(at)) / 86_400_000);
  if (diffDays === 0) return timeOf(at);
  if (diffDays === 1) return "Вчера";
  if (diffDays < 7) return WEEKDAYS[new Date(at).getDay()];
  return `${pad2(new Date(at).getDate())}.${pad2(new Date(at).getMonth() + 1)}`;
}

export function duration(sec: number) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${pad2(s % 60)}`;
}

export function lastSeenLabel(at?: number, online?: boolean) {
  if (online) return "в сети";
  if (!at) return "был(а) недавно";
  const now = Date.now();
  const diff = Math.max(0, now - at);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "был(а) в сети только что";
  if (mins < 60) return `был(а) в сети ${mins} ${plural(mins, "минуту", "минуты", "минут")} назад`;
  const hours = Math.floor(mins / 60);
  if (isSameDay(now, at)) return `был(а) в сети ${hours} ${plural(hours, "час", "часа", "часов")} назад`;
  const diffDays = Math.round((dayStart(now) - dayStart(at)) / 86_400_000);
  if (diffDays === 1) return `был(а) вчера в ${timeOf(at)}`;
  if (diffDays < 7) return `был(а) в ${WEEKDAYS_FULL[new Date(at).getDay()]} в ${timeOf(at)}`;
  const d = new Date(at);
  if (d.getFullYear() === new Date(now).getFullYear()) {
    return `был(а) ${d.getDate()} ${MONTHS[d.getMonth()]} в ${timeOf(at)}`;
  }
  return `был(а) ${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`;
}

export function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

export function formatPhone(dial: string, national: string) {
  const digits = national.replace(/\D/g, "");
  if (!digits) return "";
  return `${dial} ${digits}`;
}

export function decoratePhone(dial: string, national: string) {
  return `${dial} ${national.replace(/\D/g, "")}`.replace(/\s+/g, " ").trim();
}

/** Deterministic pseudo-random generator (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeWave(seed: number, n = 32) {
  const r = rng(seed * 97 + 13);
  return Array.from({ length: n }, (_, i) => {
    const envelope = Math.sin((i / (n - 1)) * Math.PI) * 0.55 + 0.45;
    return Math.max(0.18, Math.min(1, (0.25 + r() * 0.9) * envelope));
  });
}

export function haptic(pattern: number | number[] = 8) {
  try {
    if ("vibrate" in navigator) navigator.vibrate(pattern);
  } catch {
    /* noop */
  }
}

export function relativeShort(at: number) {
  const diff = Math.max(0, Date.now() - at);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "сейчас";
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч`;
  const d = Math.floor(h / 24);
  return `${d} д`;
}

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function messagePreview(text: string, max = 62) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Реальный адрес приложения — вместо несуществующего zero.app. */
export function appOrigin() {
  if (typeof window === "undefined") return "https://zero-nothing.vercel.app";
  return window.location.origin;
}

export function appLink(path = "/") {
  const origin = appOrigin();
  if (!path || path === "/") return origin;
  return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
}

export function appHost() {
  return appLink().replace(/^https?:\/\//, "").replace(/\/$/, "");
}
