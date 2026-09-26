/**
 * The mobile API client: the part of the app every screen goes through, and
 * the one whose mistakes log people out. A stale token refreshes once — even
 * with five requests racing — and the request replays; a refresh that fails
 * ends the session instead of looping; a visit is one session until 30 quiet
 * minutes pass; and the API host is one a phone can actually reach.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { store } from "../../test/stubs/expo-secure-store";
import { Platform } from "react-native";
import Constants from "expo-constants";

type Call = { url: string; method: string; headers: Record<string, string>; body: any };
let calls: Call[] = [];
let respond: (call: Call) => { status: number; body?: unknown };

const json = (status: number, body?: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (body === undefined ? "" : JSON.stringify(body)),
  json: async () => body,
});

/** A fresh copy of the client: its API host, visit and in-flight refresh are module state. */
async function client() {
  vi.resetModules();
  return import("./client");
}

beforeEach(() => {
  store.clear();
  calls = [];
  Platform.OS = "ios";
  (Constants as any).expoConfig = { extra: { apiUrl: "https://api.sparktower.test" } };
  delete process.env.EXPO_PUBLIC_API_URL;
  respond = () => ({ status: 200, body: {} });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: any = {}) => {
    const call: Call = { url, method: init.method ?? "GET", headers: init.headers ?? {}, body: typeof init.body === "string" ? JSON.parse(init.body) : init.body };
    calls.push(call);
    const r = respond(call);
    return json(r.status, r.body);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("the API host", () => {
  it("uses the configured host, and one a phone can reach when that host is localhost", async () => {
    expect((await client()).API_URL).toBe("https://api.sparktower.test");
    process.env.EXPO_PUBLIC_API_URL = "https://staging.sparktower.test/";
    expect((await client()).API_URL).toBe("https://staging.sparktower.test");
    delete process.env.EXPO_PUBLIC_API_URL;

    (Constants as any).expoConfig = { extra: { apiUrl: "http://localhost:5001" } };
    Platform.OS = "android";
    expect((await client()).API_URL).toBe("http://10.0.2.2:5001");
    Platform.OS = "ios";
    (Constants as any).expoConfig = { extra: { apiUrl: "http://localhost:5001" }, hostUri: "192.168.1.20:8081" };
    expect((await client()).API_URL).toBe("http://192.168.1.20:5001");
  });
});

describe("requests", () => {
  it("sends the access token and a JSON body, and throws the server's message on an error", async () => {
    const { api, saveSession, ApiError } = await client();
    await saveSession({ accessToken: "access-1", refreshToken: "refresh-1" });
    respond = (c) => (c.url.endsWith("/api/projects") ? { status: 200, body: { id: "p1" } } : { status: 400, body: { message: "Title is required", field: "title" } });

    expect(await api("/api/projects", { method: "POST", body: { title: "X" } })).toEqual({ id: "p1" });
    expect(calls[0]).toMatchObject({ url: "https://api.sparktower.test/api/projects", method: "POST", body: { title: "X" }, headers: { Authorization: "Bearer access-1", "Content-Type": "application/json" } });

    const err = await api("/api/other").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, message: "Title is required", body: { field: "title" } });
  });
});

describe("refreshing an expired token", () => {
  it("refreshes once, saves the new pair, and replays the request with the new token", async () => {
    const { api, saveSession, getRefreshToken } = await client();
    await saveSession({ accessToken: "stale", refreshToken: "refresh-1" });
    respond = (c) => {
      if (c.url.endsWith("/api/auth/mobile/refresh")) return { status: 200, body: { accessToken: "fresh", refreshToken: "refresh-2" } };
      return c.headers.Authorization === "Bearer fresh" ? { status: 200, body: { ok: true } } : { status: 401, body: { message: "Unauthorized" } };
    };
    expect(await api("/api/feed")).toEqual({ ok: true });
    const refresh = calls.find((c) => c.url.endsWith("/refresh"))!;
    /*
     * The refresh token and nothing else. The server reads only that
     * (server/mobile-auth.ts) and keeps the device label from sign-in, so
     * sending one here would be a value nobody looks at.
     */
    expect(refresh.body).toEqual({ refreshToken: "refresh-1" });
    expect(calls.map((c) => c.url.replace("https://api.sparktower.test", ""))).toEqual(["/api/feed", "/api/auth/mobile/refresh", "/api/feed"]);
    expect(await getRefreshToken()).toBe("refresh-2");
  });

  it("shares one refresh between requests that expire together — a second refresh would spend the rotated token", async () => {
    const { api, saveSession } = await client();
    await saveSession({ accessToken: "stale", refreshToken: "refresh-1" });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    respond = (c) => (c.url.endsWith("/refresh")
      ? { status: 200, body: { accessToken: "fresh", refreshToken: "refresh-2" } }
      : c.headers.Authorization === "Bearer fresh" ? { status: 200, body: { path: c.url } } : { status: 401 });
    // Hold the refresh open so all five are waiting on it at once.
    const realFetch = fetch as any;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: any) => { if (url.endsWith("/refresh")) await gate; return realFetch(url, init); }));
    const results = Promise.all([1, 2, 3, 4, 5].map((i) => api(`/api/q${i}`)));
    await new Promise((r) => setTimeout(r, 20));
    release();
    expect((await results).map((r: any) => r.path.split("/").pop())).toEqual(["q1", "q2", "q3", "q4", "q5"]);
    expect(calls.filter((c) => c.url.endsWith("/refresh"))).toHaveLength(1);
  });

  /*
   * A price is not a failure. Any of a dozen things can be the one that costs
   * money — a code audit, a document, a simulation, an image — and before this
   * a 402 was an ordinary error that each screen had to recognise for itself,
   * which meant the ones nobody remembered dead-ended with no way to pay.
   */
  it("announces a price before throwing it, so something can always offer the way out", async () => {
    const { api, saveSession, setPaymentRequiredHandler, ApiError } = await client();
    await saveSession({ accessToken: "good", refreshToken: "good" });
    const asked = vi.fn();
    setPaymentRequiredHandler(asked);
    const body = { code: "payment_required", message: "Simulating a decision costs $3.", label: "Simulate a decision", price: { cents: 300, display: "$3" } };
    respond = () => ({ status: 402, body });

    const err = await api("/api/projects/x/decision-sim/scenarios", { method: "POST" }).catch((e) => e);

    expect(asked, "the paywall hears about it").toHaveBeenCalledTimes(1);
    expect(asked.mock.calls[0][0]).toMatchObject({ code: "payment_required", label: "Simulate a decision" });
    // And it still rejects, so a screen with something of its own to say can.
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(402);
    expect(err.body).toMatchObject({ price: { display: "$3" } });
    setPaymentRequiredHandler(null);
  });

  it("does not mistake an ordinary refusal for a price", async () => {
    const { api, saveSession, setPaymentRequiredHandler } = await client();
    await saveSession({ accessToken: "good", refreshToken: "good" });
    const asked = vi.fn();
    setPaymentRequiredHandler(asked);
    respond = () => ({ status: 403, body: { code: "not_yours", message: "Not yours." } });

    await api("/api/projects/x").catch(() => {});
    expect(asked).not.toHaveBeenCalled();
    setPaymentRequiredHandler(null);
  });

  it("ends the session when the refresh is refused, without retrying forever", async () => {
    const { api, saveSession, getAccessToken, getRefreshToken, setSessionExpiredHandler, ApiError } = await client();
    await saveSession({ accessToken: "stale", refreshToken: "revoked" });
    const expired = vi.fn();
    setSessionExpiredHandler(expired);
    respond = () => ({ status: 401, body: { message: "Your session expired. Please sign in again." } });

    const err = await api("/api/feed").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(expired).toHaveBeenCalledTimes(1);
    expect(await getAccessToken()).toBeNull();
    expect(await getRefreshToken()).toBeNull();
    expect(calls.filter((c) => c.url.endsWith("/refresh"))).toHaveLength(1);
  });

  it("doesn't try to refresh with no refresh token", async () => {
    const { api } = await client();
    respond = () => ({ status: 401 });
    await expect(api("/api/feed")).rejects.toMatchObject({ status: 401 });
    expect(calls).toHaveLength(1);
  });
});

describe("visits", () => {
  it("is one visit, announced once, until 30 quiet minutes — and the device keeps its visitor id", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-15T10:00:00Z"));
    let { api } = await client();
    await api("/a");
    await api("/b");
    const [a, b] = calls;
    expect(a.headers["X-ST-Session-Start"]).toBe("1");
    expect(b.headers["X-ST-Session-Start"]).toBeUndefined();
    expect(b.headers["X-ST-Session"]).toBe(a.headers["X-ST-Session"]);
    expect(a.headers["X-ST-Visitor"]).toMatch(/^[0-9a-f]{32}$/);

    vi.setSystemTime(new Date("2026-09-15T10:29:00Z"));
    await api("/c");
    expect(calls[2].headers["X-ST-Session"]).toBe(a.headers["X-ST-Session"]);
    vi.setSystemTime(new Date("2026-09-15T11:00:00Z"));
    await api("/d");
    expect(calls[3].headers["X-ST-Session"]).not.toBe(a.headers["X-ST-Session"]);
    expect(calls[3].headers["X-ST-Session-Start"]).toBe("1");

    // A relaunch: a new visit, the same visitor.
    ({ api } = await client());
    await api("/e");
    expect(calls[4].headers["X-ST-Visitor"]).toBe(a.headers["X-ST-Visitor"]);
  });
});

describe("signing out and uploading", () => {
  it("signs out locally even when the server can't be reached", async () => {
    const { logout, saveSession, getAccessToken } = await client();
    await saveSession({ accessToken: "a", refreshToken: "r" });
    respond = () => ({ status: 500 });
    await logout();
    expect(calls[0]).toMatchObject({ method: "POST", body: { refreshToken: "r" } });
    expect(await getAccessToken()).toBeNull();
  });

  it("points a development upload URL at the API host a phone can reach, and leaves real storage URLs alone", async () => {
    const { uploadFile } = await client();
    for (const [uploadURL, expected] of [
      ["http://localhost:5001/internal-local-upload/abc", "https://api.sparktower.test/internal-local-upload/abc"],
      ["https://storage.googleapis.com/bucket/obj?sig=1", "https://storage.googleapis.com/bucket/obj?sig=1"],
    ]) {
      calls = [];
      respond = (c) => (c.url.endsWith("/request-url") ? { status: 200, body: { uploadURL, objectPath: "/objects/uploads/abc" } } : { status: 200 });
      expect(await uploadFile({ uri: "file:///photo.jpg", name: "photo.jpg", mimeType: "image/jpeg", size: 1234 })).toBe("/objects/uploads/abc");
      expect(calls[1]).toMatchObject({ url: expected, method: "PUT" });
    }
  });
});
