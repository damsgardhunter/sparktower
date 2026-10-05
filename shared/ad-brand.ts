/**
 * A business's branding, as an advert applies it.
 *
 * Not to be confused with `shared/brand-kit.ts`, which generates a *placeholder
 * logo and cover* for a project page. That file makes a picture once; this one
 * holds the handful of values every advert is typeset from, and the logo it
 * composites is usually the one that file drew.
 *
 * Every value here is applied **in code** when an advert is rendered — the
 * colours are drawn, the logo is composited, the words are typeset. None of it
 * is described to the video model. A model asked to put a logo in a frame
 * draws something that resembles a logo, which is worse than no logo at all
 * because it is a company's mark, wrong, in their own advertisement.
 */
import { contrastRatio } from "./ad-type";

/** The voices an advert can be written in. A list, because "describe your tone" produces a paragraph nobody can act on. */
export const BRAND_VOICES = [
  { id: "plain", label: "Plain", how: "Short sentences, no adjectives that could be removed. Says what the thing is." },
  { id: "warm", label: "Warm", how: "Speaks to one person. Contractions, second person, a little generosity." },
  { id: "bold", label: "Bold", how: "Declarative and confident. Short lines, strong verbs, no hedging — and no shouting." },
  { id: "expert", label: "Expert", how: "Precise and unhurried. Names specifics, trusts the reader to follow." },
  { id: "playful", label: "Playful", how: "Light, a little surprising. Never at the customer's expense and never at the product's." },
] as const;
export type BrandVoiceId = (typeof BRAND_VOICES)[number]["id"];
export const BRAND_VOICE_IDS = BRAND_VOICES.map((v) => v.id) as BrandVoiceId[];
export const brandVoice = (id: string | null | undefined) => BRAND_VOICES.find((v) => v.id === id) ?? null;

/**
 * The fonts that can actually be rendered.
 *
 * A list rather than a free field because a font has to exist on the machine
 * doing the compositing. Offering a name we cannot load produces an advert
 * silently typeset in something else, which is exactly the kind of wrong a
 * business notices and cannot explain.
 */
export const BRAND_FONTS = [
  { id: "grotesk", label: "Space Grotesk", file: "SpaceGrotesk-Bold.ttf", regular: "SpaceGrotesk-Regular.ttf" },
] as const;
export type BrandFontId = (typeof BRAND_FONTS)[number]["id"];
export const DEFAULT_FONT: BrandFontId = "grotesk";
export const brandFont = (id: string | null | undefined) =>
  BRAND_FONTS.find((f) => f.id === id) ?? BRAND_FONTS.find((f) => f.id === DEFAULT_FONT)!;

/** `#RRGGBB`, uppercase or lower, nothing else. Three-digit hex is rejected rather than expanded: a half-typed colour is a mistake, not a shorthand. */
export const isHexColor = (v: unknown): v is string =>
  typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v.trim());

/** What an advert uses when the business has set nothing. Deliberately plain, never a guess at their brand. */
export const BRAND_FALLBACK = {
  primaryColor: "#111111",
  backgroundColor: "#FFFFFF",
  accentColor: "#111111",
  voice: "plain" as BrandVoiceId,
  fontFamily: DEFAULT_FONT,
} as const;

export const BRAND_LIMITS = {
  displayName: 60,
  tagline: 90,
  callToAction: 40,
  /** Each word or phrase they will not say. */
  avoidWord: 40,
  avoidWords: 25,
} as const;

export interface BrandKitInput {
  primaryColor?: string | null;
  backgroundColor?: string | null;
  accentColor?: string | null;
  logoPath?: string | null;
  fontFamily?: string | null;
  displayName?: string | null;
  tagline?: string | null;
  voice?: string | null;
  avoidWords?: string[] | null;
  callToAction?: string | null;
  websiteUrl?: string | null;
}

export type BrandKitValidation =
  | { ok: true; value: BrandKitInput }
  | { ok: false; field: string; message: string };

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
};

/**
 * Checked field by field, with the field named.
 *
 * Partial on purpose: a business fills this in over time, and refusing a save
 * because the logo is missing would mean nobody ever gets as far as the logo.
 * What is rejected is a value that is *present and wrong* — a colour that is
 * not a colour will be drawn as black and look like a bug.
 */
export function validateBrandKit(raw: Record<string, unknown>): BrandKitValidation {
  const value: BrandKitInput = {};

  for (const key of ["primaryColor", "backgroundColor", "accentColor"] as const) {
    if (raw[key] === undefined || raw[key] === null || raw[key] === "") continue;
    if (!isHexColor(raw[key])) {
      return { ok: false, field: key, message: "A colour is six hex digits after a hash, like #1A2B3C." };
    }
    value[key] = String(raw[key]).trim().toUpperCase();
  }

  if (raw.voice !== undefined && raw.voice !== null && raw.voice !== "") {
    if (!BRAND_VOICE_IDS.includes(raw.voice as BrandVoiceId)) {
      return { ok: false, field: "voice", message: `Pick a voice: ${BRAND_VOICE_IDS.join(", ")}.` };
    }
    value.voice = raw.voice as string;
  }

  if (raw.fontFamily !== undefined && raw.fontFamily !== null && raw.fontFamily !== "") {
    if (!BRAND_FONTS.some((f) => f.id === raw.fontFamily)) {
      return { ok: false, field: "fontFamily", message: `Pick a font we can render: ${BRAND_FONTS.map((f) => f.id).join(", ")}.` };
    }
    value.fontFamily = raw.fontFamily as string;
  }

  value.displayName = text(raw.displayName, BRAND_LIMITS.displayName);
  value.tagline = text(raw.tagline, BRAND_LIMITS.tagline);
  value.callToAction = text(raw.callToAction, BRAND_LIMITS.callToAction);

  if (raw.websiteUrl !== undefined && raw.websiteUrl !== null && raw.websiteUrl !== "") {
    const url = String(raw.websiteUrl).trim();
    /*
     * https only. The call to action is rendered on screen and read aloud by
     * nobody; an http link in an advert is a link somebody's browser warns
     * them about, which is a strange note to end on.
     */
    if (!/^https:\/\/[^\s]+\.[^\s]+$/.test(url)) {
      return { ok: false, field: "websiteUrl", message: "Use the full address, starting with https://." };
    }
    value.websiteUrl = url;
  }

  if (raw.avoidWords !== undefined && raw.avoidWords !== null) {
    if (!Array.isArray(raw.avoidWords)) {
      return { ok: false, field: "avoidWords", message: "Words to avoid are a list." };
    }
    const words = raw.avoidWords
      .map((w) => text(w, BRAND_LIMITS.avoidWord))
      .filter((w): w is string => !!w)
      .slice(0, BRAND_LIMITS.avoidWords);
    value.avoidWords = [...new Set(words)];
  }

  if (raw.logoPath !== undefined) {
    const path = text(raw.logoPath, 500);
    /*
     * An object-storage path, not a URL. Accepting a URL here would mean the
     * renderer fetching from wherever somebody pointed it, which is a request
     * made by our server to an address a user chose.
     */
    if (path && !path.startsWith("/objects/")) {
      return { ok: false, field: "logoPath", message: "Upload the logo rather than linking to one." };
    }
    value.logoPath = path;
  }

  return { ok: true, value };
}

export interface BrandWarning {
  field: string;
  message: string;
}

/**
 * What will look wrong, without refusing the save.
 *
 * Deliberately not part of `validateBrandKit`. These are the business's own
 * colours and they are entitled to them; a save refused over a contrast ratio
 * is a form that will not let somebody enter their actual brand. But drawn
 * without a word said, a bar in a colour three shades from its background is
 * read as the renderer having failed.
 *
 * Narrow on purpose. It says nothing about on-screen text, because text is not
 * drawn flat — `typeTreatment` gives it an outline and a halo chosen from this
 * same contrast ratio, so a warning about unreadable lettering would be a
 * warning about something already handled. What has no such rescue is the flat
 * shapes: the progress sweep, a bar, an underline, the accent on a card. Those
 * are the colour against the background and nothing else.
 */
export function brandWarnings(kit: BrandKitInput | null | undefined): BrandWarning[] {
  if (!kit) return [];
  const out: BrandWarning[] = [];
  const background = kit.backgroundColor;
  if (!background) return out;

  /*
   * Three to one. Large flat areas are judged by the large-text threshold
   * rather than 4.5, which is a rule about body copy at reading size and would
   * flag perfectly legible brand colours.
   */
  const FLAT_FLOOR = 3;
  for (const field of ["primaryColor", "accentColor"] as const) {
    const colour = kit[field];
    if (!colour) continue;
    if (contrastRatio(colour, background) < FLAT_FLOOR) {
      out.push({
        field,
        message: `${colour} is too close to ${background} to show up against it. A bar or an underline in it will look like nothing was drawn.`,
      });
    }
  }

  /* An accent that matches the primary is not an accent; it is the primary twice. */
  if (kit.accentColor && kit.primaryColor && kit.accentColor.toUpperCase() === kit.primaryColor.toUpperCase()) {
    out.push({
      field: "accentColor",
      message: "The accent is the same colour as the primary, so nothing on screen will stand out from anything else.",
    });
  }

  return out;
}

/** The kit with every gap filled, which is what a renderer wants. */
export function resolvedBrand(kit: BrandKitInput | null | undefined) {
  return {
    primaryColor: kit?.primaryColor ?? BRAND_FALLBACK.primaryColor,
    backgroundColor: kit?.backgroundColor ?? BRAND_FALLBACK.backgroundColor,
    accentColor: kit?.accentColor ?? BRAND_FALLBACK.accentColor,
    voice: (kit?.voice as BrandVoiceId | undefined) ?? BRAND_FALLBACK.voice,
    font: brandFont(kit?.fontFamily),
    logoPath: kit?.logoPath ?? null,
    displayName: kit?.displayName ?? null,
    tagline: kit?.tagline ?? null,
    callToAction: kit?.callToAction ?? null,
    websiteUrl: kit?.websiteUrl ?? null,
    avoidWords: kit?.avoidWords ?? [],
  };
}

/**
 * How complete it is, and what is missing.
 *
 * Shown rather than enforced. An advert can be made with nothing but a
 * display name, and it will be a worse advert — so the thing to do is say
 * which parts are doing the work, not refuse to proceed.
 */
export function brandCompleteness(kit: BrandKitInput | null | undefined): { done: number; of: number; missing: string[] } {
  const checks: [string, boolean][] = [
    ["a name to put on screen", !!kit?.displayName],
    ["a logo", !!kit?.logoPath],
    ["a main colour", !!kit?.primaryColor],
    ["a call to action", !!kit?.callToAction],
    ["a voice", !!kit?.voice],
  ];
  return {
    done: checks.filter(([, ok]) => ok).length,
    of: checks.length,
    missing: checks.filter(([, ok]) => !ok).map(([what]) => what),
  };
}
