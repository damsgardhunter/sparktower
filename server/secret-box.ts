/**
 * Sealing a secret at rest. AES-256-GCM under a key derived from
 * SESSION_SECRET, so a database dump alone does not yield the builder's
 * connection strings. Rotating SESSION_SECRET invalidates sealed values,
 * which is the right failure: the builder re-enters it.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

let key: Buffer | null = null;
function derive(): Buffer {
  if (key) return key;
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required to seal secrets");
  key = scryptSync(secret, "sparktower:secret-box:v1", 32);
  return key;
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derive(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${body.toString("base64url")}`;
}

export function open(sealed: string): string | null {
  try {
    const [v, iv, tag, body] = sealed.split(".");
    if (v !== "v1") return null;
    const d = createDecipheriv("aes-256-gcm", derive(), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(body, "base64url")), d.final()]).toString("utf8");
  } catch { return null; }
}
