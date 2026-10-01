/**
 * Nova's kit, on the web and on the phone.
 *
 * `docs/mobile-parity.md` carried this as an open question: "`Pill` and `Block`
 * exist under those names in the phone's own kit — which is not the same thing
 * as agreeing with the web's, and nobody has checked." This is the check, and it
 * stays checked.
 *
 * It compares the *exports* rather than the rendering. A phone and a browser
 * draw a pill differently and should; what must not happen is a component
 * existing on one and not the other, or existing on both under one name while
 * being two different ideas — because then "the phone has a Pill" is true and
 * useless, and the drift is invisible until somebody holds the screens side by
 * side.
 *
 * Anything the web exports and the phone does not must be on the list below
 * with a reason, which is the same bargain `route-guards.test.ts` strikes for
 * surfaces that own no routes.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(import.meta.dirname, "../..", p), "utf8");

/** The value names an index re-exports, ignoring `type` exports. */
function exportsOf(source: string): string[] {
  const names: string[] = [];
  for (const m of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
      if (name && !part.trim().startsWith("type ")) names.push(name);
    }
  }
  return [...new Set(names)];
}

/**
 * What the web has and the phone does not, each with the reason and the work.
 *
 * Not a suppression list: every line here is a decision somebody can disagree
 * with, and removing a line is how the disagreement gets settled.
 */
const NOT_ON_THE_PHONE: Record<string, string> = {
  Pill: "the web's takes a tone of good/warn/bad/info/neutral/unknown; the phone has three components called Pill (MoreKit, FeaturedContest, profile/kit) and none has a tone system. Exporting one would be picking a winner by import order. Fix: one Pill with the web's tones, three call sites migrated.",
  PILL_TONE: "the tone table belongs with the Pill above.",
  Block: "the phone's Block in ProjectBits is a titled section with an action; the web's is a surface primitive. Same word, different component.",
  NOVA_GRADIENT: "a Tailwind class string, which means nothing on a phone. The phone's equivalent is colors.novaGreen/Emerald/Purple, held to the web's values by nova-gradient-parity.test.ts.",
  NOVA_GRADIENT_BR: "as above.",
  NOVA_TINT: "as above.",
  GLANCE_LABEL: "as above — the phone states the same 11px semibold uppercase in Glance's own stylesheet.",
  NovaInput: "the phone's Field is the whole input; the web splits the field from its control.",
  NovaTextarea: "as above.",
  NOVA_FIELD_CLASS: "a class string.",
};

describe("the Nova kit both platforms draw from", () => {
  const web = exportsOf(read("client/src/components/nova/index.ts"));
  const phone = exportsOf(read("mobile/src/components/nova/index.ts"));

  it("is being read off both sides", () => {
    expect(web.length, "the web's nova index changed shape").toBeGreaterThan(8);
    expect(phone.length, "the phone's nova index changed shape").toBeGreaterThan(3);
  });

  it("has a phone counterpart for everything the web exports, or a written reason", () => {
    const missing = web.filter((name) => !phone.includes(name) && !NOT_ON_THE_PHONE[name]);
    expect(missing, `on the web and not on the phone — build it, or give it a reason in NOT_ON_THE_PHONE:\n  ${missing.join("\n  ")}`).toEqual([]);
  });

  /*
   * A reason for something that has since been built is worse than no reason:
   * it says the phone is missing a component it now has, and the next person
   * believes it.
   */
  it("does not excuse anything the phone now has", () => {
    const stale = Object.keys(NOT_ON_THE_PHONE).filter((name) => phone.includes(name));
    expect(stale, `the phone has these now; delete their lines from NOT_ON_THE_PHONE:\n  ${stale.join("\n  ")}`).toEqual([]);
  });

  it("does not excuse anything the web no longer exports", () => {
    const gone = Object.keys(NOT_ON_THE_PHONE).filter((name) => !web.includes(name));
    expect(gone, `the web dropped these; delete their lines from NOT_ON_THE_PHONE:\n  ${gone.join("\n  ")}`).toEqual([]);
  });

  /*
   * The two this change was for. Named individually so a regression says which
   * one went, rather than only that the counts stopped matching.
   */
  it("has the live dot and the glance strip on the phone", () => {
    for (const name of ["LiveDot", "Glance", "GlanceStat", "GlanceAction"]) {
      expect(phone, `${name} should be in the phone's nova kit`).toContain(name);
    }
  });
});
