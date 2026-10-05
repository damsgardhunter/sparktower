/**
 * The layer that turns a generated clip into an advertisement.
 *
 * The first real clip off the model was a slow push into an empty desk in a
 * white room — which is exactly what it was asked for, a background plate with
 * no product, no text and no people. That clip is the *input*. Everything that
 * makes it an advert is here: which story is being told, and whose branding is
 * on it.
 *
 * Three things are held below, and the third is the one that protects somebody
 * other than the user.
 */
import { describe, it, expect } from "vitest";
import { AD_DURATIONS, beatPlan } from "@shared/ads";
import { AD_STYLES, AD_STYLE_IDS, adStyle, availableStyles, styleRequirements } from "@shared/ad-styles";
import {
  BRAND_FALLBACK, BRAND_FONTS, BRAND_VOICES, BRAND_VOICE_IDS, BRAND_LIMITS,
  brandCompleteness, brandFont, isHexColor, resolvedBrand, validateBrandKit,
} from "@shared/ad-brand";

describe("the styles of story", () => {
  it("offers more than one shape, because one shape is a template", () => {
    expect(AD_STYLES.length).toBeGreaterThanOrEqual(5);
    expect(new Set(AD_STYLE_IDS).size, "ids must be unique").toBe(AD_STYLE_IDS.length);
  });

  it("says what each is for in the words a business owner would use", () => {
    for (const s of AD_STYLES) {
      expect(s.bestFor.length, s.id).toBeGreaterThan(30);
      expect(s.blurb.length, s.id).toBeGreaterThan(10);
    }
  });

  it("directs the plate without ever asking the model for the product", () => {
    /*
     * The rule the whole feature rests on. The model is asked for setting and
     * camera; the product is composited from the business's own photographs.
     * A plate direction that mentions a logo or on-screen text is the model
     * being asked to draw the thing it gets wrong.
     */
    for (const s of AD_STYLES) {
      expect(s.plate.length, s.id).toBeGreaterThan(40);
      expect(s.plate, `${s.id} must not ask the model for text`).not.toMatch(/\btext\b|\bwords?\b|\blogo\b|\bprice\b/i);
    }
  });

  it("names a failure mode per style, because they differ", () => {
    /* A testimonial invents a customer; a transformation implies a result. One
     * generic warning would cover neither. */
    for (const s of AD_STYLES) expect(s.avoid.length, s.id).toBeGreaterThan(40);
  });

  it("answers for an unknown style rather than throwing mid-render", () => {
    expect(adStyle("whatever")).toBeNull();
    expect(adStyle(null)).toBeNull();
    expect(adStyle("problem_solution")?.label).toBe("Problem and solution");
  });
});

describe("a style changes the film without changing the sequence", () => {
  it("still fills the runtime exactly, whichever style", () => {
    for (const s of AD_STYLES) {
      for (const d of AD_DURATIONS) {
        const plan = beatPlan(d, s.beatWeights);
        expect(plan.reduce((sum, b) => sum + b.seconds, 0), `${s.id} at ${d}s`).toBe(d);
      }
    }
  });

  it("spends a founder's story on the problem and a demonstration on the product", () => {
    const at = (styleId: string, beat: string) => {
      const s = adStyle(styleId)!;
      return beatPlan(30, s.beatWeights).find((b) => b.id === beat)?.seconds ?? 0;
    };
    expect(at("founder_story", "problem")).toBeGreaterThan(at("demonstration", "problem"));
    expect(at("demonstration", "product")).toBeGreaterThan(at("founder_story", "product"));
  });

  it("drops a beat a style has no use for", () => {
    /* Nobody opening a parcel needs telling they had a problem. */
    const unboxing = adStyle("unboxing")!;
    expect(beatPlan(30, unboxing.beatWeights).map((b) => b.id)).not.toContain("problem");
  });

  it("still leads with the hook and ends on the ask, in every style", () => {
    for (const s of AD_STYLES) {
      for (const d of AD_DURATIONS) {
        const ids = beatPlan(d, s.beatWeights).map((b) => b.id);
        expect(ids[0], `${s.id} at ${d}s`).toBe("hook");
        expect(ids[ids.length - 1], `${s.id} at ${d}s`).toBe("cta");
      }
    }
  });
});

/**
 * The part that protects somebody who is not the user.
 *
 * Three styles make a claim about a third party — a customer who said
 * something, a result somebody got, a parcel that arrived. An advert that
 * invents any of those is not a worse advert; it is a false statement about
 * someone else, and in the case of a testimonial an illegal one.
 */
describe("a style can be unavailable, with a reason", () => {
  it("withholds the ones that would have to invent something", () => {
    const withNothing = availableStyles({}).map((s) => s.id);
    expect(withNothing).not.toContain("social_proof");
    expect(withNothing).not.toContain("before_after");
    expect(withNothing).not.toContain("unboxing");
  });

  it("always leaves one that needs nothing but the brief", () => {
    /* Otherwise a business with no photographs has no advert at all. */
    expect(availableStyles({}).length).toBeGreaterThanOrEqual(1);
    expect(availableStyles({}).map((s) => s.id)).toContain("problem_solution");
  });

  it("unlocks each one on the thing it actually needs", () => {
    expect(availableStyles({ quotes: true }).map((s) => s.id)).toContain("social_proof");
    expect(availableStyles({ packagingPhotos: true }).map((s) => s.id)).toContain("unboxing");
    expect(availableStyles({ productPhotos: true }).map((s) => s.id)).toContain("demonstration");
    /* And not the others, on the same evidence. */
    expect(availableStyles({ quotes: true }).map((s) => s.id)).not.toContain("unboxing");
  });

  it("says what is missing rather than just refusing", () => {
    for (const id of ["social_proof", "before_after", "unboxing", "founder_story", "demonstration"]) {
      expect(styleRequirements(id).length, id).toBeGreaterThan(0);
    }
    expect(styleRequirements("social_proof").join(" ")).toMatch(/permission/i);
    /* A transformation has to say whether the result is typical. */
    expect(styleRequirements("before_after").join(" ")).toMatch(/typical/i);
  });
});

describe("the brand kit", () => {
  it("takes a colour only in the one form that can be drawn", () => {
    for (const good of ["#112233", "#AABBCC", "#aabbcc"]) expect(isHexColor(good), good).toBe(true);
    /* Three-digit hex is rejected rather than expanded: a half-typed colour is
     * a mistake, not a shorthand, and guessing produces a brand nobody chose. */
    for (const bad of ["#123", "123456", "red", "rgb(1,2,3)", "", null, "#12345G"]) {
      expect(isHexColor(bad), String(bad)).toBe(false);
    }
  });

  it("refuses a present-but-wrong value, naming the field", () => {
    const bad = validateBrandKit({ primaryColor: "reddish" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.field).toBe("primaryColor");
      expect(bad.message).toMatch(/hex/i);
    }
  });

  it("accepts a half-filled kit, because it is filled in over time", () => {
    /* Refusing a save until the logo exists means nobody gets as far as the logo. */
    const partial = validateBrandKit({ displayName: "Acme Sauces" });
    expect(partial.ok).toBe(true);
    if (partial.ok) expect(partial.value.displayName).toBe("Acme Sauces");
  });

  it("normalises a colour so two spellings are one brand", () => {
    const ok = validateBrandKit({ primaryColor: " #aabbcc " });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.primaryColor).toBe("#AABBCC");
  });

  it("takes only a voice and a font it can actually use", () => {
    expect(validateBrandKit({ voice: "sarcastic" }).ok).toBe(false);
    expect(validateBrandKit({ voice: "warm" }).ok).toBe(true);
    /*
     * A font has to exist on the machine doing the compositing. Offering a
     * name we cannot load produces an advert silently set in something else.
     */
    expect(validateBrandKit({ fontFamily: "Helvetica" }).ok).toBe(false);
    expect(validateBrandKit({ fontFamily: BRAND_FONTS[0].id }).ok).toBe(true);
  });

  it("insists the website is https, since the link is the last thing on screen", () => {
    expect(validateBrandKit({ websiteUrl: "http://acme.test" }).ok).toBe(false);
    expect(validateBrandKit({ websiteUrl: "acme.test" }).ok).toBe(false);
    expect(validateBrandKit({ websiteUrl: "https://acme.test" }).ok).toBe(true);
  });

  it("will not take a logo from a URL somebody chose", () => {
    /*
     * Accepting a URL means our renderer making a request to an address a user
     * supplied. The logo is uploaded and referenced by its object path.
     */
    const bad = validateBrandKit({ logoPath: "https://evil.test/logo.png" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toMatch(/upload/i);
    expect(validateBrandKit({ logoPath: "/objects/uploads/logo.png" }).ok).toBe(true);
  });

  it("de-duplicates and caps the words a business will not say", () => {
    const many = Array.from({ length: BRAND_LIMITS.avoidWords + 10 }, (_, i) => `word${i}`);
    const res = validateBrandKit({ avoidWords: [...many, "word0", "word0"] });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.avoidWords!.length).toBeLessThanOrEqual(BRAND_LIMITS.avoidWords);
      expect(new Set(res.value.avoidWords).size).toBe(res.value.avoidWords!.length);
    }
  });

  it("refuses a list that is not a list", () => {
    expect(validateBrandKit({ avoidWords: "profanity" }).ok).toBe(false);
  });
});

describe("what a render gets when the business set nothing", () => {
  it("fills every gap, so a renderer never reads a null colour", () => {
    const brand = resolvedBrand(null);
    expect(isHexColor(brand.primaryColor)).toBe(true);
    expect(isHexColor(brand.backgroundColor)).toBe(true);
    expect(brand.font.file).toMatch(/\.ttf$/);
    expect(BRAND_VOICE_IDS).toContain(brand.voice);
  });

  it("falls back to plain rather than inventing a brand", () => {
    /* A guessed palette is a brand the business did not choose, on their advert. */
    expect(resolvedBrand(null).primaryColor).toBe(BRAND_FALLBACK.primaryColor);
    expect(resolvedBrand(null).voice).toBe("plain");
    expect(resolvedBrand(null).logoPath).toBeNull();
  });

  it("prefers what the business set, where they set it", () => {
    const brand = resolvedBrand({ primaryColor: "#FF0000", voice: "bold" });
    expect(brand.primaryColor).toBe("#FF0000");
    expect(brand.voice).toBe("bold");
    /* And still fills what they did not. */
    expect(brand.backgroundColor).toBe(BRAND_FALLBACK.backgroundColor);
  });

  it("gives an unknown font the default rather than failing to render", () => {
    expect(brandFont("comic-sans").file).toBe(BRAND_FONTS[0].file);
    expect(brandFont(null).file).toBe(BRAND_FONTS[0].file);
  });
});

describe("how complete the branding is", () => {
  it("counts what is done and names what is not", () => {
    const empty = brandCompleteness(null);
    expect(empty.done).toBe(0);
    expect(empty.missing.length).toBe(empty.of);
    /* Named in plain words, because this is shown to the person filling it in. */
    expect(empty.missing.join(" ")).toMatch(/logo/);
  });

  it("is shown rather than enforced", () => {
    /*
     * An advert can be made with nothing but a name, and it will be a worse
     * advert. Saying which parts are doing the work is more use than refusing.
     */
    const some = brandCompleteness({ displayName: "Acme", primaryColor: "#112233" });
    expect(some.done).toBe(2);
    expect(some.missing).not.toContain("a name to put on screen");
  });

  it("is complete when every piece is there", () => {
    const full = brandCompleteness({
      displayName: "Acme", logoPath: "/objects/a.png", primaryColor: "#112233",
      callToAction: "Order at acme.test", voice: "warm",
    });
    expect(full.done).toBe(full.of);
    expect(full.missing).toEqual([]);
  });
});

describe("the voices", () => {
  it("each say how to write, not just what they are called", () => {
    /* "Tone: warm" tells a model nothing. These are instructions. */
    for (const v of BRAND_VOICES) expect(v.how.length, v.id).toBeGreaterThan(30);
  });
});
