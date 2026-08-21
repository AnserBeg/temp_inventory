const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64Url(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const decoded = atob(padded);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

export function constantTimeEqual(left: string, right: string) {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index % Math.max(leftBytes.length, 1)] ?? 0) ^ (rightBytes[index % Math.max(rightBytes.length, 1)] ?? 0);
  }
  return difference === 0;
}

export function randomUrlSafeString(byteLength = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return bytesToBase64Url(bytes);
}

export async function sha256Hex(value: string | Uint8Array) {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hmacSha256Base64(secret: string, value: Uint8Array) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, Uint8Array.from(value).buffer));
  let binary = "";
  for (const byte of signature) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function encryptionKey(secret: string) {
  if (secret.trim().length < 32) throw new Error("QBO_TOKEN_ENCRYPTION_KEY must be at least 32 characters.");
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptQboSecret(value: string, secret: string, associatedData: string) {
  const key = await encryptionKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(associatedData), tagLength: 128 },
    key,
    encoder.encode(value),
  ));
  return `v1.${bytesToBase64Url(iv)}.${bytesToBase64Url(encrypted)}`;
}

export async function decryptQboSecret(value: string, secret: string, associatedData: string) {
  const [version, ivValue, encryptedValue] = value.split(".");
  if (version !== "v1" || !ivValue || !encryptedValue) throw new Error("The stored QBO token has an unsupported format.");
  const key = await encryptionKey(secret);
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64UrlToBytes(ivValue), additionalData: encoder.encode(associatedData), tagLength: 128 },
      key,
      base64UrlToBytes(encryptedValue),
    );
    return decoder.decode(decrypted);
  } catch {
    throw new Error("The stored QBO token could not be decrypted. Check QBO_TOKEN_ENCRYPTION_KEY.");
  }
}
