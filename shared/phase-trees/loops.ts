/**
 * The five loops a business runs on.
 *
 * A product with one core loop is a product, not a business. Every project
 * on a building path writes five: how people arrive (growth), why they come
 * back (retention), how it earns (revenue), how users bring users (referral)
 * and the thing they came for (product). Product is the only kind a project
 * may have several of — SparkTower's paths are each their own product loop.
 *
 * The type rides on the loop's task as a `loop-type:<type>` tag. A loop from
 * before types existed has no tag and counts as a product loop, which is what
 * those loops were.
 *
 * Also here, pure so they can be tested without a model: the sanitizers for
 * Nova's two reads of the loops — against competitors, and against the code.
 */

/** In the order they're shown and read: product first, then how it grows, keeps, earns and spreads. */
export const LOOP_TYPES = ["product", "growth", "retention", "revenue", "referral"] as const;
export type LoopType = typeof LOOP_TYPES[number];

export interface LoopTypeInfo {
  type: LoopType;
  label: string;
  /** What the loop is, in one line — shown on an empty slot and handed to Nova. */
  asks: string;
  /** What makes it a loop rather than a funnel: the output that restarts it. */
  closes: string;
  /** An example shape, so an empty slot isn't a blank page. */
  example: string;
}

export const LOOP_TYPE_INFO: Record<LoopType, LoopTypeInfo> = {
  growth: {
    type: "growth", label: "Growth loop",
    asks: "How new people find the product without you finding each of them.",
    closes: "Something a user makes or does becomes the thing the next stranger discovers.",
    example: "Builder publishes a finished step as a public page → it's indexed and shared → a stranger lands on it → signs up → publishes their own.",
  },
  retention: {
    type: "retention", label: "Retention loop",
    asks: "Why someone who used it once comes back next week.",
    closes: "Each visit leaves a reason for the next one — a reply, a streak, new state waiting.",
    example: "Post an update → get a comment → notified → come back to reply → post the next update.",
  },
  revenue: {
    type: "revenue", label: "Revenue loop",
    asks: "How using the product turns into money, and money into more use.",
    closes: "Paying unlocks value that makes paying again (or paying more) the obvious next step.",
    example: "Hit the free limit → upgrade → get more done → need more capacity → stay subscribed or upgrade.",
  },
  referral: {
    type: "referral", label: "Referral loop",
    asks: "How a user deliberately brings another user in.",
    closes: "The invited person gets their own reason and means to invite the next one.",
    example: "Invite a teammate → they join and get value → they get their own invite link and credit → invite theirs.",
  },
  product: {
    type: "product", label: "Product loop",
    asks: "The core thing one kind of user does over and over and gets value from each time.",
    closes: "Finishing the cycle gives the user the input for starting it again.",
    example: "Open the path → do the next step → see the date move → come back for the next step.",
  },
};

/** Every one of these must be written before the core-loop milestone is done. */
export const REQUIRED_LOOP_TYPES: readonly LoopType[] = LOOP_TYPES;
/** Only product loops repeat; a business has one growth loop, not three half ones. */
export const MAX_PRODUCT_LOOPS = 4;
/** Four business loops plus up to four product loops. */
export const LOOP_CAP = REQUIRED_LOOP_TYPES.length - 1 + MAX_PRODUCT_LOOPS;

export const isLoopType = (v: unknown): v is LoopType => typeof v === "string" && (LOOP_TYPES as readonly string[]).includes(v);
export const loopTypeTag = (type: LoopType) => `loop-type:${type}`;
/** A loop's type; untyped loops predate types and were product loops. */
export const loopTypeOf = (tags: string[] | null | undefined): LoopType => {
  const raw = tags?.find((t) => t.startsWith("loop-type:"))?.slice("loop-type:".length);
  return isLoopType(raw) ? raw : "product";
};

export const LOOP_ORDER: readonly LoopType[] = LOOP_TYPES;
export const byLoopOrder = <T extends { type: LoopType }>(a: T, b: T) => LOOP_ORDER.indexOf(a.type) - LOOP_ORDER.indexOf(b.type);

export interface LoopCoverage {
  /** Types with no loop at all. */
  missing: LoopType[];
  /** Types with a loop that hasn't been written yet. */
  unwritten: LoopType[];
  productLoops: number;
  /** All five types exist and are written. */
  complete: boolean;
}

/** Whether a project's loops cover the five kinds, each written down. */
export function loopCoverage(loops: { type: LoopType; written: boolean }[]): LoopCoverage {
  const missing = REQUIRED_LOOP_TYPES.filter((t) => !loops.some((l) => l.type === t));
  const unwritten = REQUIRED_LOOP_TYPES.filter((t) => !missing.includes(t) && !loops.some((l) => l.type === t && l.written));
  return { missing, unwritten, productLoops: loops.filter((l) => l.type === "product").length, complete: !missing.length && !unwritten.length };
}

/**
 * Whether one more loop of this type fits. Returns the refusal, or null.
 * `existing` is the project's loops, excluding the one being retyped.
 */
export function loopTypeRefusal(existing: { type: LoopType }[], type: LoopType): { code: string; message: string } | null {
  // Limits per kind, not a total: a project with extra product loops (from before the cap) must still
  // be able to add the growth, retention, revenue or referral loop every business needs. Business
  // kinds come one each, so the total never passes LOOP_CAP through them.
  if (type === "product") {
    return existing.filter((l) => l.type === "product").length >= MAX_PRODUCT_LOOPS
      ? { code: "loop_cap", message: `${MAX_PRODUCT_LOOPS} product loops is already a lot to build. Finish or remove one first.` }
      : null;
  }
  return existing.some((l) => l.type === type)
    ? { code: "loop_type_taken", message: `This project already has a ${LOOP_TYPE_INFO[type].label.toLowerCase()}. Rewrite that one instead — only product loops come in more than one.` }
    : null;
}

// --- Nova's competitive read ------------------------------------------------

export type LoopVerdict = "strong" | "competitive" | "weak";

export interface LoopCompetitor { name: string; howTheirLoopWorks: string }

export interface LoopCompetitiveRead {
  loopTaskId: string;
  title: string;
  type: LoopType;
  /** 0–100: how likely this loop is to actually turn, against what customers already use. */
  score: number;
  verdict: LoopVerdict;
  competitors: LoopCompetitor[];
  advantage: string;
  gap: string;
  /** Where it's most likely to stop turning in practice. */
  breakRisk: string;
  recommendation: string;
}

export interface LoopCompetitiveAudit {
  kind: "loop-audit";
  /** The competitors named for the whole product. */
  competitors: { name: string; why: string }[];
  summary: string;
  /** 0–100 across the loops, weighted equally. */
  overallScore: number;
  loops: LoopCompetitiveRead[];
  /** Every loop the audit was given, scored or not, as it read then — what "the loops have changed since" compares with. */
  audited: { taskId: string; text: string }[];
  /** The one loop to fix first, by task id. */
  weakestLoopTaskId: string | null;
  caveat: string;
  model?: string;
}

/** What a loop said when it was read: a rewrite, a rename or a retype all change it. */
export const loopText = (l: { title: string; type: LoopType; description?: string | null }) => `${l.type}|${l.title.trim()}|${(l.description ?? "").trim()}`;

/** Whether the loops have changed since an audit read them. */
export function loopAuditStale(audit: Pick<LoopCompetitiveAudit, "audited">, loops: { taskId: string; title: string; type: LoopType; description?: string | null }[]): boolean {
  const then = new Map((audit.audited ?? []).map((a) => [a.taskId, a.text]));
  return loops.length !== then.size || loops.some((l) => then.get(l.taskId) !== loopText(l));
}

const s = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const verdictFor = (score: number): LoopVerdict => (score >= 70 ? "strong" : score >= 45 ? "competitive" : "weak");

/**
 * Nova's competitive read, reduced to what it may say. Loops are matched by
 * the short keys the prompt handed out (L1, L2…), never by titles the model
 * might reword; a loop the model skipped is not invented, and the verdict is
 * derived from the score so the two can't disagree.
 */
export function sanitizeLoopAudit(
  raw: any,
  loops: { key: string; taskId: string; title: string; type: LoopType; description?: string }[],
): LoopCompetitiveAudit {
  const byKey = new Map(loops.map((l) => [l.key, l]));
  const seen = new Set<string>();
  const reads: LoopCompetitiveRead[] = [];
  for (const item of Array.isArray(raw?.loops) ? raw.loops : []) {
    const loop = byKey.get(s(item?.key, 8));
    if (!loop || seen.has(loop.key)) continue;
    seen.add(loop.key);
    const score = Math.max(0, Math.min(100, Math.round(Number(item?.score) || 0)));
    reads.push({
      loopTaskId: loop.taskId, title: loop.title, type: loop.type, score, verdict: verdictFor(score),
      competitors: (Array.isArray(item?.competitors) ? item.competitors : []).slice(0, 4)
        .map((c: any) => ({ name: s(c?.name, 80), howTheirLoopWorks: s(c?.howTheirLoopWorks, 400) }))
        .filter((c: LoopCompetitor) => c.name),
      advantage: s(item?.advantage, 500),
      gap: s(item?.gap, 500),
      breakRisk: s(item?.breakRisk, 400),
      recommendation: s(item?.recommendation, 500),
    });
  }
  reads.sort((a, b) => loops.findIndex((l) => l.taskId === a.loopTaskId) - loops.findIndex((l) => l.taskId === b.loopTaskId));
  const overallScore = reads.length ? Math.round(reads.reduce((n, r) => n + r.score, 0) / reads.length) : 0;
  const weakest = reads.length ? reads.reduce((w, r) => (r.score < w.score ? r : w)) : null;
  return {
    kind: "loop-audit",
    competitors: (Array.isArray(raw?.competitors) ? raw.competitors : []).slice(0, 6)
      .map((c: any) => ({ name: s(c?.name, 80), why: s(c?.why, 300) }))
      .filter((c: { name: string }) => c.name),
    summary: s(raw?.summary, 1200),
    overallScore,
    loops: reads,
    audited: loops.map((l) => ({ taskId: l.taskId, text: loopText(l) })),
    weakestLoopTaskId: weakest?.loopTaskId ?? null,
    caveat: s(raw?.caveat, 300) || "From Nova's knowledge of the market, not a live scan. Check the competitors named before acting on a score.",
  };
}

// --- The code audit's closure check -----------------------------------------

export type LoopClosure = "closed" | "open" | "not-built";

export interface LoopStageCheck { step: string; status: "built" | "partial" | "missing"; evidence: string[] }

export interface LoopClosureRead {
  loopTaskId: string;
  title: string;
  type: LoopType;
  closure: LoopClosure;
  stages: LoopStageCheck[];
  /** The code that brings the user (or the next user) back to the first step. */
  returnPath: { mechanism: string; evidence: string[] } | null;
  /** Where the cycle stops, for an open loop. */
  breaksAt: string;
  fix: string;
  /** Set when the claim was downgraded for lack of evidence. */
  note?: string;
}

/**
 * The audit's per-loop verdict, held to the evidence. "Closed" needs two
 * things the digest can show: every stage built, and a return path — the
 * notification, email, feed, link or credit that starts the next turn — citing
 * a file that is really in the tree. Missing either, it's open, and the note
 * says why. Loops the model skipped come back as unreported-open, never
 * silently closed.
 */
export function sanitizeLoopClosures(
  raw: unknown,
  loops: { key: string; taskId: string; title: string; type: LoopType }[],
  files: Set<string>,
): LoopClosureRead[] {
  const items = Array.isArray(raw) ? raw : [];
  const onlyReal = (v: unknown) => (Array.isArray(v) ? v : []).map((f) => s(typeof f === "string" ? f : (f as any)?.file, 200)).filter((f) => files.has(f)).slice(0, 6);
  return loops.map((loop) => {
    const item: any = items.find((i: any) => s(i?.key, 8) === loop.key);
    if (!item) {
      return { loopTaskId: loop.taskId, title: loop.title, type: loop.type, closure: "open", stages: [], returnPath: null, breaksAt: "", fix: "", note: "The audit didn't report on this loop; run it again or check it by hand." };
    }
    const stages: LoopStageCheck[] = (Array.isArray(item.stages) ? item.stages : []).slice(0, 8).map((st: any) => {
      const evidence = onlyReal(st?.evidence);
      const claimed = ["built", "partial", "missing"].includes(st?.status) ? st.status : "missing";
      // A built stage with nothing real behind it is, at best, partial.
      return { step: s(st?.step, 200), status: claimed === "built" && !evidence.length ? "partial" : claimed, evidence };
    }).filter((st: LoopStageCheck) => st.step);
    const returnEvidence = onlyReal(item.returnPath?.evidence);
    const returnPath = item.returnPath?.mechanism ? { mechanism: s(item.returnPath.mechanism, 300), evidence: returnEvidence } : null;
    let closure: LoopClosure = ["closed", "open", "not-built"].includes(item.closure) ? item.closure : "open";
    let note: string | undefined;
    if (closure === "closed") {
      if (!stages.length || stages.some((st) => st.status !== "built")) { closure = "open"; note = "Reported closed, but not every stage has code behind it."; }
      else if (!returnPath || !returnEvidence.length) { closure = "open"; note = "Reported closed, but no file shows what brings the user back to the first step."; }
    }
    if (closure === "not-built" && stages.some((st) => st.status !== "missing")) closure = "open";
    return {
      loopTaskId: loop.taskId, title: loop.title, type: loop.type, closure, stages,
      returnPath,
      breaksAt: closure === "closed" ? "" : s(item.breaksAt, 400),
      fix: closure === "closed" ? "" : s(item.fix, 500),
      ...(note ? { note } : {}),
    };
  });
}
