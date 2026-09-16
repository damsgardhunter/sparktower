/**
 * How a stranger finds a published artifact without being sent the link.
 *
 * Every published step already renders with its own title, description and
 * canonical URL (shared/path-artifacts.ts), which is what a pasted link needs.
 * Being *indexable* needs one more thing: something that tells a crawler these
 * pages exist. That's this — a sitemap of every public artifact page, and a
 * robots.txt that points at it.
 *
 * The rules here are the page's own rules (`publicArtifact`): published,
 * project public, feed post not hidden. A page that 404s must never be listed,
 * so both read the same three conditions — and a test holds them together.
 */
import type { Express, Request } from "express";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { feedPosts, pathArtifacts, projects } from "@shared/schema";
import { artifactPath } from "@shared/path-artifacts";

/** Sitemaps are capped at 50,000 URLs; well past that we'd need an index file. */
export const SITEMAP_MAX_URLS = 50_000;
const CACHE_SECONDS = 600;

/** The site's own address: what a crawler must see, not whatever host the request came in on. */
export const siteBase = (req: Request) =>
  (process.env.PUBLIC_URL || process.env.SERVER_BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");

/** Only a real deployment should be in an index. A preview or a laptop says "none of it". */
const indexable = () => process.env.NODE_ENV === "production" && !!(process.env.PUBLIC_URL || process.env.SERVER_BASE_URL);

const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Published artifact pages, newest first — the same three conditions the page itself applies. */
export async function publicArtifactPages(limit = SITEMAP_MAX_URLS) {
  return db.select({ id: pathArtifacts.id, updatedAt: pathArtifacts.updatedAt, publishedAt: pathArtifacts.publishedAt })
    .from(pathArtifacts)
    .innerJoin(projects, eq(projects.id, pathArtifacts.projectId))
    .leftJoin(feedPosts, eq(feedPosts.id, pathArtifacts.publishedPostId))
    .where(and(
      eq(pathArtifacts.visibility, "public"),
      eq(projects.isPrivate, false),
      isNull(feedPosts.hiddenAt),
    ))
    .orderBy(desc(sql`coalesce(${pathArtifacts.publishedAt}, ${pathArtifacts.updatedAt})`))
    .limit(limit);
}

export function registerSitemapRoutes(app: Express) {
  /**
   * What a crawler may read. Everything behind a sign-in is pointless to crawl
   * and some of it is one-time (an invite link), so it's listed as off-limits
   * rather than left to chance.
   */
  app.get("/robots.txt", (req, res) => {
    const lines = indexable()
      ? [
        "User-agent: *",
        "Allow: /$",
        "Allow: /a/",
        // Nothing here is readable signed out, and an invite token must never end up in an index.
        "Disallow: /api/",
        "Disallow: /invite/",
        "Disallow: /admin/",
        "Disallow: /objects/",
        "Disallow: /settings/",
        "Disallow: /internal-local-upload/",
        `Sitemap: ${siteBase(req)}/sitemap.xml`,
      ]
      // A preview deploy or a laptop: keep the whole thing out of the index, or it competes with the real site.
      : ["User-agent: *", "Disallow: /"];
    res.type("text/plain").set("Cache-Control", `public, max-age=${CACHE_SECONDS}`).send(`${lines.join("\n")}\n`);
  });

  /** Every page a stranger can read: the front door, and each published step. */
  app.get("/sitemap.xml", async (req, res) => {
    try {
      const base = siteBase(req);
      const pages = await publicArtifactPages();
      const urls = [
        `  <url><loc>${xmlEscape(base)}/</loc><changefreq>daily</changefreq></url>`,
        ...pages.map((p) => {
          const when = (p.publishedAt ?? p.updatedAt)?.toISOString().slice(0, 10);
          return `  <url><loc>${xmlEscape(base + artifactPath(p.id))}</loc>${when ? `<lastmod>${when}</lastmod>` : ""}</url>`;
        }),
      ];
      res.type("application/xml").set("Cache-Control", `public, max-age=${CACHE_SECONDS}`).send(
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`,
      );
    } catch (error) {
      console.error("Sitemap error:", error);
      res.status(500).type("text/plain").send("Couldn't build the sitemap");
    }
  });
}
