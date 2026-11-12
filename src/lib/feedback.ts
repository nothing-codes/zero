let ctx: AudioContext | null = null;

function context() {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(freq: number, start: number, length: number, gainValue: number, type: OscillatorType) {
  const audio = context();
  if (!audio) return;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, audio.currentTime + start);
  gain.gain.setValueAtTime(0.0001, audio.currentTime + start);
  gain.gain.exponentialRampToValueAtTime(gainValue, audio.currentTime + start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + start + length);
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(audio.currentTime + start);
  osc.stop(audio.currentTime + start + length + 0.02);
}

export type SoundKind = "send" | "receive" | "tap" | "success" | "error" | "hangup";

export function playTone(kind: SoundKind) {
  try {
    switch (kind) {
      case "send":
        tone(540, 0, 0.07, 0.02, "triangle");
        tone(760, 0.03, 0.06, 0.012, "sine");
        break;
      case "receive":
        tone(340, 0, 0.1, 0.018, "sine");
        tone(510, 0.09, 0.14, 0.02, "sine");
        break;
      case "tap":
        tone(620, 0, 0.03, 0.008, "sine");
        break;
      case "success":
        tone(420, 0, 0.12, 0.02, "sine");
        tone(630, 0.08, 0.16, 0.02, "sine");
        tone(840, 0.16, 0.22, 0.018, "sine");
        break;
      case "error":
        tone(220, 0, 0.12, 0.025, "triangle");
        tone(180, 0.1, 0.16, 0.02, "triangle");
        break;
      case "hangup":
        tone(380, 0, 0.12, 0.02, "sine");
        tone(280, 0.1, 0.2, 0.018, "sine");
        break;
    }
  } catch {
    /* audio is decorative */
  }
}

export function setBadge(count: number) {
  const nav = navigator as Navigator & {
    setAppBadge?: (n?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  try {
    if (count > 0 && nav.setAppBadge) void nav.setAppBadge(count);
    else if (nav.clearAppBadge) void nav.clearAppBadge();
  } catch {
    /* unsupported */
  }
}

export async function requestPushPermission() {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    const result = await Notification.requestPermission();
    return result === "granted";
  } catch {
    return false;
  }
}

export function showExternalNotification(title: string, body: string, tag: string) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, {
      body,
      tag,
      icon: "/icon-192.png",
      badge: "/icon-96.png",
      silent: true,
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* noop */
  }
}
