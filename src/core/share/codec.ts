/**
 * Compresses text into a URL-safe string (deflate-raw + base64url) and back.
 * Uses the standard Compression Streams API, available in modern browsers and
 * in Node.js 18+.
 */

export async function compressToBase64Url(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const compressed = await pipe(bytes, new CompressionStream('deflate-raw'));
  return bytesToBase64Url(compressed);
}

export async function decompressFromBase64Url(encoded: string): Promise<string> {
  const bytes = base64UrlToBytes(encoded);
  const decompressed = await pipe(bytes, new DecompressionStream('deflate-raw'));
  return new TextDecoder().decode(decompressed);
}

async function pipe(input: Uint8Array, transform: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const stream = new Blob([input as BlobPart]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(encoded: string): Uint8Array {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const HASH_PREFIX = '#json=';

/** Builds the `#json=...` fragment for a share link. */
export async function encodeShareHash(input: string): Promise<string> {
  return HASH_PREFIX + (await compressToBase64Url(input));
}

/** Extracts the input from a share-link fragment, or `null` if the hash is not a share link. */
export async function decodeShareHash(hash: string): Promise<string | null> {
  if (!hash.startsWith(HASH_PREFIX)) return null;
  try {
    return await decompressFromBase64Url(hash.slice(HASH_PREFIX.length));
  } catch {
    return null;
  }
}
