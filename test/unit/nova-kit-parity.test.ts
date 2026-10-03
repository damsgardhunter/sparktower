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
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { withoutComments } from "../helpers/source-parity";

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
  Block: "nothing on the phone is called Block any more. Four components shared the word; the phone's two are now ProjectSection in ProjectBits (a titled section with an action) and SectionBlock in manage/bits (a labelled block of a section screen, named after the web file it mirrors). The web keeps section/block, a surface primitive, and nova/block, a counted panel. Different components, so renamed rather than merged.",
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

/**
 * `Block`, which was five things and is now four, three of them unambiguous.
 *
 * Two exported components on the phone answered to the word, plus two on the
 * web and one module-private helper. The cost was not aesthetic: a diff saying
 * `<Block>` told a reader nothing about which component, and importing the
 * wrong one compiled. The phone's two are now `ProjectSection` and
 * `SectionBlock`.
 *
 * This holds the rename rather than the taste behind it. Somebody who wants
 * `Block` back can delete the test and say why; what they cannot do is
 * reintroduce the collision by accident.
 */
describe("nothing exported from the phone is called Block", () => {
  /** Every .ts/.tsx under mobile/, minus the dependency tree. */
  const phoneFiles = execFileSync("git", ["ls-files", "mobile"], {
    cwd: resolve(import.meta.dirname, "../.."),
    encoding: "utf8",
  })
    .split("\n")
    .filter((f) => /\.tsx?$/.test(f));

  it("finds files to check at all", () => {
    /* Without this the suite passes loudly when the glob breaks. */
    expect(phoneFiles.length).toBeGreaterThan(50);
  });

  it("exports no component named Block", () => {
    const offenders = phoneFiles.filter((f) => /export (?:function|const) Block\b/.test(read(f)));
    expect(offenders, `these export a component called Block again:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });

  it("renders no element named Block", () => {
    /*
     * The import could be renamed and the element left, or a new local `Block`
     * introduced. A private one is allowed by the rule above — it cannot be
     * imported by mistake — so this looks only at what is rendered, and
     * LandingSections is named here rather than silently skipped.
     */
    const allowed = "mobile/src/components/onboarding/LandingSections.tsx";
    const offenders = phoneFiles
      .filter((f) => f !== allowed)
      /* Comments stripped: bits.tsx explains the rename, and the explanation
       * has to be able to name the thing it is about. */
      .filter((f) => /<Block[\s/>]|<\/Block>/.test(withoutComments(read(f))));
    expect(offenders, `these render a <Block>:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });

  it("keeps the two names it chose, and each is used", () => {
    expect(read("mobile/src/components/ProjectBits.tsx")).toMatch(/export function ProjectSection\b/);
    expect(read("mobile/src/components/manage/bits.tsx")).toMatch(/export function SectionBlock\b/);
    for (const [name, users] of [
      ["ProjectSection", ["mobile/src/components/ProjectPageTabs.tsx"]],
      ["SectionBlock", ["mobile/src/components/manage/PathPanel.tsx", "mobile/src/components/manage/Dashboard.tsx"]],
    ] as const) {
      for (const user of users) {
        expect(read(user), `${user} should render <${name}>`).toContain(`<${name}`);
      }
    }
  });
});

/**
 * The Pill's tones, which are the component.
 *
 * A pill without tones is a coloured rectangle, and that is what the phone had:
 * twenty call sites reached for `colors.success`, `colors.warning`,
 * `colors.info` or `colors.danger` by hand, so "what does green mean here" was
 * answered separately twenty times. The tones are the answer written once.
 */
describe("the Pill's tones", () => {
  const webPill = read("client/src/components/nova/pill.tsx");
  const phonePill = read("mobile/src/components/nova/Pill.tsx");

  const tonesIn = (source: string) => {
    const m = /PillTone\s*=\s*([^;]+);/.exec(source);
    expect(m, "PillTone is no longer a union of string literals").toBeTruthy();
    return [...m![1].matchAll(/"(\w+)"/g)].map((x) => x[1]).sort();
  };

  it("are the same set on both", () => {
    expect(tonesIn(phonePill), "the phone's tones have drifted from the web's").toEqual(tonesIn(webPill));
  });

  /*
   * The one the web's comment singles out: `unknown` is dashed and blue, never
   * red, "because 'nobody has checked' is a question and `bad` is an answer.
   * Drawing them alike is how a screen tells somebody they have a problem they
   * do not have." Worth a test rather than a comment, because the next person to
   * tidy the tone table will see two blues and be tempted.
   */
  it("keep unknown dashed, and keep it away from the colour bad uses", () => {
    const table = /PILL_TONE[\s\S]*?\n};/.exec(phonePill);
    expect(table, "the phone's tone table changed shape").toBeTruthy();
    const unknown = /unknown:\s*\{([^}]*)\}/.exec(table![0]);
    expect(unknown, "there is no unknown tone on the phone").toBeTruthy();
    expect(unknown![1], "unknown has to be dashed — it is the half of the distinction the phone's palette can still carry").toMatch(/dashed:\s*true/);
    expect(unknown![1], "unknown must not borrow the colour bad uses").not.toMatch(/colors\.danger/);

    const bad = /bad:\s*\{([^}]*)\}/.exec(table![0]);
    expect(bad![1], "bad is the one that uses danger").toMatch(/colors\.danger/);
  });

  /*
   * The point of the migration: a pill that means a state should say which
   * state, not which colour. These five files had every one of their pills
   * converted, so a hand-picked semantic colour reappearing in them is a
   * regression rather than a style choice.
   */
  it("are used instead of a hand-picked colour, in the screens that were converted", () => {
    const converted = [
      "mobile/app/admin/surfaces.tsx",
      "mobile/app/admin/analytics.tsx",
      "mobile/app/admin/safety.tsx",
      "mobile/app/investor/interview.tsx",
      "mobile/app/sim/index.tsx",
    ];
    for (const path of converted) {
      const source = read(path);
      const handPicked = source.split("\n").filter((l) => l.includes("<Pill") && /colors\.(success|warning|danger|info)/.test(l));
      expect(handPicked, `${path} is back to picking pill colours by hand:\n  ${handPicked.join("\n  ")}`).toEqual([]);
    }
  });
});
