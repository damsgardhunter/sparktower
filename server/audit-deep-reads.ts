/**
 * Targeted second reads. The first pass says whether an area exists; these
 * ask one narrow question per area against the full text of the files that
 * prove it, plus the exact route coverage, and come back with a quantified
 * coverage line and the specific gaps. This is what turns "rate limiting:
 * built" into "covers 14 of 19 writes; comments and uploads are not".
 */
import OpenAI from "openai";
import { modelFor, coachingDirectiveFor, type UserEntitlements } from "./entitlements";
import type { RepoFile } from "./code-ingest";
import type { RouteCoverage } from "./route-coverage";
import { renderRouteCoverage } from "./route-coverage";
import { renderDataShape, type DataShape } from "@shared/data-shape";
import { CAPABILITY_AREAS, sanitizeDeepRead, type CapabilityEntry, type CapabilityArea, type CapabilityDetail } from "@shared/capabilities";
import { parseModelJson } from "./ai-json";

const rawBase = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: rawBase ? (rawBase.endsWith("/v1") ? rawBase : `${rawBase.replace(/\/$/, "")}/v1`) : undefined,
});

/** The one question each area is asked. Quantified answers, named gaps. */
export const AREA_QUESTIONS: Record<CapabilityArea, string> = {
  auth: "Which routes can be reached without auth that shouldn't be? How are sessions or tokens issued, refreshed and revoked, and is the password path hashed? Name any route or flow that trusts the client.",
  rateLimiting: "Which write and costly routes are rate-limited and which are not (use the ROUTE COVERAGE list and the code)? Is the limit durable across instances? What error shape does a limited request get, and is Retry-After sent?",
  moderation: "Is the chain report → queue → action → enforcement in reads → undo complete? Name each step's file and any step that is UI-only or missing. Is the log immutable?",
  payments: "Is every webhook verified against a signature? Are events idempotent? What syncs entitlements after payment, and what happens on failure or refund?",
  ai: "Which AI routes are metered by credits and which are not? Is there a per-user burst limit? How are model errors and unparseable responses handled, and is the user charged on failure?",
  analytics: "Which events are captured and where? What can the owner see, is it gated to the owner, and is the data retention or deletion handled?",
  data: "How is the schema applied (migrations vs push)? Which tables carry user content, and which columns could hold secrets or PII? Is there any destructive operation without a guard? If DATA IN USE is given: which tables are empty, and which features does that make built-but-unused?",
  tests: "What do the tests actually cover — list areas with a test file for each — and what important paths have none? Is there a test database strategy, and do tests run in CI?",
  ci: "What does the pipeline run (typecheck, lint, tests, E2E, secrets scan)? What is missing? Are results required before merge, as far as the code shows?",
  deploy: "How is the app deployed and configured? Is there a health check, an environment contract, kill switches, and production-only enforcement (e.g. session secret)? What would break on a fresh deploy?",
  mobile: "Which screens exist and which API routes do they call? Does the mobile auth flow match the web one? Which of the product's loops are reachable on mobile and which are not?",
};

const RELEVANT_TO_COVERAGE = new Set<CapabilityArea>(["auth", "rateLimiting", "ai", "moderation", "deploy"]);

/** Where each area's code usually lives, by file name. Added to the evidence files for the read. */
const AREA_FILE_HINTS: Partial<Record<CapabilityArea, RegExp>> = {
  auth: /auth|session|passport|token|login/i,
  rateLimiting: /moderation|rate-?limit|limiter|entitle|plans/i,
  moderation: /moderation|report|admin/i,
  payments: /stripe|billing|payment|webhook|subscription|entitle/i,
  ai: /openai|nova|ai-?models|prompt|entitle|plans|ai-json|ai-metering|moderation/i,
  analytics: /analytics|metrics|track/i,
  data: /schema|storage|db\b|migrat/i,
  tests: /vitest|playwright|test\/setup|test\/helpers|test\/integration|test\/unit|e2e\//i,
  ci: /\.github\/workflows|ci-stability|release-checklist/i,
  deploy: /index\.ts$|app\.ts$|surfaces|health|env-contract|\.replit|Dockerfile/i,
  mobile: /^mobile\/(app|src)\/|mobile-auth/i,
};

/** The matrix rows this area's question is about, one compact line each, so "which routes" is answerable from evidence. */
export function rowsForArea(area: CapabilityArea, cov: RouteCoverage, max = 140): string | null {
  const rows = cov.rows.filter((r) => r.mounted !== false);
  const pick = area === "rateLimiting" ? rows.filter((r) => r.write || r.cost)
    : area === "auth" ? rows.filter((r) => r.write || r.privileged)
    : area === "ai" ? rows.filter((r) => r.cost)
    : area === "moderation" ? rows.filter((r) => /report|moderat|admin|ban|suspend|hide|comment|feed|check-in/i.test(r.path))
    : area === "deploy" ? rows.filter((r) => r.surface || /health|surfaces|admin/i.test(r.path))
    : [];
  if (!pick.length) return null;
  const line = (r: typeof pick[number]) => `${r.method} ${r.path}  auth:${r.auth ? "y" : "n"} limit:${r.rateLimited ? "y" : r.floor ? "floor" : "n"} credits:${r.credits ? "y" : "n"}${r.surface ? ` surface:${r.surface}` : ""}${r.privileged ? " privileged" : ""}  [${r.file}]`;
  return `ROUTES RELEVANT TO THIS AREA (${pick.length}${pick.length > max ? `, first ${max}` : ""}; read off the source, exact)\n${pick.slice(0, max).map(line).join("\n")}`;
}


/**
 * One area, read properly. Given the full text of its evidence files (and
 * a few obvious relatives), the route coverage where it matters, and the
 * area's question. Never throws: a failed read leaves the area at its
 * first-pass verdict, which is honest, rather than failing the audit.
 */
export async function deepReadArea(
  ent: UserEntitlements, entry: CapabilityEntry, files: RepoFile[], coverage: RouteCoverage | null,
  opts: { maxFiles?: number; maxCharsPerFile?: number; timeoutMs?: number; dataShape?: DataShape | null } = {},
): Promise<CapabilityDetail | null> {
  const area = CAPABILITY_AREAS.find((a) => a.id === entry.area);
  if (!area) return null;
  // Whole files for the ones that matter: a mechanism cut off mid-function
  // reads as "cannot be verified", which is worse than a longer prompt.
  const maxFiles = opts.maxFiles ?? 10, maxChars = opts.maxCharsPerFile ?? 60000;
  const byPath = new Map(files.map((f) => [f.path, f]));
  const chosen: RepoFile[] = [];
  for (const e of entry.evidence) { const f = byPath.get(e.file); if (f?.content && !chosen.includes(f)) chosen.push(f); if (chosen.length >= maxFiles) break; }
  // Files the area's question is about, by name, so "not present in the
  // files provided" stops being the answer when the file exists.
  const hint = AREA_FILE_HINTS[entry.area];
  if (hint) for (const f of files) {
    if (chosen.length >= maxFiles) break;
    if (f.content && !chosen.includes(f) && hint.test(f.path) && !/(^|\/)(test|tests|e2e)\//.test(f.path)) chosen.push(f);
  }
  if (!chosen.length) return null;
  const fileText = chosen.map((f) => `### ${f.path}\n${f.content!.slice(0, maxChars)}${f.content!.length > maxChars ? "\n… (truncated)" : ""}`).join("\n\n");
  const cov = [
    RELEVANT_TO_COVERAGE.has(entry.area) && coverage ? [renderRouteCoverage(coverage, 40), rowsForArea(entry.area, coverage)].filter(Boolean).join("\n\n") : null,
    opts.dataShape ? renderDataShape(opts.dataShape) : null,
  ].filter(Boolean).join("\n\n") || null;
  const allowed = new Set(files.map((f) => f.path));

  try {
    const completion = await openai.chat.completions.create({
      model: modelFor(ent),
      messages: [
        { role: "system", content: `You are Nova, doing a close read of one area of a builder's codebase. ${coachingDirectiveFor(ent)}
Area: ${area.label}. What counts: ${area.counts}.
First-pass verdict: ${entry.status}${entry.summary ? ` — ${entry.summary}` : ""}.
Answer the question from the FILES and the ROUTE COVERAGE only. Quantify wherever the code lets you ("14 of 19 write routes"). Name gaps as concrete things to change, each with the file it lives in when you can point at one — only paths that appear in the files given or the coverage list. No advice, no generalities: if it isn't in the code in front of you, say it isn't there.
Respond ONLY with JSON: {"coverage":"one or two sentences, quantified","gaps":[{"item":"","file":"path or omit","severity":"low|medium|high"}],"strengths":["what is done well, one line each, at most three"]}` },
        { role: "user", content: `QUESTION\n${AREA_QUESTIONS[entry.area]}\n\n${cov ? `${cov}\n\n` : ""}FILES\n${fileText}` },
      ],
    }, { timeout: opts.timeoutMs ?? 120_000 });
    return sanitizeDeepRead(parseModelJson(completion.choices[0]?.message?.content ?? "{}"), allowed);
  } catch (err) {
    console.error(`[audit] deep read failed for ${entry.area}:`, (err as Error)?.message ?? err);
    return null;
  }
}

/** Second reads for every built or partial area, in parallel, each independent. */
export async function deepReadAll(ent: UserEntitlements, caps: CapabilityEntry[], files: RepoFile[], coverage: RouteCoverage | null, dataShape: DataShape | null = null): Promise<CapabilityEntry[]> {
  const results = await Promise.all(caps.map(async (c) => {
    if (c.status !== "built" && c.status !== "partial") return c;
    const detail = await deepReadArea(ent, c, files, coverage, { dataShape });
    return detail ? { ...c, detail } : c;
  }));
  return results;
}
