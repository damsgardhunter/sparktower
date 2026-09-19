/**
 * The phone's copies of the engine, checked against the engine.
 *
 * Metro cannot resolve the web app's `@shared` alias, so the mobile client
 * re-implements by hand every piece of arithmetic it needs to show a number
 * before the server has confirmed it: what the table has committed, what a
 * raise costs in ownership, what research buys, what a seat may file. Each of
 * those mirrors names the file it copies in a comment, and every one of them
 * is a copy that can quietly stop being true.
 *
 * It has already happened twice. The fixed-cost mirror kept charging a
 * national payroll after the engine started scaling it by how much of the
 * country a company sells in, so a one-city team's live total was overstated
 * by most of its fixed costs. And a lever added on the server is a lever the
 * phone's validator does not know about, which is how a decision that was
 * perfectly legal started being refused.
 *
 * Neither was caught by either test suite, because each suite only ever sees
 * its own half. This file is the only place the two halves meet: it imports
 * both implementations and runs them on the same inputs. The mobile logic
 * modules are deliberately free of React Native imports, which is what makes
 * this possible at all — keep them that way.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import * as phone from "../../mobile/src/components/sim/desk";
import * as phoneLobby from "../../mobile/src/components/sim/lobby";
import { commitment, LEVER_FIELDS, validateDecision } from "@shared/simulation/levers";
import { fixedCosts, SALARY, EXECUTIVE } from "@shared/simulation/decisions";
import { saturate } from "@shared/simulation/market";
import { countdown, longCountdown } from "@shared/simulation/lobby-copy";
import { startingCompany } from "@shared/simulation/season";
import { nicheById } from "@shared/simulation/niches";
import { ROLES, type Company } from "@shared/simulation/types";

const niche = nicheById("dating_apps")!;
const company = (over: Partial<Company> = {}): Company => ({
  ...startingCompany({ id: "t", name: "T", niche, seats: [...ROLES] }),
  ...over,
});

describe("what the doors cost", () => {
  it("agrees with the engine at every footprint", () => {
    /*
     * The one that broke. The engine scales the fixed bill by how much of the
     * country a company sells in; the phone did not, and a one-city team was
     * shown a bill more than half again what it would actually be charged.
     */
    for (const reach of [0, 0.09, 0.12, 0.43, 0.7, 1]) {
      for (const headcount of [0, 5, 40]) {
        const mine = fixedCosts(company(), headcount, { costIndex: 1 } as any, reach);
        const theirs = phone.fixedCosts(headcount, 1, ROLES.length, reach);
        expect(theirs, `reach ${reach}, headcount ${headcount}`).toBeCloseTo(mine, 6);
      }
    }
  });

  it("uses the same salaries", () => {
    expect(phone.SALARY_PER_HEAD).toBe(SALARY);
    expect(phone.EXECUTIVE_SALARY).toBe(EXECUTIVE);
  });

  it("moves with the cost index the same way", () => {
    for (const costIndex of [0.9, 1, 1.17]) {
      expect(phone.fixedCosts(12, costIndex, 5, 1))
        .toBeCloseTo(fixedCosts(company(), 12, { costIndex } as any, 1), 6);
    }
  });
});

describe("what the table has committed", () => {
  const cases: { name: string; decisions: any; cities: string[] }[] = [
    { name: "nobody has filed", decisions: {}, cities: ["leeds"] },
    {
      name: "three seats spending",
      cities: ["leeds"],
      decisions: {
        cmo: { price: 22, brandSpend: 2_000_000, performanceSpend: 500_000, celebritySpend: 0, targetCities: ["leeds"] },
        cto: { featureSpend: 1_000_000, reliabilitySpend: 250_000, techDebtPaydown: 0, researchSpend: 400_000 },
        coo: { capacityTarget: 100_000, supportSpend: 300_000, efficiencySpend: 100_000, headcount: 8 },
      },
    },
    {
      name: "finance borrowing and holding money back",
      cities: ["leeds", "london"],
      decisions: {
        cmo: { price: 20, brandSpend: 100_000, performanceSpend: 0, celebritySpend: 0, targetCities: ["leeds", "london"] },
        cfo: { borrow: 2_000_000, repay: 500_000, cashBuffer: 1_000_000 },
      },
    },
    {
      name: "opening somewhere new",
      cities: ["leeds"],
      decisions: {
        cmo: { price: 20, brandSpend: 0, performanceSpend: 0, celebritySpend: 0, targetCities: ["leeds", "london", "bristol"] },
      },
    },
  ];

  for (const testCase of cases) {
    it(`agrees with the engine when ${testCase.name}`, () => {
      const c = company({ cities: testCase.cities });
      const mine = commitment(c, { companyId: "t", ...testCase.decisions }, { costIndex: 1 }, niche);
      const map = niche.cities.map((city) => ({ ...city, open: testCase.cities.includes(city.id) })) as any;
      const theirs = phone.commitment({
        company: {
          cash: c.cash,
          debt: c.debt,
          creditLimit: c.creditLimit,
          seats: [...c.seats],
          capacity: c.capacity,
        } as any,
        decisions: testCase.decisions,
        costIndex: 1,
        // The screen works reach out from the map and passes it; so does this.
        reach: phone.reachOf(map),
        cities: map,
      });

      expect(theirs.spend, "spend").toBeCloseTo(mine.spend, 4);
      expect(theirs.fixed, "fixed").toBeCloseTo(mine.fixed, 4);
      expect(theirs.available, "available").toBeCloseTo(mine.available, 4);
      expect(theirs.openingCost, "the cost of opening somewhere").toBeCloseTo(mine.openingCost, 4);
    });
  }
});

describe("what a year of research buys", () => {
  it("saturates the same way", () => {
    for (const spend of [0, 50_000, 150_000, 800_000, 5_000_000]) {
      expect(phone.saturate(spend, 150_000)).toBeCloseTo(saturate(spend, 150_000), 8);
    }
  });

  it("predicts what the engine will actually add", () => {
    /*
     * The phone shows "+12 quality, landing in two years" before anything is
     * filed. If that number is not the number the tick produces, the screen is
     * lying about the only lever whose whole point is patience.
     */
    for (const spend of [200_000, 800_000, 2_000_000]) {
      const engine = saturate(spend, 150_000) * 24 * niche.innovationPace;
      expect(phone.researchLanding(spend, niche.innovationPace)).toBeCloseTo(engine, 6);
    }
  });
});

describe("what a seat may file", () => {
  it("refuses and accepts the same drafts the server does", () => {
    /*
     * A validator that is stricter than the server refuses a legal decision;
     * one that is looser lets a player fill in a form and then be told no.
     * Both are worse than having no client validation at all.
     */
    const c = company();
    const drafts: { role: (typeof ROLES)[number]; draft: any }[] = [
      { role: "cmo", draft: { price: 22, brandSpend: 0, performanceSpend: 0, celebritySpend: 0, targetCities: ["leeds"] } },
      { role: "cmo", draft: { price: 22, brandSpend: -5, performanceSpend: 0, celebritySpend: 0, targetCities: [] } },
      { role: "cto", draft: { featureSpend: 100, reliabilitySpend: 0, techDebtPaydown: 0, researchSpend: 0 } },
      { role: "cfo", draft: { borrow: 0, repay: 0, cashBuffer: 0, raiseAmount: 1_000_000 } },
      { role: "cfo", draft: { borrow: 0, repay: 9_000_000, cashBuffer: 0, raiseAmount: 0 } },
      { role: "ceo", draft: { focus: "growth", positioning: "", rehire: "" } },
      { role: "ceo", draft: { focus: "nonsense", positioning: "", rehire: "" } },
      { role: "coo", draft: { capacityTarget: 1000, supportSpend: 0, efficiencySpend: 0, headcount: 0 } },
    ];

    for (const { role, draft } of drafts) {
      const mine = validateDecision(role, draft, c);
      const theirs = phone.validateDraft(LEVER_FIELDS[role] as any, draft, { debt: c.debt } as any, role);
      expect(theirs.ok, `${role}: ${JSON.stringify(draft)}`).toBe(mine.ok);
    }
  });

  it("knows about every lever the server offers", () => {
    // A lever added on the server that the phone's stepper cannot size is a
    // control that jumps by one against a field that moves in fifty thousands.
    for (const role of ROLES) {
      for (const field of LEVER_FIELDS[role]) {
        expect(phone.stepFor(field as any), `${role}.${field.id}`).toBe(field.step ?? 1);
      }
    }
  });
});

describe("the clock", () => {
  it("formats a lobby phase the same way", () => {
    for (const seconds of [0, 9, 59, 60, 61, 125, 899]) {
      expect(phoneLobby.formatCountdown(seconds), `${seconds}s`).toBe(countdown(seconds));
    }
  });

  it("formats a year the same way", () => {
    for (const seconds of [5, 59, 60, 3_600, 3_660, 86_400, 172_740]) {
      expect(phone.formatUntil(seconds), `${seconds}s`).toBe(longCountdown(seconds));
    }
  });
});

describe("what keeps this file able to run at all", () => {
  /*
   * The mirror modules must have no React Native anywhere in their import
   * graph, and that is not a style preference — it is the precondition for
   * every test above.
   *
   * This suite runs in the web app's test runner, which parses with Rollup.
   * React Native ships Flow source. The moment one of these modules reaches
   * `react-native`, directly or through six hops of theme file, the whole
   * suite stops loading and says:
   *
   *     Error: Expected 'from', got 'typeOf'
   *
   * No file name, no line, no import path. Nothing that suggests React Native,
   * nothing that suggests a mirror module. It took one `import { colors } from
   * "../../theme"` — four colour names, in one function that turns a loyalty
   * score into a label — to take the only check on phone/server agreement
   * offline, and a while to work out why.
   *
   * So the constraint is checked directly, by walking the graph from each
   * mirror module. A failure here names the file and the chain, which is the
   * whole difference between a five-minute fix and an afternoon.
   */
  const ROOT = resolve(__dirname, "../..");
  const ENTRIES = [
    "mobile/src/components/sim/desk.ts",
    "mobile/src/components/sim/lobby.ts",
  ];

  /**
   * Every module specifier a file imports or re-exports from.
   *
   * Comments are stripped first. The comment a few lines up quotes the exact
   * import that caused all this — `from "../../theme"` — and without this the
   * scanner dutifully found it and failed on a sentence explaining the rule it
   * was enforcing.
   */
  function importsOf(raw: string): string[] {
    const source = raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    const found: string[] = [];
    const patterns = [
      /\bfrom\s+["']([^"']+)["']/g,
      /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
      /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
    ];
    for (const re of patterns) {
      for (const m of source.matchAll(re)) found.push(m[1]);
    }
    return found;
  }

  function resolveLocal(from: string, spec: string): string | null {
    if (!spec.startsWith(".")) return null;
    const base = resolve(dirname(from), spec);
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
    return null;
  }

  it("never reaches React Native, however indirectly", () => {
    for (const entry of ENTRIES) {
      const start = resolve(ROOT, entry);
      const seen = new Set<string>();
      // The chain, so a failure says how it got there rather than only that it did.
      const how = new Map<string, string[]>([[start, [entry]]]);
      const queue = [start];

      while (queue.length > 0) {
        const file = queue.shift()!;
        if (seen.has(file)) continue;
        seen.add(file);

        const chain = how.get(file)!;
        for (const spec of importsOf(readFileSync(file, "utf-8"))) {
          if (!spec.startsWith(".")) {
            expect(
              spec,
              `${chain.join(" → ")} imports "${spec}". A mirror module's graph must stay free of React Native and Expo, or this whole file stops loading with an error that names nothing.`,
            ).not.toMatch(/^(react-native|expo|@expo|@react-native)/);
            continue;
          }
          const next = resolveLocal(file, spec);
          if (next && !seen.has(next)) {
            how.set(next, [...chain, spec]);
            queue.push(next);
          }
        }
      }
    }
  });
});
