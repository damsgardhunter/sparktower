/**
 * Spotting a rewrite that throws code away.
 *
 * The cases are the shapes a model's rewrite actually takes: exports dropped
 * outright, a named export quietly turned into a default one, a file mostly
 * replaced while keeping its names — and the ordinary additive edit, which must
 * not be flagged, or the warning becomes noise people learn to click through.
 */
import { describe, it, expect } from "vitest";
import { exportedNames, rewriteRisk } from "../src/risk.js";

/** The real case, in miniature: a module the server boots from, "extended" by rewriting it. */
const ANALYTICS = `import type { Express } from "express";
export interface ActivityInput { name: string }
export const attachVisitor = (req: any, _res: any, next: () => void) => { next(); };
export async function recordActivity(input: ActivityInput): Promise<void> {
  void input;
}
export const captureWrites = (_req: any, _res: any, next: () => void) => next();
export function registerAnalyticsIngest(app: Express) {
  app.post("/api/track", () => {});
}
export function startAnalyticsJobs(): void {
  setInterval(() => {}, 1000);
}
${Array.from({ length: 15 }, (_, i) => `// retention detail ${i}`).join("\n")}
`;

describe("exportedNames", () => {
  it("reads every kind of named export, lists included", () => {
    const names = exportedNames(`export function a() {}
export async function b() {}
export const c = 1;
export class D {}
export abstract class E {}
export interface F {}
export type G = string;
export enum H { X }
export { i, j as k };
export type { L };
`);
    expect([...names].sort()).toEqual(["D", "E", "F", "G", "H", "L", "a", "b", "c", "i", "k"]);
  });

  it("keeps a default export apart from the named ones", () => {
    const names = exportedNames("export default function registerAnalyticsRoutes() {}\n");
    expect([...names]).toEqual(["default"]);
  });
});

describe("rewriteRisk", () => {
  it("flags a rewrite that drops the exports other files import", () => {
    const risk = rewriteRisk(ANALYTICS, `export const track = () => {};\n`);
    expect(risk.destructive).toBe(true);
    expect(risk.lostExports).toEqual(["ActivityInput", "attachVisitor", "captureWrites", "recordActivity", "registerAnalyticsIngest", "startAnalyticsJobs"]);
  });

  it("counts a named export turned into a default as lost — every `import { x }` breaks", () => {
    const risk = rewriteRisk(
      "export function registerAnalyticsRoutes(app: any) {\n  app.get('/x', () => {});\n}\n",
      "export default function registerAnalyticsRoutes(app: any) {\n  app.get('/x', () => {});\n}\n",
    );
    expect(risk.lostExports).toEqual(["registerAnalyticsRoutes"]);
    expect(risk.destructive).toBe(true);
  });

  it("leaves an additive edit alone", () => {
    const risk = rewriteRisk(ANALYTICS, `${ANALYTICS}\nexport function trackExplore() {}\n`);
    expect(risk).toEqual({ lostExports: [], removedLines: 0, totalLines: risk.totalLines, destructive: false });
  });

  it("flags a file mostly replaced even when its names survive", () => {
    const current = Array.from({ length: 30 }, (_, i) => `const step${i} = ${i};`).join("\n") + "\nexport const pipeline = 1;\n";
    const proposed = "export const pipeline = 2;\n";
    const risk = rewriteRisk(current, proposed);
    expect(risk.lostExports).toEqual([]);
    expect(risk.destructive).toBe(true);
    expect(risk.removedLines).toBe(31);
  });

  it("doesn't flag a small file redone on purpose", () => {
    const risk = rewriteRisk("export const a = 1;\nconst b = 2;\n", "export const a = 3;\nconst c = 4;\n");
    expect(risk.destructive).toBe(false);
  });
});
