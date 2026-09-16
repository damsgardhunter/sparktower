/**
 * One door for webhooks, and it's locked.
 *
 * Every Stripe delivery is verified in one place — the signature is checked
 * over the raw bytes before anything is parsed — which is the right shape, and
 * also the fragile one: a second entrypoint added later would be unverified,
 * and nothing about the first one would notice. So the count is pinned here.
 * A new webhook route is a decision: name it below and give it a verified
 * signature, or it fails.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";

/** Route paths that receive calls from outside and must verify what sent them. */
const WEBHOOK_ROUTES: Record<string, RegExp> = {
  "/api/stripe/webhook": /WebhookHandlers\.processWebhook/,
};

const serverFiles = () => execSync("git ls-files server", { encoding: "utf8" })
  .split("\n").filter((p) => /\.ts$/.test(p) && existsSync(p))
  .map((path) => ({ path, content: readFileSync(path, "utf8") }));

describe("webhook entrypoints", () => {
  it("are only the ones named here, each verifying the sender before it reads the body", () => {
    const found: string[] = [];
    for (const f of serverFiles()) {
      for (const m of f.content.matchAll(/app\.(post|put|patch)\(\s*["'`]([^"'`]*(?:webhook|hook)[^"'`]*)["'`]([\s\S]{0,2000})/gi)) {
        const [, , path, body] = m;
        found.push(path);
        const verifier = WEBHOOK_ROUTES[path];
        expect(verifier, `${path} in ${f.path} is a new webhook entrypoint — add it to WEBHOOK_ROUTES with what verifies it`).toBeTruthy();
        expect(verifier!.test(body), `${path} in ${f.path} must verify the sender's signature before using the body`).toBe(true);
        // The raw bytes, not a parsed body: a re-serialised body fails Stripe's signature check.
        expect(body).toMatch(/express\.raw|rawBody|Buffer/);
      }
    }
    expect(found.sort()).toEqual(Object.keys(WEBHOOK_ROUTES).sort());
  });

  it("verify with the signing secret, and refuse rather than guess when it's missing", () => {
    const handlers = serverFiles().find((f) => f.path === "server/webhookHandlers.ts")!.content;
    // A missing secret is a 500 so Stripe retries — never a silently accepted event.
    expect(handlers).toMatch(/no webhook secret/i);
    expect(handlers).toMatch(/WebhookVerificationError/);
    // Verified first, then parsed: the order is the whole guarantee.
    const verifyAt = handlers.indexOf("processWebhook(payload, signature)");
    const parseAt = handlers.indexOf("JSON.parse(payload.toString())");
    expect(verifyAt).toBeGreaterThan(-1);
    expect(parseAt).toBeGreaterThan(verifyAt);
  });
});
