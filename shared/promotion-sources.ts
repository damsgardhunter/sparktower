/**
 * Reading a company's own public pages for its promotion: the logo its site
 * declares, the YouTube channel its site links, and a recent video from that
 * channel's public feed. Pure parsing — server/promotion-sync.ts does the
 * fetching — so what gets picked is tested without the network.
 */

/** Image types a logo may be. SVG is left out: served from our origin, it could carry script. */
export const LOGO_CONTENT_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/x-icon", "image/vnd.microsoft.icon"];
export const LOGO_MAX_BYTES = 512 * 1024;

const attr = (tag: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag)?.slice(2).find((v) => v != null) ?? null;
const absolute = (href: string, base: string) => { try { return new URL(href.replace(/&amp;/g, "&"), base).toString(); } catch { return null; } };

/**
 * The logo candidates a homepage declares, best first: the largest
 * apple-touch-icon, then the largest raster icon, then /favicon.ico. SVGs are skipped.
 */
export function findLogoCandidates(html: string, pageUrl: string): string[] {
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
  const scored: { url: string; score: number }[] = [];
  for (const tag of links) {
    const rel = (attr(tag, "rel") ?? "").toLowerCase();
    const href = attr(tag, "href");
    if (!href || !/\b(apple-touch-icon(-precomposed)?|icon)\b/.test(rel)) continue;
    const url = absolute(href, pageUrl);
    if (!url || !/^https:/.test(url)) continue;
    const type = (attr(tag, "type") ?? "").toLowerCase();
    if (type.includes("svg") || /\.svg(\?|#|$)/i.test(url)) continue;
    const size = Math.max(0, ...((attr(tag, "sizes") ?? "").match(/\d+/g) ?? []).map(Number));
    const apple = rel.includes("apple-touch-icon");
    // A touch icon is made to be shown as a tile; without a size it's usually 180px.
    scored.push({ url, score: (apple ? 1000 : 0) + (size || (apple ? 180 : 32)) });
  }
  const ordered = [...new Map(scored.sort((a, b) => b.score - a.score).map((s) => [s.url, s])).keys()];
  const fallback = absolute("/favicon.ico", pageUrl);
  if (fallback && !ordered.includes(fallback)) ordered.push(fallback);
  return ordered;
}

/** YouTube channel links on a page: handles, channel ids, and the older /c/ and /user/ forms. */
export function findYouTubeChannelLinks(html: string): string[] {
  const found = [...html.matchAll(/https?:\/\/(?:www\.|m\.)?youtube\.com\/(@[A-Za-z0-9_.-]{2,100}|channel\/UC[A-Za-z0-9_-]{22}|c\/[A-Za-z0-9_.-]{1,100}|user\/[A-Za-z0-9_.-]{1,100})/g)]
    .map((m) => `https://www.youtube.com/${m[1]}`);
  // Channel ids first: nothing to resolve.
  return [...new Set(found)].sort((a, b) => Number(b.includes("/channel/")) - Number(a.includes("/channel/")));
}

/** The channel id in a youtube.com/channel/… link, or in a channel page's HTML. */
export function channelIdFrom(urlOrHtml: string): string | null {
  return /youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})/.exec(urlOrHtml)?.[1]
    ?? /"(?:externalId|channelId)"\s*:\s*"(UC[A-Za-z0-9_-]{22})"/.exec(urlOrHtml)?.[1]
    ?? null;
}

/**
 * Handles a company's channel is likely to have, for a site that doesn't link
 * one: its name squashed, its domain's name, and that with "hq", "app" or "dev".
 * A guess is only used once `channelVouchesFor` confirms it (see below).
 */
export function guessYouTubeHandles(company: { name: string; url: string }): string[] {
  const host = (() => { try { return new URL(company.url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
  const root = host.split(".").slice(-2, -1)[0] ?? "";
  const squashed = company.name.toLowerCase().replace(/\bby\b.*$/, "").replace(/[^a-z0-9]/g, "");
  return [...new Set([squashed, root, `${root}hq`, `${root}app`, `${root}dev`].filter((h) => h.length >= 2))]
    .map((h) => `https://www.youtube.com/@${h}`);
}

/** The site's host, as a channel page would mention it ("posthog.com"). */
export const siteHost = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };

/**
 * Whether a guessed channel is really the company's: its page links the
 * company's own domain, more than in passing. A look-alike channel doesn't
 * (@notionhq mentions notion.com 0 times; @notion, 13).
 */
export function channelVouchesFor(channelHtml: string, companyUrl: string): boolean {
  const host = siteHost(companyUrl);
  if (!host) return false;
  return channelHtml.split(host).length - 1 >= 2;
}

export interface ChannelVideo { videoId: string; title: string; publishedAt: string; short?: boolean }

/** The entries of a channel's public feed (youtube.com/feeds/videos.xml?channel_id=…), newest first as YouTube lists them. */
export function parseYouTubeFeed(xml: string): ChannelVideo[] {
  const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].flatMap((m) => {
    const videoId = /<yt:videoId>([A-Za-z0-9_-]{11})<\/yt:videoId>/.exec(m[1])?.[1];
    const title = /<title>([\s\S]*?)<\/title>/.exec(m[1])?.[1];
    const publishedAt = /<published>([^<]+)<\/published>/.exec(m[1])?.[1];
    // A Short's alternate link is youtube.com/shorts/…: the one reliable way to tell.
    const short = /<link[^>]+href="https:\/\/www\.youtube\.com\/shorts\//.test(m[1]);
    return videoId && title && publishedAt ? [{ videoId, title: decode(title.trim()), publishedAt, ...(short ? { short } : {}) }] : [];
  });
}

const LAUNCH_WORDS = /\b(introduc|launch|announc|new|meet|releas|unveil|now available|what's new|demo|v\d)/i;
const SHORT = /#shorts?\b/i;
/** Talk formats rather than product news: tried after everything else. */
const TALK = /\b(podcast|ama\b|office hours|live ?stream|webinar|interview|conversation|community call|episode|ep\.? ?\d)/i;

/**
 * Which videos to try, best first: recent ones about something new
 * ("Introducing…", "Launch…", "What's new"), then the rest newest first.
 * Podcasts, AMAs and streams come last. Shorts are left out, and so is
 * anything over a year old.
 */
export function rankChannelVideos(videos: ChannelVideo[], now = new Date()): ChannelVideo[] {
  const yearAgo = now.getTime() - 365 * 86_400_000;
  const usable = videos.filter((v) => !v.short && !SHORT.test(v.title) && Date.parse(v.publishedAt) >= yearAgo)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const talks = usable.filter((v) => TALK.test(v.title));
  const product = usable.filter((v) => !talks.includes(v));
  const recentLaunches = product.slice(0, 8).filter((v) => LAUNCH_WORDS.test(v.title));
  return [...recentLaunches, ...product.filter((v) => !recentLaunches.includes(v)), ...talks];
}

/** Whether an address is one a server must never be made to fetch: loopback, private, link-local, unspecified. */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) {
    const [a, b] = v4.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe8") || v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb");
}
