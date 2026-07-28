const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) =>
    character.charCodeAt(0),
  );
}

function asArrayBuffer(bytes: Uint8Array) {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function importEncryptionKey(encodedKey: string) {
  let keyBytes: Uint8Array;

  try {
    keyBytes = base64ToBytes(encodedKey.trim());
  } catch {
    throw new Error(
      "The LinkedIn token encryption key is not valid base64.",
    );
  }

  if (keyBytes.byteLength !== 32) {
    throw new Error(
      "The LinkedIn token encryption key must contain exactly 32 bytes.",
    );
  }

  return crypto.subtle.importKey(
    "raw",
    asArrayBuffer(keyBytes),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptLinkedInToken(
  token: string,
  encodedKey: string,
) {
  const key = await importEncryptionKey(encodedKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(token),
  );

  return {
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    iv: bytesToBase64(iv),
  };
}

export async function decryptLinkedInToken(
  ciphertext: string,
  encodedIv: string,
  encodedKey: string,
) {
  const key = await importEncryptionKey(encodedKey);

  try {
    const decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: asArrayBuffer(base64ToBytes(encodedIv)),
      },
      key,
      asArrayBuffer(base64ToBytes(ciphertext)),
    );

    return decoder.decode(decrypted);
  } catch {
    throw new Error(
      "The LinkedIn connection credentials could not be decrypted.",
    );
  }
}

export function createOAuthState() {
  return bytesToBase64(
    crypto.getRandomValues(new Uint8Array(32)),
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export async function hashOAuthState(state: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(state),
  );

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
