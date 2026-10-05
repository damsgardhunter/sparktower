/**
 * Shipping something that is not software.
 *
 * "Ship an MVP" offered four kinds of project — app, SaaS, game, website — and
 * then handed everybody a roadmap about repos, schemas and deploys. Somebody
 * making a hot sauce, a hardware product or a YouTube channel has a first
 * version to get in front of real people exactly like everybody else, and the
 * four-week spine fits them; what did not fit was every milestone inside it.
 *
 * Three things are tested here, and the third is the one that matters most.
 *
 * **The options exist**, on the server and on the phone, which keeps its own
 * copy because Metro will not resolve `@shared`.
 *
 * **The words adapt.** A food path that says "deploy" is worse than no path,
 * because it tells somebody this product was not built for them.
 *
 * **Who acts adapts too.** `nova-builds` is a promise that Nova finishes and
 * closes the step (shared/nova-build.ts). For "make a first prototype" that is
 * a flat lie — Nova cannot make a physical thing — and `ACTOR_SHORT` would put
 * "Nova builds it" on the card. So every remaining `nova-builds` on a
 * non-software path is listed by name below and has to be work that genuinely
 * is software.
 */
import { describe, it, expect } from "vitest";
import { resolveTree } from "@shared/phase-trees";
import { PROJECT_SUBCATEGORIES, subcategoriesFor } from "@shared/goals";
import { LIVE_PACKS, packFor } from "@shared/nova-prompt-packs";
import { PROJECT_SUBCATEGORIES as PHONE_SUBCATEGORIES } from "../../mobile/src/projectData";

/** The three that are not software. */
const MADE_THINGS = ["physical", "food", "channel"] as const;

const milestonesFor = (sub: string) =>
  resolveTree("ship_mvp", sub).flatMap((phase) => phase.milestones);

describe("the options", () => {
  it("offers the three non-software kinds", () => {
    const ids = subcategoriesFor("ship_mvp").map((s) => s.id);
    for (const sub of MADE_THINGS) expect(ids, `${sub} should be offerable`).toContain(sub);
  });

  it("keeps the software ones, and Other last", () => {
    const ids = subcategoriesFor("ship_mvp").map((s) => s.id);
    for (const sub of ["app", "saas", "game", "website"]) expect(ids).toContain(sub);
    /* "Other" is a real answer somebody picks, not a default they fall into —
     * and it reads as the last resort only if it is last. */
    expect(ids[ids.length - 1]).toBe("other");
  });

  it("is the same list on the phone", () => {
    /* The phone's copy drifts silently; a missing option there is a kind of
     * project an app user simply cannot choose. */
    expect(PHONE_SUBCATEGORIES.ship_mvp).toEqual(PROJECT_SUBCATEGORIES.ship_mvp.map((s) => ({ id: s.id, label: s.label })));
  });
});

describe("the path adapts its words", () => {
  /*
   * Vocabulary that means nothing to somebody making a jar of sauce. Checked
   * against the resolved title and description, which is what they actually
   * read.
   */
  const SOFTWARE_WORDS = [
    "repo", "deploy", "schema", "database", "framework", "routing",
    "auth", "codebase", "commit", "endpoint", "API", "front end", "backend",
  ];

  for (const sub of MADE_THINGS) {
    it(`says nothing about software on the ${sub} path`, () => {
      const offenders: string[] = [];
      for (const m of milestonesFor(sub)) {
        const text = `${m.title} ${m.description}`;
        for (const word of SOFTWARE_WORDS) {
          if (new RegExp(`\\b${word}\\b`, "i").test(text)) offenders.push(`${m.id} "${m.title}" — ${word}`);
        }
      }
      expect(offenders, `the ${sub} path still talks about software:\n  ${offenders.join("\n  ")}`).toEqual([]);
    });

    it(`changes most of the path for ${sub}, not a milestone or two`, () => {
      /*
       * A count, loosely, because the failure this guards against is somebody
       * adding the option and one variant and calling it supported.
       */
      const all = milestonesFor(sub);
      const adapted = all.filter((m) => m.variantApplied);
      expect(adapted.length, `${adapted.length} of ${all.length} adapted`).toBeGreaterThanOrEqual(20);
    });
  }

  it("leaves the software paths exactly as they were", () => {
    /* The whole change has to be additive: an app's path must not have moved. */
    for (const sub of ["app", "saas", "game", "website"]) {
      const titles = milestonesFor(sub).map((m) => m.title);
      expect(titles, `${sub} should still start at the product statement`).toContain("Product statement");
      expect(titles, `${sub} should still deploy`).toEqual(expect.arrayContaining([expect.stringMatching(/Deploy|Playable build|TestFlight/)]));
    }
  });
});

describe("who acts adapts too", () => {
  /**
   * Every `nova-builds` left on a non-software path, named.
   *
   * The rule: the work has to genuinely be software. Taking an order and
   * taking a payment are software even when the product is a jar; making the
   * jar is not.
   */
  const NOVA_MAY_STILL_BUILD: Record<string, string[]> = {
    /* A page that takes an order, and the payment plumbing behind it. */
    physical: ["SHIP.M1.8", "SHIP.M2.4"],
    /* Taking money and keeping a record of each batch. */
    food: ["SHIP.M2.4"],
    /* Nothing. A channel's whole surface belongs to the platform. */
    channel: [],
  };

  for (const sub of MADE_THINGS) {
    it(`never claims Nova builds something it cannot, on the ${sub} path`, () => {
      const wrong = milestonesFor(sub)
        .filter((m) => m.actor === "nova-builds")
        .filter((m) => !NOVA_MAY_STILL_BUILD[sub].includes(m.id))
        .map((m) => `${m.id} "${m.title}"`);
      expect(
        wrong,
        `these would put "Nova builds it" on work Nova cannot do — give the variant an actor, or add the id to NOVA_MAY_STILL_BUILD with a reason:\n  ${wrong.join("\n  ")}`,
      ).toEqual([]);
    });

    it(`still has Nova doing the parts it can, on the ${sub} path`, () => {
      /*
       * The other half: a path where Nova does nothing is not a product, it is
       * a checklist. Nova drafts throughout even when it cannot build.
       */
      const novaWork = milestonesFor(sub).filter((m) => m.actor === "nova-drafts" || m.actor === "nova-builds");
      expect(novaWork.length, `only ${novaWork.length} steps are Nova's on the ${sub} path`).toBeGreaterThanOrEqual(8);
    });
  }
});

describe("what each kind of thing skips", () => {
  it("skips accounts and orders for a channel, which has neither", () => {
    const ids = milestonesFor("channel").map((m) => m.id);
    expect(ids).not.toContain("SHIP.M2.4");
  });

  it("gives the made things a judgement only the maker can make", () => {
    /*
     * The feel checkpoint was game-only, which was an accident of which paths
     * had been written: a thing you hold, a thing you eat and a thing you
     * watch all have one.
     */
    for (const sub of MADE_THINGS) {
      const feel = milestonesFor(sub).find((m) => m.id === "SHIP.M2.2");
      expect(feel, `${sub} should have the feel checkpoint`).toBeTruthy();
      expect(feel!.actor, "and it can only be theirs").toBe("user-does");
      expect(feel!.description.toLowerCase()).not.toContain("play it yourself");
    }
  });

  it("still skips it for software, where polish week covers the same ground", () => {
    for (const sub of ["app", "saas", "website", "other"]) {
      expect(milestonesFor(sub).map((m) => m.id)).not.toContain("SHIP.M2.2");
    }
  });
});

describe("the money step says something true for each", () => {
  /*
   * Pricing is where a generic path does the most damage: a food margin and a
   * channel's revenue route are not the same kind of answer, and "three models
   * with reasoning" is useless for a channel with no product to price.
   */
  it("prices a unit for a physical product and a serving for food", () => {
    expect(milestonesFor("physical").find((m) => m.id === "SHIP.M3.7")!.description).toMatch(/unit cost/i);
    expect(milestonesFor("food").find((m) => m.id === "SHIP.M3.7")!.description).toMatch(/per serving/i);
  });

  it("asks a channel how it earns, not what it costs", () => {
    const m = milestonesFor("channel").find((x) => x.id === "SHIP.M3.7")!;
    expect(m.title).toBe("How it earns");
    expect(m.description).toMatch(/sponsorship|affiliate/i);
  });
});

/**
 * Nova's first-plan packs for the three.
 *
 * The path controls the roadmap; the pack controls the questions Nova asks and
 * the instructions it plans under. Both can promise the impossible, so both
 * are checked for it.
 */
describe("the prompt packs", () => {
  const packs = MADE_THINGS.map((sub) => [sub, packFor("ship_mvp", sub)] as const);

  it("has real questions for each, not the generic set", () => {
    for (const [sub, pack] of packs) {
      expect(pack.key, sub).toBe(`ship_mvp:${sub}`);
      expect(pack.status, `${sub} should have a written pack`).not.toBe("stub");
      expect(pack.questions.length, sub).toBeGreaterThanOrEqual(3);
    }
  });

  it("does not claim an eval nobody ran", () => {
    /* "live" means written and evaluated. These are written. */
    for (const [sub, pack] of packs) expect(pack.status, sub).toBe("written");
    expect(LIVE_PACKS.map((p) => p.key)).toEqual(["ship_mvp:website"]);
  });

  it("tells Nova in writing that it cannot make the thing", () => {
    /*
     * The guidance is an instruction to a model that will otherwise happily
     * plan "Nova assembles the units". Each pack says so explicitly, because
     * the actor on a milestone governs the roadmap and this governs the plan
     * Nova writes freehand.
     */
    for (const [sub, pack] of packs) {
      expect(pack.guidance, `${sub} must tell Nova what it cannot do`).toMatch(/Never write a step that assumes Nova can/);
    }
  });

  it("puts the legal question first for food, because it decides what may be sold", () => {
    const food = packFor("ship_mvp", "food");
    expect(food.questions.some((q) => /kitchen/i.test(q.ask))).toBe(true);
    expect(food.guidance).toMatch(/rules first|legally/i);
    expect(food.guidance).toMatch(/allergen/i);
  });

  it("plans a channel as a cadence rather than a launch", () => {
    const channel = packFor("ship_mvp", "channel");
    expect(channel.guidance).toMatch(/cadence, not a launch/i);
    /* The two numbers that feel like progress and are not. */
    expect(channel.guidance).toMatch(/subscriber count and total views/i);
    expect(channel.guidance).toMatch(/Do not plan around ad revenue/i);
  });

  it("asks a physical maker what one costs, and accepts not knowing", () => {
    const physical = packFor("ship_mvp", "physical");
    const cost = physical.questions.find((q) => /cost/i.test(q.ask));
    expect(cost, "there should be a unit-cost question").toBeTruthy();
    expect(cost!.ask, "not knowing has to be an allowed answer").toMatch(/don't know|do not know/i);
  });
});
