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
export const CAPABILITY_STATUSES = ["built", "partial", "missing", "unreported"] as const;
export type CapabilityStatus = (typeof CAPABILITY_STATUSES)[number];

export interface CapabilityEvidence { file: string; route?: string }
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
  const order: Record<CapabilityStatus, number> = { built: 0, partial: 1, missing: 2, unreported: 3 };
  const lines = [...caps].sort((a, b) => order[a.status] - order[b.status]).map((c) => {
    const ev = c.evidence.map((e) => (e.route ? `${e.route} in ${e.file}` : e.file)).join(", ");
    return `- ${areaLabel(c.area)}: ${c.status.toUpperCase()}${c.summary ? ` — ${c.summary}` : ""}${ev ? ` [${ev}]` : ""}${c.missing ? ` Missing: ${c.missing}` : ""}${c.note ? ` (${c.note})` : ""}`;
  });
  return `CAPABILITY INVENTORY (from the latest audit — what already exists, with the files that prove it. A plan that proposes something marked BUILT from scratch is wrong; extend or wire the file named.)\n${lines.join("\n")}`;
}
