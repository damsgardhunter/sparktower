/**
 * Sealing a secret at rest. AES-256-GCM under a key derived from
 * SESSION_SECRET, so a database dump alone does not yield the builder's
 * connection strings. Rotating SESSION_SECRET invalidates sealed values,
 * which is the right failure: the builder re-enters it.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { sessionSecret } from "./secrets";

let key: Buffer | null = null;
function derive(): Buffer {
  if (key) return key;
  key = scryptSync(sessionSecret(), "sparktower:secret-box:v1", 32);
  return key;
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derive(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${body.toString("base64url")}`;
}

/**
 * Base64 that means exactly one thing.
 *
 * `Buffer.from(x, "base64url")` is forgiving: characters that don't complete a
 * byte are dropped, so several spellings decode to the same bytes and one
 * sealed value has many valid-looking forms. GCM still authenticates the bytes,
 * so this is not a way in — but it made "tamper with the end of the string and
 * it must not open" true only most of the time, which is how the unit test for
 * exactly that came back green on a laptop and red on CI about once a run.
 *
 * Decoding and re-encoding is the whole check: if the input wasn't the
 * canonical spelling of those bytes, it isn't this sealed value.
 */
function decodeExact(part: string): Buffer | null {
  const bytes = Buffer.from(part, "base64url");
  return bytes.toString("base64url") === part ? bytes : null;
}

export function open(sealed: string): string | null {
  try {
    const [v, iv, tag, body] = sealed.split(".");
    if (v !== "v1") return null;
    const parts = [iv, tag, body].map((p) => (typeof p === "string" ? decodeExact(p) : null));
    if (parts.some((b) => b === null)) return null;
    const [ivBytes, tagBytes, bodyBytes] = parts as Buffer[];
    const d = createDecipheriv("aes-256-gcm", derive(), ivBytes);
    d.setAuthTag(tagBytes);
    return Buffer.concat([d.update(bodyBytes), d.final()]).toString("utf8");
  } catch { return null; }
}
