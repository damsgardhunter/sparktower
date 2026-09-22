/**
 * The capability inventory: the audit's first-class answer to "what does
 * this codebase already have", area by area, with the files and routes
 * that prove it. Produced by the model from the digest, validated against
 * the files and routes the digest actually saw, stored on the audit, and
 * quoted by every later Nova prompt — so a plan never re-proposes what
 * exists and never cites a file that doesn't.
 */
export const CAPABILITY_AREAS = [
  { id: "auth", label: "Auth & sessions", counts: "sign-up/sign-in, sessions or tokens, route guards, password hashing or a managed auth SDK" },
  { id: "rateLimiting", label: "Rate limiting", counts: "a limiter on writes, auth attempts or costly endpoints; durable (database-backed) beats in-memory" },
  { id: "moderation", label: "Moderation & reporting", counts: "user reports, a review queue, take-down or suspend actions, an immutable log" },
  { id: "payments", label: "Payments & billing", counts: "a payment provider, checkout or subscriptions, webhook verification, credits or quotas" },
  { id: "ai", label: "AI routes", counts: "model calls behind endpoints, prompt/response handling, cost or credit metering on them" },
  { id: "analytics", label: "Analytics & metrics", counts: "event capture, funnels or retention queries, an admin or owner dashboard" },
  { id: "data", label: "Data & persistence", counts: "a schema with real tables, migrations or push, storage for uploads" },
  { id: "tests", label: "Tests", counts: "unit or integration tests that run, a test database strategy, E2E" },
  { id: "ci", label: "CI", counts: "a pipeline that runs typecheck, lint and tests on push or PR" },
  { id: "deploy", label: "Deploy & operability", counts: "a deploy config or live URL, environment contract, health check, kill switches or feature flags" },
  { id: "mobile", label: "Mobile", counts: "a native or Expo app that talks to the same API, with its own auth flow" },
] as const;

export type CapabilityArea = (typeof CAPABILITY_AREAS)[number]["id"];
/**
 * Four verdicts and a fifth thing that is not a verdict.
 *
 * "unknown" is the one that had to be added: not found in what the audit read.
 * The audit reads a digest, and a digest is a view — lists are clipped, most
 * files appear as excerpts, an archive can be cut to a byte budget. For three
 * audits running, that view's edges were reported as the product's edges: a
 * shipped wedge told to cancel itself, an admin safety loop with every route,
 * page and test in place graded four partial steps, tables declared in
 * shared/schema.ts listed as absent from the code.
 *
 * "missing" is a claim about the repository. "unknown" is a claim about the
 * read, and the only honest one to make when the read didn't cover the area.
 * Nothing downstream may treat it as a gap: it is a question, not work.
 *
 * The model never returns it — it is applied deterministically after the fact
 * (server/audit-claims.ts, downgradeUnreadCapabilities), because a model asked
 * to know what it didn't see will guess.
 */
export const CAPABILITY_STATUSES = ["built", "partial", "missing", "unknown", "unreported"] as const;
export type CapabilityStatus = (typeof CAPABILITY_STATUSES)[number];

/** How each verdict reads to a person. */
export const CAPABILITY_STATUS_LABEL: Record<CapabilityStatus, string> = {
  built: "built",
  partial: "partial",
  missing: "missing",
  unknown: "not read",
  unreported: "unreported",
};

/**
 * Words that mean an area, for matching prose against the inventory.
 *
 * Used only to annotate a recommendation whose area the audit could not read —
 * "build X" where X is unknown rather than missing. Kept tight on purpose: a
 * false match adds a sentence to a fair recommendation, which is cheap, but a
 * loose one would add it to half of them, which is noise.
 */
export const AREA_TERMS: Record<CapabilityArea, string[]> = {
  auth: ["auth", "sign-in", "sign in", "sign-up", "sign up", "login", "log in", "session", "password"],
  rateLimiting: ["rate limit", "rate-limit", "ratelimit", "throttl"],
  moderation: ["moderat", "report queue", "take-down", "takedown", "suspend"],
  payments: ["payment", "billing", "stripe", "checkout", "subscription", "paywall"],
  ai: ["ai route", "ai endpoint", "model call", "prompt", "llm", "openai"],
  analytics: ["analytic", "funnel", "retention", "event tracking", "metrics dashboard"],
  data: ["schema", "migration", "database table", "persistence", "drizzle", "prisma"],
  tests: ["test suite", "unit test", "integration test", "tests", "e2e", "coverage"],
  ci: ["ci ", "ci/", "continuous integration", "pipeline", "github action"],
  deploy: ["deploy", "health check", "feature flag", "kill switch", "environment contract"],
  mobile: ["mobile app", "expo", "react native", "native app", "ios app", "android app"],
};

/**
 * What the inventory says is outstanding work.
 *
 * `gaps` is what a count in the UI or a plan may act on: partial and missing.
 * `unknown` is counted separately and never folded in — an audit that couldn't
 * read the payments code has not found a payments gap, and showing it as one
 * is how a builder ends up rebuilding what they already shipped.
 */
export function capabilityCounts(caps: CapabilityEntry[] | null | undefined) {
  const list = caps ?? [];
  const of = (s: CapabilityStatus) => list.filter((c) => c.status === s).length;
  return {
    total: list.length,
    built: of("built"),
    partial: of("partial"),
    missing: of("missing"),
    unknown: of("unknown"),
    unreported: of("unreported"),
    gaps: of("partial") + of("missing"),
  };
}

export interface CapabilityEvidence { file: string; route?: string }
/** The second read's answer: quantified coverage and the specific gaps. */
export interface CapabilityDetail {
  coverage: string;
  gaps: { item: string; file?: string; severity: "low" | "medium" | "high" }[];
  strengths: string[];
}
export interface CapabilityEntry {
  area: CapabilityArea;
  status: CapabilityStatus;
  /** One or two sentences: what exists, in the code's own names. */
  summary: string;
  evidence: CapabilityEvidence[];
  /** For partial: what still isn't there. */
  missing?: string;
  /** Set by validation when the model claimed more than it cited. */
  note?: string;
  /** From the targeted second read, when one ran. */
  detail?: CapabilityDetail;
}

export const areaLabel = (id: string) => CAPABILITY_AREAS.find((a) => a.id === id)?.label ?? id;

/**
 * Holds the model's inventory to the digest. Unknown areas are dropped,
 * evidence that names a file the digest never saw is dropped, a route not
 * in the route list is dropped, and a "built" or "partial" claim left with
 * no file evidence is downgraded — a claim with nothing behind it is exactly
 * what this inventory exists to prevent. Every area is present in the
 * result; ones the model skipped are "unreported", never silently absent.
 */
export function sanitizeCapabilities(
  raw: unknown,
  known: { files: Set<string>; routes: Set<string> },
): CapabilityEntry[] {
  const byArea = new Map<string, CapabilityEntry>();
  const items = Array.isArray(raw) ? raw : [];
  for (const item of items) {
    const area = String((item as any)?.area ?? "");
    if (!CAPABILITY_AREAS.some((a) => a.id === area) || byArea.has(area)) continue;
    const status0 = String((item as any)?.status ?? "");
    let status: CapabilityStatus = (["built", "partial", "missing"] as string[]).includes(status0) ? (status0 as CapabilityStatus) : "unreported";
    const evidenceRaw = Array.isArray((item as any)?.evidence) ? (item as any).evidence : [];
    const evidence: CapabilityEvidence[] = [];
    const dropped: string[] = [];
    for (const e of evidenceRaw.slice(0, 12)) {
      const file = String(typeof e === "string" ? e : e?.file ?? "").trim();
      const route = typeof e === "object" && e?.route ? String(e.route).trim() : undefined;
      if (!file || !known.files.has(file)) { if (file) dropped.push(file); continue; }
      evidence.push(route && known.routes.has(route) ? { file, route } : { file });
    }
    let note: string | undefined;
    if ((status === "built" || status === "partial") && evidence.length === 0) {
      note = `Claimed ${status} but cited no file the digest saw${dropped.length ? ` (cited: ${dropped.slice(0, 3).join(", ")})` : ""}; treat as unverified.`;
      status = "partial";
    } else if (dropped.length) {
      note = `Some cited files are not in the repository: ${dropped.slice(0, 3).join(", ")}.`;
    }
    byArea.set(area, {
      area: area as CapabilityArea, status,
      summary: String((item as any)?.summary ?? "").trim().slice(0, 500),
      evidence,
      missing: (item as any)?.missing ? String((item as any).missing).trim().slice(0, 400) : undefined,
      note,
    });
  }
  return CAPABILITY_AREAS.map((a) => byArea.get(a.id) ?? { area: a.id, status: "unreported", summary: "", evidence: [] });
}

/** The inventory as prompt text, in the order a planner should read it. */
export function renderCapabilities(caps: CapabilityEntry[] | null | undefined): string | null {
  if (!caps?.length) return null;
  const order: Record<CapabilityStatus, number> = { built: 0, partial: 1, missing: 2, unknown: 3, unreported: 4 };
  const lines = [...caps].sort((a, b) => order[a.status] - order[b.status]).map((c) => {
    const ev = c.evidence.map((e) => (e.route ? `${e.route} in ${e.file}` : e.file)).join(", ");
    const detail = c.detail
      ? `${c.detail.coverage ? ` Coverage: ${c.detail.coverage}` : ""}${c.detail.gaps.length ? ` Gaps: ${c.detail.gaps.slice(0, 5).map((g) => `${g.item}${g.file ? ` (${g.file})` : ""}`).join("; ")}` : ""}`
      : "";
    // UNKNOWN is spelled out, because a later plan reading "UNKNOWN" alone
    // would treat it as a gap — which is the failure this state exists to stop.
    const verdict = c.status === "unknown" ? "UNKNOWN (not found in what this audit read — NOT a gap; confirm before building it)" : c.status.toUpperCase();
    return `- ${areaLabel(c.area)}: ${verdict}${c.summary ? ` — ${c.summary}` : ""}${ev ? ` [${ev}]` : ""}${c.missing ? ` Missing: ${c.missing}` : ""}${detail}${c.note ? ` (${c.note})` : ""}`;
  });
  return `CAPABILITY INVENTORY (from the latest audit — what already exists, with the files that prove it. A plan that proposes something marked BUILT from scratch is wrong; extend or wire the file named.)\n${lines.join("\n")}`;
}

/** Holds a second read to the files it was given. */
export function sanitizeDeepRead(raw: unknown, allowedFiles: Set<string>): CapabilityDetail | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as any;
  const gaps = (Array.isArray(r.gaps) ? r.gaps : []).slice(0, 12).map((g: any) => {
    const file = g?.file ? String(g.file).trim() : undefined;
    return {
      item: String(g?.item ?? "").trim().slice(0, 300),
      file: file && allowedFiles.has(file) ? file : undefined,
      severity: ((["low", "medium", "high"] as string[]).includes(g?.severity) ? g.severity : "medium") as "low" | "medium" | "high",
    };
  }).filter((g: any) => g.item);
  const coverage = String(r.coverage ?? "").trim().slice(0, 500);
  if (!coverage && !gaps.length) return null;
  return {
    coverage,
    gaps,
    strengths: (Array.isArray(r.strengths) ? r.strengths : []).map((x: any) => String(x).trim().slice(0, 200)).filter(Boolean).slice(0, 6),
  };
}
