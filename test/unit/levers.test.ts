/**
 * What the table can see before it commits.
 *
 * The claims here are about information rather than arithmetic: that five
 * people each spending a reasonable amount can see they have collectively
 * spent an unreasonable amount, that the engine's own warnings reach them
 * while they can still act on them, and that a seat cannot file a decision
 * belonging to somebody else.
 */
import { describe, it, expect } from "vitest";
import {
  LEVER_FIELDS, cleanDecision, defaultDraft, validateDecision, commitment, draftPreview, filedRoles,
  stepFor, FOUNDER_STEP_CAP,
} from "@shared/simulation/levers";
import { startingCompany, economyFor } from "@shared/simulation/season";
import { nicheById } from "@shared/simulation/niches";
import { ROLES, type Role } from "@shared/simulation/types";
import type { TeamDecisions } from "@shared/simulation/decisions";

const niche = nicheById("dating_apps")!;
const economy = economyFor("s", 1);
const company = () => startingCompany({ id: "t", name: "T", niche, seats: [...ROLES] });

describe("the levers themselves", () => {
  it("gives every seat something to do", () => {
    for (const role of ROLES) {
      expect(LEVER_FIELDS[role].length, `${role} has no levers`).toBeGreaterThan(0);
      for (const field of LEVER_FIELDS[role]) {
        // A control with no explanation is a control people set to zero and
        // resent when it turns out to have mattered.
        expect(field.help.length, `${role}.${field.id} has no help`).toBeGreaterThan(20);
      }
    }
  });

  it("starts a seat from last year rather than from zero", () => {
    const previous = { price: 19, brandSpend: 300_000, performanceSpend: 100_000, celebritySpend: 900_000, targetCities: [] };
    const draft = defaultDraft("cmo", company(), previous);
    expect(draft.price).toBe(19);
    expect(draft.brandSpend).toBe(300_000);
    // A campaign that ran once does not re-book itself just by opening the screen.
    expect(draft.celebritySpend).toBe(0);
  });

  it("does not pre-fill a loan", () => {
    const draft = defaultDraft("cfo", company(), { borrow: 2_000_000, repay: 0, cashBuffer: 0 });
    expect(draft.borrow).toBe(0);
  });

  it("does not pre-fill last year's raise, and keeps the buffer", () => {
    // The lever is `raiseAmount`. Resetting a field called `raise` left it in
    // place, so every year after the first re-filed the same round.
    const draft = defaultDraft("cfo", company(), { borrow: 0, repay: 500_000, cashBuffer: 1_000_000, raiseAmount: 3_000_000 });
    expect(draft.raiseAmount).toBe(0);
    expect(draft.repay).toBe(0);
    expect(draft.cashBuffer).toBe(1_000_000);
  });

  it("does not carry a chief executive's one-off moves into the next year", () => {
    const draft = defaultDraft("ceo", company(), {
      focus: "margin", positioning: "x", rehire: "cmo", dissolveSeats: ["cto"],
      offer: { targetCompanyId: "c2", kind: "acquire", amount: 1 },
    });
    expect(draft.focus).toBe("margin");
    expect(draft.positioning).toBe("x");
    expect(draft.rehire).toBe("");
    expect(draft.offer).toBeUndefined();
    expect(draft.dissolveSeats).toBeUndefined();
  });
});

describe("what a seat may file", () => {
  it("refuses a repayment of money nobody owes", () => {
    const c = { ...company(), debt: 100_000 };
    const bad = validateDecision("cfo", { borrow: 0, repay: 500_000, cashBuffer: 0 }, c);
    expect(bad.ok).toBe(false);
    expect(bad.errors.repay).toMatch(/only owe/i);
  });

  it("allows a reckless year", () => {
    /*
     * Deliberate. Spending everything the company has is a decision a team is
     * allowed to make and sometimes the right one; a validator that refuses
     * risk turns a business simulation into a form that only accepts the safe
     * answer. The screen's job is to say what it costs, not to forbid it.
     */
    const ok = validateDecision("cmo", {
      price: 12, brandSpend: 50_000_000, performanceSpend: 50_000_000, celebritySpend: 0, targetCities: [],
    }, company());
    expect(ok.ok).toBe(true);
  });

  it("insists on a choice the engine understands", () => {
    expect(validateDecision("ceo", { focus: "vibes" }, company()).ok).toBe(false);
    expect(validateDecision("ceo", { focus: "survival" }, company()).ok).toBe(true);
  });
});

describe("what the table has committed", () => {
  it("adds up what no single seat could see", () => {
    /*
     * The failure this exists to prevent: four people each commit an amount
     * that is reasonable on its own screen, and the company is bankrupt before
     * the year runs. Each of them sees only their own number; only the sum is
     * alarming, and nobody was looking at the sum.
     */
    const c = company();
    const decisions: TeamDecisions = {
      companyId: "t",
      cmo: { price: 22, brandSpend: 2_000_000, performanceSpend: 0, celebritySpend: 0, targetCities: [] },
      cto: { featureSpend: 2_000_000, reliabilitySpend: 0, techDebtPaydown: 0 },
      coo: { capacityTarget: c.capacity, supportSpend: 2_000_000, efficiencySpend: 0, headcount: 0 },
    };

    const money = commitment(c, decisions, economy);
    expect(money.spend).toBe(6_000_000);
    // And the salary bill nobody chose is in there too.
    expect(money.fixed).toBeGreaterThan(0);
    // Past the cash in the bank: from here the year is funded on credit, which
    // is the line the table needs to see itself crossing.
    expect(money.spend + money.fixed).toBeGreaterThan(c.cash);
    expect(money.ratio).toBeGreaterThan(0.8);
  });

  it("counts what finance has ring-fenced as unavailable", () => {
    const c = company();
    const withoutBuffer = commitment(c, { companyId: "t" }, economy).available;
    const withBuffer = commitment(c, { companyId: "t", cfo: { borrow: 0, repay: 0, cashBuffer: 3_000_000 } }, economy).available;
    expect(withBuffer).toBe(withoutBuffer - 3_000_000);
  });

  it("counts a drawdown once: it moves money from the line to the bank, it doesn't add to it", () => {
    /*
     * This used to expect a million more to spend after borrowing a million —
     * which is the double count itself: the million was already there as
     * unused credit. Drawing it changes where the money sits, not how much
     * there is.
     */
    const c = { ...company(), creditLimit: 3_000_000, debt: 0 };
    const plain = commitment(c, { companyId: "t" }, economy).available;
    const borrowed = commitment(c, { companyId: "t", cfo: { borrow: 1_000_000, repay: 0, cashBuffer: 0 } }, economy).available;
    expect(borrowed).toBe(plain);
    expect(plain).toBe(c.cash + 3_000_000);
  });

  it("attributes the spend to the seat that chose it", () => {
    const money = commitment(company(), {
      companyId: "t",
      cmo: { price: 22, brandSpend: 500_000, performanceSpend: 0, celebritySpend: 0, targetCities: [] },
    }, economy);
    expect(money.bySeat.find((s) => s.role === "cmo")!.spend).toBe(500_000);
    expect(money.bySeat.find((s) => s.role === "cto")!.spend).toBe(0);
  });
});

describe("the preview", () => {
  it("says how short the year is, in money", () => {
    const c = company();
    const preview = draftPreview({
      company: c, niche, economy,
      decisions: {
        companyId: "t",
        cmo: { price: 22, brandSpend: 20_000_000, performanceSpend: 0, celebritySpend: 0, targetCities: [] },
      },
    });
    expect(preview.warnings.join(" ")).toMatch(/short/i);
    // And says what happens anyway, rather than just refusing.
    expect(preview.warnings.join(" ")).toMatch(/credit|insolvent/i);
  });

  it("warns before a year that leaves nothing in reserve", () => {
    const c = company();
    const available = commitment(c, { companyId: "t" }, economy).available;
    const fixed = commitment(c, { companyId: "t" }, economy).fixed;
    const preview = draftPreview({
      company: c, niche, economy,
      decisions: {
        companyId: "t",
        cmo: { price: 22, brandSpend: Math.round(available * 0.95 - fixed), performanceSpend: 0, celebritySpend: 0, targetCities: [] },
      },
    });
    expect(preview.warnings.join(" ")).toMatch(/nothing left|almost everything/i);
  });

  it("says when a year stops being funded by cash and starts being funded by the bank", () => {
    /*
     * Not the same as spending too much. A team can commit every pound they
     * have, still be inside what they could technically borrow, and hear
     * nothing from a plain ratio — while having just moved onto the credit
     * line, which costs interest every year afterwards.
     */
    const c = company();
    const preview = draftPreview({
      company: c, niche, economy,
      decisions: {
        companyId: "t",
        cmo: { price: 22, brandSpend: c.cash, performanceSpend: 0, celebritySpend: 0, targetCities: [] },
      },
    });
    expect(preview.commitment.ratio, "still inside what they could raise").toBeLessThan(0.9);
    expect(preview.warnings.join(" ")).toMatch(/credit line|comes out of the credit/i);
    expect(preview.warnings.join(" ")).toMatch(/interest/i);
  });

  /*
   * "Tells operations that marketing is about to outrun them" lived here, and
   * moved to test/unit/forecast.test.ts. The preview judged it against a guess
   * at demand that was out by a factor of fifty; the desk now judges capacity
   * against the forecast, which runs the real market.
   */

  it("says nothing about seats that simply haven't filed yet", () => {
    /*
     * The engine writes "no finance decision was made this year" once the year
     * has run, which is true then and merely nagging at nine in the morning
     * while the CFO is still asleep. The screen shows empty seats as empty
     * seats instead.
     */
    const preview = draftPreview({ company: company(), niche, economy, decisions: { companyId: "t" } });
    expect(preview.notes.join(" ")).not.toMatch(/no finance decision was made/i);
  });

  it("flags a price below what a unit costs to make", () => {
    const c = company();
    const preview = draftPreview({
      company: c, niche, economy,
      decisions: { companyId: "t", cmo: { price: 1, brandSpend: 0, performanceSpend: 0, celebritySpend: 0, targetCities: [] } },
    });
    expect(preview.notes.join(" ")).toMatch(/costs .* to make/i);
  });
});

describe("who has filed", () => {
  it("lists the seats that committed and not the ones that didn't", () => {
    const filed = filedRoles({
      companyId: "t",
      cmo: { price: 1, brandSpend: 0, performanceSpend: 0, celebritySpend: 0, targetCities: [] },
      ceo: { focus: "growth" },
    });
    expect(filed.sort()).toEqual(["ceo", "cmo"]);
  });
});

/**
 * The keys of two of these maps come from the client and are only bounded in
 * length: the answers to a season's offers, and an allocation whose allowed
 * keys aren't known to this deployment. `out[key] = …` with a key of
 * `__proto__` sets the object's prototype instead of filing anything, and the
 * result goes to jsonb and comes back out as a decision.
 */
describe("a decision keyed by whatever the client sent", () => {
  it("never lets a key reach the prototype, and files an ordinary object", () => {
    const filed = cleanDecision("cmo", {
      budget: { __proto__: 5, constructor: 4 },
      priceTiers: { __proto__: 9 },
    } as any, [], {});

    expect(({} as any)[5], "nothing reached Object.prototype").toBeUndefined();
    for (const value of Object.values(filed)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        expect(Object.getPrototypeOf(value), "an ordinary object, which is what the Postgres driver can serialise").toBe(Object.prototype);
      }
    }
  });
});

/*
 * A sealed bid, in the one number the whole table reads.
 *
 * The commitment meter is the only place the five of them see what they have
 * promised between them, and a bid at auction was invisible to it. The money is
 * committed the moment the bid is placed: `settleMarket` takes it on the tick, the
 * bidder cannot spend it twice, and the market screen already warns whoever placed
 * it that their bids add up to more than the company has. It had no way to tell
 * the other four, who were filing a year against a total that looked comfortable —
 * which is the same failure the city-entry cost had, and is fixed the same way.
 *
 * An exposure rather than a certainty, since most bids lose. Counted anyway:
 * overstating what a year might cost is the safe side of a meter whose job is to
 * stop a table committing money it has not got.
 */
describe("what the table has committed, including what it has bid", () => {
  const economy = economyFor("s", 1);

  it("counts a standing bid, and leaves the total alone when there is none", () => {
    const c = company();
    const decisions: TeamDecisions = { companyId: "t", ceo: { focus: "growth" } } as TeamDecisions;
    const without = commitment(c, decisions, economy, niche);
    const withBid = commitment(c, decisions, economy, niche, null, 1_500_000);
    expect(withBid.spend - without.spend, "a 1.5m bid did not move the total").toBeCloseTo(1_500_000, 4);
    expect(without.bidsOutstanding, "nothing bid, so nothing to report").toBe(0);
    expect(withBid.bidsOutstanding).toBe(1_500_000);
  });

  it("puts it on the chief executive's line, because bidding is their lever", () => {
    /*
     * Not spread across the table and not on its own invented seat: the meter
     * reads "this is what each of you has committed", and bidding is refused to
     * anybody else (`BID_IS_THE_CEOS`).
     */
    const c = company();
    const seat = (x: ReturnType<typeof commitment>, role: Role) => x.bySeat.find((b) => b.role === role)!.spend;
    const base = commitment(c, { companyId: "t" } as TeamDecisions, economy, niche);
    const bid = commitment(c, { companyId: "t" } as TeamDecisions, economy, niche, null, 900_000);
    expect(seat(bid, "ceo") - seat(base, "ceo")).toBeCloseTo(900_000, 4);
    for (const role of ["cmo", "cto", "coo", "cfo"] as Role[]) {
      expect(seat(bid, role), `${role}'s line moved because of a bid`).toBeCloseTo(seat(base, role), 4);
    }
  });

  it("can turn a comfortable year into one the company cannot pay for", () => {
    /*
     * The whole point. Without this a table could file a year the meter called
     * clear, having already promised most of the cash at auction, and find out on
     * the tick.
     */
    const c = company();
    const decisions = { companyId: "t", ceo: { focus: "growth" } } as TeamDecisions;
    const clear = commitment(c, decisions, economy, niche);
    expect(clear.ratio, "the baseline year is meant to be affordable").toBeLessThan(1);
    const swamped = commitment(c, decisions, economy, niche, null, clear.available * 2);
    expect(swamped.ratio, "bidding twice what the company has still read as affordable").toBeGreaterThan(1);
  });

  it("ignores a nonsense figure rather than poisoning the whole meter", () => {
    /*
     * The total arrives from a database sum, and a meter that went `NaN` because
     * one row was odd would take every other number on the screen with it.
     */
    const c = company();
    const base = commitment(c, { companyId: "t" } as TeamDecisions, economy, niche).spend;
    for (const bad of [Number.NaN, -5_000, undefined, null as unknown as number]) {
      const out = commitment(c, { companyId: "t" } as TeamDecisions, economy, niche, null, bad);
      expect(Number.isFinite(out.spend), `a bid of ${String(bad)} broke the total`).toBe(true);
      expect(out.spend).toBeCloseTo(base, 4);
      expect(out.bidsOutstanding).toBe(0);
    }
  });

  it("warns the table when the bids are what tipped it over", () => {
    /*
     * `draftPreview` is what the server sends and what both clients show, so the
     * warnings have to see the bids too — a preview that said the year was fine
     * while the meter beside it said otherwise would be read as the meter being
     * broken.
     */
    const c = company();
    const decisions = { companyId: "t", ceo: { focus: "growth" } } as TeamDecisions;
    const quiet = draftPreview({ company: c, niche, decisions, economy });
    const loud = draftPreview({ company: c, niche, decisions, economy, bids: quiet.commitment.available * 3 });
    expect(quiet.warnings.some((w) => /committed/.test(w)), "the baseline year should not warn").toBe(false);
    expect(loud.warnings.some((w) => /committed/.test(w)), "a year swamped by bids did not warn").toBe(true);
  });
});

/**
 * A founder's arrows.
 *
 * The lever list is written for a company with a board; a solo founder opens
 * with sixty thousand, and the claim here is that no arrow on their desk moves
 * more than a thousand while every lever that was already finer than that is
 * left exactly as it was.
 */
describe("the step a founder's arrows move in", () => {
  const every = ROLES.flatMap((r) => LEVER_FIELDS[r]);

  it("caps a founder's steps at a thousand", () => {
    const coarse = every.filter((f) => (f.step ?? 1) > FOUNDER_STEP_CAP);
    expect(coarse.length, "no lever steps by more than a thousand, so this test proves nothing").toBeGreaterThan(0);
    for (const field of coarse) {
      expect(stepFor(field, true).step, `${field.id} still moves in ${field.step}`).toBe(FOUNDER_STEP_CAP);
    }
  });

  it("leaves a full table alone", () => {
    for (const field of every) {
      expect(stepFor(field, false), `${field.id} was changed for a table that has a board`).toBe(field);
    }
  });

  it("does not coarsen a lever that was already finer", () => {
    // A price moves in ones and a percentage in fives; capping must not raise either.
    for (const field of every.filter((f) => (f.step ?? 1) <= FOUNDER_STEP_CAP)) {
      expect(stepFor(field, true).step, `${field.id} was dragged up to the cap`).toBe(field.step);
    }
  });

  it("does not mutate the shared lever list", () => {
    const field = every.find((f) => (f.step ?? 1) > FOUNDER_STEP_CAP)!;
    const was = field.step;
    stepFor(field, true);
    expect(field.step, "stepFor wrote through to the module-level constant").toBe(was);
  });
});
