/**
 * Where a signed-out visitor was trying to go, held across sign-in.
 *
 * Two screens in the app are reachable without an account — an invite
 * (app/invite/[token].tsx) and a published artifact (app/a/[id].tsx) — and both
 * of them exist to turn a reader into a member. Both end in a button that needs
 * an account, and until this module existed both lost the thread: the invite
 * screen wrote the token to the device and promised "we'll bring you back
 * here", and nothing ever read it back, so an invited person signed up, landed
 * on the feed, and never joined the project that invited them. The artifact
 * page didn't even write anything down — its two CTAs pushed at /project/:id
 * and /project/new, AuthGate bounced them to sign-in, and the goal they had
 * picked was gone.
 *
 * So: the screen that sends someone to sign in writes down where they were
 * going, and the two places a person arrives after signing in — the entry
 * point (app/index.tsx) and the end of onboarding (app/welcome.tsx) — take it
 * and go there instead of the feed. Taking it clears it, because a destination
 * that survives its own arrival would hijack every launch afterwards.
 *
 * The pure half lives here, apart from the screens, so the rules about what
 * counts as a safe destination can be tested.
 */
import { readPref, writePref } from "./api/client";

/** The same key the web uses (shared/invites.ts); mobile can't import from @shared. */
export const PENDING_INVITE_KEY = "st_pending_invite";

/** Any other in-app route a signed-out screen sent someone away from. */
export const PENDING_RETURN_KEY = "st_pending_return";

/**
 * Invite tokens are opaque ids from the server. Anything with a slash, a space
 * or a scheme in it isn't one, and would be pasted straight into a route —
 * so it's refused rather than navigated to.
 */
const TOKEN_RE = /^[A-Za-z0-9_-]{8,128}$/;

export const isInviteToken = (token: unknown): token is string =>
  typeof token === "string" && TOKEN_RE.test(token);

/**
 * A stored return path is only ever a route inside this app.
 *
 * `//host` and `https://host` are the two shapes that would turn a router push
 * into an open redirect if one ever reached a browser build, and a path
 * without a leading slash isn't a route at all. The length cap is there so a
 * corrupted preference can't become a megabyte-long navigation.
 */
export function isSafeReturnPath(path: unknown): path is string {
  if (typeof path !== "string") return false;
  if (path.length < 2 || path.length > 512) return false;
  if (!path.startsWith("/") || path.startsWith("//")) return false;
  return !/^\/[^/?#]*:/.test(path);
}

/**
 * The route to open, given what the device had stored. The invite wins: it is
 * someone waiting on the other end, and it is the only one of the two that
 * fails permanently if it's missed.
 */
export function destinationFor(invite: unknown, returnTo: unknown): string | null {
  if (isInviteToken(invite)) return `/invite/${invite}`;
  if (isSafeReturnPath(returnTo)) return returnTo;
  return null;
}

/** Remember an in-app route to come back to after signing in. */
export async function rememberReturnPath(path: string): Promise<void> {
  if (!isSafeReturnPath(path)) return;
  await writePref(PENDING_RETURN_KEY, path).catch(() => {});
}

/**
 * The destination, once. Both keys are cleared whether or not either was
 * usable — a token this build refuses is a token that would be refused on
 * every launch from now on.
 */
export async function takePendingDestination(): Promise<string | null> {
  try {
    const [invite, returnTo] = await Promise.all([
      readPref(PENDING_INVITE_KEY).catch(() => null),
      readPref(PENDING_RETURN_KEY).catch(() => null),
    ]);
    if (invite == null && returnTo == null) return null;
    await Promise.all([
      writePref(PENDING_INVITE_KEY, null).catch(() => {}),
      writePref(PENDING_RETURN_KEY, null).catch(() => {}),
    ]);
    return destinationFor(invite, returnTo);
  } catch {
    // Storage is a convenience here; never let it stop the app opening.
    return null;
  }
}
