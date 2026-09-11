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
 * Base URL resolution.
 *
 * `localhost` means the device itself, not your Mac — so a phone or the
 * Android emulator can't reach a dev server that way. Android's emulator
 * maps the host to 10.0.2.2; a physical device needs your LAN IP, which
 * Expo exposes as the dev-server host.
 */
export function resolveApiUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");

  const configured = (Constants.expoConfig?.extra?.apiUrl as string) || "http://localhost:5001";
  if (!configured.includes("localhost") && !configured.includes("127.0.0.1")) {
    return configured.replace(/\/$/, "");
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
        body: JSON.stringify({ refreshToken, device: deviceLabel() }),
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

export async function api<T = any>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, _retried } = options;
  const token = await getAccessToken();

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

export async function login(email: string, password: string): Promise<Session> {
  const session = await api<Session>("/api/auth/mobile/login", {
    method: "POST",
    body: { email, password, device: deviceLabel() },
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

export async function loginWithGoogle(idToken: string): Promise<Session> {
  // Sent on every Google call, not just new accounts: the app can't tell a
  // first sign-in from a returning one, and the server ignores it for anyone
  // who already has a row.
  const attribution = await pendingAttribution();
  const session = await api<Session>("/api/auth/mobile/google", {
    method: "POST",
    body: { idToken, device: deviceLabel(), attribution },
  });
  await saveSession(session);
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
