/**
 * Proves the uploads bucket actually works, before a deploy finds out it doesn't.
 *
 * Uploads are the one feature that cannot be checked by looking at the app. The
 * server only discovers the bucket is wrong when somebody picks a photo, the
 * browser PUTs straight to Google without the server in the loop, and the
 * failure lands in that person's console rather than in any log here. So this
 * walks the whole path the way a real upload does — credentials, bucket, write,
 * sign, read back, metadata, CORS — and says which step broke.
 *
 * Run it against the production values before pointing the service at them:
 *
 *   PRIVATE_OBJECT_DIR=/my-bucket/uploads \
 *   GCS_SERVICE_ACCOUNT_KEY="$(cat key.json)" \
 *   npx tsx script/verify-object-storage.ts
 *
 * `--keep` leaves the test object behind for poking at; by default it is deleted,
 * which is also how delete permission gets checked.
 */
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

const keep = process.argv.includes("--keep");

/** The origin a browser will PUT from, which is what CORS has to allow. */
const appOrigin = (process.env.PUBLIC_URL || process.env.SERVER_BASE_URL || "").trim().replace(/\/$/, "");

type Status = "ok" | "warn" | "fail";
const results: { status: Status; title: string; detail: string }[] = [];
const say = (status: Status, title: string, detail: string) => {
  results.push({ status, title, detail });
  const mark = status === "ok" ? "✓" : status === "warn" ? "!" : "✗";
  console.log(`${mark} ${title}`);
  if (detail) for (const line of detail.split("\n")) console.log(`    ${line}`);
};

/** `/bucket/prefix` → its two halves, the way `parseObjectPath` does it. */
function splitDir(dir: string): { bucket: string; prefix: string } {
  const trimmed = dir.startsWith("/") ? dir.slice(1) : dir;
  const slash = trimmed.indexOf("/");
  if (slash === -1) return { bucket: trimmed, prefix: "" };
  return { bucket: trimmed.slice(0, slash), prefix: trimmed.slice(slash + 1) };
}

async function main(): Promise<number> {
  console.log("");

  // ── 1. Which credentials will be used, and is that what was intended? ──────
  const { storageCredentialMode, parseServiceAccountKey } = await import(
    "../server/replit_integrations/object_storage/objectStorage"
  );
  const mode = storageCredentialMode();

  if (mode === "replit-sidecar") {
    say("fail", "Credentials", "This is resolving to Replit's sidecar, which only exists inside Replit.\n"
      + "On Render, set GCS_SERVICE_ACCOUNT_KEY.");
    return 1;
  }
  if (mode === "default") {
    /*
     * The trap worth naming. Setting GOOGLE_CLOUD_PROJECT alone is enough to
     * select this mode, and on Render there are no application default
     * credentials to find — so the symptom is an auth error that says nothing
     * about the variable that caused it.
     */
    say("warn", "Credentials: application default", process.env.GCS_SERVICE_ACCOUNT_KEY
      ? "GCS_SERVICE_ACCOUNT_KEY is set but empty or blank."
      : "No GCS_SERVICE_ACCOUNT_KEY. This only works on Google's own infrastructure\n"
        + "or with GOOGLE_APPLICATION_CREDENTIALS pointing at a key file.\n"
        + "On Render you almost certainly want GCS_SERVICE_ACCOUNT_KEY instead.");
  } else {
    try {
      const key = parseServiceAccountKey(process.env.GCS_SERVICE_ACCOUNT_KEY!);
      say("ok", "Credentials: service account", `${key.client_email}\nproject ${key.project_id ?? "(not in key)"}`);
    } catch (err) {
      say("fail", "Credentials: service account", String(err instanceof Error ? err.message : err));
      return 1;
    }
  }

  // ── 2. Is there somewhere to write? ───────────────────────────────────────
  const dir = (process.env.PRIVATE_OBJECT_DIR || "").trim();
  if (!dir) {
    say("fail", "PRIVATE_OBJECT_DIR", "Not set. This is the variable the boot log and /admin/surfaces complain about.\n"
      + "Set it to /<bucket>/<prefix>, e.g. /my-app-uploads/uploads");
    return 1;
  }
  const { bucket: bucketName, prefix } = splitDir(dir);
  if (!dir.startsWith("/")) {
    say("warn", "PRIVATE_OBJECT_DIR", `"${dir}" has no leading slash. The parser tolerates it, but every\n`
      + "example and the error messages use /<bucket>/<prefix> — keep it consistent.");
  }
  if (!bucketName) {
    say("fail", "PRIVATE_OBJECT_DIR", `"${dir}" has no bucket name in it.`);
    return 1;
  }
  if (!prefix) {
    say("warn", "PRIVATE_OBJECT_DIR", `No prefix, so uploads land in the bucket root. Harmless, but a prefix\n`
      + "(e.g. /" + bucketName + "/uploads) keeps room for anything else in the bucket.");
  } else {
    say("ok", "PRIVATE_OBJECT_DIR", `bucket "${bucketName}", prefix "${prefix}"`);
  }

  // ── 3. Does the bucket exist, and can this account see it? ────────────────
  const { Storage } = await import("@google-cloud/storage");
  let storage: InstanceType<typeof Storage>;
  try {
    if (mode === "service-account") {
      const key = parseServiceAccountKey(process.env.GCS_SERVICE_ACCOUNT_KEY!);
      storage = new Storage({
        projectId: process.env.GOOGLE_CLOUD_PROJECT || key.project_id,
        credentials: { client_email: key.client_email, private_key: key.private_key },
      });
    } else {
      storage = new Storage({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
    }
  } catch (err) {
    say("fail", "Storage client", String(err instanceof Error ? err.message : err));
    return 1;
  }

  const bucket = storage.bucket(bucketName);
  /*
   * `bucket.exists()` is a *bucket* read, and `roles/storage.objectAdmin` does
   * not grant one — the app never makes one either, because every `.exists()`
   * and `.getMetadata()` it calls is on a file. So a correctly locked-down
   * account lands in the permission branch here while being perfectly able to
   * handle uploads, and failing on that would make this script stricter than the
   * thing it is checking. The write below is the authoritative test.
   */
  let bucketReadable = false;
  try {
    const [exists] = await bucket.exists();
    if (!exists) {
      say("fail", "Bucket", `"${bucketName}" does not exist, or this service account cannot see it.\n`
        + "Grant it roles/storage.objectAdmin on the bucket (not just on the project).");
      return 1;
    }
    bucketReadable = true;
    say("ok", "Bucket reachable", bucketName);
  } catch (err) {
    const message = String(err instanceof Error ? err.message : err);
    /*
     * The three ways this fails look nothing alike, and only one of them is
     * about the bucket. A mangled private key surfaces as an OpenSSL decoder
     * error, which is deeply unhelpful unless it is named — and a key pasted
     * into a dashboard form is the most likely thing in this whole setup to
     * arrive mangled, because its newlines usually do not survive the paste.
     */
    const why = /DECODER|unsupported|PEM|private key|asn1/i.test(message)
      ? "That is the private key failing to parse, not the bucket. The key's newlines\n"
        + "were probably lost when it was pasted. Paste the file base64-encoded instead:\n"
        + "  base64 -i key.json | tr -d '\\n'"
      : /permission|forbidden|403/i.test(message)
        ? "That reads as a permissions problem: the account authenticated but is not allowed here.\n"
          + "Grant it roles/storage.objectAdmin on the bucket."
        : /invalid_grant|unauthorized|401|invalid JWT/i.test(message)
          ? "The credentials were rejected. Check the key has not been deleted or disabled."
          : "Check the bucket name and the service account's project.";
    if (/permission|forbidden|403/i.test(message)) {
      say("warn", "Bucket read", "Cannot read the bucket itself, which the app never does either —\n"
        + "roles/storage.objectAdmin is object-level only. Carrying on to the write test,\n"
        + "which is what actually decides whether uploads work.");
    } else {
      say("fail", "Bucket", `${message}\n${why}`);
      return 1;
    }
  }

  // ── 4. The round trip an upload actually performs ─────────────────────────
  const objectName = `${prefix ? `${prefix}/` : ""}_verify-${randomUUID()}`;
  const file = bucket.file(objectName);
  const body = Buffer.from("object storage verification\n");

  try {
    await file.save(body, { contentType: "text/plain", resumable: false });
    say("ok", "Write", objectName);
  } catch (err) {
    say("fail", "Write", String(err instanceof Error ? err.message : err)
      + "\nThe account can see the bucket but not write to it. roles/storage.objectAdmin covers this.");
    return 1;
  }

  /*
   * Signing is checked separately from writing because it fails separately. V4
   * signing needs a private key; a workload identity has none and falls back to
   * the IAM signBlob API, which needs its own role. The server's upload route
   * does nothing but sign, so this failing means every upload fails while the
   * bucket itself looks perfect.
   */
  let signedUrl = "";
  try {
    const [url] = await file.getSignedUrl({ version: "v4", action: "read", expires: Date.now() + 60_000 });
    signedUrl = url;
    say("ok", "Signing (V4)", "the upload route can hand the browser a URL");
  } catch (err) {
    const message = String(err instanceof Error ? err.message : err);
    say("fail", "Signing (V4)", `${message}\n`
      + (/signBlob|iam/i.test(message)
        ? "Grant roles/iam.serviceAccountTokenCreator, or use a service-account key, which signs locally."
        : "Without this the server cannot issue upload or download URLs at all."));
  }

  if (signedUrl) {
    try {
      const res = await fetch(signedUrl);
      const text = await res.text();
      if (res.ok && text === body.toString()) say("ok", "Read back through a signed URL", `${res.status}`);
      else say("fail", "Read back through a signed URL", `${res.status}, ${text.slice(0, 120)}`);
    } catch (err) {
      say("fail", "Read back through a signed URL", String(err instanceof Error ? err.message : err));
    }
  }

  /* The ACL the app writes is object metadata, so metadata has to be writable. */
  try {
    await file.setMetadata({ metadata: { "custom:aclPolicy": JSON.stringify({ owner: "verify", visibility: "public" }) } });
    const [meta] = await file.getMetadata();
    if (meta.metadata?.["custom:aclPolicy"]) say("ok", "Object metadata", "the ACL policy the app stores can be written and read");
    else say("fail", "Object metadata", "setMetadata reported success but nothing came back.");
  } catch (err) {
    say("fail", "Object metadata", String(err instanceof Error ? err.message : err)
      + "\nThe app records who owns each upload here. Without it every object reads as having no policy.");
  }

  // ── 5. CORS, which is the one that breaks in the browser and nowhere else ──
  /*
   * The browser PUTs the file straight to storage.googleapis.com, so that PUT is
   * cross-origin and Google has to be told to allow it. Nothing on the server
   * can detect this: the server's job finished when it handed over the URL, the
   * preflight is refused by Google, and the only evidence is a CORS error in one
   * person's console. It is the single most likely reason a correctly configured
   * bucket still cannot be uploaded to.
   */
  try {
    const [meta] = await bucket.getMetadata();
    const cors = (meta.cors ?? []) as { origin?: string[]; method?: string[]; responseHeader?: string[]; maxAgeSeconds?: number }[];
    if (cors.length === 0) {
      say("fail", "Bucket CORS", "No CORS rules. The browser uploads directly to this bucket, so that\n"
        + "upload is cross-origin and Google will refuse the preflight. Uploads will\n"
        + "fail in the browser with nothing in the server log.\n"
        + "Fix: see docs/ops/object-storage.md, or run\n"
        + `  gcloud storage buckets update gs://${bucketName} --cors-file=cors.json`);
    } else {
      const origins = cors.flatMap((r) => r.origin ?? []);
      const methods = cors.flatMap((r) => (r.method ?? []).map((m) => m.toUpperCase()));
      const headers = cors.flatMap((r) => (r.responseHeader ?? []).map((h) => h.toLowerCase()));
      const allowsOrigin = appOrigin ? origins.includes("*") || origins.includes(appOrigin) : origins.length > 0;
      const allowsPut = methods.includes("*") || methods.includes("PUT");
      const allowsContentType = headers.includes("*") || headers.includes("content-type");

      const missing = [
        !allowsOrigin && (appOrigin ? `origin ${appOrigin} is not in [${origins.join(", ")}]` : "no origins listed"),
        !allowsPut && `PUT is not allowed (methods: ${methods.join(", ") || "none"})`,
        !allowsContentType && "Content-Type is not an allowed request header, and the uploader sends it",
      ].filter(Boolean) as string[];

      if (missing.length === 0) {
        say("ok", "Bucket CORS", `${origins.join(", ")} — PUT allowed${appOrigin ? "" : " (set PUBLIC_URL to check your real origin)"}`);
      } else {
        say("fail", "Bucket CORS", missing.join("\n") + "\nSee docs/ops/object-storage.md for the file to apply.");
      }
    }
  } catch (err) {
    /*
     * Reading bucket metadata needs a bucket-level permission that writing
     * objects does not, so an account scoped tightly to objects will land here.
     * That is not an upload failure, so it is a warning.
     */
    say("warn", "Bucket CORS", `Could not read the bucket's CORS rules: ${String(err instanceof Error ? err.message : err)}\n`
      + "That needs storage.buckets.get, which roles/storage.objectAdmin does not include.\n"
      + "Uploads can still work — but this is the check you least want skipped, because a\n"
      + "missing CORS rule fails only in the browser. Add roles/storage.legacyBucketReader\n"
      + "to run it, or confirm by hand:\n"
      + `  gcloud storage buckets describe gs://${bucketName} --format='value(cors_config)'`);
  }

  // ── 6. Tidy up, which also checks delete ─────────────────────────────────
  if (keep) {
    say("warn", "Test object", `left behind at ${objectName} (--keep)`);
  } else {
    try {
      await file.delete();
      say("ok", "Delete", "test object removed");
    } catch (err) {
      say("warn", "Delete", `Could not remove ${objectName}: ${String(err instanceof Error ? err.message : err)}\n`
        + "Uploads will work; cleanup and takedowns will not.");
    }
  }

  if (!bucketReadable) {
    console.log("");
    console.log("Note: bucket-level reads were not permitted, so the CORS check above could not");
    console.log("run from here. Everything the app itself needs was still exercised.");
  }

  const failed = results.filter((r) => r.status === "fail").length;
  const warned = results.filter((r) => r.status === "warn").length;
  console.log("");
  if (failed > 0) {
    console.log(`${failed} check(s) failed. Uploads will not work with these settings.\n`);
    return 1;
  }
  console.log(warned > 0 ? `All checks passed, with ${warned} warning(s).\n` : "Everything passed — uploads will work.\n");
  return 0;
}

const runDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (runDirectly) {
  main().then(
    (code) => process.exit(code),
    (err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); },
  );
}
