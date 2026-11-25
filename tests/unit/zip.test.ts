import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { zipUncompressedSize } from "@/server/domain/zip";

/** Minimal one-entry zip with a given (claimed) uncompressed size. */
function zipWith(name: string, data: Buffer, claimedSize = data.length): Buffer {
  const comp = deflateRawSync(data);
  const nameBuf = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(claimedSize, 22); local.writeUInt16LE(nameBuf.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(claimedSize, 24); central.writeUInt16LE(nameBuf.length, 28);
  const localPart = Buffer.concat([local, nameBuf, comp]);
  const centralPart = Buffer.concat([central, nameBuf]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralPart.length, 12); eocd.writeUInt32LE(localPart.length, 16);
  return Buffer.concat([localPart, centralPart, eocd]);
}

describe("zipUncompressedSize", () => {
  it("reads entries and total size of a real .xlsx", () => {
    const r = zipUncompressedSize(readFileSync("tests/fixtures/products.xlsx"));
    expect(r).not.toBeNull();
    expect(r!.entries).toBeGreaterThan(5);
    expect(r!.bytes).toBeGreaterThan(1000);
  });
  it("sees a highly compressible entry's true size before decompressing", () => {
    const bomb = zipWith("xl/sharedStrings.xml", Buffer.alloc(150 * 1024 * 1024, 0x41)); // 150 MB of "A"
    expect(bomb.length).toBeLessThan(1024 * 1024); // tiny on disk
    expect(zipUncompressedSize(bomb)!.bytes).toBe(150 * 1024 * 1024);
  });
  it("rejects ZIP64 markers and garbage", () => {
    expect(zipUncompressedSize(zipWith("a", Buffer.from("x"), 0xffffffff))).toBeNull();
    expect(zipUncompressedSize(Buffer.from("PK not really a zip"))).toBeNull();
  });
});
