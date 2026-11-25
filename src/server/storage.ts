import "server-only";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { isSafeStorageKey } from "@/server/domain/files";

// Private file store for logos, signatures and the PDFs sent to customers.
// Development: a folder outside public/ (STORAGE_DIR, default ./storage, git-ignored).
// Production must point STORAGE_DIR at a persistent disk — or use object storage (R2), added in M8.
// Files are only ever served through routes that check the signed-in user.
// The turbopackIgnore comments keep runtime data out of the build's file tracing.

function root(): string {
  const dir = process.env.STORAGE_DIR;
  if (!dir && process.env.NODE_ENV === "production") {
    throw new Error("STORAGE_DIR is not set: production needs persistent file storage");
  }
  // relative paths resolve against the working directory (the project root in development)
  return path.resolve(/*turbopackIgnore: true*/ (dir || "storage"));
}

function fullPath(key: string): string {
  if (!isSafeStorageKey(key)) throw new Error(`Unsafe storage key: ${key}`);
  const base = root();
  const p = path.resolve(/*turbopackIgnore: true*/ base, key);
  if (!p.startsWith(base + path.sep)) throw new Error(`Storage key escapes the store: ${key}`);
  return p;
}

/** A new, unguessable key: newKey("logos", companyId, "png") → logos/<id>-<random>.png */
export function newKey(folder: "logos" | "signatures" | "quotations" | "po" | "outbox", owner: string, ext: "png" | "jpg" | "pdf" | "json"): string {
  const safeOwner = owner.replace(/[^A-Za-z0-9_-]/g, "");
  return `${folder}/${safeOwner}-${randomBytes(9).toString("base64url")}.${ext}`;
}

export async function putObject(key: string, data: Uint8Array): Promise<void> {
  const p = fullPath(key);
  await mkdir(/*turbopackIgnore: true*/ path.dirname(p), { recursive: true });
  await writeFile(/*turbopackIgnore: true*/ p, data, { flag: "wx" }); // keys are unique: never overwrite
}

export async function getObject(key: string): Promise<Buffer | null> {
  try {
    return await readFile(/*turbopackIgnore: true*/ fullPath(key));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

/** Best effort: a missing file is fine. */
export async function deleteObject(key: string | null | undefined): Promise<void> {
  if (!key) return;
  try {
    await rm(/*turbopackIgnore: true*/ fullPath(key), { force: true });
  } catch {
    // an unsafe or already-removed key: nothing to delete
  }
}
