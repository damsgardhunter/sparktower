import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { injectPageMeta, type PageMeta } from "@shared/path-artifacts";
import { pageStatus } from "./page-status";

const YEAR = 60 * 60 * 24 * 365;

/**
 * How long a built file may be cached, by its name alone.
 *
 * Exported because getting it wrong is silent in both directions: too short
 * and the CDN you are paying for revalidates everything; too long on the shell
 * and people who visited before a deploy get a blank page, because the shell
 * they have cached names hashed files that no longer exist.
 *
 * A name is treated as immutable only when it carries a content hash, which is
 * what makes the promise true rather than hopeful.
 */
export function cachePolicyFor(filePath: string): string {
  const hashed = /\.[0-9a-f]{8,}\.[a-z0-9]+$/i.test(filePath)
    || /[-.][0-9a-zA-Z_-]{8,}\.(js|css|woff2?|png|jpg|jpeg|svg|webp|avif)$/i.test(filePath);
  return hashed ? `public, max-age=${YEAR}, immutable` : "no-cache";
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  /*
   * Cache headers, because a CDN in front of this is most of the capacity.
   *
   * `express.static` sends an ETag and a Last-Modified and no `Cache-Control`,
   * so every asset is revalidated on every navigation: a conditional request
   * per file, answered 304, at the origin. That is cheap per request and it is
   * the whole bundle on every cold load, and a CDN placed in front of it caches
   * nothing it can serve without asking — which is the opposite of why you buy
   * one.
   *
   * Vite builds hashed filenames (`assets/index-a1b2c3.js`), and a hashed name
   * is immutable by construction: if the contents change the name changes. So
   * those get a year and `immutable`, which a CDN and a browser can both serve
   * without a round trip.
   *
   * Everything else — `index.html` above all — gets `no-cache`, meaning "ask
   * me, I will usually say 304". The shell must never be cached: it carries the
   * references to the hashed files, so a stale shell points at assets that no
   * longer exist, and the symptom is a blank page for everyone who visited
   * before the deploy.
   */
  app.use(express.static(distPath, {
    index: false,
    setHeaders(res, filePath) {
      res.setHeader("Cache-Control", cachePolicyFor(filePath));
    },
  }));

  // fall through to index.html if the file doesn't exist — with the page's own
  // title and preview tags when a route set them (a published artifact, say).
  const indexHtml = fs.readFileSync(path.resolve(distPath, "index.html"), "utf-8");
  app.use("/{*path}", (_req, res) => {
    const meta = res.locals.pageMeta as PageMeta | undefined;
    // See the note in server/vite.ts: a route can ask for a 404 and still get the shell.
    /*
     * `no-cache` on the shell for the reason above, and said explicitly rather
     * than left to a default: this response is built per request (it carries
     * the page's own title and preview tags) and a CDN that cached it would
     * serve one artifact's preview for every other page on the site.
     */
    res.status(pageStatus(res)).set({ "Content-Type": "text/html", "Cache-Control": "no-cache" })
      .end(meta ? injectPageMeta(indexHtml, meta) : indexHtml);
  });
}
