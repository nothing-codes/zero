import type { MediaEncryption, MessagePayload } from "../types";
import { supabase } from "./supabase";

/**
 * Сквозное шифрование Zero.
 *
 * Приватный ключ устройства (ECDH P-256) создаётся один раз и лежит только
 * в localStorage. В Supabase попадает лишь публичный ключ профиля. Из
 * ECDH-секрета пары участников через HKDF выводится AES-256-GCM ключ беседы:
 * им шифруются payload сообщений и содержимое вложений.
 */

const IDENTITY_PREFIX = "zero:e2ee:identity:v1:";
const BACKUP_PREFIX = "zero:e2ee:backup:v1:";
const E2EE_INFO = "zero-e2ee-v1";
const PAYLOAD_MARK = "zero-e2ee-v1";
const STATE_MARK = "zero-state-v1";

export interface EncryptedEnvelope {
  __enc: typeof PAYLOAD_MARK;
  iv: string;
  data: string;
}

interface StoredIdentity {
  privateJwk: JsonWebKey;
  publicJwk: JsonWebKey;
}

interface Identity {
  privateKey: CryptoKey;
  publicJwk: JsonWebKey;
}

const identityCache = new Map<string, Promise<Identity>>();
const conversationKeys = new Map<string, Promise<CryptoKey>>();
const peerKeys = new Map<string, { value: string | null; at: number }>();
const mediaUrls = new Map<string, Promise<string>>();

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function conversationKey(a: string, b: string) {
  return [normalizeEmail(a), normalizeEmail(b)].sort().join("|");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function encode(value: string) {
  return new TextEncoder().encode(value);
}

function randomBytes(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/** Копия байтов в ArrayBuffer — так типы WebCrypto довольны при любом TS. */
function bytes(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

function subtle() {
  if (!globalThis.crypto?.subtle) throw new Error("crypto-unavailable");
  return globalThis.crypto.subtle;
}

async function createIdentity(): Promise<StoredIdentity> {
  const pair = await subtle().generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  return {
    privateJwk: await subtle().exportKey("jwk", pair.privateKey),
    publicJwk: await subtle().exportKey("jwk", pair.publicKey),
  };
}

async function importIdentity(stored: StoredIdentity): Promise<Identity> {
  const privateKey = await subtle().importKey(
    "jwk",
    stored.privateJwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );
  return { privateKey, publicJwk: stored.publicJwk };
}

/** Ключевая пара устройства. Приватный ключ никогда не покидает браузер. */
export function ensureIdentity(emailValue: string): Promise<Identity> {
  const email = normalizeEmail(emailValue);
  if (!email) return Promise.reject(new Error("missing-email"));
  const cached = identityCache.get(email);
  if (cached) return cached;

  const created = (async () => {
    let stored: StoredIdentity | null = null;
    try {
      const raw = localStorage.getItem(`${IDENTITY_PREFIX}${email}`);
      if (raw) {
        const parsed = JSON.parse(raw) as StoredIdentity;
        if (parsed?.privateJwk && parsed?.publicJwk) stored = parsed;
      }
    } catch {
      stored = null;
    }

    if (!stored) {
      stored = await createIdentity();
      try {
        localStorage.setItem(`${IDENTITY_PREFIX}${email}`, JSON.stringify(stored));
      } catch {
        /* приватный ключ останется только в памяти этой сессии */
      }
    }

    try {
      return await importIdentity(stored);
    } catch {
      const fresh = await createIdentity();
      try {
        localStorage.setItem(`${IDENTITY_PREFIX}${email}`, JSON.stringify(fresh));
      } catch {
        /* noop */
      }
      return importIdentity(fresh);
    }
  })();

  identityCache.set(email, created);
  created.catch(() => identityCache.delete(email));
  return created;
}

/** Публичный ключ профиля в виде JWK-строки для сохранения в Supabase. */
export async function publicKeyFor(email: string): Promise<string | null> {
  try {
    const identity = await ensureIdentity(email);
    return JSON.stringify(identity.publicJwk);
  } catch {
    return null;
  }
}

async function fetchPeerKey(emailValue: string): Promise<JsonWebKey | null> {
  const email = normalizeEmail(emailValue);
  if (!email) return null;
  const cached = peerKeys.get(email);
  if (cached && Date.now() - cached.at < 5 * 60_000) {
    return cached.value ? (JSON.parse(cached.value) as JsonWebKey) : null;
  }

  try {
    const { data, error } = await supabase
      .from("zero_profiles")
      .select("public_key")
      .eq("email", email)
      .maybeSingle<{ public_key: string | null }>();
    if (error) throw error;
    const value = data?.public_key ?? null;
    peerKeys.set(email, { value, at: Date.now() });
    return value ? (JSON.parse(value) as JsonWebKey) : null;
  } catch {
    peerKeys.set(email, { value: null, at: Date.now() - 5 * 60_000 + 15_000 });
    return null;
  }
}

function fingerprint(jwk: JsonWebKey) {
  return `${jwk.kty}:${jwk.crv}:${jwk.x}:${jwk.y}`;
}

async function deriveConversationKey(meEmail: string, peerEmail: string): Promise<CryptoKey> {
  const me = await ensureIdentity(meEmail);
  const peer = await fetchPeerKey(peerEmail);
  if (!peer) throw new Error("missing-peer-key");

  const cacheKey = `${normalizeEmail(meEmail)}|${normalizeEmail(peerEmail)}|${fingerprint(peer)}`;
  const cached = conversationKeys.get(cacheKey);
  if (cached) return cached;

  const created = (async () => {
    const publicKey = await subtle().importKey(
      "jwk",
      peer,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      [],
    );
    const shared = await subtle().deriveBits(
      { name: "ECDH", public: publicKey },
      me.privateKey,
      256,
    );
    const hkdf = await subtle().importKey("raw", shared, "HKDF", false, ["deriveKey"]);
    return subtle().deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: bytes(encode(conversationKey(meEmail, peerEmail))),
        info: bytes(encode(E2EE_INFO)),
      },
      hkdf,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  })();

  conversationKeys.set(cacheKey, created);
  created.catch(() => conversationKeys.delete(cacheKey));
  return created;
}

export function isEncryptedPayload(value: unknown): value is EncryptedEnvelope {
  if (!value || typeof value !== "object") return false;
  const envelope = value as Partial<EncryptedEnvelope>;
  return envelope.__enc === PAYLOAD_MARK && typeof envelope.iv === "string" && typeof envelope.data === "string";
}

/** Шифрует payload сообщения ключом беседы. */
export async function encryptPayload(
  meEmail: string,
  peerEmail: string,
  payload: MessagePayload,
): Promise<EncryptedEnvelope> {
  const key = await deriveConversationKey(meEmail, peerEmail);
  const iv = randomBytes(12);
  const cipher = await subtle().encrypt(
    { name: "AES-GCM", iv: bytes(iv) },
    key,
    bytes(encode(JSON.stringify(payload))),
  );
  return {
    __enc: PAYLOAD_MARK,
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(cipher)),
  };
}

/** Расшифровывает payload. Старые незашифрованные сообщения читаются как есть. */
export async function decryptPayload(
  meEmail: string,
  peerEmail: string,
  payload: unknown,
): Promise<MessagePayload> {
  if (!isEncryptedPayload(payload)) return payload as MessagePayload;
  try {
    const key = await deriveConversationKey(meEmail, peerEmail);
    const plain = await subtle().decrypt(
      { name: "AES-GCM", iv: bytes(base64ToBytes(payload.iv)) },
      key,
      bytes(base64ToBytes(payload.data)),
    );
    return JSON.parse(new TextDecoder().decode(plain)) as MessagePayload;
  } catch {
    return { kind: "text", text: "Зашифрованное сообщение" };
  }
}

/** Шифрует вложение случайным AES-256-GCM ключом. Ключ едет внутри payload. */
export async function encryptBlob(blob: Blob): Promise<{ blob: Blob; enc: MediaEncryption }> {
  const raw = randomBytes(32);
  const iv = randomBytes(12);
  const key = await subtle().importKey("raw", bytes(raw), "AES-GCM", false, ["encrypt"]);
  const cipher = await subtle().encrypt(
    { name: "AES-GCM", iv: bytes(iv) },
    key,
    await blob.arrayBuffer(),
  );
  return {
    blob: new Blob([cipher], { type: "application/octet-stream" }),
    enc: {
      key: bytesToBase64(raw),
      iv: bytesToBase64(iv),
      mime: blob.type || "application/octet-stream",
      size: blob.size,
    },
  };
}

export async function decryptBlob(blob: Blob, enc: MediaEncryption): Promise<Blob> {
  const key = await subtle().importKey(
    "raw",
    bytes(base64ToBytes(enc.key)),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const plain = await subtle().decrypt(
    { name: "AES-GCM", iv: bytes(base64ToBytes(enc.iv)) },
    key,
    await blob.arrayBuffer(),
  );
  return new Blob([plain], { type: enc.mime || "application/octet-stream" });
}

/** Ссылка на расшифрованное вложение (object URL). Кэшируется по URL и ключу. */
export function decryptedMediaUrl(src: string, enc: MediaEncryption): Promise<string> {
  const cacheKey = `${src}|${enc.key}|${enc.iv}`;
  const cached = mediaUrls.get(cacheKey);
  if (cached) return cached;

  const created = (async () => {
    const response = await fetch(src, { cache: "no-store" });
    if (!response.ok) throw new Error(`media-${response.status}`);
    const plain = await decryptBlob(await response.blob(), enc);
    return URL.createObjectURL(plain);
  })();

  mediaUrls.set(cacheKey, created);
  created.catch(() => mediaUrls.delete(cacheKey));
  return created;
}

/* ── Резервная копия состояния ───────────────────────────────────── */

async function backupKey(email: string): Promise<CryptoKey> {
  const normalized = normalizeEmail(email);
  const storageKey = `${BACKUP_PREFIX}${normalized}`;
  let raw: Uint8Array;
  try {
    const stored = localStorage.getItem(storageKey);
    raw = stored ? base64ToBytes(stored) : randomBytes(32);
    if (!stored) localStorage.setItem(storageKey, bytesToBase64(raw));
  } catch {
    raw = randomBytes(32);
  }
  return subtle().importKey("raw", bytes(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export interface EncryptedState {
  __enc: typeof STATE_MARK;
  iv: string;
  data: string;
}

export async function encryptState(value: unknown, email: string): Promise<EncryptedState> {
  const key = await backupKey(email);
  const iv = randomBytes(12);
  const cipher = await subtle().encrypt(
    { name: "AES-GCM", iv: bytes(iv) },
    key,
    bytes(encode(JSON.stringify(value))),
  );
  return {
    __enc: STATE_MARK,
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(cipher)),
  };
}

export function isEncryptedState(value: unknown): value is EncryptedState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<EncryptedState>;
  return state.__enc === STATE_MARK && typeof state.iv === "string" && typeof state.data === "string";
}

export async function decryptState<T>(value: EncryptedState, email: string): Promise<T> {
  const key = await backupKey(email);
  const plain = await subtle().decrypt(
    { name: "AES-GCM", iv: bytes(base64ToBytes(value.iv)) },
    key,
    bytes(base64ToBytes(value.data)),
  );
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}
