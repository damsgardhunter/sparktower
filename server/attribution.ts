/**
 * Remembering where someone came from, from arrival until they sign up.
 *
 * The tagged link lands on the HTML page; the signup happens minutes later on a
 * different request that carries none of it. Something has to hold the answer
 * across that gap, and it has to survive a closed tab, because plenty of people
 * read for a while, leave, and come back to sign up.
 *
 * A cookie does that. Deliberately separate from the analytics stream even
 * though both are stamped on the same first request: the stream is best-effort
 * and swept after 90 days, while attribution is written onto the user row and
 * expected to still be true a year later.
 */
import type { Request, RequestHandler } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "./db";
import { users } from "@shared/schema";
import { readCookies, setCookie, isDocumentRequest, isSelfReferrer } from "./http-cookies";
import { parseAttribution, type Attribution } from "@shared/attribution";

const ATTR_COOKIE = "st_attr";
/**
 * Long enough to still be there when someone comes back to sign up.
 *
 * 90 days is the convention ad platforms settled on, and it's a reasonable
 * outer bound for "that link is why they're here" still being an honest claim.
 */
const ATTR_MAX_AGE_DAYS = 90;

const encode = (a: Attribution): string =>
  Buffer.from(JSON.stringify(a), "utf8").toString("base64url");

const decode = (raw: string): Attribution | null => {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    return parsed && typeof parsed.source === "string" ? (parsed as Attribution) : null;
  } catch {
    return null;
  }
};

/**
 * Stamps first-touch attribution on the visitor's first page.
 *
 * Never overwrites. If the cookie is already there, this visit is not the one
 * that brought them — someone who arrives from a newsletter, wanders off, then
 * comes back through a Google search is still the newsletter's, and rewriting
 * it on the second visit is how last-touch quietly replaces first-touch.
 */
export const captureAttribution: RequestHandler = (req: any, res, next) => {
  if (!isDocumentRequest(req)) return next();

  try {
    if (readCookies(req)[ATTR_COOKIE]) return next();

    const referer = typeof req.headers.referer === "string" ? req.headers.referer : undefined;
    const external = isSelfReferrer(referer, req.headers.host) ? null : referer!;
    const attribution = parseAttribution(req.originalUrl || req.path, external);

    setCookie(res, ATTR_COOKIE, encode(attribution), ATTR_MAX_AGE_DAYS * 24 * 60 * 60);
    req.attribution = attribution;
  } catch (err) {
    // Not knowing where someone came from must never cost them the page.
    console.error("[attribution] Capture failed:", err);
  }
  next();
};

/** What we know about this visitor's arrival, if anything. */
export function attributionFor(req: Request): Attribution | null {
  const fresh = (req as any).attribution as Attribution | undefined;
  if (fresh) return fresh;
  const raw = readCookies(req)[ATTR_COOKIE];
  return raw ? decode(raw) : null;
}

/**
 * Attribution a native client carried in for itself.
 *
 * Mobile has no cookie jar shared with the API, so the server can't stamp a
 * first-touch cookie on arrival the way it does on the web — there is no
 * arrival to stamp. The app holds the deep link or install referrer that opened
 * it and hands it over at registration instead.
 *
 * That makes this input rather than observation, so it goes through exactly the
 * same parser as the web path: only allowlisted parameters survive, each capped
 * in length. A determined caller can still claim to have come from a campaign
 * they didn't — worth knowing, and worth not caring about, since the blast
 * radius is one row in an internal number rather than anything anyone is paid
 * on.
 */
export function attributionFromBody(body: unknown): Attribution | null {
  const a = (body as any)?.attribution;
  if (!a || typeof a !== "object") return null;

  const landingUrl = typeof a.landingUrl === "string" ? a.landingUrl.slice(0, 500) : "";
  const referrer = typeof a.referrer === "string" ? a.referrer.slice(0, 500) : null;
  if (!landingUrl && !referrer) return null;

  return parseAttribution(landingUrl || "/", referrer);
}

/**
 * Writes attribution onto a newly created account.
 *
 * Guarded on `signup_source IS NULL`, so it can only ever fill a blank. Called
 * from the account-creation paths rather than from sign-in: stamping on sign-in
 * would backfill every existing account with whatever link they happened to use
 * next, which is worse than leaving them honestly unknown.
 */
export async function stampSignupAttribution(userId: string, req: Request): Promise<void> {
  try {
    /*
     * Cookie first, body second. On the web the cookie is always there, having
     * been stamped on the document request; the body fallback is what the
     * native apps use, since they have no cookie to read. One function covers
     * both, so a fifth signup route can't be added that silently records
     * nothing.
     */
    const a = attributionFor(req) ?? attributionFromBody(req.body);
    if (!a || !userId) return;

    await db.update(users).set({
      signupSource: a.source,
      signupMedium: a.medium,
      signupCampaign: a.campaign,
      signupReferrer: a.referrer,
      signupLandingPath: a.landingPath,
      signupParams: a.params,
    }).where(and(eq(users.id, userId), isNull(users.signupSource)));
  } catch (err) {
    console.error("[attribution] Failed to stamp signup:", err);
  }
}
