/**
 * The development upload endpoint's credential. A presigned URL carries
 * its own authority; the local stand-in does the same by remembering the
 * ids it issued, for ten minutes, one use each. A PUT with an id nobody
 * issued is a stranger guessing, and is treated as such.
 */
const issued = new Map<string, number>();

/** The same ceiling the storage service puts on a file it reads back. */
export const LOCAL_UPLOAD_MAX_BYTES = 15 * 1024 * 1024;
const TTL_MS = 10 * 60_000;

export function issueLocalUpload(id: string): void {
  const now = Date.now();
  for (const [k, exp] of issued) if (exp < now) issued.delete(k);
  issued.set(id, now + TTL_MS);
}

/** True once, for an issued and unexpired id. */
export function consumeLocalUpload(id: string): boolean {
  const exp = issued.get(id);
  if (!exp || exp < Date.now()) { issued.delete(id); return false; }
  issued.delete(id);
  return true;
}
