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
import { feedPosts, pathArtifacts, projects, users, userProfiles } from "@shared/schema";
import { artifactPath } from "@shared/path-artifacts";
import { publicBaseUrl } from "./public-url";
import { authorIsLive, publicArtifactVisible, publiclyVisible } from "./visibility";

/** Sitemaps are capped at 50,000 URLs; well past that we'd need an index file. */
export const SITEMAP_MAX_URLS = 50_000;
const CACHE_SECONDS = 600;

/**
 * The site's own address: what a crawler must see, not whatever host the
 * request came in on.
 *
 * `publicBaseUrl` rather than a fourth copy of the same three-way fallback.
 * The copy that used to live here fell back to `req.get("host")`, which is a
 * request header and therefore whatever the caller typed. With neither
 * variable set, one request carrying `Host: evil.example` got back a sitemap
 * of this site's real pages with every URL rewritten to point at theirs — a
 * ready-made list for a phishing mirror, served by us, and indexable.
 * `publicBaseUrl` prefers the configured address, uses `x-forwarded-host`
 * ahead of `host` behind a proxy, and is the same function every email link is
 * built from, so there is one place the site's own name is decided.
 */
export const siteBase = (req: Request) => publicBaseUrl(req).replace(/\/$/, "");

/** Only a real deployment should be in an index. A preview or a laptop says "none of it". */
const indexable = () => process.env.NODE_ENV === "production" && !!(process.env.PUBLIC_URL || process.env.SERVER_BASE_URL);

const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Published artifact pages, newest first — the same conditions the page itself applies. */
export async function publicArtifactPages(limit = SITEMAP_MAX_URLS) {
  return db.select({ id: pathArtifacts.id, updatedAt: pathArtifacts.updatedAt, publishedAt: pathArtifacts.publishedAt })
    .from(pathArtifacts)
    .innerJoin(projects, eq(projects.id, pathArtifacts.projectId))
    .innerJoin(users, eq(users.id, projects.ownerId))
    .leftJoin(feedPosts, eq(feedPosts.id, pathArtifacts.publishedPostId))
    .where(and(
      eq(pathArtifacts.visibility, "public"),
      eq(projects.isPrivate, false),
      isNull(feedPosts.hiddenAt),
      /*
       * The page's own moderation rules, from the same helper the page reads
       * (`publicArtifact` in server/artifact-routes.ts): the artifact taken
       * down, the project taken down, the author's or the owner's account
       * suspended or closed — any of those and the URL is gone from the index.
       * Written by hand here, this list was already one condition short: it
       * tested the owner's suspension but not a closed account, and there was
       * no test at all for the artifact itself because the column didn't
       * exist. Inviting a crawler to a page that 404s is the one thing a
       * sitemap must never do.
       */
      publicArtifactVisible(),
    ))
    .orderBy(desc(sql`coalesce(${pathArtifacts.publishedAt}, ${pathArtifacts.updatedAt})`))
    .limit(limit);
}

/**
 * Public project pages.
 *
 * They were crawlable and unlisted: `/projects/:id` renders for anyone when
 * the project isn't private, and nothing told a crawler those addresses
 * existed, so the only public pages in the index were the artifacts. The
 * conditions are the page's own — `GET /api/projects/:id` serves a
 * "restricted" stub for a private project, which is not worth a crawl — plus
 * the two visibility rules every public listing now applies.
 */
export async function publicProjectPages(limit = SITEMAP_MAX_URLS) {
  return db.select({ id: projects.id, createdAt: projects.createdAt })
    .from(projects)
    .innerJoin(users, eq(users.id, projects.ownerId))
    .where(and(
      eq(projects.isPrivate, false),
      // The same pair every public project listing applies, from one place.
      publiclyVisible.project(),
    ))
    .orderBy(desc(projects.createdAt))
    .limit(limit);
}

/**
 * Public profile pages.
 *
 * `/profile/:id` reads signed out, so it belongs in the index — but only for
 * people who have actually made a profile. An account that signed up and
 * stopped has a page with a name on it and nothing else, and filling an index
 * with those is how a site earns a reputation for thin content. A suspended
 * account is never listed.
 */
export async function publicProfilePages(limit = SITEMAP_MAX_URLS) {
  return db.select({ id: users.id })
    .from(users)
    .innerJoin(userProfiles, eq(userProfiles.userId, users.id))
    .where(and(
      authorIsLive(users.id),
      eq(userProfiles.isOnboarded, true),
      /*
       * The brackets matter. `and()` joins its arguments with `and` and
       * parenthesises the whole, not each part, so a raw fragment containing a
       * bare `or` binds looser than everything beside it: this read was
       * `(live and onboarded and bio<>'') or headline<>''`, which listed every
       * account with a headline — suspended, closed, half-onboarded, all of
       * them — in the public sitemap. It was invisible because the common case
       * (a live account with a bio) is in both readings.
       */
      sql`(coalesce(${userProfiles.bio}, '') <> '' or coalesce(${userProfiles.headline}, '') <> '')`,
    ))
    .orderBy(desc(users.createdAt))
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
        "Allow: /projects/",
        "Allow: /profile/",
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

  /** Every page a stranger can read: the front door, each published step, each public project, each real profile. */
  app.get("/sitemap.xml", async (req, res) => {
    try {
      /*
       * Nothing to serve when the site says it isn't indexable.
       *
       * robots.txt already answers "Disallow: /" in that case, and a sitemap
       * disagreeing with the robots.txt beside it is worse than having none:
       * a crawler that finds the sitemap by any other route — a link, a
       * submission, a cached reference — takes it as an invitation, and the
       * pages it then indexes belong to a preview deploy or somebody's laptop,
       * competing with the real site under URLs that will not exist next week.
       * The same condition decides both answers, so they cannot drift apart.
       */
      if (!indexable()) return res.status(404).type("text/plain").send("No sitemap here.");

      const base = siteBase(req);
      // Shared out across the three kinds, so one busy kind can't crowd the
      // others out of the 50,000 a sitemap may hold.
      const share = Math.floor(SITEMAP_MAX_URLS / 3);
      const [artifacts, projectPages, profilePages] = await Promise.all([
        publicArtifactPages(share),
        publicProjectPages(share),
        publicProfilePages(share),
      ]);
      const urls = [
        `  <url><loc>${xmlEscape(base)}/</loc><changefreq>daily</changefreq></url>`,
        ...artifacts.map((p) => {
          const when = (p.publishedAt ?? p.updatedAt)?.toISOString().slice(0, 10);
          return `  <url><loc>${xmlEscape(base + artifactPath(p.id))}</loc>${when ? `<lastmod>${when}</lastmod>` : ""}</url>`;
        }),
        ...projectPages.map((p) => {
          const when = p.createdAt?.toISOString().slice(0, 10);
          return `  <url><loc>${xmlEscape(`${base}/projects/${p.id}`)}</loc>${when ? `<lastmod>${when}</lastmod>` : ""}</url>`;
        }),
        ...profilePages.map((p) => `  <url><loc>${xmlEscape(`${base}/profile/${p.id}`)}</loc></url>`),
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
