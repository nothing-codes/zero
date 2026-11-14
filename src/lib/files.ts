import type { MediaEncryption } from "../types";
import { encryptBlob } from "./e2ee";
import { MEDIA_BUCKET } from "./media";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, supabase } from "./supabase";

export interface UploadedFile {
  url: string;
  path: string;
  enc: MediaEncryption;
}

interface WritableFileLike {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}

interface FileHandleLike {
  createWritable(): Promise<WritableFileLike>;
}

interface DirectoryHandleLike {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandleLike>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>;
}

type DirectoryPicker = (options?: {
  id?: string;
  mode?: "read" | "readwrite";
  startIn?: string;
}) => Promise<DirectoryHandleLike>;

type SaveFilePicker = (options?: {
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
}) => Promise<FileHandleLike>;

function pickerWindow() {
  return window as unknown as {
    showDirectoryPicker?: DirectoryPicker;
    showSaveFilePicker?: SaveFilePicker;
  };
}

export function safeFileName(value: string) {
  const base = value.split(/[\\/]/).pop() ?? "file";
  const clean = base
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return clean.slice(0, 140) || "file";
}

/** Загружает файл в Storage, отдавая реальный прогресс и поддержку отмены. */
export async function uploadFileToCloud(
  file: File,
  onProgress: (value: number) => void,
  signal: AbortSignal,
): Promise<UploadedFile> {
  const name = safeFileName(file.name);
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "") : "bin";
  const path = `files/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext || "bin"}.enc`;
  const endpoint = `${SUPABASE_URL}/storage/v1/object/${MEDIA_BUCKET}/${path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
  const encrypted = await encryptBlob(file);
  const body = encrypted.blob;
  const contentType = "application/octet-stream";

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    let aborted = false;

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      reject(error);
    };
    const done = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = () => {
      aborted = true;
      try { xhr.abort(); } catch { /* noop */ }
      fail(new DOMException("Aborted", "AbortError"));
    };

    xhr.open("POST", endpoint, true);
    xhr.setRequestHeader("apikey", SUPABASE_PUBLISHABLE_KEY);
    xhr.setRequestHeader("authorization", `Bearer ${SUPABASE_PUBLISHABLE_KEY}`);
    xhr.setRequestHeader("cache-control", "31536000");
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("content-type", contentType);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.max(0, Math.min(1, event.loaded / event.total)));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1);
        done();
        return;
      }
      let message = `upload-${xhr.status}`;
      try {
        const parsed = JSON.parse(xhr.responseText) as { message?: string; error?: string };
        message = parsed.message || parsed.error || message;
      } catch { /* noop */ }
      fail(new Error(message));
    };
    xhr.onerror = () => fail(new Error(aborted ? "aborted" : "network"));
    xhr.onabort = () => fail(new DOMException("Aborted", "AbortError"));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    xhr.send(body);
  });

  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, path, enc: encrypted.enc };
}

export function storagePathFromUrl(url?: string | null): string | null {
  if (!url) return null;
  try {
    const marker = `/storage/v1/object/public/${MEDIA_BUCKET}/`;
    const parsed = new URL(url, window.location.origin);
    const index = parsed.pathname.indexOf(marker);
    if (index < 0) return null;
    return parsed.pathname
      .slice(index + marker.length)
      .split("/")
      .map((part) => decodeURIComponent(part))
      .join("/");
  } catch {
    return null;
  }
}

export async function deleteStoragePaths(paths: string[]): Promise<void> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return;
  const { error } = await supabase.storage.from(MEDIA_BUCKET).remove(unique);
  if (error) throw error;
}

/** Скачивает файл с прогрессом; signal отменяет чтение. */
export async function downloadFileBlob(
  url: string,
  expectedSize: number,
  onProgress: (value: number) => void,
  signal: AbortSignal,
): Promise<Blob> {
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`download-${response.status}`);
  const total = Number(response.headers.get("content-length")) || expectedSize || 0;
  const type = response.headers.get("content-type") || "application/octet-stream";

  if (!response.body) {
    const blob = await response.blob();
    onProgress(1);
    return blob;
  }

  const reader = response.body.getReader();
  const buffers: ArrayBuffer[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    buffers.push(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer);
    received += value.byteLength;
    if (total > 0) onProgress(Math.min(1, received / total));
  }
  onProgress(1);
  return new Blob(buffers, { type });
}

/** Возвращает папку Download/Zero, если браузер поддерживает доступ к файлам. */
export async function pickZeroDirectory(): Promise<DirectoryHandleLike | null> {
  const picker = pickerWindow().showDirectoryPicker;
  if (!picker) return null;
  const root = await picker({ id: "zero-downloads", mode: "readwrite", startIn: "downloads" });
  return root.getDirectoryHandle("Zero", { create: true });
}

export async function writeBlobToDirectory(
  directory: DirectoryHandleLike,
  filename: string,
  blob: Blob,
): Promise<void> {
  const handle = await directory.getFileHandle(safeFileName(filename), { create: true });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

export function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = safeFileName(filename);
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Сохраняет фото в галерею через системный диалог сохранения. */
export async function saveImageToGallery(
  blob: Blob,
  filename: string,
): Promise<"saved" | "canceled"> {
  const type = blob.type.startsWith("image/") ? blob.type : "image/jpeg";
  const file = new File([blob], safeFileName(filename), { type });

  const picker = pickerWindow().showSaveFilePicker;
  if (picker) {
    try {
      const ext = file.name.includes(".") ? `.${file.name.split(".").pop()}` : ".jpg";
      const handle = await picker({
        suggestedName: file.name,
        types: [{ description: "Изображение", accept: { "image/*": [ext] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return "saved";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "canceled";
    }
  }

  triggerBlobDownload(blob, file.name);
  return "saved";
}
