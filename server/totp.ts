/**
 * Time-based one-time passwords (RFC 6238), the codes an authenticator app
 * shows: HMAC-SHA1 over the 30-second time step, truncated to 6 digits.
 * Written out rather than pulled in as a dependency — it's forty lines, and
 * it's checked against the RFC's own test vectors (test/unit/totp.test.ts).
 */
import { createHmac, randomBytes, timingSafeEqual } from "crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Steps either side of now a code may come from: clock drift and typing time, not more. */
export const TOTP_WINDOW = 1;

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error("not base32");
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** A new secret: 20 random bytes (160 bits, the RFC's recommendation), base32 for authenticator apps. */
export const newTotpSecret = () => base32Encode(randomBytes(20));

export const timeStep = (at = Date.now()) => Math.floor(at / 1000 / TOTP_PERIOD_SECONDS);

/** The code for a time step. `digits` is only ever not 6 in the RFC test vectors. */
export function totpAt(secret: string | Buffer, step: number, digits = TOTP_DIGITS): string {
  const key = Buffer.isBuffer(secret) ? secret : base32Decode(secret);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac("sha1", key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/**
 * Checks a code against now ± the window, in constant time per candidate.
 * Returns the step it matched — so the caller can refuse that step (and any
 * earlier one) next time: a code works once — or null.
 */
export function verifyTotp(secret: string, code: string, opts: { at?: number; lastUsedStep?: number | null } = {}): number | null {
  const given = String(code ?? "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(given)) return null;
  const now = timeStep(opts.at);
  for (let offset = -TOTP_WINDOW; offset <= TOTP_WINDOW; offset++) {
    const step = now + offset;
    if (opts.lastUsedStep != null && step <= opts.lastUsedStep) continue;
    const expected = totpAt(secret, step);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(given))) return step;
  }
  return null;
}

/** The link an authenticator app reads (and a QR code encodes). */
export function otpauthUrl(secret: string, account: string, issuer = "SparkTower"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD_SECONDS}`;
}
