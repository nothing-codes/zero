import { supabase } from "./supabase";

/**
 * Медиа для голосовых и видеокружков хранится в Supabase Storage.
 * Бакет публичный на чтение, чтобы ссылки можно было класть в сообщения
 * и синхронизировать через облачную резервную копию.
 */
export const MEDIA_BUCKET = "zero-media";

function extensionFor(blob: Blob, kind: "voice" | "videoNote" | "photo") {
  const type = (blob.type || "").toLowerCase();
  if (kind === "photo") {
    if (type.includes("png")) return "png";
    if (type.includes("webp")) return "webp";
    return "jpg";
  }
  if (type.includes("mp4")) return kind === "voice" ? "m4a" : "mp4";
  if (type.includes("mpeg")) return "mp3";
  if (type.includes("ogg")) return "ogg";
  return "webm";
}

/**
 * Safari/iOS не умеет проигрывать webm, поэтому сначала пробуем mp4.
 * Chrome, наоборот, не пишет mp4 — там сработает webm/opus.
 */
export function pickRecorderMime(kind: "voice" | "videoNote"): string | undefined {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return undefined;
  const candidates = kind === "voice"
    ? ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]
    : ["video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

export async function uploadMedia(blob: Blob, kind: "voice" | "videoNote" | "photo"): Promise<string> {
  const ext = extensionFor(blob, kind);
  const path = `${kind}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const contentType = (blob.type || "").split(";")[0] || (kind === "photo" ? "image/jpeg" : kind === "voice" ? "audio/webm" : "video/webm");

  const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, blob, {
    contentType,
    cacheControl: "31536000",
    upsert: false,
  });

  if (error) throw error;

  const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
