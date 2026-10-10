/**
 * The one that pops off.
 *
 * Every business like this has the same story in it — one video that went
 * further than anything before it and left the company permanently bigger —
 * and the engine had no way for it to happen. Four promises:
 *
 *   - **The work changes the odds, and money cannot.** Paid promotion already
 *     has its own path; a budget that could buy breakout chance would be a
 *     second advertising lever, and `an-edge-is-needed` exists to stop being
 *     louder beating being better.
 *   - **It is rare.** A company this happens to every month is not having
 *     breakouts, it is having a business model.
 *   - **A year is a year.** The same odds over a season whether the table
 *     files monthly or yearly — the mistake `founderPace` was written to fix.
 *   - **It lands on everything, and it stays.** Brand, standing, what you
 *     learned, and the room for the people who now know you exist.
 */
import { describe, it, expect } from "vitest";
import { BREAKOUT_BASE, breakoutFor, breakoutNote } from "@shared/simulation/breakout";
import { nicheById } from "@shared/simulation/niches";

const niche = nicheById("podcasts")!;

/** How often it happens over many seasons, at a given amount of work. */
function howOften(hours: number, quality: number, periods: number, tries = 4_000): number {
  let got = 0;
  for (let i = 0; i < tries; i++) {
    if (breakoutFor({ seed: `s${i}`, hoursOnTheWork: hours, quality, niche, periods })) got += 1;
  }
  return got / tries;
}

describe("whether one takes off", () => {
  it("happens to somebody doing nothing in particular, rarely", () => {
    const rate = howOften(0, 38, 12);
    expect(rate, "never happens, which is not a mechanic").toBeGreaterThan(0);
    expect(rate, "happens most months, which is not a breakout").toBeLessThan(0.02);
  });

  it("is likely enough over a season to be worth working for", () => {
    /*
     * The test that was missing, and its absence is why the first numbers
     * shipped useless: the others all hold that the odds *rise* with the work,
     * and none of them held that they were high enough for anybody to notice.
     * Measured in play, those numbers gave zero breakouts across nine markets
     * and a year each — 108 company-months — because a founder giving the work
     * the whole week had a one-in-ten chance over a season.
     *
     * So this is about a season rather than a period: somebody who commits the
     * week to it should expect one and never be promised one, and somebody who
     * does not should be surprised when it happens.
     */
    const overAYear = (hours: number, quality: number, periods: number) =>
      1 - Math.pow(1 - howOften(hours, quality, periods), periods);

    for (const periods of [1, 4, 12]) {
      const committed = overAYear(60, 60, periods);
      expect(committed, `${periods} periods: the whole week barely ever pays off`).toBeGreaterThan(0.35);
      expect(committed, `${periods} periods: it is close to guaranteed, which is not luck`).toBeLessThan(0.8);

      const idle = overAYear(0, 38, periods);
      expect(idle, `${periods} periods: it happens to everybody anyway`).toBeLessThan(0.2);
      expect(committed / Math.max(1e-9, idle), `${periods} periods: the work hardly matters`).toBeGreaterThan(2.5);
    }
  });

  it("gets likelier the more of the week goes into the work", () => {
    const idle = howOften(0, 38, 12);
    const some = howOften(30, 38, 12);
    const all = howOften(60, 38, 12);
    expect(some).toBeGreaterThan(idle);
    expect(all).toBeGreaterThan(some);
    /*
     * And by a margin worth the decision. A lever that moves the odds by a
     * rounding error is a lever nobody would reasonably pull.
     */
    expect(all / Math.max(1e-9, idle), "the whole week barely moved the odds").toBeGreaterThan(2);
  });

  it("does not get likelier just because the product is already good", () => {
    /*
     * This asserted the opposite, and the opposite was wrong — not as a
     * sentence about the world, where a better show does travel further, but
     * as a rule in this engine, because of who holds the better product.
     * Incumbents open at quality 81 and file no hours, so a quality term paid
     * them 19% a year against a startup's 13%: a lucky break that favoured the
     * market leader. The full suite priced that at four guards, every one of
     * them about relative advantage.
     *
     * The odds are the base plus the work, and the work is the only thing
     * anybody controls.
     */
    expect(howOften(0, 80, 12)).toBe(howOften(0, 20, 12));
    expect(howOften(60, 20, 12), "the work still has to matter").toBeGreaterThan(howOften(0, 80, 12));
  });

  it("cannot be bought — the odds take no money at all", () => {
    /*
     * Stated as a property of the signature rather than a measurement: there
     * is nowhere to put a budget. If somebody adds one, this stops compiling
     * and they have to come and read the note above.
     */
    const odds = breakoutFor({ seed: "x", hoursOnTheWork: 60, quality: 50, niche, periods: 12 });
    expect(odds === null || typeof odds.views === "number").toBe(true);
  });

  it("gives a season the same odds at every cadence", () => {
    /*
     * A monthly table rolls twelve times a year and a yearly table once, so
     * the per-period chance has to be the year's chance shared out — exactly
     * the correction `founderPace` makes for the founders' hours. Without it a
     * monthly season is twelve times as lucky for no reason anybody chose.
     */
    const monthly = howOften(60, 50, 12) * 12;
    const quarterly = howOften(60, 50, 4) * 4;
    const yearly = howOften(60, 50, 1) * 1;
    expect(monthly).toBeGreaterThan(yearly * 0.6);
    expect(monthly).toBeLessThan(yearly * 1.6);
    expect(quarterly).toBeGreaterThan(yearly * 0.6);
    expect(quarterly).toBeLessThan(yearly * 1.6);
  });
});

describe("what it does when it lands", () => {
  const some = Array.from({ length: 3_000 }, (_, i) =>
    breakoutFor({ seed: `hit${i}`, hoursOnTheWork: 60, quality: 90, niche, periods: 1 }))
    .filter((x): x is NonNullable<typeof x> => x !== null);

  it("lands on being known, on standing, on the product and on the room", () => {
    expect(some.length, "no breakouts to inspect").toBeGreaterThan(10);
    for (const got of some) {
      expect(got.brand).toBeGreaterThan(0);
      expect(got.reputation).toBeGreaterThan(0);
      expect(got.quality).toBeGreaterThan(0);
      /*
       * Reported, not granted. Granting room was tried and is what sank the
       * local-operator guard: free capacity a small firm cannot fill is an
       * idle-capacity bill, not a lucky break. What a hit brings is people at
       * the door; whether there is room for them is the operations decision.
       */
      expect(got.arrived, "a hit that brought nobody is not a hit").toBeGreaterThan(0);
    }
  });

  it("is mostly the small one, and a million is the story they tell for years", () => {
    const count = (t: string) => some.filter((g) => g.tier === t).length / some.length;
    expect(count("hundred")).toBeGreaterThan(count("half"));
    expect(count("half")).toBeGreaterThan(count("million"));
    expect(count("million"), "a million views should be rare").toBeLessThan(0.15);
  });

  it("is worth more the further it went", () => {
    const of = (t: string) => some.find((g) => g.tier === t);
    const small = of("hundred"); const big = of("million");
    if (small && big) {
      expect(big.brand).toBeGreaterThan(small.brand);
      expect(big.arrived).toBeGreaterThan(small.arrived);
    }
  });

  it("says what happened in words somebody would use", () => {
    const got = some[0];
    const said = breakoutNote(got, "listeners");
    expect(said).toMatch(/views/);
    expect(said).toMatch(/listeners/);
    expect(said, "it should say the odds are earned, not bought").toMatch(/cannot buy|more likely/i);
  });
});
