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
import { buildCostPerUnit, leaseCostPerUnit } from "@shared/simulation/responsibilities";
import { featureCost } from "@shared/simulation/product";
import { programmeCost, researchCost, statementCost } from "@shared/simulation/world";
import { AUTOMATION_RATE, SHIFT_RATE, STOCK_RATE } from "@shared/simulation/factory";
import { SEVERANCE, payEffect } from "@shared/simulation/people";
import { describe, it, expect } from "vitest";
import { resolveYear } from "@shared/simulation/resolve";
import { buildWorld, economyFor, decisionsForYear, SEASON_YEARS } from "@shared/simulation/season";
import { botDecision } from "@shared/simulation/bots";
import { NICHES } from "@shared/simulation/niches";
import { ROLES } from "@shared/simulation/types";
import { accountLines, accountsReconcile } from "../../mobile/src/components/sim/report";
import { SERVING_TIGHT, servingAfter } from "@shared/simulation/mergers";
import { SERVING_TIGHT as PHONE_SERVING_TIGHT, serviceGap } from "../../mobile/src/components/sim/serving";
import { CADENCES, PERIOD_NAME, periodsPerYear, totalPeriods } from "@shared/simulation/cadence";
import {
  PERIOD_NAME as phonePeriodName, periodsPerYear as phonePeriodsPerYear,
  totalPeriodsIn as phoneTotalPeriodsIn,
} from "../../mobile/src/components/sim/period";
import { capacityRisk } from "@shared/simulation/forecast";
import {
  capacityRisk as phoneCapacityRisk, ORDER_FAR_TOO_MUCH as PHONE_ORDER_FAR_TOO_MUCH,
  type Forecast as PhoneForecast,
} from "../../mobile/src/components/sim/future";
import { readDecision as phoneReadDecision } from "../../mobile/src/components/sim/past";
import { readDecision as webReadDecision } from "../../client/src/components/sim/past-year";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import * as phone from "../../mobile/src/components/sim/desk";
import { connectionName as phoneName, searchConnections as phoneSearchConnections } from "../../mobile/src/connectionSearch";
import { connectionName as webName, searchConnections } from "../../client/src/lib/connection-search";
import { CROP as phoneCrop } from "../../mobile/src/profileCrop";
import { CROP_PRESETS } from "../../client/src/lib/image-crop";
import * as phoneProblem from "../../mobile/src/problemReport";
import { workingView as phoneWorkingView, WORKING_CURRENT_WIDTH as phoneCurrentWidth, WORKING_MIN_WIDTH as phoneMinWidth, WORKING_UNSTARTED_LABEL as phoneUnstarted } from "../../mobile/src/workingView";
import { workingView, WORKING_CURRENT_WIDTH, WORKING_MIN_WIDTH, WORKING_UNSTARTED_LABEL } from "../../client/src/lib/working-view";
import { auditStageLabel as phoneAuditStageLabel, AUDIT_STAGES as phoneAuditStages } from "../../mobile/src/auditStages";
import { auditStageLabel } from "../../client/src/lib/audit-status";
import * as phoneBuild from "../../mobile/src/buildStages";
import { buildThrough, buildProgress, buildStepLine, buildElapsedSeconds, buildStageLabel, STAGE_ORDER } from "../../client/src/lib/build-status";
import { BUILD_STAGE_COPY, BUILD_STEP_CAP } from "@shared/nova-build";
import * as phoneRewards from "../../mobile/src/backerRewards";
import { DIGITAL_REWARDS, OFFERABLE_DIGITAL_REWARDS, deliverableRewards, isRewardAvailable } from "@shared/backing";
import * as webProblem from "@shared/problem-reports";
import * as phoneLobby from "../../mobile/src/components/sim/lobby";
import { commitment, LEVER_FIELDS, validateDecision } from "@shared/simulation/levers";
import { fixedCosts, SALARY, EXECUTIVE } from "@shared/simulation/decisions";
import { salaryIn } from "@shared/simulation/workforce";
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
        const mine = fixedCosts(company(), headcount, { costIndex: 1 } as any, reach, niche);
        const theirs = phone.fixedCosts(headcount, 1, ROLES.length, reach, { perHead: salaryIn(niche) });
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
      expect(phone.fixedCosts(12, costIndex, 5, 1, { perHead: salaryIn(niche) }))
        .toBeCloseTo(fixedCosts(company(), 12, { costIndex } as any, 1, niche), 6);
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
    },    {
      name: "building room and leasing more",
      cities: ["leeds"],
      decisions: {
        coo: { capacityTarget: 900_000, supportSpend: 100_000, efficiencySpend: 0, headcount: 4, leaseCapacity: 120_000 },
      },
    },
    {
      name: "cutting room, which is not spending",
      cities: ["leeds"],
      decisions: {
        coo: { capacityTarget: 1_000, supportSpend: 0, efficiencySpend: 0, headcount: 4 },
      },
    },    {
      name: "the people money: engineer pay, hiring, training, a bonus and a firing",
      cities: ["leeds"],
      decisions: {
        cto: { featureSpend: 500_000, reliabilitySpend: 100_000, techDebtPaydown: 0, researchSpend: 0, engineerPay: 120 },
        coo: { capacityTarget: 1_000, supportSpend: 0, efficiencySpend: 0, headcount: 4, recruitingSpend: 75_000, trainingSpend: 50_000 },
        ceo: { focus: "growth", bonusPool: 200_000, replaceSeat: "coo", replaceBid: 300_000 },
      },
    },
    {
      name: "the plant: automating it, a second shift, and stock for next year",
      cities: ["leeds"],
      decisions: {
        coo: { capacityTarget: 1_000, supportSpend: 0, efficiencySpend: 0, headcount: 4, automationTarget: 40, shiftCapacity: 50_000, stockTarget: 30_000 },
      },
    },
    {
      name: "the world: a report, a win-back, a programme and a statement",
      cities: ["leeds"],
      decisions: {
        cmo: { price: 22, brandSpend: 0, performanceSpend: 0, celebritySpend: 0, targetCities: [], winbackSpend: 120_000, research: "rivals" },
        coo: { capacityTarget: 1_000, supportSpend: 0, efficiencySpend: 0, headcount: 4, programme: "quality" },
        ceo: { focus: "growth", shockAnswer: "statement" },
      },
    },
    {
      /*
       * A bid standing at auction. Not a decision — it lives in its own table and
       * is placed from the market screen between filings — so it is passed in
       * rather than drafted, and both sides have to put it on the same seat's line
       * or the meter tells the table a different story depending on the device.
       */
      name: "a sealed bid standing at auction",
      cities: ["leeds"],
      bids: 1_200_000,
      decisions: {
        cmo: { price: 22, brandSpend: 300_000, performanceSpend: 0, celebritySpend: 0, targetCities: [] },
        ceo: { focus: "growth", bonusPool: 50_000 },
      },
    },
    {
      name: "the bets: PR, referrals, security, data and a feature",
      cities: ["leeds"],
      decisions: {
        cmo: { price: 22, brandSpend: 0, performanceSpend: 0, celebritySpend: 0, targetCities: [], prSpend: 50_000, referralSpend: 75_000 },
        cto: { featureSpend: 0, reliabilitySpend: 0, techDebtPaydown: 0, researchSpend: 0, securitySpend: 100_000, dataSpend: 50_000, featureBet: "anything", featureMode: "copy", engineerPay: 90 },
      },
    },
  ];

  for (const testCase of cases) {
    it(`agrees with the engine when ${testCase.name}`, () => {
      const c = company({ cities: testCase.cities });
      const bids = (testCase as { bids?: number }).bids;
      const mine = commitment(c, { companyId: "t", ...testCase.decisions }, { costIndex: 1 }, niche, null, bids);
      const map = niche.cities.map((city) => ({ ...city, open: testCase.cities.includes(city.id) })) as any;
      const theirs = phone.commitment({
        perHead: salaryIn(niche),
        company: {
          cash: c.cash,
          debt: c.debt,
          creditLimit: c.creditLimit,
          seats: [...c.seats],
          officers: c.officers,
          scale: c.scale,
          capacity: c.capacity,
        } as any,
        decisions: testCase.decisions,
        costIndex: 1,
        bids,
        // The screen works reach out from the map and passes it; so does this.
        reach: phone.reachOf(map),
        cities: map,
        // As the desk sends them.
        prices: {
          build: buildCostPerUnit(niche), lease: leaseCostPerUnit(niche),
          featureBuild: featureCost(niche, "build"), featureCopy: featureCost(niche, "copy"),
          research: researchCost(niche), programme: programmeCost(niche), statement: statementCost(niche), expansion: 0,
          shift: buildCostPerUnit(niche) * SHIFT_RATE, stock: buildCostPerUnit(niche) * STOCK_RATE,
          automation: buildCostPerUnit(niche) * AUTOMATION_RATE,
        },
      });

      expect(theirs.spend, "spend").toBeCloseTo(mine.spend, 4);
      expect(theirs.fixed, "fixed").toBeCloseTo(mine.fixed, 4);
      expect(theirs.available, "available").toBeCloseTo(mine.available, 4);
      expect(theirs.openingCost, "the cost of opening somewhere").toBeCloseTo(mine.openingCost, 4);
      /*
       * And the sealed bids, both as the named exposure and inside the total. A
       * phone that showed the line but left it out of `spend` would be the worse
       * of the two bugs: the table would read "of which 1.2m is bid" above a total
       * that did not include it.
       */
      expect(theirs.bidsOutstanding, "sealed bids standing").toBeCloseTo(mine.bidsOutstanding, 4);
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
      // The responsibilities that arrive during the season.
      { role: "coo", draft: { capacityTarget: 1000, supportSpend: 0, efficiencySpend: 0, headcount: 0, leaseCapacity: 50_000 } },
      { role: "cmo", draft: { price: 22, brandSpend: 0, performanceSpend: 0, celebritySpend: 0, targetCities: [], forecast: 90_000, tiers: { swipers: 0, long_haulers: 150 } } },
      { role: "cmo", draft: { price: 22, brandSpend: 0, performanceSpend: 0, celebritySpend: 0, targetCities: [], tiers: { swipers: -1 } } },
      { role: "cmo", draft: { price: 22, brandSpend: 0, performanceSpend: 0, celebritySpend: 0, targetCities: [], tiers: "cheap" } },
      { role: "ceo", draft: { focus: "growth", positioning: "", rehire: "", budget: { cmo: 40, cto: 30, coo: 30 } } },
      { role: "ceo", draft: { focus: "growth", positioning: "", rehire: "", budget: { cmo: 70, cto: 40 } } },
      { role: "cfo", draft: { borrow: 0, repay: 0, cashBuffer: 0, borrowTerm: "long", holdBack: 10, holdBackSeat: "cto", annualDiscount: 15 } },
      { role: "cfo", draft: { borrow: 0, repay: 0, cashBuffer: 0, holdBack: 25 } },
      { role: "cfo", draft: { borrow: 0, repay: 0, cashBuffer: 0, borrowTerm: "forever" } },
      { role: "cfo", draft: { borrow: 0, repay: 0, cashBuffer: 0, holdBack: "" } },
      // The people levers.
      { role: "ceo", draft: { focus: "growth", positioning: "", rehire: "", targets: { cmo: "aggressive", cto: "easy" }, bonusPool: 200_000 } },
      { role: "ceo", draft: { focus: "growth", positioning: "", rehire: "", targets: { cmo: "brutal" } } },
      { role: "ceo", draft: { focus: "growth", positioning: "", rehire: "", overrule: "cmo", replaceSeat: "coo", replaceBid: 250_000 } },
      { role: "cto", draft: { featureSpend: 0, reliabilitySpend: 0, techDebtPaydown: 0, researchSpend: 0, engineerPay: 120 } },
      { role: "cto", draft: { featureSpend: 0, reliabilitySpend: 0, techDebtPaydown: 0, researchSpend: 0, engineerPay: 150 } },
      { role: "coo", draft: { capacityTarget: 1000, supportSpend: 0, efficiencySpend: 0, headcount: 0, recruitingSpend: 50_000, trainingSpend: -1 } },
      { role: "cfo", draft: { borrow: 0, repay: 0, cashBuffer: 0, costReview: 10 } },
      // Borrowing past the line.
      { role: "cfo", draft: { borrow: 900_000_000, repay: 0, cashBuffer: 0 } },
      // The depth: regions and segments aimed at, the plant, the balance sheet.
      { role: "cmo", draft: { price: 22, brandSpend: 0, performanceSpend: 0, celebritySpend: 0, targetCities: [], regionFocus: { leeds: 60, london: 40 }, segmentFocus: { swipers: 50 } } },
      { role: "cmo", draft: { price: 22, brandSpend: 0, performanceSpend: 0, celebritySpend: 0, targetCities: [], regionFocus: { leeds: 80, london: 80 } } },
      { role: "coo", draft: { capacityTarget: 1000, supportSpend: 0, efficiencySpend: 0, headcount: 0, automationTarget: 60, shiftCapacity: 10_000, stockTarget: 5_000, sourcing: "outsourced" } },
      { role: "coo", draft: { capacityTarget: 1000, supportSpend: 0, efficiencySpend: 0, headcount: 0, automationTarget: 140 } },
      { role: "cfo", draft: { borrow: 0, repay: 0, cashBuffer: 0, terms: 90, factorPct: 50, refinance: 500_000, buyback: 1_000_000 } },
      // The world's levers.
      { role: "cmo", draft: { price: 22, brandSpend: 0, performanceSpend: 0, celebritySpend: 0, targetCities: [], promo: "free_month", winbackSpend: 50_000, research: "expectations" } },
      { role: "cfo", draft: { borrow: 0, repay: 0, cashBuffer: 0, insurance: "all", dividendPct: 40 } },
      { role: "cfo", draft: { borrow: 0, repay: 0, cashBuffer: 0, dividendPct: 200 } },
      { role: "ceo", draft: { focus: "growth", positioning: "", rehire: "", deals: { "6-distribution": "accept" }, shockAnswer: "statement" } },
      { role: "cto", draft: { featureSpend: 0, reliabilitySpend: 0, techDebtPaydown: 0, researchSpend: 0, dealVotes: { "6-distribution": "yes" } } },
      { role: "cto", draft: { featureSpend: 0, reliabilitySpend: 0, techDebtPaydown: 0, researchSpend: 0, dealVotes: { "6-distribution": "maybe" } } },
    ];

    for (const { role, draft } of drafts) {
      const mine = validateDecision(role, draft, c);
      const theirs = phone.validateDraft(LEVER_FIELDS[role] as any, draft, { debt: c.debt, creditLimit: c.creditLimit } as any, role);
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
    "mobile/src/components/sim/past.ts",
    "mobile/src/components/sim/future.ts",
    "mobile/src/components/sim/report.ts",
    "mobile/src/components/sim/serving.ts",
    "mobile/src/components/sim/period.ts",
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

describe("the numbers the phone copies by hand", () => {
  it("agree with the engine's", () => {
    expect(phone.SEVERANCE).toBe(SEVERANCE);
    for (const pct of [undefined, 80, 100, 115, 130, 150]) expect(phone.payCost(pct)).toBeCloseTo(payEffect(pct as any).cost, 10);
  });
});

/**
 * Finding somebody to message, on both clients.
 *
 * Messages has a picker over your connections, and the matching behind it is
 * written twice: `client/src/lib/connection-search.ts` and
 * `mobile/src/connectionSearch.ts`. The phone's copy had already drifted before
 * either was extracted — it matched the name and the headline but not the
 * username, and left the list in the order the server sent it, which is by when
 * each connection was made. Neither suite could see it, because each only ever
 * saw its own half: the web had no picker at all, and the phone's was a filter
 * written inline in a screen.
 *
 * The failure is quiet in the worst way. A search that has stopped looking at
 * usernames returns nothing for a handle typed from memory, and "no connection
 * by that name" is indistinguishable from "that person never connected with you".
 */
describe("searching your connections", () => {
  const row = (over: { firstName?: string; lastName?: string; displayName?: string; username?: string; headline?: string }) => ({
    user: { firstName: over.firstName, lastName: over.lastName },
    profile: (over.displayName || over.username || over.headline)
      ? { displayName: over.displayName, username: over.username, headline: over.headline }
      : undefined,
  });

  /*
   * Everybody here has a name. The one place the two sides differ on purpose is
   * the fallback for somebody who has none: the phone's `personName` refuses to
   * print an email and says "Builder", the web prints the address before "User".
   * That is a deliberate rule on the phone, and the email is redacted from
   * anybody else's account before it leaves the server anyway — so excluding
   * nameless rows here excludes the known difference and nothing else.
   */
  const people = [
    row({ displayName: "Zara Ferreira", username: "zaraf", headline: "Designer, mostly mobile" }),
    row({ displayName: "Ada Marchetti", username: "adam", headline: "Backend and data" }),
    row({ firstName: "Nils", lastName: "Ferreira" }),
    row({ displayName: "Quinn", username: "qq", headline: "Design systems" }),
    row({ firstName: "Bo", lastName: "Adams", headline: "Ships on Fridays" }),
  ];

  it("matches and orders the same rows as the web app", () => {
    for (const query of [
      "", "   ", "a", "ada", "ADA MARCH", "ferreira", "zaraf", "qq",
      "design", "Design Systems", "ships", "bo", "nils",
      "nobody-by-that-name", "@", "  ferreira  ",
    ]) {
      const onWeb = searchConnections(people as any, query).map((c) => webName(c as any));
      const onPhone = phoneSearchConnections(people, query).map((c) => phoneName(c));
      expect(onPhone, `query ${JSON.stringify(query)}`).toEqual(onWeb);
    }
  });

  /* The two drifts that were actually there, named so a revert fails loudly. */
  it("matches a username on both, which the phone used not to", () => {
    expect(phoneSearchConnections(people, "zaraf").map(phoneName)).toEqual(["Zara Ferreira"]);
    expect(searchConnections(people as any, "zaraf").map((c) => webName(c as any))).toEqual(["Zara Ferreira"]);
  });

  it("sorts by name on both, not by when the connection was made", () => {
    const byName = ["Ada Marchetti", "Bo Adams", "Nils Ferreira", "Quinn", "Zara Ferreira"];
    expect(phoneSearchConnections(people, "").map(phoneName)).toEqual(byName);
    expect(searchConnections(people as any, "").map((c) => webName(c as any))).toEqual(byName);
  });

  it("leaves the caller's array alone on both, since the query cache owns it", () => {
    const original = [...people];
    phoneSearchConnections(people, "");
    searchConnections(people as any, "");
    expect(people).toEqual(original);
  });
});

/**
 * The shape a profile picture is cut to, on both clients.
 *
 * Both crop before uploading — the web with its own cropper, the phone by handing
 * the job to the native crop UI — and both store the result, so the ratio is
 * baked into the file rather than applied when it is shown. Which means a cover
 * framed 4:1 on one client and 16:9 on the other would land differently in the
 * same band, and nothing would fail: both would look deliberate, and only side
 * by side would either look wrong.
 *
 * Not a mirror of logic, then, but of a number that has to be the same number.
 */
describe("the shape a profile picture is cut to", () => {
  it("is the same on the phone as on the web", () => {
    expect(phoneCrop.avatar[0] / phoneCrop.avatar[1], "a round avatar is square").toBe(CROP_PRESETS.avatar.aspect);
    expect(phoneCrop.cover[0] / phoneCrop.cover[1], "the cover band is 4:1").toBe(CROP_PRESETS.cover.aspect);
  });

  /*
   * And that the web's own frame still matches the band it is framing. The band
   * is `aspect-[4/1]` in client/src/pages/landing.tsx's sibling, the profile
   * page; a preset that stopped agreeing with it would put the cropper back to
   * promising a framing the page does not keep.
   */
  it("keeps the web preset square for the avatar and four-to-one for the cover", () => {
    expect(CROP_PRESETS.avatar.outWidth).toBe(CROP_PRESETS.avatar.outHeight);
    expect(CROP_PRESETS.cover.outWidth / CROP_PRESETS.cover.outHeight).toBe(4);
  });
});

/**
 * What counts as a problem report, on both clients.
 *
 * The server answers 400 with a sentence meant to be shown verbatim, and both
 * clients check the same rule first so a message too short to be useful does not
 * cost a round trip to be told so. Which means the rule is written twice, and the
 * refusal *wording* is written twice with it.
 *
 * This caught a real drift while it was being written: the phone's copy had the
 * ceiling at 2,000 characters against the server's 1,000. The failure that would
 * have caused is the quiet kind — a long report passes on the phone, the button
 * enables, the person sends it, and the server rejects it with a message about a
 * limit the screen had just told them they were inside.
 */
describe("what counts as a problem report", () => {
  it("has the same bounds on the phone as on the server", () => {
    expect(phoneProblem.PROBLEM_MESSAGE_MIN).toBe(webProblem.PROBLEM_MESSAGE_MIN);
    expect(phoneProblem.PROBLEM_MESSAGE_MAX).toBe(webProblem.PROBLEM_MESSAGE_MAX);
  });

  it("accepts and refuses the same messages, with the same words", () => {
    const max = webProblem.PROBLEM_MESSAGE_MAX;
    for (const input of [
      "", "   ", "a", "abc", "abcd", "  abcd  ", "the save button does nothing",
      "x".repeat(max - 1), "x".repeat(max), "x".repeat(max + 1), "x".repeat(max * 2),
      undefined, null, 42, {}, [], true,
    ] as unknown[]) {
      const onPhone = phoneProblem.readProblemMessage(input);
      const onServer = webProblem.readProblemMessage(input);
      expect(onPhone, `input ${JSON.stringify(input)?.slice(0, 40)}`).toEqual(onServer);
    }
  });

  /* The path is stored so a report can be reproduced; both sides strip it the same. */
  it("reduces a path to a path the same way", () => {
    for (const input of [
      "/project/123", "/project/123?tab=brief", "/project/123#notes", "/",
      "relative", "https://evil.test/x", "//evil.test", "", "  /spaced  ",
      "/" + "x".repeat(400), undefined, null, 7,
    ] as unknown[]) {
      expect(phoneProblem.readProblemPath(input), `input ${JSON.stringify(input)?.slice(0, 40)}`)
        .toBe(webProblem.readProblemPath(input));
    }
  });
});

/**
 * What a Nova wait draws, on both clients.
 *
 * The phone showed the stage as a sentence in small grey text — "reading ·
 * 1:05" — which says which of three phases is running and not that there are
 * three. A read sitting in "reading" for ninety seconds therefore looked exactly
 * like one that had stopped. It now draws the web's segmented bar, which means
 * both clients answer "which segment is filled" and "what is this wait called",
 * and a disagreement would show the same run at two different states.
 *
 * The waits are the longest thing in the product and the phone's are longer than
 * the web's, same model call over a worse connection — so this is the mirror most
 * likely to be looked at while something is going wrong.
 */
describe("what a Nova wait draws", () => {
  const stages = [
    { id: "fetching", label: "Fetching your code" },
    { id: "reading", label: "Nova is reading it" },
    { id: "saving", label: "Saving what it found" },
  ];

  it("agrees on the bar and the label at every stage", () => {
    const progresses = [undefined, null, 0, 0.01, 0.5, 1, 2, -1, Number.NaN, Number.POSITIVE_INFINITY];
    for (const current of [undefined, null, "", "fetching", "reading", "saving", "not-a-stage"]) {
      for (const saying of [undefined, null, "Uploading the zip"]) {
        for (const progress of progresses) {
          const onWeb = workingView(stages, current, saying, progress);
          const onPhone = phoneWorkingView(stages, current, saying, progress);
          expect(onPhone, `current=${current} saying=${saying} progress=${progress}`).toEqual(onWeb);
        }
      }
    }
  });

  /* The three rules that make the bar honest, asserted on both rather than described. */
  it("draws an unrecognised stage as nothing started, not as the first one finished", () => {
    for (const view of [workingView(stages, "not-a-stage"), phoneWorkingView(stages, "not-a-stage")]) {
      expect(view.index).toBe(-1);
      expect(view.widths).toEqual([0, 0, 0]);
      expect(view.label).toBe(WORKING_UNSTARTED_LABEL);
    }
    expect(phoneUnstarted).toBe(WORKING_UNSTARTED_LABEL);
  });

  it("fills the finished stages and part-fills the current one", () => {
    for (const view of [workingView(stages, "saving"), phoneWorkingView(stages, "saving")]) {
      expect(view.widths).toEqual([100, 100, WORKING_CURRENT_WIDTH]);
    }
    expect(phoneCurrentWidth).toBe(WORKING_CURRENT_WIDTH);
  });

  it("floors a known progress, so a stage that has just begun reads as begun", () => {
    for (const view of [workingView(stages, "reading", null, 0), phoneWorkingView(stages, "reading", null, 0)]) {
      expect(view.widths[1]).toBe(WORKING_MIN_WIDTH);
    }
    expect(phoneMinWidth).toBe(WORKING_MIN_WIDTH);
  });

  /* And the words a stage is given, which both clients look up separately. */
  it("names each stage the same way on both", () => {
    for (const id of ["fetching", "reading", "saving", "", "unknown", null, undefined]) {
      expect(phoneAuditStageLabel(id), String(id)).toBe(auditStageLabel(id));
    }
  });
});

/**
 * A whole-business build in flight, on both clients.
 *
 * The phone could *start* this and then showed nothing: the button fired, a toast
 * said "Nova is building it", and the app was silent for the length of a forty-
 * step job — no stage, no step count, no completion, and no error if the run died.
 * From the buyer's side that is indistinguishable from a fourteen-dollar outcome
 * that silently failed, which makes this the most expensive thing in the product
 * to get wrong and the one the phone said least about.
 *
 * Now both read the same run and have to describe it the same way. Two of these
 * rules are the kind that look like details and are not:
 *
 *   - **Steps left for the builder count as gone through.** `stepsForYou` is a
 *     decision Nova researched and deliberately left open — work done, not work
 *     skipped. Excluding it stalls the bar on a run that is still working.
 *   - **A fraction only during `building`.** The other three stages are seconds
 *     each and know nothing about their own position, so a number there would be
 *     invented, and an invented number that looks precise is worse than an
 *     honest unknown.
 */
describe("a whole-business build in flight", () => {
  const run = (over: Partial<{ stage: string; stepsDone: number; stepsForYou: number; stepsFailed: number; stepsTotal: number; currentTitle: string | null; elapsedSeconds: number; startedAt: string }> = {}) => ({
    id: "r1", stage: "building", stageLabel: "Working through your path",
    stepsDone: 10, stepsForYou: 3, stepsFailed: 1, stepsTotal: 28,
    currentTitle: "Writing your pricing page",
    startedAt: new Date("2026-10-01T12:00:00Z").toISOString(), elapsedSeconds: 600,
    ...over,
  }) as any;

  it("lists the same stages, with the same words", () => {
    expect(phoneBuild.BUILD_STAGES).toEqual([...STAGE_ORDER]);
    expect(phoneBuild.BUILD_STAGE_COPY).toEqual(BUILD_STAGE_COPY);
    expect(phoneBuild.BUILD_STEP_CAP, "how many steps one purchase covers").toBe(BUILD_STEP_CAP);
    for (const stage of [...STAGE_ORDER, "", "unknown", null, undefined]) {
      expect(phoneBuild.buildStageLabel(stage as any), String(stage)).toBe(buildStageLabel(stage as any));
    }
  });

  it("counts the same steps as gone through", () => {
    for (const over of [
      {}, { stepsForYou: 0 }, { stepsFailed: 0 }, { stepsDone: 0, stepsForYou: 0, stepsFailed: 0 },
      { stepsDone: 28, stepsForYou: 0, stepsFailed: 0 },
    ]) {
      expect(phoneBuild.buildThrough(run(over))).toBe(buildThrough(run(over)));
    }
    /* Named, because dropping either term is the bug that stalls the bar. */
    expect(buildThrough(run({ stepsDone: 10, stepsForYou: 3, stepsFailed: 1 }))).toBe(14);
  });

  it("offers the same fraction, and the same refusal to invent one", () => {
    for (const stage of [...STAGE_ORDER, "unknown"]) {
      for (const over of [{ stepsTotal: 28 }, { stepsTotal: 0 }, { stepsDone: 999, stepsTotal: 28 }]) {
        const r = run({ stage, ...over });
        expect(phoneBuild.buildProgress(r), `${stage} ${JSON.stringify(over)}`).toBe(buildProgress(r));
      }
    }
    expect(buildProgress(run({ stage: "reading" })), "no fraction outside building").toBeNull();
    expect(buildProgress(null)).toBeNull();
    expect(phoneBuild.buildProgress(null)).toBeNull();
  });

  it("names the same step, clamped to the total", () => {
    for (const over of [{}, { stepsTotal: 0 }, { stepsDone: 28, stepsForYou: 0, stepsFailed: 0 }]) {
      expect(phoneBuild.buildStepLine(run(over))).toBe(buildStepLine(run(over)));
    }
    expect(buildStepLine(run()), "counted from one").toBe("step 15 of 28");
    expect(buildStepLine(run({ stepsDone: 28, stepsForYou: 0, stepsFailed: 0 })), "never one past the end").toBe("step 28 of 28");
  });

  it("agrees on the elapsed time, and never runs it backwards", () => {
    const started = new Date("2026-10-01T12:00:00Z").toISOString();
    for (const [elapsedSeconds, now] of [
      [600, Date.parse(started) + 700_000],
      [600, Date.parse(started) + 100_000],
      [0, Date.parse(started)],
      [600, Number.NaN],
    ] as const) {
      const r = run({ elapsedSeconds, startedAt: started });
      expect(phoneBuild.buildElapsedSeconds(r, now), `${elapsedSeconds} @ ${now}`).toBe(buildElapsedSeconds(r, now));
    }
    /* The clock is ahead of the last poll, so the number ticks rather than stepping. */
    expect(buildElapsedSeconds(run({ elapsedSeconds: 600, startedAt: started }), Date.parse(started) + 700_000)).toBe(700);
    /* And a stale poll never drags it back. */
    expect(buildElapsedSeconds(run({ elapsedSeconds: 600, startedAt: started }), Date.parse(started) + 100_000)).toBe(600);
  });
});

/**
 * Which backer rewards exist, on both clients.
 *
 * Two of them did not: a wallpaper and a profile frame, both declared as things
 * the *platform* generates, with nothing anywhere that does. A creator could
 * promise either and a backer could pay for a rung advertising it, and the
 * creator is the one who looks like they broke the promise.
 *
 * Withdrawn rather than deleted, because eight tiers already name those keys and
 * an unknown key renders to a backer as the raw string. So "which of these can
 * actually be delivered" is now a fact the two clients have to agree on — and the
 * phone keeps its own hand copy of the catalogue, which is exactly the shape of
 * drift this file exists for. A phone still offering a wallpaper would be the web
 * having withdrawn it and the phone not hearing.
 */
describe("which backer rewards exist", () => {
  it("is the same catalogue, key for key and label for label", () => {
    expect(phoneRewards.DIGITAL_REWARDS.map((r) => r.key)).toEqual(DIGITAL_REWARDS.map((r) => r.key));
    for (const web of DIGITAL_REWARDS) {
      const phone = phoneRewards.DIGITAL_REWARDS.find((r) => r.key === web.key);
      expect(phone, web.key).toBeTruthy();
      expect(phone!.label, web.key).toBe(web.label);
      expect(phone!.fulfilledBy, web.key).toBe(web.fulfilledBy);
    }
  });

  it("agrees on which ones cannot be delivered", () => {
    for (const web of DIGITAL_REWARDS) {
      expect(phoneRewards.isRewardAvailable(web.key), web.key).toBe(isRewardAvailable(web.key));
    }
    expect(phoneRewards.OFFERABLE_DIGITAL_REWARDS.map((r) => r.key))
      .toEqual(OFFERABLE_DIGITAL_REWARDS.map((r) => r.key));
  });

  /* Named on both sides, so putting either back has to be done twice and on purpose. */
  it("withholds the wallpaper and the profile frame on both", () => {
    for (const key of ["wallpaper", "profile_frame"]) {
      expect(isRewardAvailable(key), `web: ${key}`).toBe(false);
      expect(phoneRewards.isRewardAvailable(key), `phone: ${key}`).toBe(false);
    }
  });

  it("filters a saved tier the same way", () => {
    for (const saved of [
      ["backer_wall", "wallpaper", "digital_badge"],
      ["profile_frame"],
      ["backer_wall", "believer_number"],
      [],
      ["something_new"],
    ]) {
      expect(phoneRewards.deliverableRewards(saved), JSON.stringify(saved)).toEqual(deliverableRewards(saved));
    }
  });
});

/*
 * The phone's Past and Future screens, against the two things they copy.
 *
 * Both screens existed on the web for months and on the phone not at all, and
 * the data for both had been on the wire the whole time — `lastFiled`,
 * `standing`, `forecast` and `idleCostPerUnit` were sent and never read. So the
 * copies are new, which is exactly when a mirror is worth pinning: the first
 * divergence is the one nobody is looking for.
 */
describe("the phone's reading of last year and next", () => {
  it("draws the same capacity verdict as the engine, at every boundary", () => {
    /*
     * The verdict decides whether a seat is told it has too much room or too
     * little, and the thresholds are a chain of comparisons with no slack in
     * them — so this walks the boundaries rather than sampling the middles. A
     * phone and a web client disagreeing about the same numbers is worse than a
     * phone that shows nothing.
     */
    const forecast: PhoneForecast = {
      likely: 1_000, low: 800, high: 1_200, band: 0.2,
      bySegment: [], curve: [], price: 50,
    };
    const around = [
      0, 1, 799, 800, 801, 999, 1_000, 1_001, 1_199, 1_200, 1_201,
      Math.floor(1_200 * 1.3) - 1, Math.floor(1_200 * 1.3), Math.ceil(1_200 * 1.3) + 1, 50_000,
    ];
    for (const capacity of around) {
      const args = { capacity, forecast, price: 50, idleCostPerUnit: 4.5 };
      expect(phoneCapacityRisk(args), `capacity ${capacity} reads differently on the phone`)
        .toEqual(capacityRisk(args));
    }
  });

  it("keeps the phone's over-ordering threshold the same as the web's", () => {
    /*
     * `ORDER_FAR_TOO_MUCH` is a local const inside the web's `ForecastCard` and
     * cannot be imported, so it is read out of the source. Textual, and that is
     * the point: if somebody retunes the web's number the phone's has to follow,
     * and nothing else in either suite would notice.
     */
    const web = readFileSync(resolve(__dirname, "../../client/src/pages/simulation-desk.tsx"), "utf-8");
    const found = web.match(/const ORDER_FAR_TOO_MUCH = ([\d.]+)/);
    expect(found, "the web's ORDER_FAR_TOO_MUCH has moved or been renamed").toBeTruthy();
    expect(Number(found![1])).toBe(PHONE_ORDER_FAR_TOO_MUCH);
  });

  it("reads a filed decision exactly as the web reads it", () => {
    /*
     * Both clients are showing the same record of what a team committed, and the
     * team will compare them — one person on a laptop, one on a phone, in the
     * same conversation. Every branch of the formatter is covered here because
     * the branches are picked by a regular expression over key names, which is
     * the kind of thing that drifts silently when a lever is added.
     */
    const filed = {
      companyId: "c1",
      price: 1_250,
      brandSpend: 240_000,
      performanceSpend: 0,
      celebritySpend: null,
      targetCities: ["london", "leeds"],
      regionFocus: { london: 60, leeds: 40 },
      segmentFocus: {},
      research: "none",
      tiers: "",
      holdBack: 15,
      engineerPay: 110,
      automationTarget: 25,
      headcount: 14,
      capacityTarget: 9_500,
      positioning: "homeowners",
      annualDiscount: 10,
      borrow: 500_000,
      raiseAmount: 0,
      factorPct: 30,
    };
    /* The web's own money formatter, so the comparison is of the reading and not of the currency. */
    const money = (n: number) =>
      n >= 1_000_000 ? `£${(n / 1_000_000).toFixed(1)}m` : n >= 1_000 ? `£${Math.round(n / 1_000)}k` : `£${Math.round(n)}`;
    expect(phoneReadDecision(filed, money)).toEqual(webReadDecision(filed));
  });

  it("leaves a seat that filed nothing readable as having filed nothing", () => {
    /*
     * The most useful thing a table can learn from the year behind it, and the
     * easiest to render as an empty box. Both clients have to agree that an
     * absent payload is zero lines rather than one line saying "—".
     */
    expect(phoneReadDecision(undefined)).toEqual([]);
    expect(webReadDecision(undefined)).toEqual([]);
    expect(phoneReadDecision(null)).toEqual([]);
  });
});

/*
 * The phone's year-end report, against accounts the engine actually produced.
 *
 * The web's report screen states that every total on it is the sum of the lines
 * above it. That is the claim worth testing from the phone's side, and it cannot
 * be tested against a fixture somebody wrote: the failure it guards against is a
 * cost being added to the engine and not to the phone's list of lines, which
 * leaves a report wrong by exactly the new line and looking entirely reasonable.
 * Nobody reconciles a screen by hand.
 *
 * So this runs real seasons in every market, takes the accounts out of the
 * reports, and reconciles them through the phone's own `accountLines`.
 */
describe("the phone's year-end accounts", () => {
  it("adds up to the profit the engine wrote, in every market", () => {
    let checked = 0;
    let worstOperating = 0;
    let worstProfit = 0;
    let where = "";

    for (const niche of NICHES) {
      for (const seed of ["rec1", "rec2"]) {
        let world = buildWorld({ seasonId: seed, niche, teams: [{ id: "t", name: "T", seats: [...ROLES] }] });
        const last = new Map<string, any>();
        for (let year = 1; year <= SEASON_YEARS; year++) {
          const company = world.companies.find((c) => c.id === "t");
          if (!company || company.bankruptSince) break;
          const submitted: Record<string, unknown> = {};
          for (const role of ROLES) {
            const d = botDecision({
              ventureId: "t", company, niche, role, year, world,
              skill: "survivor", previous: last.get(role) as any,
            });
            if (d) { submitted[role] = d; last.set(role, d); }
          }
          const { decisions } = decisionsForYear({ company, niche, submitted: submitted as any, previous: undefined });
          const out = resolveYear({ ...world, year }, [decisions], economyFor(seed, year, 1));
          const report = out.reports.find((r) => r.companyId === "t");
          world = out.world;
          if (!report?.pnl) continue;

          const recon = accountsReconcile(report.pnl as any);
          checked++;
          if (Math.abs(recon.operatingOut) > Math.abs(worstOperating)) {
            worstOperating = recon.operatingOut;
            where = `${niche.id} year ${year}`;
          }
          if (Math.abs(recon.profitOut) > Math.abs(worstProfit)) worstProfit = recon.profitOut;
        }
      }
    }

    /* A sweep that checked nothing would pass every assertion below it. */
    expect(checked, "no accounts were produced, so nothing was reconciled").toBeGreaterThan(50);
    /*
     * A pound of slack, not a percentage: these are floats summed in a different
     * order from the engine's own, and the figures run to millions. Anything
     * larger than rounding means a line is missing from `accountLines`, and the
     * message names the market so it is findable.
     */
    expect(
      Math.abs(worstOperating),
      `the phone's cost lines do not add up to the engine's operating profit — worst at ${where}, out by ${worstOperating.toFixed(2)}. A cost was probably added to ProfitAndLoss and not to accountLines.`,
    ).toBeLessThan(1);
    expect(
      Math.abs(worstProfit),
      `operating profit less tax does not equal the profit the engine wrote, out by ${worstProfit.toFixed(2)}`,
    ).toBeLessThan(1);
  }, 120_000);

  it("names a seat against every cost, which is the whole point of the card", () => {
    /*
     * "We lost two million" is not an argument a table can have. "Marketing spent
     * 2.1m to win 900k" is. Every line needs an owner, and the owners have to be
     * seats a player recognises rather than internal role codes.
     */
    const pnl = {
      revenue: 1_000, costToServe: 1, salaries: 1, marketing: 1, product: 1, operations: 1,
      idleCapacity: 1, capacity: 1, planning: 0, incidents: 1, partners: 1, insurance: 1,
      interest: 1, operatingProfit: 0, tax: 0, profit: 0, lossesCarried: 0,
    };
    const lines = accountLines(pnl);
    expect(lines.length).toBeGreaterThan(8);
    const seats = new Set(lines.map((l) => l.seat));
    for (const seat of seats) {
      expect(["operations", "marketing", "technology", "finance", "the table"]).toContain(seat);
    }
    for (const line of lines) {
      expect(line.label, "a cost line with no label").toBeTruthy();
    }
  });

  it("keeps a nil line rather than dropping it", () => {
    /*
     * A zero against "Idle capacity" is a fact about the year, and a seat looking
     * for it should find it rather than wonder whether it was left out or never
     * happened. It also keeps the column the same height year to year.
     */
    const empty = {
      revenue: 0, costToServe: 0, salaries: 0, marketing: 0, product: 0, operations: 0,
      idleCapacity: 0, interest: 0, operatingProfit: 0, tax: 0, profit: 0, lossesCarried: 0,
    };
    expect(accountLines(empty).length).toBe(accountLines({ ...empty, idleCapacity: 5 }).length);
    expect(accountsReconcile(empty).costs).toBe(0);
  });
});

/*
 * Whether you could serve the customers you are about to buy.
 *
 * Two copies of one sum, which is the condition this file exists for. The engine
 * owns the thresholds (`servingAfter`), the web imports them, and the phone
 * re-implements them in `serviceGap` because Metro cannot reach `@shared`.
 *
 * It is worth pinning harder than most mirrors because of what the sum decides.
 * `applyAcquisition` hands the buyer every customer the seller had and none of
 * their plant, so anybody beyond capacity is turned away — in public, in the year
 * every other team is watching the company that just bought somebody. The asking
 * price says nothing about it and `canOffer` will not refuse it. A phone and a web
 * client disagreeing about whether a deal is survivable is worse than neither
 * warning at all, because one of them is then trusted.
 */
describe("whether a buyer could serve what it is buying", () => {
  it("agrees with the engine on the arithmetic and the verdict", () => {
    const cases = [
      { capacity: 10_000, customers: 4_000, theirs: 3_000 },   // comfortable
      { capacity: 10_000, customers: 5_000, theirs: 4_000 },   // exactly at the tight line
      { capacity: 10_000, customers: 5_000, theirs: 4_001 },   // just over it
      { capacity: 10_000, customers: 6_000, theirs: 4_000 },   // exactly full
      { capacity: 10_000, customers: 6_000, theirs: 4_001 },   // one customer short
      { capacity: 10_000, customers: 9_000, theirs: 9_000 },   // badly short
      { capacity: 0, customers: 0, theirs: 500 },              // no plant at all
      { capacity: 1, customers: 0, theirs: 0 },                // nothing moving
    ];
    for (const c of cases) {
      const engine = servingAfter(c);
      const phone = serviceGap({ you: { capacity: c.capacity, customers: c.customers }, target: { customers: c.theirs } });
      expect(phone.held, `held disagrees at ${JSON.stringify(c)}`).toBe(engine.holding);
      expect(phone.capacity, `capacity disagrees at ${JSON.stringify(c)}`).toBe(engine.room);
      expect(phone.short, `shortfall disagrees at ${JSON.stringify(c)}`).toBe(engine.turnedAway);
      expect(phone.over, `"over" disagrees at ${JSON.stringify(c)}`).toBe(engine.verdict === "short");
      expect(phone.tight, `"tight" disagrees at ${JSON.stringify(c)}`).toBe(engine.verdict === "tight");
    }
  });

  it("keeps the tight threshold the same on both sides", () => {
    expect(PHONE_SERVING_TIGHT).toBe(SERVING_TIGHT);
  });

  it("says nothing at all when the server sent no figures, rather than reassuring anybody", () => {
    /*
     * The phone's own careful bit, and the one place it is allowed to differ: with
     * no capacity on the payload there is nothing honest to say, and a guess here
     * would read as "this deal is fine". `line` is null and the screen draws
     * nothing.
     */
    expect(serviceGap({ you: null, target: { customers: 500 } }).line).toBeNull();
    expect(serviceGap({ you: undefined, target: { customers: 500 } }).line).toBeNull();
    expect(serviceGap({ you: { capacity: Number.NaN, customers: 0 }, target: { customers: 5 } }).line).toBeNull();
  });

  it("always has something to say when it does have the figures", () => {
    /*
     * Including the reassuring case. A warning that appears only when something is
     * wrong teaches people that its absence means nothing was checked.
     */
    for (const c of [{ capacity: 10_000, customers: 1, theirs: 1 }, { capacity: 10, customers: 100, theirs: 100 }]) {
      const phone = serviceGap({ you: { capacity: c.capacity, customers: c.customers }, target: { customers: c.theirs } });
      expect(phone.line, `no line for ${JSON.stringify(c)}`).toBeTruthy();
    }
  });
});

/*
 * The phone's period vocabulary, against the engine's.
 *
 * Most routes send `period` and `totalPeriods` ready-made, and the phone prefers
 * them — but the room route sends bare `cadence`, so the phone has to be able to
 * work the words and the span out for itself. That means a copy of
 * `PERIOD_NAME`, `PERIODS_PER_YEAR` and `totalPeriods`, and a copy is a thing
 * that stops being true.
 *
 * The failure it would cause is the one the phone just had: `year` counts periods
 * and `totalYears` is in years, and a screen dividing one by the other said
 * "Year 7 of 4" in a quarterly season — past its own end, with the bar at full.
 * A phone that disagreed with the engine about how many quarters are in a year
 * would say it again, differently.
 */
describe("the phone's period vocabulary", () => {
  it("uses the same words for a decision as the engine", () => {
    for (const cadence of ["yearly", "quarterly", "monthly"] as const) {
      expect(phonePeriodName[cadence], `${cadence} is worded differently on the phone`)
        .toEqual(PERIOD_NAME[cadence]);
    }
  });

  it("agrees on how many decisions a year is", () => {
    for (const cadence of ["yearly", "quarterly", "monthly"] as const) {
      expect(phonePeriodsPerYear(cadence), `${cadence} divides differently on the phone`)
        .toBe(periodsPerYear(cadence));
    }
  });

  it("agrees on how many decisions a season is, at every length and cadence", () => {
    /*
     * The actual sum behind "of 16". Walked across lengths rather than sampled,
     * because the two implementations round in their own code and a disagreement
     * would most likely be at an odd length.
     */
    for (const cadence of ["yearly", "quarterly", "monthly"] as const) {
      for (const years of [1, 2, 3, 4, 5, 7, 10, 14]) {
        expect(phoneTotalPeriodsIn(years, cadence), `${years} years ${cadence} disagrees`)
          .toBe(totalPeriods(years, cadence));
      }
    }
  });

  it("covers every cadence the engine has, so a new one cannot be missed quietly", () => {
    /*
     * `CADENCES` is the engine's list. A fourth cadence added there and not here
     * would fall back to "year" on the phone and read as a bug in the season
     * rather than a gap in a mirror.
     */
    for (const cadence of CADENCES) {
      expect(Object.keys(phonePeriodName), `the phone has no words for "${cadence}"`).toContain(cadence);
    }
  });
});
