import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";

/**
 * WebRTC-звонки без отдельного сервера: сигналинг идёт через Supabase Realtime.
 * Комната — это username того, кому звонят. Публичные STUN-серверы помогают
 * установить соединение напрямую; для сложных NAT нужен TURN (см. DEPLOY.md).
 */
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  ...(import.meta.env.VITE_TURN_URL
    ? [
        {
          urls: import.meta.env.VITE_TURN_URL.split(",").map((url: string) => url.trim()),
          username: import.meta.env.VITE_TURN_USERNAME,
          credential: import.meta.env.VITE_TURN_CREDENTIAL,
        },
      ]
    : []),
];

export function slug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function callRoom(handle: string) {
  return `zero-call:${slug(handle) || "unknown"}`;
}

export function newClientId() {
  return globalThis.crypto?.randomUUID?.() ?? `c_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export type CallSignal =
  | {
      client: string;
      kind: "offer";
      from: string;
      handle: string;
      sdp: RTCSessionDescriptionInit;
    }
  | { client: string; kind: "answer"; sdp: RTCSessionDescriptionInit }
  | { client: string; kind: "ice"; candidate: RTCIceCandidateInit }
  | { client: string; kind: "hangup" };

export interface IncomingCall {
  chatId: string;
  from: string;
  handle: string;
  room: string;
  sdp: RTCSessionDescriptionInit;
}

export function subscribeCall(
  room: string,
  onSignal: (signal: CallSignal) => void,
  onReady?: () => void,
) {
  const channel = supabase.channel(room, {
    config: { private: true, broadcast: { self: false } },
  });
  channel.on("broadcast", { event: "signal" }, ({ payload }) => {
    if (payload && typeof payload === "object") onSignal(payload as CallSignal);
  });
  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") onReady?.();
  });
  return channel;
}

export function sendSignal(channel: RealtimeChannel | null, signal: CallSignal): Promise<void> {
  if (!channel) return Promise.resolve();
  return channel
    .send({ type: "broadcast", event: "signal", payload: signal })
    .then(() => undefined)
    .catch(() => undefined);
}
