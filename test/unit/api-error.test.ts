/**
 * How the web app turns an API error into words. The rate-limit refusal
 * reaches a person as the server's message and when to try again — never as
 * "429: {…}" — and every other error keeps working as it did.
 */
import { describe, it, expect } from "vitest";
import { ApiError, errorText, toApiError, waitPhrase } from "@/lib/api-error";
import { isUnauthorizedError } from "@/lib/auth-utils";

const response = (status: number, body: string, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers });

describe("errorText", () => {
  it("gives a rate limit's message and the wait, from the shared contract", async () => {
    const err = await toApiError(response(429, JSON.stringify({
      message: "Slow down a moment — you can comment again shortly.", code: "rate_limited", action: "comment", retryAfterSeconds: 150, retryAfterMinutes: 3,
    }), { "Retry-After": "150" }));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(429);
    expect(err.code).toBe("rate_limited");
    expect(errorText(err)).toBe("Slow down a moment — you can comment again shortly. Ready again in about 3 minutes.");
  });

  it("falls back to the Retry-After header when the body has no wait", async () => {
    const err = await toApiError(response(429, JSON.stringify({ message: "Too fast.", code: "rate_limited" }), { "Retry-After": "30" }));
    expect(errorText(err)).toBe("Too fast. Ready again in about 30 seconds.");
  });

  it("uses the server's message for other errors, and never shows a server's error page", async () => {
    expect(errorText(await toApiError(response(400, JSON.stringify({ message: "Title is required" }))))).toBe("Title is required");
    expect(errorText(await toApiError(response(500, "<html>stack</html>")), "Couldn't save.")).toBe("Couldn't save.");
  });

  it("still reads errors made the old way, and plain ones", () => {
    expect(errorText(new Error('409: {"message":"Already joined"}'))).toBe("Already joined");
    expect(errorText(new Error("Upload too large"))).toBe("Upload too large");
    expect(errorText(undefined, "Try again.")).toBe("Try again.");
  });

  it("keeps the message form that sign-out detection matches on", async () => {
    const err = await toApiError(response(401, JSON.stringify({ message: "Unauthorized" })));
    expect(isUnauthorizedError(err)).toBe(true);
  });
});

describe("waitPhrase", () => {
  it("reads like a person would say it", () => {
    expect(waitPhrase(12)).toBe("about 10 seconds");
    expect(waitPhrase(60)).toBe("about a minute");
    expect(waitPhrase(61)).toBe("about 2 minutes");
    expect(waitPhrase(900)).toBe("about 15 minutes");
  });
});
