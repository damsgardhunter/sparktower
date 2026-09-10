/**
 * The difference between two audits, computed from their stored signals
 * and findings. Pure, so it can be tested without a database and rendered
 * anywhere. Positive `changed` means the code moved: that is activity for
 * the pace model, and it is what lets a "verified" milestone be verified
 * by evidence rather than by a click.
 */
import { areaLabel, type CapabilityEntry } from "./capabilities";

export interface AuditDelta {
  previousAuditId: string | null;
  previousAt: string | null;
  daysSince: number | null;
  changed: boolean;
  routes: { added: string[]; removed: string[]; before: number; after: number };
  tables: { added: string[]; removed: string[]; before: number; after: number };
  guards: { added: string[]; removed: string[] };
  areas: { area: string; from: string; to: string }[];
  tests: { before: number; after: number };
  linesOfCode: { before: number; after: number };
  completionPercent: { before: number | null; after: number | null };
  coverage: { writesRateLimited: [number, number]; writesWithAuth: [number, number]; costlyMetered: [number, number]; writes: [number, number] } | null;
}

interface AuditLike {
  id: string;
  createdAt: Date | string;
  completionPercent: number | null;
  signals: any;
  findings: any;
}

const labels = (xs: any[] | undefined, key: string) => new Set<string>((xs ?? []).map((x: any) => String(x?.[key] ?? x)));
const diff = (before: Set<string>, after: Set<string>) => ({
  added: [...after].filter((x) => !before.has(x)).sort(),
  removed: [...before].filter((x) => !after.has(x)).sort(),
});

export function computeAuditDelta(prev: AuditLike | null | undefined, next: AuditLike): AuditDelta {
  const ps = prev?.signals ?? {}, ns = next.signals ?? {};
  const routes = diff(labels(ps.routes, "label"), labels(ns.routes, "label"));
  const tables = diff(labels(ps.dataModels, "name"), labels(ns.dataModels, "name"));
  const guards = diff(labels(ps.guards, "name"), labels(ns.guards, "name"));
  const pc = new Map<string, string>(((prev?.findings?.capabilities ?? []) as CapabilityEntry[]).map((c) => [c.area, c.status]));
  const areas = ((next.findings?.capabilities ?? []) as CapabilityEntry[])
    .map((c) => ({ area: c.area, from: pc.get(c.area) ?? "unreported", to: c.status }))
    .filter((a) => prev && a.from !== a.to && a.to !== "unreported");
  const cov = ps.routeCoverage?.summary && ns.routeCoverage?.summary
    ? {
        writesRateLimited: [ps.routeCoverage.summary.writesRateLimited, ns.routeCoverage.summary.writesRateLimited] as [number, number],
        writesWithAuth: [ps.routeCoverage.summary.writesWithAuth, ns.routeCoverage.summary.writesWithAuth] as [number, number],
        costlyMetered: [ps.routeCoverage.summary.costlyMetered, ns.routeCoverage.summary.costlyMetered] as [number, number],
        writes: [ps.routeCoverage.summary.writes, ns.routeCoverage.summary.writes] as [number, number],
      }
    : null;
  const before = prev ? new Date(prev.createdAt).getTime() : null;
  const daysSince = before ? Math.round(((new Date(next.createdAt).getTime() - before) / 86_400_000) * 10) / 10 : null;
  const changed = !!prev && (
    routes.added.length + routes.removed.length + tables.added.length + tables.removed.length + guards.added.length > 0
    || areas.length > 0
    || (ns.testFiles ?? 0) !== (ps.testFiles ?? 0)
    || Math.abs((ns.linesOfCode ?? 0) - (ps.linesOfCode ?? 0)) > 50
  );
  return {
    previousAuditId: prev?.id ?? null,
    previousAt: prev ? new Date(prev.createdAt).toISOString() : null,
    daysSince,
    changed,
    routes: { ...routes, before: (ps.routes ?? []).length, after: (ns.routes ?? []).length },
    tables: { ...tables, before: (ps.dataModels ?? []).length, after: (ns.dataModels ?? []).length },
    guards,
    areas,
    tests: { before: ps.testFiles ?? 0, after: ns.testFiles ?? 0 },
    linesOfCode: { before: ps.linesOfCode ?? 0, after: ns.linesOfCode ?? 0 },
    completionPercent: { before: prev?.completionPercent ?? null, after: next.completionPercent ?? null },
    coverage: cov,
  };
}

/** The delta as prompt text. Says plainly when it's the first audit. */
export function renderAuditDelta(d: AuditDelta | null | undefined): string | null {
  if (!d) return null;
  if (!d.previousAuditId) return "SINCE THE LAST AUDIT: this is the first audit, so there is no code-level velocity yet.";
  const lst = (xs: string[], n = 12) => xs.length ? `${xs.slice(0, n).join(", ")}${xs.length > n ? ` … +${xs.length - n}` : ""}` : "none";
  const lines = [
    `SINCE THE LAST AUDIT (${d.daysSince} days ago): ${d.changed ? "the code moved." : "no meaningful change in the code."}`,
    `- Routes ${d.routes.before}→${d.routes.after}. Added: ${lst(d.routes.added)}. Removed: ${lst(d.routes.removed, 6)}.`,
    `- Tables ${d.tables.before}→${d.tables.after}. Added: ${lst(d.tables.added)}. Removed: ${lst(d.tables.removed, 6)}.`,
    d.guards.added.length || d.guards.removed.length ? `- Mechanisms added: ${lst(d.guards.added)}. Removed: ${lst(d.guards.removed)}.` : null,
    d.areas.length ? `- Areas that moved: ${d.areas.map((a) => `${areaLabel(a.area)} ${a.from}→${a.to}`).join("; ")}.` : "- No area changed status.",
    `- Tests ${d.tests.before}→${d.tests.after} files; lines of code ${d.linesOfCode.before.toLocaleString()}→${d.linesOfCode.after.toLocaleString()}; completion ${d.completionPercent.before ?? "?"}%→${d.completionPercent.after ?? "?"}%.`,
    d.coverage ? `- Coverage: writes rate-limited ${d.coverage.writesRateLimited[0]}→${d.coverage.writesRateLimited[1]} of ${d.coverage.writes[1]}; writes with auth ${d.coverage.writesWithAuth[0]}→${d.coverage.writesWithAuth[1]}; costly metered ${d.coverage.costlyMetered[0]}→${d.coverage.costlyMetered[1]}.` : null,
  ].filter(Boolean);
  return lines.join("\n");
}
