/**
 * The two ways a deploy can come up "healthy" and be broken anyway.
 *
 * The preflight already refuses to start production over a missing database or
 * an unsigned session. What it deliberately does not do is refuse over a
 * feature that isn't configured — and that is right, but it left two holes an
 * audit found, both with the same shape: the service boots, answers /_health
 * with a 200, and one whole part of the product does not work, discovered days
 * later by a person rather than minutes later by a deploy that failed.
 *
 *  - **No bucket.** `PRIVATE_OBJECT_DIR` unset in production meant every
 *    avatar, cover and post image failed at the moment somebody tried one. The
 *    boot log said "uploads will fail" and nothing acted on it.
 *  - **No address.** Stripe's webhook was registered from `PUBLIC_URL ||
 *    REPLIT_DOMAINS`, which is neither the chain the rest of the product
 *    builds links from nor the chain the preflight accepts. Configured with
 *    only one of the others, the service ran perfectly and recorded no
 *    payment, subscription or cancellation at all.
 *
 * Both are now answered rather than logged, and this is what says so.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { environmentDisabledSurfaces } from "../../server/surfaces";
import { checkEnvironment } from "@shared/env-requirements";
import { SURFACE_API_PREFIXES } from "@shared/surfaces";

const root = join(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("a production deploy with nowhere to put an upload", () => {
  it("turns the uploads surface off rather than failing one image at a time", () => {
    const off = environmentDisabledSurfaces({ NODE_ENV: "production", PRIVATE_OBJECT_DIR: "" });
    expect(Object.keys(off)).toEqual(["uploads"]);
    expect(off.uploads, "and says which variable, because that is the fix").toMatch(/PRIVATE_OBJECT_DIR/);
  });

  it("leaves it on as soon as there is a bucket", () => {
    expect(environmentDisabledSurfaces({ NODE_ENV: "production", PRIVATE_OBJECT_DIR: "/bucket/private" })).toEqual({});
    // Whitespace is not a bucket.
    expect(environmentDisabledSurfaces({ NODE_ENV: "production", PRIVATE_OBJECT_DIR: "   " })).toHaveProperty("uploads");
  });

  it("does nothing on a laptop, where local storage is the point", () => {
    expect(environmentDisabledSurfaces({ NODE_ENV: "development", PRIVATE_OBJECT_DIR: "" })).toEqual({});
    expect(environmentDisabledSurfaces({ PRIVATE_OBJECT_DIR: "" })).toEqual({});
  });

  it("names a surface that exists and guards real routes", () => {
    // A blocker on an id nothing is mounted under would be a no-op nobody notices.
    expect(SURFACE_API_PREFIXES.uploads).toContain("/api/uploads");
  });

  it("is still only degraded to the preflight, so the site keeps serving", () => {
    const report = checkEnvironment({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://u:p@db.example.com:5432/app",
      SESSION_SECRET: "x".repeat(40),
      PUBLIC_URL: "https://sparktower.app",
      PRIVATE_OBJECT_DIR: "",
    });
    expect(report.blocking.map((f) => f.name), "no bucket is not a reason to take the whole site down").not.toContain("PRIVATE_OBJECT_DIR");
    expect(report.degraded.map((f) => f.name)).toContain("PRIVATE_OBJECT_DIR");
  });
});

describe("where the Stripe webhook is registered from", () => {
  const boot = read("server/index.ts");

  it("asks the one resolver, rather than reading the environment a second way", () => {
    const registration = boot.slice(boot.indexOf("findOrCreateManagedWebhook") - 2000, boot.indexOf("findOrCreateManagedWebhook") + 200);
    expect(registration).toContain("publicUrlFact");
    expect(
      registration,
      "a private chain here is how a deploy with SERVER_BASE_URL registered no webhook at all",
    ).not.toMatch(/process\.env\.PUBLIC_URL\s*\|\|/);
  });

  it("says so as an error in production, because payments are off until it is fixed", () => {
    expect(boot).toMatch(/console\.error\(\s*\n?\s*"\[stripe\] No public URL configured/);
  });
});
