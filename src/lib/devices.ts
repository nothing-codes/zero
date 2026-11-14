import { supabase } from "./supabase";

/**
 * Активные устройства (как «Устройства» в Telegram).
 *
 * Идентификатор устройства хранится в localStorage, поэтому один и тот же
 * браузер обновляет свою запись, а не создаёт новую при каждом входе.
 */
export const DEVICES_TABLE = "zero_devices";
const DEVICE_KEY = "zero:device:v1";

export interface DeviceRow {
  id: string;
  account_email: string;
  name: string;
  platform: string;
  app_version: string;
  last_active: string;
  created_at: string;
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function deviceId() {
  try {
    const stored = localStorage.getItem(DEVICE_KEY);
    if (stored) return stored;
    const created =
      globalThis.crypto?.randomUUID?.() ??
      `dev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(DEVICE_KEY, created);
    return created;
  } catch {
    return "dev_unknown";
  }
}

export function currentDeviceInfo() {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const platform = detectPlatform(ua);
  const browser = detectBrowser(ua);
  const name = browser ? `${browser} · ${platform}` : platform;
  return { name, platform, appVersion: "0.1.0" };
}

function detectPlatform(ua: string) {
  if (/iPhone|iPod/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) {
    const match = /Android[^;)]*;\s*([^;)]+)/i.exec(ua);
    return match?.[1]?.trim() || "Android";
  }
  if (/Macintosh|Mac OS X/i.test(ua)) return "macOS";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Linux/i.test(ua)) return "Linux";
  return "Браузер";
}

function detectBrowser(ua: string) {
  if (/Edg\//.test(ua)) return "Edge";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua)) return "Safari";
  return "";
}

export async function registerDevice(email: string): Promise<void> {
  const account = normalizeEmail(email);
  if (!account) return;
  const info = currentDeviceInfo();
  const { error } = await supabase.from(DEVICES_TABLE).upsert(
    {
      id: `${account}:${deviceId()}`,
      account_email: account,
      name: info.name,
      platform: info.platform,
      app_version: info.appVersion,
      last_active: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) throw error;
}

export async function listDevices(email: string): Promise<DeviceRow[]> {
  const account = normalizeEmail(email);
  if (!account) return [];
  const { data, error } = await supabase
    .from(DEVICES_TABLE)
    .select("*")
    .eq("account_email", account)
    .order("last_active", { ascending: false })
    .limit(30);
  if (error) throw error;
  return (data ?? []) as DeviceRow[];
}

export async function terminateDevice(id: string): Promise<void> {
  const { error } = await supabase.from(DEVICES_TABLE).delete().eq("id", id);
  if (error) throw error;
}

export async function terminateOtherDevices(email: string): Promise<void> {
  const account = normalizeEmail(email);
  if (!account) return;
  const current = `${account}:${deviceId()}`;
  const { error } = await supabase
    .from(DEVICES_TABLE)
    .delete()
    .eq("account_email", account)
    .neq("id", current);
  if (error) throw error;
}

export function isCurrentDevice(row: DeviceRow) {
  return row.id === `${normalizeEmail(row.account_email)}:${deviceId()}`;
}
