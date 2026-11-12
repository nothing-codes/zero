import { supabase } from "./supabase";

/**
 * Медиа для голосовых и видеокружков хранится в Supabase Storage.
 * Бакет публичный на чтение, чтобы ссылки можно было класть в сообщения
 * и синхронизировать через облачную резервную копию.
 */
export const MEDIA_BUCKET = "zero-media";

function extensionFor(blob: Blob, kind: "voice" | "videoNote") {
  const type = (blob.type || "").toLowerCase();
  if (type.includes("mp4")) return kind === "voice" ? "m4a" : "mp4";
  if (type.includes("mpeg")) return "mp3";
  if (type.includes("ogg")) return "ogg";
  return "webm";
}

export async function uploadMedia(blob: Blob, kind: "voice" | "videoNote"): Promise<string> {
  const ext = extensionFor(blob, kind);
  const path = `${kind}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const contentType = (blob.type || "").split(";")[0] || (kind === "voice" ? "audio/webm" : "video/webm");

  const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, blob, {
    contentType,
    cacheControl: "31536000",
    upsert: false,
  });

  if (error) throw error;

  const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
