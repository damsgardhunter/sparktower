/**
 * Two audits, one delta: what moved, whether it counts as movement, and
 * the URL guard that keeps the runtime probe off the internal network.
 */
import { describe, it, expect } from "vitest";
import { computeAuditDelta, renderAuditDelta } from "@shared/audit-delta";
import { safeProbeUrl } from "../../server/runtime-probe";

const audit = (id: string, at: string, over: any = {}) => ({
  id, createdAt: at, completionPercent: over.completion ?? 50,
  signals: { routes: (over.routes ?? []).map((label: string) => ({ label, file: "x" })), dataModels: (over.tables ?? []).map((name: string) => ({ name, file: "y" })), guards: (over.guards ?? []).map((name: string) => ({ name, evidence: "z" })), testFiles: over.tests ?? 0, linesOfCode: over.loc ?? 1000, routeCoverage: over.cov ? { summary: over.cov } : undefined },
  findings: { capabilities: (over.caps ?? []).map(([area, status]: [string, string]) => ({ area, status, summary: "", evidence: [] })) },
});

describe("computeAuditDelta", () => {
  it("is honest about a first audit", () => {
    const d = computeAuditDelta(null, audit("b", "2026-09-10T00:00:00Z", { routes: ["GET /a"] }));
    expect(d).toMatchObject({ previousAuditId: null, daysSince: null, changed: false });
    expect(renderAuditDelta(d)).toMatch(/first audit/);
  });

  it("names what moved and counts it as movement", () => {
    const prev = audit("a", "2026-09-01T00:00:00Z", { routes: ["GET /a", "POST /b"], tables: ["users"], guards: ["Kill switches"], tests: 10, loc: 1000, caps: [["auth", "partial"], ["tests", "built"]], cov: { writesRateLimited: 40, writesWithAuth: 100, costlyMetered: 30, writes: 120 }, completion: 40 });
    const next = audit("b", "2026-09-10T12:00:00Z", { routes: ["GET /a", "POST /c"], tables: ["users", "path_pace"], guards: ["Kill switches", "Durable rate limiting"], tests: 18, loc: 1400, caps: [["auth", "built"], ["tests", "built"], ["mobile", "missing"]], cov: { writesRateLimited: 55, writesWithAuth: 110, costlyMetered: 44, writes: 130 }, completion: 62 });
    const d = computeAuditDelta(prev, next);
    expect(d).toMatchObject({
      previousAuditId: "a", daysSince: 9.5, changed: true,
      routes: { added: ["POST /c"], removed: ["POST /b"], before: 2, after: 2 },
      tables: { added: ["path_pace"], removed: [], before: 1, after: 2 },
      guards: { added: ["Durable rate limiting"], removed: [] },
      areas: [{ area: "auth", from: "partial", to: "built" }, { area: "mobile", from: "unreported", to: "missing" }],
      tests: { before: 10, after: 18 },
      completionPercent: { before: 40, after: 62 },
      coverage: { writesRateLimited: [40, 55], writes: [120, 130] },
    });
    const text = renderAuditDelta(d)!;
    expect(text).toMatch(/the code moved/);
    expect(text).toMatch(/Auth & sessions partial→built/);
    expect(text).toMatch(/writes rate-limited 40→55 of 130/);
  });

  it("does not call a trivial diff movement", () => {
    const prev = audit("a", "2026-09-01T00:00:00Z", { routes: ["GET /a"], loc: 1000, tests: 3 });
    const next = audit("b", "2026-09-02T00:00:00Z", { routes: ["GET /a"], loc: 1020, tests: 3 });
    expect(computeAuditDelta(prev, next).changed).toBe(false);
  });
});

describe("safeProbeUrl", () => {
  it("allows public http(s) and refuses anything that could reach inside", () => {
    expect(safeProbeUrl("https://sparktower.app/")?.hostname).toBe("sparktower.app");
    expect(safeProbeUrl("http://example.com:8080/x")?.port).toBe("8080");
    for (const bad of ["http://localhost:5001", "http://127.0.0.1", "http://10.0.0.5", "http://192.168.1.2", "http://169.254.169.254/latest", "http://172.16.0.1", "http://[::1]", "ftp://example.com", "file:///etc/passwd", "http://user:pw@example.com", "http://api.internal", "not a url", ""]) {
      expect(safeProbeUrl(bad), bad).toBeNull();
    }
  });
});
