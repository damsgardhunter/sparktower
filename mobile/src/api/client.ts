/**
 * API client for the mobile app.
 *
 * Talks to the same Express backend as the web app, but authenticates with a
 * Bearer access token instead of a cookie session (see server/mobile-auth.ts).
 * Handles transparent refresh: when a request comes back 401, it exchanges the
 * refresh token once and replays the request.
 */
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { pendingAttribution, clearAttribution } from "./attribution";

const ACCESS_KEY = "sparktower.accessToken";
const REFRESH_KEY = "sparktower.refreshToken";

/**
 * The host a shipped build talks to. Also `expo.extra.apiUrl` in app.json and
 * `EXPO_PUBLIC_API_URL` in every eas.json build profile — three places that
 * must agree, and the constant below is the one that wins if they ever don't.
 */
export const PRODUCTION_API_URL = "https://sparktower.app";

const isLoopback = (url: string) => url.includes("localhost") || url.includes("127.0.0.1");

/**
 * Base URL resolution.
 *
 * `localhost` means the device itself, not your Mac — so a phone or the
 * Android emulator can't reach a dev server that way. Android's emulator
 * maps the host to 10.0.2.2; a physical device needs your LAN IP, which
 * Expo exposes as the dev-server host.
 *
 * The loopback rewrite applies to `EXPO_PUBLIC_API_URL` as well as to
 * app.json's value: an env var set to `http://localhost:5001` is the same
 * unreachable address, and silently skipping the rewrite for it was a trap.
 *
 * A release bundle never keeps a loopback host. If one gets this far — a
 * mis-set build profile, a stale `.env` picked up by the bundler — the app
 * falls back to production and says so, because an app pointed at localhost
 * is an app that does nothing at all and gives no reason why.
 */
export function resolveApiUrl(): string {
  const configured =
    process.env.EXPO_PUBLIC_API_URL ||
    (Constants.expoConfig?.extra?.apiUrl as string) ||
    PRODUCTION_API_URL;

  if (!isLoopback(configured)) {
    return configured.replace(/\/$/, "");
  }

  if (process.env.NODE_ENV === "production") {
    console.error(
      `[api] Release build resolved the API host to ${configured}, which is this device. ` +
      `Falling back to ${PRODUCTION_API_URL}. Fix EXPO_PUBLIC_API_URL in eas.json before shipping again.`,
    );
    return PRODUCTION_API_URL;
  }

  const port = new URL(configured).port || "5001";

  if (Platform.OS === "android") {
    return `http://10.0.2.2:${port}`;
  }

  // Physical device over Expo: reuse the LAN host the bundler is served from.
  const hostUri = Constants.expoConfig?.hostUri || (Constants as any).expoGoConfig?.debuggerHost;
  const lanHost = hostUri?.split(":")[0];
  if (lanHost && lanHost !== "localhost" && lanHost !== "127.0.0.1") {
    return `http://${lanHost}:${port}`;
  }

  return configured.replace(/\/$/, "");
}

export const API_URL = resolveApiUrl();

// --- Token storage -------------------------------------------------------
// SecureStore keeps tokens in the iOS Keychain / Android Keystore rather than
// plaintext AsyncStorage. Web has no SecureStore, so fall back to localStorage
// (only used by `expo start --web` during development).

async function setItem(key: string, value: string | null): Promise<void> {
  if (Platform.OS === "web") {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    return;
  }
  if (value === null) await SecureStore.deleteItemAsync(key);
  else await SecureStore.setItemAsync(key, value);
}

async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === "web") return localStorage.getItem(key);
  return SecureStore.getItemAsync(key);
}

/**
 * Small per-device preferences — not secrets, just things a screen remembers,
 * like when Discover was last looked at. The same storage as the tokens, so
 * there's one place that knows how to store on each platform.
 */
export const readPref = (key: string) => getItem(key);
export const writePref = (key: string, value: string | null) => setItem(key, value);

export interface Session {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: any;
  profile: any;
}

/**
 * What sign-in returns instead of a session for an account with 2FA on: the
 * password (or Google) step passed, and a code is still needed. The token is
 * good for five minutes and only for /api/auth/mobile/mfa/verify.
 */
export interface MfaChallenge { mfaRequired: true; challengeToken: string }
export const isMfaChallenge = (r: Session | MfaChallenge): r is MfaChallenge => (r as MfaChallenge).mfaRequired === true;

export async function saveSession(session: Pick<Session, "accessToken" | "refreshToken">): Promise<void> {
  await setItem(ACCESS_KEY, session.accessToken);
  await setItem(REFRESH_KEY, session.refreshToken);
}

export async function clearSession(): Promise<void> {
  await setItem(ACCESS_KEY, null);
  await setItem(REFRESH_KEY, null);
}

export const getAccessToken = () => getItem(ACCESS_KEY);
export const getRefreshToken = () => getItem(REFRESH_KEY);

/** Thrown for any non-2xx response, carrying the server's message. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: any,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Called when refresh fails, so the UI can drop back to sign-in. */
let onSessionExpired: (() => void) | null = null;
export function setSessionExpiredHandler(fn: () => void) {
  onSessionExpired = fn;
}

/**
 * Called when the server says something costs money.
 *
 * Handled here rather than screen by screen, for the same reason a session
 * expiring is: any of a dozen things can be the one that needs paying for —
 * a code audit, a document, a roadmap, a simulation, an image — and a 402
 * that only some of them know what to do with is a dead end in the others.
 * The refusal still throws, so a screen that wants to say something specific
 * still can; this is what makes sure *something* always offers the way out.
 */
let onPaymentRequired: ((body: any) => void) | null = null;
export function setPaymentRequiredHandler(fn: ((body: any) => void) | null) {
  onPaymentRequired = fn;
}

/**
 * A single in-flight refresh shared by all callers.
 *
 * Without this, a screen firing five queries at once on a stale token would
 * kick off five refreshes — and since refresh tokens rotate server-side, four
 * of them would be rejected and log the user out.
 */
let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const refreshToken = await getRefreshToken();
      if (!refreshToken) return null;

      const res = await fetch(`${API_URL}/api/auth/mobile/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // No device label: the server keeps the one from sign-in (server/mobile-auth.ts).
        body: JSON.stringify({ refreshToken }),
      });

      if (!res.ok) {
        await clearSession();
        onSessionExpired?.();
        return null;
      }

      const session = (await res.json()) as Session;
      await saveSession(session);
      return session.accessToken;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export function deviceLabel(): string {
  const name = Constants.deviceName || Platform.OS;
  return `${name} · ${Platform.OS} ${Platform.Version}`;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /** Internal: prevents an infinite refresh loop. */
  _retried?: boolean;
}

// --- Visits ----------------------------------------------------------------
//
// The web app's visitor and session live in cookies, which this client doesn't
// keep. Without them every request looked like a new visit, so "opened
// Discover, then followed someone" could never be one session on the owner's
// numbers. So the app names its own: a visitor id kept on the device, and a
// visit that ends after the same 30 quiet minutes the server's cookie does.

const VISITOR_KEY = "sparktower.visitorId";
/** Matches SESSION_IDLE_MINUTES in shared/analytics.ts, where the web's visit is defined. */
const VISIT_IDLE_MS = 30 * 60 * 1000;

const newId = () =>
  Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");

let visitorId: string | null = null;
/** `announced`: the server has been told this visit started (on the first request that carries it). */
let visit = { id: "", lastAt: 0, announced: false };

/** The current visit's id, starting a new one after 30 quiet minutes. */
export function currentVisit(): { id: string } {
  const now = Date.now();
  if (!visit.id || now - visit.lastAt > VISIT_IDLE_MS) visit = { id: newId(), lastAt: now, announced: false };
  visit.lastAt = now;
  return { id: visit.id };
}

async function visitHeaders(): Promise<Record<string, string>> {
  if (!visitorId) {
    visitorId = await getItem(VISITOR_KEY).catch(() => null);
    if (!visitorId) {
      visitorId = newId();
      void setItem(VISITOR_KEY, visitorId).catch(() => {});
    }
  }
  const { id } = currentVisit();
  const started = !visit.announced;
  visit.announced = true;
  return {
    "X-ST-Visitor": visitorId,
    "X-ST-Session": id,
    ...(started ? { "X-ST-Session-Start": "1" } : {}),
  };
}

export async function api<T = any>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, _retried } = options;
  const token = await getAccessToken();

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(await visitHeaders()),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // One transparent refresh-and-replay on expiry.
  if (res.status === 401 && !_retried && (await getRefreshToken())) {
    const fresh = await refreshAccessToken();
    if (fresh) return api<T>(path, { ...options, _retried: true });
  }

  const text = await res.text();
  let parsed: any = undefined;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }

  if (!res.ok) {
    // Announced before it is thrown, so the paywall is up whether or not the
    // caller does anything with the error.
    if (res.status === 402 && parsed?.code === "payment_required") onPaymentRequired?.(parsed);
    throw new ApiError(
      res.status,
      parsed?.message || `Request failed (${res.status})`,
      parsed,
    );
  }

  return parsed as T;
}

// --- File upload ---------------------------------------------------------

export interface PickedFile {
  uri: string;
  name: string;
  mimeType?: string | null;
  size?: number | null;
}

/**
 * Two-step upload: ask the server for a presigned URL, then PUT the bytes
 * straight to storage. The file streams from disk via its `file://` URI, so a
 * multi-megabyte résumé or photo never gets base64'd into JS memory.
 *
 * Returns the object path (`/objects/uploads/<id>`) to hand to whichever
 * endpoint should own the file.
 */
export async function uploadFile(file: PickedFile): Promise<string> {
  const contentType = file.mimeType || "application/octet-stream";

  // Goes through api() so a stale access token refreshes transparently.
  const { uploadURL, objectPath } = await api<{ uploadURL: string; objectPath: string }>(
    "/api/uploads/request-url",
    { method: "POST", body: { name: file.name, size: file.size ?? undefined, contentType } },
  );

  const res = await fetch(rewriteToApiHost(uploadURL), {
    method: "PUT",
    headers: { "Content-Type": contentType },
    // RN's fetch accepts a file URI object here and streams it.
    body: { uri: file.uri, name: file.name, type: contentType } as any,
  });
  if (!res.ok) throw new ApiError(res.status, `Upload failed (${res.status})`);

  return objectPath;
}

/**
 * In local development the server hands back an absolute `localhost` upload
 * URL, which on a phone or the Android emulator points at the device itself.
 * Rewrite that one case onto the host we already know reaches the API; real
 * presigned cloud URLs are left untouched.
 */
function rewriteToApiHost(url: string): string {
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url)) return url;
  const path = url.replace(/^https?:\/\/[^/]+/, "");
  return `${API_URL}${path}`;
}

// --- Auth calls ----------------------------------------------------------

export async function login(email: string, password: string): Promise<Session | MfaChallenge> {
  const session = await api<Session | MfaChallenge>("/api/auth/mobile/login", {
    method: "POST",
    body: { email, password, device: deviceLabel() },
  });
  if (!isMfaChallenge(session)) await saveSession(session);
  return session;
}

/** The second step for an account with 2FA on: an authenticator or recovery code against the challenge. */
export async function verifyMfa(challengeToken: string, code: string): Promise<Session> {
  const session = await api<Session>("/api/auth/mobile/mfa/verify", {
    method: "POST",
    body: { challengeToken, code: code.trim(), device: deviceLabel() },
  });
  await saveSession(session);
  return session;
}

export async function register(input: {
  email: string; password: string; firstName?: string; lastName?: string;
}): Promise<Session> {
  // Where this install came from, carried in with the signup — the server has
  // no cookie to read here. See src/api/attribution.ts.
  const attribution = await pendingAttribution();
  const session = await api<Session>("/api/auth/mobile/register", {
    method: "POST",
    body: { ...input, device: deviceLabel(), attribution },
  });
  await saveSession(session);
  await clearAttribution();
  return session;
}

export async function loginWithGoogle(idToken: string): Promise<Session | MfaChallenge> {
  // Sent on every Google call, not just new accounts: the app can't tell a
  // first sign-in from a returning one, and the server ignores it for anyone
  // who already has a row.
  const attribution = await pendingAttribution();
  const session = await api<Session | MfaChallenge>("/api/auth/mobile/google", {
    method: "POST",
    body: { idToken, device: deviceLabel(), attribution },
  });
  if (!isMfaChallenge(session)) await saveSession(session);
  await clearAttribution();
  return session;
}

/**
 * Sign in with Apple.
 *
 * `fullName` is sent every time and is almost always empty: Apple hands the
 * name over on the first authorization and never again, so the one sign-in
 * that has it is the one that needs it. The server takes it only to fill a
 * blank, never to overwrite a name somebody has since chosen.
 */
export async function loginWithApple(
  identityToken: string,
  fullName?: { givenName?: string | null; familyName?: string | null } | null,
): Promise<Session | MfaChallenge> {
  const attribution = await pendingAttribution();
  const session = await api<Session | MfaChallenge>("/api/auth/mobile/apple", {
    method: "POST",
    body: {
      identityToken,
      device: deviceLabel(),
      attribution,
      fullName: fullName ? { givenName: fullName.givenName ?? "", familyName: fullName.familyName ?? "" } : null,
    },
  });
  if (!isMfaChallenge(session)) await saveSession(session);
  await clearAttribution();
  return session;
}

export async function logout(): Promise<void> {
  const refreshToken = await getRefreshToken();
  try {
    if (refreshToken) {
      await api("/api/auth/mobile/logout", { method: "POST", body: { refreshToken } });
    }
  } catch {
    // Signing out locally matters more than the server round-trip succeeding.
  }
  await clearSession();
}

export async function fetchMe(): Promise<{ user: any; profile: any }> {
  return api("/api/auth/mobile/me");
}
