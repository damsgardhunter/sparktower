/**
 * Moves what the local-disk fallback holds into the bucket.
 *
 * The gap the object-storage runbook names and does not cover: anything
 * uploaded while the app was falling back to local disk lives in
 * `local_objects/` on whichever machine wrote it, and is invisible to a
 * deployment reading from a bucket. Every row pointing at it resolves to
 * nothing — a logo, a cover, an avatar, a generated image, all 404.
 *
 * ## The two things that make this more than a file copy
 *
 * **The access policy travels in metadata, not in the file.** On disk it is a
 * `<name>.meta.json` sidecar; in the bucket it is custom metadata on the
 * object. `canAccessObject` returns false for an object carrying no policy, so
 * copying bytes alone would upload every file and then refuse to serve the
 * private ones. The sidecar is written as the object's metadata here, which is
 * the same shape `setObjectAclPolicy` writes.
 *
 * **The prefix is applied on top of the entity path.** `/objects/uploads/<id>`
 * resolves to `PRIVATE_OBJECT_DIR` + `/uploads/<id>` — so with a dir of
 * `/bucket/uploads` the object is `uploads/uploads/<id>`, not `uploads/<id>`.
 * That doubling looks like a mistake and is what both the read and the write
 * paths do, so a migration that "fixes" it puts every file where nothing will
 * look for it.
 *
 * Content type is taken from the sidecar when it has one and sniffed from the
 * first bytes otherwise, because a file stored as application/octet-stream is
 * offered as a download rather than drawn in a page.
 *
 * Idempotent: an object already in the bucket is left alone, so a run that
 * fails halfway can simply be run again.
 *
 *   PRIVATE_OBJECT_DIR=/bucket/uploads GCS_SERVICE_ACCOUNT_KEY=… \
 *     npx tsx script/upload-local-objects.ts [--apply]
 *
 * Reports by default; `--apply` uploads.
 */
import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Storage } from "@google-cloud/storage";

const LOCAL_ROOT = process.env.LOCAL_OBJECT_ROOT || path.join(process.cwd(), "local_objects");

/** What the first bytes say it is. A wrong type is a download prompt instead of a picture. */
function sniff(head: Buffer): string | null {
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head.length >= 6 && head.subarray(0, 6).toString("latin1").startsWith("GIF8")) return "image/gif";
  if (head.length >= 12 && head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (head.length >= 5 && head.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  const text = head.subarray(0, 200).toString("utf8").trimStart();
  if (text.startsWith("<svg") || (text.startsWith("<?xml") && text.includes("<svg"))) return "image/svg+xml";
  return null;
}

async function walk(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, base)));
    else if (!entry.name.endsWith(".meta.json")) out.push(path.relative(base, full));
  }
  return out;
}

/** The bucket and the prefix, from the same variable the server reads. */
function target(): { bucket: string; prefix: string } {
  const dir = (process.env.PRIVATE_OBJECT_DIR || "").trim();
  if (!dir) throw new Error("PRIVATE_OBJECT_DIR is not set, so there is no bucket to upload to.");
  const parts = dir.replace(/^\/+/, "").split("/").filter(Boolean);
  if (!parts.length) throw new Error(`PRIVATE_OBJECT_DIR ${JSON.stringify(dir)} names no bucket.`);
  return { bucket: parts[0], prefix: parts.slice(1).join("/") };
}

export async function uploadLocalObjects(apply: boolean): Promise<number> {
  const { bucket: bucketName, prefix } = target();
  const key = process.env.GCS_SERVICE_ACCOUNT_KEY?.trim();
  if (!key) throw new Error("GCS_SERVICE_ACCOUNT_KEY is not set.");
  const parsed = JSON.parse(key.startsWith("{") ? key : Buffer.from(key, "base64").toString("utf8"));
  if (typeof parsed.private_key === "string") parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  const storage = new Storage({
    projectId: parsed.project_id,
    credentials: { client_email: parsed.client_email, private_key: parsed.private_key },
  });
  const bucket = storage.bucket(bucketName);

  const files = await walk(LOCAL_ROOT);
  if (!files.length) {
    console.log(`Nothing in ${LOCAL_ROOT}.`);
    return 0;
  }
  console.log(`${files.length} object(s) in ${LOCAL_ROOT} → gs://${bucketName}/${prefix}/…\n`);

  let uploaded = 0, skipped = 0, withPolicy = 0, bytes = 0;
  const types = new Map<string, number>();

  for (const rel of files) {
    const local = path.join(LOCAL_ROOT, rel);
    /* Windows separators would make an object name with a backslash in it. */
    const objectName = [prefix, rel.split(path.sep).join("/")].filter(Boolean).join("/");
    const file = bucket.file(objectName);

    if (apply) {
      const [exists] = await file.exists();
      if (exists) { skipped += 1; continue; }
    }

    const handle = await readFile(local).catch(() => null);
    if (!handle) { console.log(`  ! unreadable: ${rel}`); continue; }

    /* The sidecar is already the metadata map the bucket wants. */
    let metadata: Record<string, string> = {};
    const sidecar = await readFile(`${local}.meta.json`, "utf8").catch(() => null);
    if (sidecar) {
      try { metadata = JSON.parse(sidecar); } catch { console.log(`  ! unreadable sidecar: ${rel}`); }
    }
    const contentType = String(metadata.contentType || sniff(handle.subarray(0, 256)) || "application/octet-stream");
    delete metadata.contentType;
    if (metadata["custom:aclPolicy"]) withPolicy += 1;

    types.set(contentType, (types.get(contentType) ?? 0) + 1);
    bytes += handle.length;
    uploaded += 1;

    if (!apply) continue;
    await file.save(handle, { contentType, resumable: false, metadata: { metadata } });
  }

  console.log(`${apply ? "Uploaded" : "Would upload"} ${uploaded}, ${skipped} already there.`);
  console.log(`${withPolicy} carry an access policy; the rest have none, which this server serves publicly.`);
  console.log(`${(bytes / 1024 / 1024).toFixed(1)} MB. Types: ${[...types].map(([t, n]) => `${n} ${t}`).join(", ")}`);
  if (!apply) console.log("\nReport only. Pass --apply to upload.");
  return 0;
}

async function main(): Promise<number> {
  return uploadLocalObjects(process.argv.includes("--apply"));
}

/* Only as a command, never on import — see the note in script/reputation-gap.ts. */
const runDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (runDirectly) {
  main().then((code) => process.exit(code), (err) => { console.error(err); process.exit(1); });
}
