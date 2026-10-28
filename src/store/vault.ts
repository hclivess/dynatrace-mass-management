/**
 * Where environments and their tokens live.
 *
 * Nothing leaves the browser. By default the list is kept in sessionStorage and is gone when the
 * tab closes. "Remember on this device" stores it in localStorage encrypted with AES-256-GCM under
 * a key derived from a passphrase (PBKDF2-SHA-256, 600,000 iterations, random salt); the
 * passphrase itself is never stored.
 */

export interface Environment {
  id: string;
  name: string;
  /** What the user entered; the API root is derived from it on every load. */
  url: string;
  token: string;
}

export interface SealedVault {
  format: "dmm-vault";
  version: 1;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string };
  cipher: { name: "AES-GCM"; iv: string };
  data: string;
}

const SESSION_KEY = "dmm.session";
const SAVED_KEY = "dmm.vault";
const ITERATIONS = 600_000;

export function newId(): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// Encryption
// ---------------------------------------------------------------------------

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function seal(environments: Environment[], passphrase: string, iterations = ITERATIONS): Promise<SealedVault> {
  if (passphrase.length < 8) throw new Error("Use a passphrase of at least 8 characters.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, iterations);
  const plain = new TextEncoder().encode(JSON.stringify(environments));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
  return {
    format: "dmm-vault",
    version: 1,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations, salt: toBase64(salt) },
    cipher: { name: "AES-GCM", iv: toBase64(iv) },
    data: toBase64(data),
  };
}

export async function unseal(vault: SealedVault, passphrase: string): Promise<Environment[]> {
  if (vault.format !== "dmm-vault" || vault.version !== 1) throw new Error("This is not a DMM vault file.");
  const key = await deriveKey(passphrase, fromBase64(vault.kdf.salt), vault.kdf.iterations);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(vault.cipher.iv) }, key, fromBase64(vault.data));
  } catch {
    throw new Error("Wrong passphrase.");
  }
  return validate(JSON.parse(new TextDecoder().decode(plain)));
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export function loadSession(): Environment[] | null {
  const raw = safeGet(sessionStorage, SESSION_KEY);
  if (!raw) return null;
  try {
    return validate(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveSession(environments: Environment[]): void {
  safeSet(sessionStorage, SESSION_KEY, JSON.stringify(environments));
}

export function loadSaved(): SealedVault | null {
  const raw = safeGet(localStorage, SAVED_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SealedVault;
  } catch {
    return null;
  }
}

export function storeSaved(vault: SealedVault | null): void {
  if (vault) safeSet(localStorage, SAVED_KEY, JSON.stringify(vault));
  else safeRemove(localStorage, SAVED_KEY);
}

export function forgetEverything(): void {
  safeRemove(sessionStorage, SESSION_KEY);
  safeRemove(localStorage, SAVED_KEY);
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/**
 * Accepts a sealed vault (needs the passphrase), a plain list exported by this app, or the
 * secrets.json of DMM 1.x ({ environments: [{ name, account, secret }] }), which is converted once.
 */
export async function importFile(text: string, passphrase?: () => Promise<string | null>): Promise<Environment[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The file is not JSON.");
  }
  if (isRecord(parsed) && parsed.format === "dmm-vault") {
    const secret = await passphrase?.();
    if (!secret) throw new Error("A passphrase is needed to open this vault.");
    return unseal(parsed as unknown as SealedVault, secret);
  }
  if (isRecord(parsed) && Array.isArray(parsed.environments)) {
    return parsed.environments.map((env, i) => {
      if (!isRecord(env) || typeof env.account !== "string" || typeof env.secret !== "string") {
        throw new Error(`environments[${i}] needs "account" and "secret".`);
      }
      return { id: newId(), name: String(env.name ?? env.account), url: env.account, token: env.secret };
    });
  }
  return validate(parsed).map((env) => ({ ...env, id: newId() }));
}

function validate(value: unknown): Environment[] {
  if (!Array.isArray(value)) throw new Error("Expected a list of environments.");
  return value.map((env, i) => {
    if (!isRecord(env)) throw new Error(`Entry ${i + 1} is not an environment.`);
    const { id, name, url, token } = env;
    if (typeof name !== "string" || typeof url !== "string" || typeof token !== "string") {
      throw new Error(`Entry ${i + 1} needs "name", "url" and "token".`);
    }
    return { id: typeof id === "string" && id ? id : newId(), name, url, token };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Storage can be unavailable (private windows, blocked site data); the app still works for the session.
function safeGet(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    /* storage blocked: keep working in memory */
  }
}

function safeRemove(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    /* nothing to remove */
  }
}
