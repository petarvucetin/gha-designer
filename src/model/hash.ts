// FNV-1a, 32-bit, lowercase hex. Shared by the client (diskHash/baseline compares)
// and server/files.ts. Content-change fingerprint only — not a security hash.
export function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
