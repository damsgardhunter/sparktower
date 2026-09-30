/**
 * What a company is worth at the end of a year, and why it is not just sales.
 *
 * The score was `sales × 1.2 + assets − debt`, with no term anywhere for
 * whether the sales paid for themselves. So volume was the whole of it, and a
 * business losing money outranked a smaller one making it.
 *
 * Measured across twelve markets and nine ways of playing them, taking every
 * pair where one company clearly made money and the other clearly lost it:
 * **thirty per cent had the profitable one ranked below the loss-making one**.
 * In restaurant chains a plan earning £58,772 a quarter came eighth of nine
 * while one losing £49,122 came fourth. That is not a close call about
 * weighting; it is the score measuring something other than whether the
 * business works.
 *
 * There is now an earnings term, and it is bounded. Unbounded it fails in both
 * directions at once: a heavy loss at a high multiple drives every company in a
 * hard market to the zero floor where they all tie and the score says nothing,
 * and on the other side it makes the company that spent nothing and banked a
 * small profit the best-scoring one in four markets. Inside a band, being
 * profitable is worth about as much as the sales themselves and being
 * loss-making costs nearly as much, and neither swamps what was built.
 */
import { describe, it, expect } from "vitest";
import { resolveYear } from "@shared/simulation/resolve";
import { buildWorld } from "@shared/simulation/season";
import { nicheById } from "@shared/simulation/niches";
import { EARNINGS_MULTIPLE, EARNINGS_BAND } from "@shared/simulation/mergers";
import { ROLES, type Role, type TeamDecisions } from "@shared/simulation/types";

const niche = nicheById("dating_apps")!;

/**
 * Two companies that sell the same thing to the same people for the same
 * price, and one of them is worse at making it.
 *
 * Isolating earnings needs exactly this. Spending more buys brand and product,
 * which buys customers, which is a bigger company and *should* score higher —
 * so a big spender is the wrong comparison. A thin margin is not: same
 * customers, same sales, less left over.
 */
const year = () => {
  const world = buildWorld({
    seasonId: "worth", niche, cadence: "quarterly",
    teams: [
      { id: "healthy", name: "Healthy", seats: [...ROLES] as Role[], officers: 1 },
      { id: "thin", name: "Thin", seats: [...ROLES] as Role[], officers: 1 },
    ],
  });
  const companies = world.companies.map((c) =>
    c.id === "thin" ? { ...c, unitCost: c.unitCost * 2.6 } : c);
  const filed = (id: string): TeamDecisions => ({ companyId: id } as unknown as TeamDecisions);
  const { reports } = resolveYear({ ...world, companies, year: 1 }, [filed("healthy"), filed("thin")], undefined, { withoutEvent: true });
  return {
    healthy: reports.find((r) => r.companyId === "healthy")!,
    thin: reports.find((r) => r.companyId === "thin")!,
  };
};

describe("what a year of running a company is worth", () => {
  it("counts whether the sales paid for themselves", () => {
    const { healthy, thin } = year();
    expect(thin.customers, "the two did not end up the same size, so this measures size")
      .toBe(healthy.customers);
    expect(thin.profit, "the thin-margin company did not actually earn less").toBeLessThan(healthy.profit);
    expect(thin.value, "two companies with identical sales scored the same however they earned")
      .toBeLessThan(healthy.value);
  });

  it("does not let earnings decide the whole number", () => {
    /*
     * The band. A company that burned four million is worth less, not nothing
     * — it still has the customers it has, and a score that collapses to zero
     * tells a team nothing about a year they spent playing.
     */
    const { thin } = year();
    expect(thin.debt, "it needed the emergency loan, so this measures debt rather than earnings").toBe(0);
    expect(thin.value, "a thin year was scored as no company at all").toBeGreaterThan(0);
    expect(thin.customers, "it ended with nobody, so this proves nothing").toBeGreaterThan(0);
  });

  it("keeps the two multiples in a sane relation to each other", () => {
    /*
     * Sales are multiplied by 1.2 and earnings by `EARNINGS_MULTIPLE`, which is
     * the ordinary shape of a real valuation: a year of revenue is worth about
     * a year of revenue, and a year of profit is worth several. The band is
     * what stops the second from swallowing the first.
     */
    expect(EARNINGS_MULTIPLE).toBeGreaterThan(1.2);
    expect(EARNINGS_BAND).toBeGreaterThan(0);
    expect(EARNINGS_BAND, "earnings may move the number by more than the sales are worth").toBeLessThan(1.2);
  });
});
