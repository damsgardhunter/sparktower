/**
 * Systemizing something that is not premises with staff.
 *
 * "Make it run without you" offered Restaurant, Service business and Retail —
 * and then every variant talked about open/close, covers and shrink. It is
 * just as true of a channel whose owner is the only person who can edit, a
 * kitchen-table business where every order goes through one phone, and a web
 * business nobody else can deploy.
 *
 * The backbone already fitted all three: time capture, an only-me list, SOPs,
 * metrics, a handoff, an absence test. What did not fit was the list of
 * options and the words inside each step.
 *
 * Shaped after `ship-path-beyond-software.test.ts`, which guards the same
 * change on the other path. The difference is that Systemize's actors were
 * already right — it is `nova-drafts` almost throughout, because what Nova
 * produces here is documents, and documents are a thing Nova can produce for
 * any kind of business.
 */
import { describe, it, expect } from "vitest";
import { resolveTree } from "@shared/phase-trees";
import { PROJECT_SUBCATEGORIES, subcategoriesFor } from "@shared/goals";
import { LIVE_PACKS, packFor } from "@shared/nova-prompt-packs";
import { PROJECT_SUBCATEGORIES as PHONE_SUBCATEGORIES } from "../../mobile/src/projectData";

const NOT_PREMISES = ["channel", "home", "online"] as const;

const milestonesFor = (sub: string) =>
  resolveTree("systemize_business", sub).flatMap((phase) => phase.milestones);

describe("the options", () => {
  it("offers the three that are not premises", () => {
    const ids = subcategoriesFor("systemize_business").map((s) => s.id);
    for (const sub of NOT_PREMISES) expect(ids, `${sub} should be offerable`).toContain(sub);
  });

  it("keeps the three it had, and Other last", () => {
    const ids = subcategoriesFor("systemize_business").map((s) => s.id);
    for (const sub of ["restaurant", "service", "retail"]) expect(ids).toContain(sub);
    expect(ids[ids.length - 1]).toBe("other");
  });

  it("is the same list on the phone", () => {
    expect(PHONE_SUBCATEGORIES.systemize_business)
      .toEqual(PROJECT_SUBCATEGORIES.systemize_business.map((s) => ({ id: s.id, label: s.label })));
  });

  it("shares the channel id with the shipping path, on purpose", () => {
    /*
     * Somebody who shipped a channel and now wants it to run without them is
     * the same person; a second id would make the pair read as two different
     * things. The same reuse `restaurant` already has with run_company.
     */
    expect(PROJECT_SUBCATEGORIES.ship_mvp.map((s) => s.id)).toContain("channel");
    expect(PROJECT_SUBCATEGORIES.systemize_business.map((s) => s.id)).toContain("channel");
    /* And each tree answers for itself, so the two paths say different things. */
    const shipping = resolveTree("ship_mvp", "channel").flatMap((p) => p.milestones);
    expect(milestonesFor("channel").map((m) => m.id)).not.toEqual(shipping.map((m) => m.id));
  });
});

describe("the path adapts its words", () => {
  /* Vocabulary that belongs to a building with a front door and a rota. */
  const PREMISES_WORDS = [
    "covers", "shrink", "sell-through", "merchandising", "front of house",
    "prep", "open/close", "floor", "cash handling", "vendor", "staffing",
  ];

  for (const sub of NOT_PREMISES) {
    it(`says nothing about premises on the ${sub} path`, () => {
      const offenders: string[] = [];
      /*
       * The backbone only. The funding phases (SYS.F*) are shared financial
       * steps and use "covers" as the ordinary verb — "what the loan covers" —
       * which an earlier version of this test reported three times as a
       * restaurant metric. "Covers" is kept in the list rather than dropped,
       * because in a metrics step it is exactly the word that should not be
       * there.
       */
      for (const m of milestonesFor(sub).filter((x) => !x.id.startsWith("SYS.F"))) {
        const text = `${m.title} ${m.description}`;
        for (const word of PREMISES_WORDS) {
          if (new RegExp(`\\b${word}\\b`, "i").test(text)) offenders.push(`${m.id} "${m.title}" — ${word}`);
        }
      }
      expect(offenders, `the ${sub} path still assumes premises:\n  ${offenders.join("\n  ")}`).toEqual([]);
    });

    it(`adapts the steps that carried the assumption, for ${sub}`, () => {
      /*
       * Fewer than Ship's because Systemize's backbone is already general —
       * but the ones that were restaurant-shaped have to be covered, and the
       * count guards against adding the option and one variant.
       */
      const adapted = milestonesFor(sub).filter((m) => m.variantApplied);
      expect(adapted.length, `${adapted.length} adapted for ${sub}`).toBeGreaterThanOrEqual(8);
    });
  }

  it("leaves the premises paths exactly as they were", () => {
    const restaurant = milestonesFor("restaurant");
    expect(restaurant.find((m) => m.id === "SYS.M1.2")!.description).toMatch(/open\/close/i);
    expect(restaurant.find((m) => m.id === "SYS.M3.1")!.description).toMatch(/covers/i);
  });
});

describe("the steps that had to change", () => {
  it("measures the thing this path is actually for, in each", () => {
    /*
     * Every one of the three has a number that means "the owner is still
     * carrying it", and a generic metrics step would miss all three.
     */
    const metric = (sub: string) => milestonesFor(sub).find((m) => m.id === "SYS.M3.1")!.description;
    expect(metric("channel")).toMatch(/published-on-time/i);
    expect(metric("home")).toMatch(/hours/i);
    expect(metric("online")).toMatch(/deploys that needed you/i);
  });

  it("defines the absence test in terms each one can actually fail", () => {
    const absence = (sub: string) => milestonesFor(sub).find((m) => m.id === "SYS.M4.4")!.description;
    /* Three quiet days prove nothing for a channel with a full queue. */
    expect(absence("channel")).toMatch(/publishes on schedule without you/i);
    /* Help in the house counts — the test is without the owner, not without help. */
    expect(absence("home")).toMatch(/somebody else in the house, that counts/i);
    expect(absence("online")).toMatch(/nothing waits for a deploy only you can do/i);
  });

  it("names what each one is afraid to hand over", () => {
    /* The only-me list is where this path either lands or does not. */
    const onlyMe = (sub: string) => milestonesFor(sub).find((m) => m.id === "SYS.M1.2")!.description;
    expect(onlyMe("channel")).toMatch(/editing/i);
    expect(onlyMe("home")).toMatch(/tangled with the rest of the house/i);
    expect(onlyMe("online")).toMatch(/access/i);
  });

  it("does not tell a creator to automate the craft", () => {
    expect(milestonesFor("channel").find((m) => m.id === "SYS.M4.1")!.description)
      .toMatch(/[Nn]ot the editing/);
  });
});

describe("the prompt packs", () => {
  const packs = NOT_PREMISES.map((sub) => [sub, packFor("systemize_business", sub)] as const);

  it("has real questions for each", () => {
    for (const [sub, pack] of packs) {
      expect(pack.key, sub).toBe(`systemize_business:${sub}`);
      expect(pack.status, `${sub} should have a written pack`).not.toBe("stub");
      expect(pack.questions.length, sub).toBeGreaterThanOrEqual(3);
    }
  });

  it("does not claim an eval nobody ran", () => {
    for (const [sub, pack] of packs) expect(pack.status, sub).toBe("written");
    expect(LIVE_PACKS.map((p) => p.key)).toEqual(["ship_mvp:website"]);
  });

  it("asks a creator the question they would not volunteer", () => {
    /* "What would you not hand to an editor" is the real constraint, and it is
     * a feeling until somebody writes it down as a standard. */
    const channel = packFor("systemize_business", "channel");
    expect(channel.questions.some((q) => /not hand to an editor/i.test(q.ask))).toBe(true);
    expect(channel.guidance).toMatch(/do not plan to automate the editing/i);
  });

  it("plans a home business around hours rather than a hire", () => {
    const home = packFor("systemize_business", "home");
    expect(home.questions.some((q) => /how many hours/i.test(q.ask))).toBe(true);
    expect(home.guidance).toMatch(/not a hire/i);
    /* And is willing to say the honest thing. */
    expect(home.guidance).toMatch(/stop offering something rather than to systemize it/i);
  });

  it("treats access as the subject for a web business", () => {
    const online = packFor("systemize_business", "online");
    expect(online.questions.some((q) => /only you have access to/i.test(q.ask))).toBe(true);
    expect(online.guidance).toMatch(/access as part of every handoff/i);
  });
});
