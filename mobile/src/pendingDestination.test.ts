/**
 * Where a signed-out visitor was going, kept across sign-in.
 *
 * The bug this covers was silent by construction: the invite screen wrote a
 * token down and nothing ever read it, so the only symptom was an invited
 * person landing on the feed having joined nothing. Nothing threw, nothing
 * logged. So the round trip — written here, taken there, gone afterwards — is
 * what the tests hold on to, along with the rule that a stored value is a
 * route in this app and not an address somewhere else.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { store } from "../test/stubs/expo-secure-store";
import {
  PENDING_INVITE_KEY, PENDING_RETURN_KEY, destinationFor, isInviteToken,
  isSafeReturnPath, rememberReturnPath, takePendingDestination,
} from "./pendingDestination";

beforeEach(() => { store.clear(); });

describe("isSafeReturnPath", () => {
  it("takes an in-app route", () => {
    expect(isSafeReturnPath("/project/abc")).toBe(true);
    expect(isSafeReturnPath("/project/new?goal=launch_saas&subcategory=b2b")).toBe(true);
  });

  it("refuses anything that leaves the app", () => {
    // The two shapes that would be an open redirect on a web build.
    expect(isSafeReturnPath("//evil.example.com")).toBe(false);
    expect(isSafeReturnPath("https://evil.example.com")).toBe(false);
    expect(isSafeReturnPath("/javascript:alert(1)")).toBe(false);
  });

  it("refuses what isn't a route at all", () => {
    expect(isSafeReturnPath("project/abc")).toBe(false);
    expect(isSafeReturnPath("/")).toBe(false);
    expect(isSafeReturnPath("")).toBe(false);
    expect(isSafeReturnPath(null)).toBe(false);
    expect(isSafeReturnPath(`/${"a".repeat(600)}`)).toBe(false);
  });
});

describe("isInviteToken", () => {
  it("takes an opaque id and refuses a path", () => {
    expect(isInviteToken("aBc123_-xyz9")).toBe(true);
    expect(isInviteToken("../../manage/someone-elses")).toBe(false);
    expect(isInviteToken("short")).toBe(false);
    expect(isInviteToken(undefined)).toBe(false);
  });
});

describe("destinationFor", () => {
  it("prefers the invite: someone is waiting on the other end of it", () => {
    expect(destinationFor("token1234abcd", "/project/xyz")).toBe("/invite/token1234abcd");
  });

  it("falls back to the return path, and to nothing", () => {
    expect(destinationFor(null, "/project/xyz")).toBe("/project/xyz");
    expect(destinationFor(null, null)).toBe(null);
    // A token this build refuses must not become a route.
    expect(destinationFor("../oops", null)).toBe(null);
  });
});

describe("takePendingDestination", () => {
  it("hands the invite over once and forgets it", async () => {
    store.set(PENDING_INVITE_KEY, "token1234abcd");

    expect(await takePendingDestination()).toBe("/invite/token1234abcd");
    // Gone from the device: a destination that survived its own arrival would
    // hijack every launch from now on.
    expect(store.has(PENDING_INVITE_KEY)).toBe(false);
    expect(await takePendingDestination()).toBe(null);
  });

  it("round-trips a remembered return path", async () => {
    await rememberReturnPath("/project/new?goal=launch_saas");
    expect(store.get(PENDING_RETURN_KEY)).toBe("/project/new?goal=launch_saas");
    expect(await takePendingDestination()).toBe("/project/new?goal=launch_saas");
    expect(store.has(PENDING_RETURN_KEY)).toBe(false);
  });

  it("never stores a path it would refuse to navigate to", async () => {
    await rememberReturnPath("https://evil.example.com");
    expect(store.has(PENDING_RETURN_KEY)).toBe(false);
  });

  it("clears both keys even when neither is usable", async () => {
    store.set(PENDING_INVITE_KEY, "../nope");
    store.set(PENDING_RETURN_KEY, "//evil.example.com");

    expect(await takePendingDestination()).toBe(null);
    expect(store.size).toBe(0);
  });

  it("is quiet when the device has nothing stored", async () => {
    expect(await takePendingDestination()).toBe(null);
  });
});
