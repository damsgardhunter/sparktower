/**
 * Ten Years From Now — the rules of the game, without a database in sight.
 *
 * Two things are worth pinning here above everything else:
 *
 *   - **Nobody can be held hostage.** Every round has a defined answer at its
 *     deadline even if one player has closed the tab. A game between strangers
 *     that requires both of them to finish is a game most people never finish.
 *   - **The verdict is clamped.** The scores come from a model, and a model
 *     will happily return 1200, or a peak below the ten-year value, or a
 *     valuation of four hundred trillion dollars. None of that reaches a
 *     leaderboard.
 */
import { describe, it, expect } from "vitest";
import {
  PLAYABLE_ROUNDS, ROUNDS, ROUND_SECONDS, TOTAL_SECONDS,
  coinWinner, dealOrder, nextRound, roundCanSettleEarly, settleChoice,
} from "@shared/sprints/game";
import {
  BUDGET_TOTAL, budgetIsReady, cleanAllocation, mergeAllocations, money,
  summariseBudget, unallocated,
} from "@shared/sprints/budget";
import { CUSTOMER_CARDS, MODEL_CARDS, SPEND_OPTIONS, customCard, isCustomCard } from "@shared/sprints/cards";
import {
  MAX_CLAIMS, MAX_CORE_CLAIMS, claimsAreReady, cleanClaims, coreClaims, mergeClaims,
} from "@shared/sprints/product";
import {
  DIMENSIONS, SCORE_MAX, VALUATION_CEILING, bestBoard, cleanVerdict,
  overallScore, rankBy, rankOn, scoreBand, standingsFor, type Scores,
} from "@shared/sprints/scoring";

const at = (n: number) => n;

describe("the shape of the game", () => {
  /* The brief was a 20-30 minute game. This is the number that keeps it one. */
  it("runs in twenty to thirty minutes even if every clock runs out", () => {
    const minutes = TOTAL_SECONDS / 60;
    expect(minutes).toBeGreaterThanOrEqual(20);
    expect(minutes).toBeLessThanOrEqual(30);
  });

  it("gives the rounds where you make something the most time", () => {
    // Picking a card is quick; inventing a product and spending a million is not.
    expect(ROUND_SECONDS.product).toBeGreaterThan(ROUND_SECONDS.customer);
    expect(ROUND_SECONDS.spend).toBeGreaterThan(ROUND_SECONDS.model);
  });

  it("runs idea → customer → model → product → spend → verdict", () => {
    expect(ROUNDS).toEqual(["idea", "customer", "model", "product", "spend", "verdict"]);
    expect(PLAYABLE_ROUNDS).not.toContain("verdict");
    expect(nextRound("spend")).toBe("verdict");
    expect(nextRound("verdict"), "the verdict is the end").toBeNull();
  });
});

describe("settling a round", () => {
  it("settles instantly when they agree", () => {
    const out = settleChoice({
      seed: "s1",
      submissions: [
        { userId: "a", choice: "night-nurses", at: at(1) },
        { userId: "b", choice: "night-nurses", at: at(2) },
      ],
    });
    expect(out.choice).toBe("night-nurses");
    expect(out.reason).toBe("agreed");
  });

  /*
   * The important one. The obvious deadlock rule — earliest submission wins —
   * is deterministic, needs no randomness, and quietly makes the correct
   * strategy "click instantly, never discuss anything", which is the opposite
   * of the product. A coin means arguing is the only way to get your way.
   */
  it("settles a deadlock with a coin rather than rewarding the fast clicker", () => {
    const early = { userId: "a", choice: "x", at: at(1) };
    const late = { userId: "b", choice: "y", at: at(9_999) };

    const winners = new Set<string>();
    for (let i = 0; i < 200; i++) {
      winners.add(settleChoice({ seed: `s${i}`, submissions: [early, late] }).wonBy!);
    }
    expect(winners, "whoever clicked first must not always win").toEqual(new Set(["a", "b"]));
  });

  it("gives the same answer for the same deadlock, so it can be explained", () => {
    const subs = [
      { userId: "a", choice: "x", at: at(1) },
      { userId: "b", choice: "y", at: at(2) },
    ];
    const once = settleChoice({ seed: "s1", submissions: subs });
    expect(settleChoice({ seed: "s1", submissions: [...subs].reverse() }), "read order must not change it").toEqual(once);
    expect(once.reason).toBe("coin");
    expect(coinWinner("s1", ["a", "b"])).toBe(once.wonBy);
  });

  /* Somebody closed the tab. The other person's game does not stop. */
  it("lets one player's pick stand when the other never submitted", () => {
    const out = settleChoice({ seed: "s1", submissions: [{ userId: "a", choice: "x", at: at(1) }] });
    expect(out.reason).toBe("unopposed");
    expect(out.choice).toBe("x");
  });

  it("has an answer even when nobody submitted anything", () => {
    const out = settleChoice<string>({ seed: "s1", submissions: [] });
    expect(out.reason).toBe("nobody");
    expect(out.choice).toBeNull();
  });

  it("can compare choices that aren't strings", () => {
    const same = (a: string[], b: string[]) => a.join() === b.join();
    const out = settleChoice({
      seed: "s1", same,
      submissions: [
        { userId: "a", choice: ["x", "y"], at: at(1) },
        { userId: "b", choice: ["x", "y"], at: at(2) },
      ],
    });
    expect(out.reason).toBe("agreed");
  });
});

describe("ending a round early", () => {
  it("ends the moment both have picked the same thing", () => {
    expect(roundCanSettleEarly({
      playerCount: 2,
      submissions: [
        { userId: "a", choice: "x", at: at(1) },
        { userId: "b", choice: "x", at: at(2) },
      ],
    })).toBe(true);
  });

  /*
   * A disagreement keeps its clock. The remaining time is exactly when the
   * argument that makes this worth playing with another person happens, and
   * ending the round on their first disagreement throws it away.
   */
  it("keeps the clock running while they disagree", () => {
    expect(roundCanSettleEarly({
      playerCount: 2,
      submissions: [
        { userId: "a", choice: "x", at: at(1) },
        { userId: "b", choice: "y", at: at(2) },
      ],
    })).toBe(false);
  });

  it("waits for everybody", () => {
    expect(roundCanSettleEarly({
      playerCount: 2,
      submissions: [{ userId: "a", choice: "x", at: at(1) }],
    })).toBe(false);
  });
});

describe("the decks", () => {
  it("has no duplicate card ids anywhere", () => {
    for (const [name, deck] of [["customer", CUSTOMER_CARDS], ["model", MODEL_CARDS]] as const) {
      const ids = deck.map((c) => c.id);
      expect(new Set(ids).size, `${name} deck has a duplicate id`).toBe(ids.length);
    }
    const spendIds = SPEND_OPTIONS.map((o) => o.id);
    expect(new Set(spendIds).size).toBe(spendIds.length);
  });

  /*
   * The design rule the whole deck rests on: every card is specific enough to
   * be wrong. A card with no consequence is a card that can't be argued about,
   * which makes it decoration.
   */
  it("says on every card what picking it costs you", () => {
    for (const card of [...CUSTOMER_CARDS, ...MODEL_CARDS]) {
      expect(card.detail.length, `${card.id} has no detail`).toBeGreaterThan(20);
      expect(card.consequence.length, `${card.id} has no consequence`).toBeGreaterThan(30);
    }
    for (const option of SPEND_OPTIONS) {
      expect(option.consequence.length, `${option.id} has no consequence`).toBeGreaterThan(30);
    }
  });

  it("is big enough to deal a real choice from", () => {
    expect(CUSTOMER_CARDS.length).toBeGreaterThanOrEqual(12);
    expect(MODEL_CARDS.length).toBeGreaterThanOrEqual(10);
  });

  it("deals in a stable order for a given game, and differently for another", () => {
    expect(dealOrder("g1", CUSTOMER_CARDS)).toEqual(dealOrder("g1", CUSTOMER_CARDS));
    expect(dealOrder("g1", CUSTOMER_CARDS)).not.toEqual(dealOrder("g2", CUSTOMER_CARDS));
    expect(dealOrder("g1", CUSTOMER_CARDS)).toHaveLength(CUSTOMER_CARDS.length);
  });

  it("lets players add their own, indistinguishable from dealt ones downstream", () => {
    const mine = customCard({ label: "My old football coach", index: 0, owner: "u1" });
    expect(isCustomCard(mine.id)).toBe(true);
    expect(mine.label).toBe("My old football coach");
    expect(Object.keys(mine).sort()).toEqual(Object.keys(CUSTOMER_CARDS[0]).sort());
  });

  /*
   * Both players' first invention used to be `custom:0`. The round settles by
   * comparing card ids, so one person writing "my old football coach" and the
   * other writing "my landlord" read as the same pick — the round closed as
   * *agreed*, on a customer neither had chosen, and told them so.
   */
  it("gives two players' inventions different ids", () => {
    const mine = customCard({ label: "My old football coach", index: 0, owner: "u1" });
    const theirs = customCard({ label: "My landlord", index: 0, owner: "u2" });
    expect(mine.id).not.toBe(theirs.id);
    expect(isCustomCard(mine.id) && isCustomCard(theirs.id)).toBe(true);
  });

  it("trims an absurdly long custom card rather than storing it", () => {
    expect(customCard({ label: "x".repeat(500), index: 1, owner: "u1" }).label.length).toBeLessThanOrEqual(80);
  });
});

describe("the first million", () => {
  it("is a million", () => {
    expect(BUDGET_TOTAL).toBe(1_000_000);
  });

  it("drops lines that don't exist, so nobody funds an invented category", () => {
    const clean = cleanAllocation({ marketing: 100_000, "free-money": 5_000_000 });
    expect(clean["free-money"]).toBeUndefined();
    expect(clean.marketing).toBe(100_000);
  });

  it("refuses negatives — a negative line is a loan, not a budget", () => {
    expect(cleanAllocation({ marketing: -50_000 }).marketing).toBe(0);
  });

  it("never lets the total exceed the million, however it's sent", () => {
    const clean = cleanAllocation({ marketing: 800_000, legal: 800_000, "build-product": 800_000 });
    expect(unallocated(clean)).toBeGreaterThanOrEqual(0);
    expect(Object.values(clean).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(BUDGET_TOTAL);
  });

  it("snaps each line to its own step, so committed numbers look chosen", () => {
    // `assets` moves in 25,000s.
    expect(cleanAllocation({ assets: 137_000 }).assets % 25_000).toBe(0);
  });

  /*
   * Averaging is what makes this a round two people play rather than one
   * person holding the money while the other watches.
   */
  it("commits the average of the two budgets", () => {
    const merged = mergeAllocations([{ marketing: 200_000 }, { marketing: 100_000 }]);
    expect(merged.marketing).toBe(150_000);
  });

  it("puts what rounding leaves over into the bank rather than losing it", () => {
    const merged = mergeAllocations([{ marketing: 500_000 }, { legal: 500_000 }]);
    expect(Object.values(merged).reduce((a, b) => a + b, 0)).toBe(BUDGET_TOTAL);
  });

  it("takes an overspend off the biggest line rather than wiping the small ones", () => {
    const trimmed = cleanAllocation({ "build-product": 900_000, community: 200_000 });
    expect(trimmed.community, "a small line should survive a trim intact").toBe(200_000);
    expect(trimmed["build-product"]).toBe(800_000);
  });

  /*
   * Half a senior engineer is not half a product — it is an unfilled role and
   * a hole in the bank. "We funded seven things badly" is the commonest way a
   * first million disappears, so the game names it.
   */
  it("flags a line funded below what it actually costs", () => {
    const summary = summariseBudget({ "first-engineer": 30_000, marketing: 100_000 });
    expect(summary.underfunded.map((l) => l.option.id)).toEqual(["first-engineer"]);
  });

  it("counts money in the bank as not deployed", () => {
    const summary = summariseBudget({ runway: 400_000, marketing: 200_000 });
    expect(summary.deployed).toBe(200_000);
    expect(summary.total).toBe(600_000);
  });

  it("breaks the spend down by group for the visual", () => {
    const summary = summariseBudget({ "first-engineer": 200_000, marketing: 200_000 });
    const shares = summary.byGroup.filter((g) => g.amount > 0);
    expect(shares).toHaveLength(2);
    expect(shares[0].share).toBeCloseTo(0.5);
  });

  it("won't commit a budget nobody touched, but will commit one banked on purpose", () => {
    expect(budgetIsReady({}).ok).toBe(false);
    expect(budgetIsReady({ runway: BUDGET_TOTAL }).ok, "banking it all is a real decision").toBe(true);
  });

  it("writes money the way the screens do", () => {
    expect(money(2_400_000_000)).toBe("$2.4B");
    expect(money(150_000)).toBe("$150k");
    expect(money(1_000_000)).toBe("$1.0M");
  });
});

describe("cleaning up what the model says", () => {
  const good = {
    scores: { growth: 820, capital: 640, product: 710, acquisition: 500, risk: 380 },
    tenYear: 4_200_000_000, peak: 5_000_000_000, peakYear: 8,
    summary: "A real business with an expensive customer.",
    notes: { growth: "Big market, compounding model." },
    advice: ["Fund sales before marketing."],
  };

  it("keeps a sane verdict intact", () => {
    const v = cleanVerdict(good);
    expect(v.scores.growth).toBe(820);
    expect(v.tenYear).toBe(4_200_000_000);
    expect(v.peakYear).toBe(8);
    expect(v.advice).toHaveLength(1);
  });

  it("clamps scores into 0–1000 however enthusiastic the model was", () => {
    const v = cleanVerdict({ scores: { growth: 1200, capital: -40, product: "high", acquisition: 700, risk: 99_999 } });
    expect(v.scores.growth).toBe(SCORE_MAX);
    expect(v.scores.capital).toBe(0);
    expect(v.scores.risk).toBe(SCORE_MAX);
  });

  it("treats a dimension the model forgot as middling, not zero", () => {
    expect(cleanVerdict({ scores: { growth: 800 } }).scores.capital).toBe(500);
  });

  it("caps a valuation at something a person would believe", () => {
    expect(cleanVerdict({ tenYear: 9e20 }).tenYear).toBe(VALUATION_CEILING);
  });

  /*
   * The peak is the highest it ever gets, and year ten is a year it passes
   * through, so a peak below the ten-year value is a contradiction. Models
   * produce it surprisingly often; believe the larger number rather than
   * throwing away somebody's half hour.
   */
  it("fixes a peak lower than the ten-year value instead of refusing the verdict", () => {
    const v = cleanVerdict({ tenYear: 900_000_000, peak: 100_000_000 });
    expect(v.peak).toBe(900_000_000);
  });

  it("survives complete nonsense, because a bad parse must not cost a game", () => {
    const v = cleanVerdict(null);
    expect(Object.keys(v.scores).sort()).toEqual(DIMENSIONS.map((d) => d.id).sort());
    expect(v.tenYear).toBe(0);
    expect(v.advice).toEqual([]);
  });
});

describe("the leaderboard", () => {
  const entry = (id: string, s: Partial<Scores>): { id: string; scores: Scores } => ({
    id,
    scores: { growth: 500, capital: 500, product: 500, acquisition: 500, risk: 500, ...s },
  });
  const scoreOf = (e: { scores: Scores }) => e.scores;

  it("ranks the highest first on the four where high is good", () => {
    const board = rankBy([entry("a", { growth: 300 }), entry("b", { growth: 900 })], "growth", scoreOf);
    expect(board[0].entry.id).toBe("b");
    expect(board[0].rank).toBe(1);
  });

  /*
   * The exception, and the reason direction lives on the dimension rather
   * than in whoever happens to be sorting. The board is called "Lowest risk";
   * if the number behind it meant safety, the label and the score would
   * disagree and somebody would eventually sort it the wrong way.
   */
  it("ranks the lowest first on risk, because the board says lowest", () => {
    const board = rankBy([entry("a", { risk: 800 }), entry("b", { risk: 120 })], "risk", scoreOf);
    expect(board[0].entry.id).toBe("b");
    expect(DIMENSIONS.find((d) => d.id === "risk")!.betterIs).toBe("lower");
  });

  /*
   * Two identical results are identical. Breaking the tie by id or by who
   * played first invents a difference and then shows it to both of them.
   */
  it("shares a rank on a tie and skips the next, the way finishing positions work", () => {
    const board = rankBy(
      [entry("a", { growth: 800 }), entry("b", { growth: 800 }), entry("c", { growth: 400 })],
      "growth", scoreOf,
    );
    expect(board.map((s) => s.rank)).toEqual([1, 1, 3]);
    expect(board[0].of).toBe(3);
  });

  /*
   * The headline board is not a dimension, so it used to be ranked separately
   * — by array position, which handed two companies on an identical score
   * first and second place. The five dimension boards shared the rank
   * correctly and the one people look at first did not, which is the worst way
   * for that inconsistency to exist: the boards are read side by side.
   */
  it("shares a rank on the overall board too, not just the dimensions", () => {
    const rows = [{ overall: 800 }, { overall: 800 }, { overall: 400 }];
    expect(rankOn(rows, (r) => r.overall).map((s) => s.rank)).toEqual([1, 1, 3]);
  });

  it("can rank the other way round when asked", () => {
    const rows = [{ n: 10 }, { n: 1 }];
    expect(rankOn(rows, (r) => r.n, "lower")[0].entry.n).toBe(1);
  });

  it("tells one pair where they landed on every board", () => {
    const mine = entry("mine", { growth: 900, risk: 900 });
    const all = [mine, entry("other", { growth: 100, risk: 100 })];
    const mineStandings = standingsFor(all, mine, scoreOf);
    expect(mineStandings.growth!.rank, "best growth").toBe(1);
    expect(mineStandings.risk!.rank, "riskiest, so last on lowest-risk").toBe(2);
  });

  /*
   * Every finished game should be able to say one true good thing about
   * itself. It is the line that makes somebody play again.
   */
  it("finds the board a pair did best on, by percentile not rank", () => {
    const mine = entry("mine", { capital: 950, growth: 500 });
    const all = [mine, ...Array.from({ length: 20 }, (_, i) => entry(`o${i}`, { capital: 100, growth: 900 }))];
    expect(bestBoard(all, mine, scoreOf)!.dimension.id).toBe("capital");
  });

  it("has a name for every score, so a screen never shows a bare number", () => {
    expect(scoreBand(950)).toBe("Exceptional");
    expect(scoreBand(100)).toBe("Struggling");
    for (let n = 0; n <= 1000; n += 25) expect(scoreBand(n).length).toBeGreaterThan(3);
  });

  /*
   * Risk is inverted into the overall rather than dropped: a company that
   * scores well everywhere because it is attempting something trivially safe
   * has not built the best startup in the room.
   */
  it("counts low risk as a good thing in the overall score", () => {
    const safe = { growth: 500, capital: 500, product: 500, acquisition: 500, risk: 100 } as Scores;
    const reckless = { ...safe, risk: 900 };
    expect(overallScore(safe)).toBeGreaterThan(overallScore(reckless));
  });

  it("puts the overall score on the same 0–1000 scale as everything else", () => {
    const top = { growth: 1000, capital: 1000, product: 1000, acquisition: 1000, risk: 0 } as Scores;
    expect(overallScore(top)).toBe(1000);
  });
});

/*
 * Round four keeps both lists instead of picking one. Two people listing what
 * their product does better are not in competition — a longer list of real
 * advantages beats either of their lists alone, and voting one out would be
 * the game destroying its own material.
 */
describe("what it does better than what exists", () => {
  const claim = (text: string, core = false) => ({ text, core });

  it("keeps both players' lists", () => {
    const merged = mergeClaims([[claim("Works offline")], [claim("Costs half")]]);
    expect(merged.map((c) => c.text)).toEqual(["Works offline", "Costs half"]);
  });

  it("keeps a claim they both wrote once", () => {
    const merged = mergeClaims([[claim("Works offline")], [claim("works offline.")]]);
    expect(merged).toHaveLength(1);
  });

  /*
   * Two people independently arriving at the same advantage, one of them
   * calling it essential, is the strongest signal this round produces.
   */
  it("treats a shared claim as core if either called it core", () => {
    const merged = mergeClaims([[claim("Works offline")], [claim("Works offline", true)]]);
    expect(merged[0].core).toBe(true);
  });

  /*
   * Concatenating would mean that when two lists exceed ten, the second
   * player's best idea is cut while the first player's tenth-best survives —
   * an arbitrary punishment for whoever the database returned second.
   */
  it("cuts fairly when the two lists together overflow", () => {
    const mine = Array.from({ length: 8 }, (_, i) => claim(`mine ${i}`));
    const theirs = Array.from({ length: 8 }, (_, i) => claim(`theirs ${i}`));
    const merged = mergeClaims([mine, theirs]);

    expect(merged).toHaveLength(MAX_CLAIMS);
    const fromMe = merged.filter((c) => c.text.startsWith("mine")).length;
    const fromThem = merged.filter((c) => c.text.startsWith("theirs")).length;
    expect(Math.abs(fromMe - fromThem), "an overflow should cost them equally").toBeLessThanOrEqual(1);
  });

  /*
   * The cap is the round's whole teaching mechanism: of the things this does
   * better, which are the reason it exists? A pair that marks all ten core
   * has said nothing.
   */
  it("holds the core list to three, keeping the earliest", () => {
    const merged = mergeClaims([[
      claim("one", true), claim("two", true), claim("three", true),
      claim("four", true), claim("five", true),
    ]]);
    expect(coreClaims(merged).map((c) => c.text)).toEqual(["one", "two", "three"]);
    expect(MAX_CORE_CLAIMS).toBe(3);
  });

  it("drops blanks and duplicates from one player's list", () => {
    const cleaned = cleanClaims([{ text: "  " }, { text: "Works offline" }, { text: "WORKS OFFLINE" }, { text: "x" }]);
    expect(cleaned.map((c) => c.text)).toEqual(["Works offline"]);
  });

  it("trims a claim somebody pasted an essay into", () => {
    expect(cleanClaims([{ text: "x".repeat(1000) }])[0].text.length).toBeLessThanOrEqual(160);
  });

  it("never takes more than ten from one player", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ text: `claim ${i}` }));
    expect(cleanClaims(many)).toHaveLength(MAX_CLAIMS);
  });

  it("won't commit a list with nothing marked core", () => {
    expect(claimsAreReady([claim("Works offline")]).ok).toBe(false);
    expect(claimsAreReady([claim("Works offline", true)]).ok).toBe(true);
    expect(claimsAreReady([]).ok).toBe(false);
  });

  it("copes with a payload that isn't a list at all", () => {
    expect(cleanClaims("nonsense")).toEqual([]);
    expect(cleanClaims(null)).toEqual([]);
  });
});
