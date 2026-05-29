/**
 * NexaLink Client-Side End-to-End Encryption (E2EE) Utility
 * Uses browser SubtleCrypto (AES-GCM-256 + PBKDF2)
 */

const encodeBase64 = (buffer: ArrayBuffer): string => {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
};

const decodeBase64 = (base64: string): ArrayBuffer => {
  const binary = window.atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
};

/**
 * Derives an AES-GCM 256-bit key from a passphrase and a salt (e.g., room name or contact key).
 */
export async function deriveKeyFromPassphrase(passphrase: string, saltText: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );
  // Ensure the salt is consistent (lowercase)
  const salt = enc.encode(saltText.toLowerCase().trim());
  return await window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts cleartext using an derived CryptoKey.
 * Returns formatted ciphertext string: [E2EE]:iv_base64:ciphertext_base64
 */
export async function encryptText(text: string, key: CryptoKey): Promise<string> {
  const enc = new TextEncoder();
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(text)
  );
  return `[E2EE]:${encodeBase64(iv.buffer)}:${encodeBase64(ciphertext)}`;
}

/**
 * Decrypts a formatted [E2EE]:iv:ciphertext string using a derived CryptoKey.
 */
export async function decryptText(encryptedStr: string, key: CryptoKey): Promise<string> {
  if (!encryptedStr.startsWith('[E2EE]:')) {
    throw new Error('Not encrypted with NexaLink E2EE protocol');
  }
  const parts = encryptedStr.split(':');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted message payload');
  }
  const iv = new Uint8Array(decodeBase64(parts[1]));
  const ciphertext = decodeBase64(parts[2]);
  const decrypted = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );
  const dec = new TextDecoder();
  return dec.decode(decrypted);
}

/**
 * Encrypts an ArrayBuffer chunk using the derived CryptoKey and a random 12-byte IV.
 * Returns a combined ArrayBuffer: [12-byte IV] + [encrypted ciphertext].
 */
export async function encryptChunk(chunk: ArrayBuffer, key: CryptoKey): Promise<ArrayBuffer> {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    chunk
  );
  const packet = new Uint8Array(12 + ciphertext.byteLength);
  packet.set(iv, 0);
  packet.set(new Uint8Array(ciphertext), 12);
  return packet.buffer;
}

/**
 * Decrypts a combined ArrayBuffer packet containing a 12-byte IV followed by AES-GCM ciphertext.
 */
export async function decryptChunk(packetBuffer: ArrayBuffer, key: CryptoKey): Promise<ArrayBuffer> {
  const packet = new Uint8Array(packetBuffer);
  if (packet.length < 12 + 16) {
    throw new Error('Encrypted packet is too short');
  }
  const iv = packet.subarray(0, 12);
  const ciphertext = packet.subarray(12);
  return await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );
}

