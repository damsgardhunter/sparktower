/**
 * How long a built file may be cached.
 *
 * A CDN in front of the web tier is most of the capacity in the 2,000-user
 * plan, and `express.static` sends an ETag and no `Cache-Control` — so without
 * this every asset is revalidated on every navigation and the CDN caches
 * nothing it can serve without asking the origin first. That is the opposite
 * of why you buy one.
 *
 * It is wrong in both directions and silent in both:
 *
 *   - too short, and the CDN is decoration;
 *   - too long on the shell, and everyone who visited before a deploy gets a
 *     blank page, because the `index.html` they have cached names hashed files
 *     that no longer exist. That failure outlasts the deploy and looks like the
 *     site is down.
 *
 * So the rule is: a year and `immutable` only for names carrying a content
 * hash, where the promise is true by construction, and `no-cache` for
 * everything else.
 */
import { describe, it, expect } from "vitest";
import { cachePolicyFor } from "../../server/static";

const immutable = (p: string) => expect(cachePolicyFor(p), `${p} should be cacheable for a year`).toBe("public, max-age=31536000, immutable");
const revalidate = (p: string) => expect(cachePolicyFor(p), `${p} must be revalidated`).toBe("no-cache");

describe("what may be cached for a year", () => {
  it("is anything Vite gave a content hash", () => {
    immutable("/dist/public/assets/index-a1b2c3d4.js");
    immutable("/dist/public/assets/index-a1b2c3d4.css");
    immutable("/dist/public/assets/logo-9f8e7d6c.svg");
    immutable("/dist/public/assets/Inter-4f3e2d1c.woff2");
    immutable("/dist/public/assets/hero-0011aabb.webp");
  });

  /*
   * The one that must never be wrong. The shell carries the references to
   * every hashed file, so a cached shell is a promise about files that are
   * about to stop existing.
   */
  it("is never the shell", () => {
    revalidate("/dist/public/index.html");
    revalidate("/dist/public/nested/index.html");
  });

  it("is never a file whose name says nothing about its contents", () => {
    revalidate("/dist/public/favicon.ico");
    revalidate("/dist/public/robots.txt");
    revalidate("/dist/public/manifest.webmanifest");
    revalidate("/dist/public/logo.png");
    revalidate("/dist/public/assets/style.css");
    revalidate("/dist/public/sw.js");
  });

  /*
   * A short suffix is not a hash. `app-v2.js` is a name somebody will edit in
   * place, and a year of `immutable` on it is a year of the old file.
   */
  it("is not fooled by a short suffix that is not a hash", () => {
    revalidate("/dist/public/app-v2.js");
    revalidate("/dist/public/icon-32.png");
    revalidate("/dist/public/theme-dark.css");
  });
});
