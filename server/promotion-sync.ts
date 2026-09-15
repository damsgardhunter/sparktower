/**
 * Keeps each promotion's logo and video current from the company's own public
 * pages — no API keys, nothing for the company to set up:
 *
 *   their homepage → the logo it declares (stored here, served from our origin)
 *                  → the YouTube channel it links (or the one an admin gave)
 *   the channel's public feed → a recent video about something new that
 *                               YouTube allows to be embedded
 *
 * Runs a few minutes after boot and then daily, and on demand from
 * /admin/promotions. Every fetch goes through `guardedFetch`: https only, no
 * private or internal addresses (checked again after every redirect), a
 * timeout, and a size cap — these URLs come from other people's HTML.
 */
import { lookup } from "dns/promises";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { promotionSettings, promotionSources } from "@shared/schema";
import { PROMOTION_CATALOG } from "@shared/promotions";
import {
  LOGO_CONTENT_TYPES, LOGO_MAX_BYTES, channelIdFrom, channelVouchesFor, findLogoCandidates, findYouTubeChannelLinks, guessYouTubeHandles,
  isPrivateAddress, parseYouTubeFeed, rankChannelVideos,
} from "@shared/promotion-sources";

const USER_AGENT = "Mozilla/5.0 (compatible; SparkTowerBot/1.0; +https://sparktower.app)";
const TIMEOUT_MS = 12_000;

export interface Fetched { ok: boolean; status: number; url: string; contentType: string; body: Buffer }
export type Fetcher = (url: string, opts?: { maxBytes?: number }) => Promise<Fetched>;

/** A fetch that can't be pointed at our own network, can't hang, and can't be made to download something huge. */
export const guardedFetch: Fetcher = async (start, { maxBytes = 3 * 1024 * 1024 } = {}) => {
  let url = start;
  for (let hop = 0; hop <= 4; hop++) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") throw new Error(`not https: ${url}`);
    const addresses = await lookup(parsed.hostname, { all: true });
    if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) throw new Error(`refused address for ${parsed.hostname}`);
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "user-agent": USER_AGENT, "accept-language": "en" } });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url).toString();
      continue;
    }
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > maxBytes) throw new Error(`too large: ${url}`);
    const reader = res.body?.getReader();
    const chunks: Buffer[] = [];
    let size = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) { await reader.cancel(); throw new Error(`too large: ${url}`); }
      chunks.push(Buffer.from(value));
    }
    return { ok: res.ok, status: res.status, url, contentType: (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase(), body: Buffer.concat(chunks) };
  }
  throw new Error(`too many redirects: ${start}`);
};

/** Reads a logo's type from its bytes, not the server's say-so. */
function sniffImage(body: Buffer): string | null {
  if (body.length < 8) return null;
  if (body[0] === 0x89 && body.toString("ascii", 1, 4) === "PNG") return "image/png";
  if (body[0] === 0xff && body[1] === 0xd8) return "image/jpeg";
  if (body.toString("ascii", 0, 4) === "RIFF" && body.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (body.toString("ascii", 0, 3) === "GIF") return "image/gif";
  if (body[0] === 0 && body[1] === 0 && body[2] === 1 && body[3] === 0) return "image/x-icon";
  return null;
}

export interface SyncResult { promotionId: string; logo: boolean; videoId: string | null; error: string | null }

/** One company: its logo and a video, stored. Never throws; what went wrong is kept on the row. */
export async function syncPromotion(promotionId: string, fetcher: Fetcher = guardedFetch): Promise<SyncResult> {
  const company = PROMOTION_CATALOG.find((c) => c.id === promotionId);
  if (!company) return { promotionId, logo: false, videoId: null, error: "not in the catalog" };
  const [settings] = await db.select({ channel: promotionSettings.youtubeChannelUrl }).from(promotionSettings).where(eq(promotionSettings.promotionId, promotionId));
  // A page on someone else's platform: its logo and channel aren't the company's. Only an admin's channel is used.
  if (company.readSite === false && !settings?.channel) {
    const cleared = { logoData: null, logoContentType: null, logoSourceUrl: null, youtubeChannelId: null, videoId: null, videoTitle: null, videoPublishedAt: null, fetchedAt: new Date(), error: "not read from its site (a shared platform page) — set its logo and YouTube channel here" };
    await db.insert(promotionSources).values({ promotionId, ...cleared }).onConflictDoUpdate({ target: promotionSources.promotionId, set: cleared });
    return { promotionId, logo: false, videoId: null, error: cleared.error };
  }
  const problems: string[] = [];
  let homepage = "";
  try {
    if (company.readSite === false) throw new Error("not read (shared platform page)");
    const page = await fetcher(company.url);
    if (page.ok) homepage = page.body.toString("utf8");
    else problems.push(`homepage ${page.status}`);
  } catch (e) { problems.push(`homepage: ${(e as Error).message}`); }

  // The logo: the first candidate that really is a raster image of a sensible size.
  let logo: { data: string; type: string; source: string } | null = null;
  for (const candidate of homepage ? findLogoCandidates(homepage, company.url).slice(0, 5) : []) {
    try {
      const img = await fetcher(candidate, { maxBytes: LOGO_MAX_BYTES });
      const type = img.ok ? sniffImage(img.body) : null;
      if (type && LOGO_CONTENT_TYPES.includes(type) && img.body.length > 200) { logo = { data: img.body.toString("base64"), type, source: img.url }; break; }
    } catch { /* next candidate */ }
  }
  if (!logo && homepage) problems.push("no usable logo");

  // The video: the admin's channel if one is set, else the one the site links,
  // else a likely handle — used only if that channel's page links the company's domain.
  const linked = settings?.channel ? [settings.channel] : findYouTubeChannelLinks(homepage);
  const channels = linked.length ? linked.slice(0, 3).map((url) => ({ url, guessed: false }))
    : company.readSite === false ? [] : guessYouTubeHandles(company).slice(0, 4).map((url) => ({ url, guessed: true }));
  let channelId: string | null = null;
  let video: { videoId: string; title: string; publishedAt: string } | null = null;
  for (const { url: channel, guessed } of channels) {
    try {
      channelId = guessed ? null : channelIdFrom(channel);
      if (!channelId) {
        const page = await fetcher(channel);
        const html = page.ok ? page.body.toString("utf8") : "";
        channelId = html && (!guessed || channelVouchesFor(html, company.url)) ? channelIdFrom(html) : null;
      }
      if (!channelId) continue;
      const feed = await fetcher(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
      if (!feed.ok) continue;
      for (const v of rankChannelVideos(parseYouTubeFeed(feed.body.toString("utf8"))).slice(0, 6)) {
        // YouTube's oEmbed answers only for videos their owner lets other sites embed.
        const embed = await fetcher(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${v.videoId}`)}`, { maxBytes: 64 * 1024 }).catch(() => null);
        if (embed?.ok) { video = v; break; }
      }
      if (video) break;
    } catch (e) { problems.push(`youtube: ${(e as Error).message}`); }
  }
  if (!video) problems.push(linked.length ? "no recent embeddable video" : "no YouTube channel linked or confirmed");

  const values = {
    ...(logo ? { logoData: logo.data, logoContentType: logo.type, logoSourceUrl: logo.source } : {}),
    ...(channelId ? { youtubeChannelId: channelId } : {}),
    ...(video ? { videoId: video.videoId, videoTitle: video.title.slice(0, 200), videoPublishedAt: new Date(video.publishedAt) } : {}),
    fetchedAt: new Date(),
    error: problems.length ? problems.join("; ").slice(0, 500) : null,
  };
  await db.insert(promotionSources).values({ promotionId, ...values }).onConflictDoUpdate({ target: promotionSources.promotionId, set: values });
  return { promotionId, logo: !!logo, videoId: video?.videoId ?? null, error: values.error };
}

let running: Promise<SyncResult[]> | null = null;

/** Every company, a few at a time. One run at once; a second call joins it. */
export function syncAllPromotions(fetcher: Fetcher = guardedFetch, concurrency = 4): Promise<SyncResult[]> {
  if (running) return running;
  running = (async () => {
    const queue = PROMOTION_CATALOG.map((c) => c.id);
    const results: SyncResult[] = [];
    await Promise.all(Array.from({ length: concurrency }, async () => {
      for (let id = queue.shift(); id; id = queue.shift()) results.push(await syncPromotion(id, fetcher));
    }));
    console.log(`[promotions] synced ${results.length}: ${results.filter((r) => r.logo).length} logos, ${results.filter((r) => r.videoId).length} videos`);
    return results;
  })().finally(() => { running = null; });
  return running;
}

export function startPromotionJobs(): void {
  if (process.env.NODE_ENV === "test" || process.env.PROMOTION_SYNC === "off") return;
  setTimeout(() => void syncAllPromotions().catch((e) => console.error("[promotions] sync failed:", e)), 3 * 60_000).unref();
  setInterval(() => void syncAllPromotions().catch((e) => console.error("[promotions] sync failed:", e)), 24 * 60 * 60_000).unref();
}
