/**
 * The metering rule for every AI route, read from the source on every run:
 * credits are checked before the model runs, charged only after it answered,
 * and never in an error path. A new AI route that charges first, charges in a
 * catch, skips the check, or charges a literal amount fails here.
 *
 * What the source can't show — a model that errors or answers with nothing
 * usable, against the running app — is test/integration/ai-metering-sweep.test.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { buildRouteCoverage, analyzeMetering, functionBody } from "../../server/route-coverage";
import { CREDIT_COSTS } from "@shared/plans";

const root = join(__dirname, "..", "..");
const walk = (d: string, out: string[] = []): string[] => {
  for (const n of readdirSync(d)) {
    if (["node_modules", ".git", "dist", "test-results", ".cache", ".local", "local_objects", "client", "mobile", "test", "e2e", "packages"].includes(n)) continue;
    const p = join(d, n);
    statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
};
const files = walk(root).filter((p) => /\.(ts|js)$/.test(p)).map((p) => ({ path: p.slice(root.length + 1), size: 0, content: readFileSync(p, "utf8") }));
const cov = buildRouteCoverage(files);
const live = cov.rows.filter((r) => r.mounted);
const costly = live.filter((r) => r.cost);
const label = (r: { method: string; path: string }) => `${r.method} ${r.path}`;

/** AI calls that are deliberately free, each with why. */
const FREE_AI: Record<string, string> = {
  "POST /api/mock-interviews/:id/finish": "the closing verdict — free, once per interview whose questions were paid for, and on the AI burst limit",
};

/** Routes that check in their own body but charge inside a helper: the helper is checked instead. */
const CHARGED_IN_HELPER: Record<string, [file: string, fn: string]> = {
  "POST /api/projects/:id/code-audit": ["server/code-audit-routes.ts", "runCodeAudit"],
  "POST /api/mcp/projects/:projectId/audit": ["server/code-audit-routes.ts", "runCodeAudit"],
  "POST /api/projects/:id/nova/suggest": ["server/nova-assist-routes.ts", "novaSuggest"],
  "POST /api/mcp/projects/:projectId/ask": ["server/nova-assist-routes.ts", "novaSuggest"],
};

/** Routes that charge a different amount from what they checked, each with why that's safe. */
const AMOUNT_EXCEPTIONS: Record<string, string> = {
  "POST /api/documents/:docId/fill": "charges the blocks actually filled — documentFillCost(filled) — which can't exceed the estimate checked",
  "POST /api/mock-interviews/:id/answer": "the follow-up question is checked and charged on its own, after it's generated",
};

const value = (expr: string): number | string => {
  const named = expr.match(/^CREDIT_COSTS\.(\w+)$/);
  if (named) return (CREDIT_COSTS as Record<string, number>)[named[1]];
  const n = Number(expr);
  return Number.isFinite(n) ? n : expr;
};

describe("metering every AI route", () => {
  it("finds the whole AI surface", () => {
    expect(costly.length).toBeGreaterThan(40);
  });

  it("meters every AI route, apart from one named free call that stays on the burst limit", () => {
    const unmetered = costly.filter((r) => !r.credits).map(label).filter((l) => !(l in FREE_AI));
    expect(unmetered, `AI routes with no requireCredits — a bare deductCredits skips the check and the burst limit:\n  ${unmetered.join("\n  ")}`).toEqual([]);
    for (const l of Object.keys(FREE_AI)) {
      const row = live.find((r) => label(r) === l);
      expect(row, `${l} is in FREE_AI but not in the code`).toBeTruthy();
      expect(row!.rateLimited, `${l} is free, so it has to stay on the AI burst limit`).toBe(true);
    }
  });

  it("checks before the model runs, charges after its answer is read, and never in an error path", () => {
    const rules = ["checkAfterModel", "chargeBeforeModel", "chargeBeforeParse", "chargeInCatch"] as const;
    const wrong = costly
      .filter((r) => r.metering && rules.some((k) => r.metering![k]))
      .map((r) => `${label(r)}: ${rules.filter((k) => r.metering![k]).join(", ")}`);
    expect(wrong).toEqual([]);
  });

  it("where a route charges in a helper, the helper charges after the model and not in a catch", () => {
    const inHelpers = costly.filter((r) => r.metering?.checks.length && !r.metering.charges.length).map(label).sort();
    expect(inHelpers).toEqual(Object.keys(CHARGED_IN_HELPER).sort());
    for (const [file, fn] of [...new Set(Object.values(CHARGED_IN_HELPER).map((x) => x.join("|")))].map((x) => x.split("|"))) {
      const body = functionBody(readFileSync(join(root, file), "utf8"), fn);
      expect(body, `${fn} in ${file}`).toBeTruthy();
      const facts = analyzeMetering(body!)!;
      expect(facts.charges.length, `${fn} never charges`).toBeGreaterThan(0);
      expect(facts.modelInBody, `${fn} doesn't call the model itself — check where it does`).toBe(true);
      expect(facts.chargeBeforeModel || facts.chargeBeforeParse || facts.chargeInCatch, `${fn} charges before the model, before reading it, or in a catch`).toBe(false);
    }
  });

  it("charges what it checked, by name — no literal amounts, and differences only where named", () => {
    const literals = costly.flatMap((r) => [...(r.metering?.checks ?? []), ...(r.metering?.charges ?? [])].filter((e) => /^\d+$/.test(e)).map((e) => `${label(r)}: ${e}`));
    expect(literals, "use a CREDIT_COSTS name, so the price lives in one place").toEqual([]);
    const differ = costly
      .filter((r) => r.metering?.checks.length && r.metering.charges.length)
      .filter((r) => { const checked = r.metering!.checks.map(value); return r.metering!.charges.map(value).some((c) => !checked.includes(c)); })
      .map(label);
    expect(differ.filter((l) => !(l in AMOUNT_EXCEPTIONS))).toEqual([]);
    for (const l of Object.keys(AMOUNT_EXCEPTIONS)) expect(differ, `${l} now charges what it checks — remove it from AMOUNT_EXCEPTIONS`).toContain(l);
  });
});
