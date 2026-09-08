/**
 * Where someone came from, worked out once and kept.
 *
 * First touch, not last: the tagged link that first brought a person here is
 * the one that did the work, and by the time they sign up they've usually
 * navigated somewhere the tag is long gone. Reading the query string off the
 * signup request would attribute almost every account to "direct" and make the
 * whole exercise quietly useless.
 */

/**
 * Query parameters worth keeping.
 *
 * An allowlist rather than "store the whole query string", because URLs pick up
 * session tokens, password-reset codes and email addresses, and a table of
 * everything anyone was ever linked with is a liability nobody asked for.
 */
export const TRACKED_PARAMS = [
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
  // Short forms people actually use when sharing a link by hand.
  "ref", "via", "source", "campaign",
  // Ad-network click ids: they identify the click, not the person.
  "gclid", "fbclid", "twclid", "li_fat_id", "msclkid",
] as const;

/** Params that can stand in for utm_source, in the order they're preferred. */
const SOURCE_ALIASES = ["utm_source", "ref", "via", "source"] as const;

/** One value can't be longer than this. Tags are labels, not payloads. */
const MAX_VALUE = 120;

export interface Attribution {
  /** The tag, the referring site, or "direct". Never null once parsed. */
  source: string;
  /** How they arrived: the utm_medium, else "referral" or "direct". */
  medium: string;
  campaign: string | null;
  /** The external page that linked here. Null for direct arrivals. */
  referrer: string | null;
  /** The first page they landed on, query string and all. */
  landingPath: string | null;
  /** Every tracked parameter that was present. */
  params: Record<string, string>;
}

const clean = (v: string | null | undefined): string | null => {
  const s = (v ?? "").trim().slice(0, MAX_VALUE);
  return s || null;
};

/** "https://news.ycombinator.com/item?id=1" -> "news.ycombinator.com" */
export function referrerHost(referrer: string | null | undefined): string | null {
  if (!referrer) return null;
  try {
    return new URL(referrer).host.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/**
 * Works out attribution from the landing URL and the referrer that brought
 * them to it.
 *
 * `referrer` must already have been checked for pointing back at us — an
 * internal link is not a source. See isSelfReferrer in server/http-cookies.ts.
 */
export function parseAttribution(landingUrl: string, referrer: string | null): Attribution {
  const params: Record<string, string> = {};
  try {
    // A relative path needs a base to parse against; the base is discarded.
    const url = new URL(landingUrl, "http://localhost");
    for (const key of TRACKED_PARAMS) {
      const value = clean(url.searchParams.get(key));
      if (value) params[key] = value;
    }
  } catch {
    /* an unparseable URL just means no params */
  }

  const tagged = SOURCE_ALIASES.map((k) => params[k]).find(Boolean) ?? null;
  const host = referrerHost(referrer);

  /*
   * Every signup gets a source, including the ones nobody tagged. "direct" is a
   * real answer that groups and counts; null is a hole that has to be special
   * cased in every query that ever reads this.
   */
  const source = tagged ?? host ?? "direct";
  const medium = params.utm_medium ?? (tagged ? "campaign" : host ? "referral" : "direct");

  return {
    source,
    medium,
    campaign: params.utm_campaign ?? params.campaign ?? null,
    referrer: clean(referrer) ? referrer!.slice(0, 500) : null,
    landingPath: landingUrl.slice(0, 500) || null,
    params,
  };
}

/** How a source reads in a sentence. */
export const describeAttribution = (a: Pick<Attribution, "source" | "campaign">): string =>
  a.campaign ? `${a.source} · ${a.campaign}` : a.source;
