// Reads a zip central directory without decompressing anything (zip-bomb guard for uploads).

/**
 * Sum the uncompressed sizes listed in the zip central directory. Returns null when the file is
 * not a readable zip, or uses ZIP64 (sizes 0xFFFFFFFF), which a real .xlsx of our size never needs.
 */
export function zipUncompressedSize(buf: Buffer): { entries: number; bytes: number } | null {
  const minEocd = 22;
  if (buf.length < minEocd) return null;
  // End of central directory record: signature 0x06054b50, searched from the end (comment ≤ 65535).
  let eocd = -1;
  for (let i = buf.length - minEocd; i >= Math.max(0, buf.length - minEocd - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const entries = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (entries === 0xffff || cdOffset === 0xffffffff || cdOffset + cdSize > buf.length) return null;
  let p = cdOffset;
  let bytes = 0;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) return null;
    const uncompressed = buf.readUInt32LE(p + 24);
    if (uncompressed === 0xffffffff) return null;
    bytes += uncompressed;
    p += 46 + buf.readUInt16LE(p + 28) + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return { entries, bytes };
}
