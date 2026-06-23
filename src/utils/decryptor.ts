/**
 * AES-128 Decryptor utility using the browser's native Web Crypto API.
 */

// Cache of key URLs to raw key bytes and CryptoKeys
const keyCache = new Map<string, { rawBytes: Uint8Array; cryptoKey: CryptoKey }>();

/**
 * Fetches the AES-128 encryption key from the provided URL (using our CORS proxy if needed).
 */
export async function getDecryptionKey(
  keyUrl: string,
  useProxy: boolean,
  proxyUrlBase: string = "/api/proxy"
): Promise<CryptoKey> {
  const cacheKey = keyUrl;
  if (keyCache.has(cacheKey)) {
    return keyCache.get(cacheKey)!.cryptoKey;
  }

  // Resolve url via CORS proxy if option enabled
  const fetchUrl = useProxy
    ? `${proxyUrlBase}?url=${encodeURIComponent(keyUrl)}`
    : keyUrl;

  const response = await fetch(fetchUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch decryption key from ${keyUrl} (Status ${response.status})`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const rawBytes = new Uint8Array(arrayBuffer);

  if (rawBytes.length !== 16) {
    throw new Error(`Invalid Key Length. Expected 16 bytes, but got ${rawBytes.length} bytes.`);
  }

  // Import key into Web Crypto API for AES-CBC decryption
  if (typeof window === "undefined" || !window.crypto || !window.crypto.subtle) {
    throw new Error(
      "Web Crypto API (subtle) is not supported or is disabled in this browser context. Note that Web Crypto requires a secure context (HTTPS) or developer environment (localhost/127.0.0.1). Please open the app in a new tab or use a secure HTTPS link."
    );
  }

  const cryptoKey = await window.crypto.subtle.importKey(
    "raw",
    rawBytes,
    { name: "AES-CBC", length: 128 },
    false, // not extractable
    ["decrypt"]
  );

  keyCache.set(cacheKey, { rawBytes, cryptoKey });
  return cryptoKey;
}

/**
 * Decrypts a media segment (ArrayBuffer) using the given CryptoKey and IV.
 */
export async function decryptSegment(
  encryptedData: ArrayBuffer,
  cryptoKey: CryptoKey,
  iv: Uint8Array
): Promise<ArrayBuffer> {
  if (typeof window === "undefined" || !window.crypto || !window.crypto.subtle) {
    throw new Error(
      "Web Crypto API is not available on this browser/iframe context. Decryption of encrypted segments requires a secure context (HTTPS) or localhost."
    );
  }
  try {
    return await window.crypto.subtle.decrypt(
      {
        name: "AES-CBC",
        iv: iv,
      },
      cryptoKey,
      encryptedData
    );
  } catch (error) {
    console.error("AES Decryption failed:", error);
    throw new Error("Failed to decrypt segment. The key or initialization vector (IV) may be incorrect, or the segment stream is corrupted.");
  }
}

/**
 * Clears the internal keys cache to liberate memory.
 */
export function clearKeyCache(): void {
  keyCache.clear();
}
