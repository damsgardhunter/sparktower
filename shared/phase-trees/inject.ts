/**
 * The injected layer's rules, and the routes between paths. Pure, so the cap
 * and the grounding requirement are enforced by code that a test can hold
 * to account, not by a sentence in a prompt.
 */
import { PROJECT_GOALS, type ProjectGoal } from "../goals";

/** Injected tasks per phase. The doc says 2–3; three is the ceiling. */
export const INJECT_CAP_PER_PHASE = 3;

/**
 * How many *phases* one artifact may seed.
 *
 * The cap above is per phase, and a phase is the wrong unit for the failure that
 * actually happens. A standing note — "remove the weekly check-ins, make the web
 * path first" — is a real artifact, so every phase admitted it, and one reminder
 * became the content of six different milestones: the MVP plan, the bottleneck
 * ranking, the gap list, the money roadmap, a contractor job post and "what is
 * costing you most". Every admission was legal. Nothing was looking across
 * phases.
 *
 * So the limit is on phases rather than on tasks, which leaves the documented
 * behaviour alone: a rich update describing three problems can still set three
 * tasks in the phase it belongs to, because that is one topic being worked
 * through. What it cannot do is follow the project around.
 *
 * Two, not one: a decision taken in week one can honestly come back when its
 * consequence lands later. Not three, because by the third phase the note has
 * stopped being evidence and become the plan.
 */
export const INJECT_PHASES_PER_ARTIFACT = 2;

export interface Artifact {
  /** The exact label Nova must name to justify a task. */
  label: string;
  kind: "milestone" | "update" | "decision";
  text: string;
}

export interface InjectionProposal {
  title: string;
  description: string;
  /** Must match an artifact label exactly, or the task is not admitted. */
  artifact: string;
  estimateHours?: number;
}

export interface AdmittedInjection extends InjectionProposal { estimateHours: number }

/** A task already injected somewhere on this project, as the admission rule needs to see it. */
export interface InjectedAlready {
  title: string;
  artifact: string;
  /** Which phase it was added to, so an artifact can be stopped from following the project around. */
  phaseId?: string | null;
}

/**
 * A title reduced to what it is actually saying, for comparing two of them.
 *
 * Case, punctuation and the filler a model varies between phrasings of the same
 * instruction — "Remove the weekly check-ins" against "Remove weekly check-ins
 * and make the web path first" should not read as two pieces of work. Compared
 * on the words that remain, in order, so a genuinely different task with one word
 * in common is still admitted.
 */
export function taskKey(title: string): string {
  const FILLER = new Set([
    "a", "an", "the", "and", "or", "to", "of", "for", "in", "on", "at", "by",
    "with", "from", "into", "your", "our", "this", "that", "it", "is", "are",
    "be", "make", "making", "do", "doing", "then", "so", "up", "out",
  ]);
  return String(title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w))
    .join(" ")
    .trim();
}

/**
 * Admits the proposals that name a real artifact, up to the cap for the phase
 * and without repeating work the project already has.
 *
 * A proposal Nova can't ground is dropped, and the reason is returned so the
 * caller can say what happened rather than quietly shrinking the list.
 *
 * `already` is every task injected anywhere on this project, and it is what stops
 * one standing note becoming the plan. Grounding and the per-phase cap both
 * passed happily while the same instruction was admitted into six phases in a
 * row — each time legitimately, by rules that could only see one phase at a time.
 * Optional, so a caller that has not got the list behaves as it always did.
 */
export function admitInjections(
  proposals: InjectionProposal[], artifacts: Artifact[], existingInPhase: number,
  already: InjectedAlready[] = [],
  /** The phase being filled, needed to tell "more of this topic" from "this note again". */
  phaseId?: string | null,
): { admitted: AdmittedInjection[]; dropped: { title: string; reason: string }[] } {
  const labels = new Set(artifacts.map((a) => a.label));
  const room = Math.max(0, INJECT_CAP_PER_PHASE - existingInPhase);
  const admitted: AdmittedInjection[] = [];
  const dropped: { title: string; reason: string }[] = [];

  /* What the project already says, and which phases each artifact has already seeded. */
  const saidAlready = new Set(already.map((t) => taskKey(t.title)).filter(Boolean));
  const phasesPerArtifact = new Map<string, Set<string>>();
  for (const t of already) {
    const key = String(t.artifact ?? "");
    const where = String(t.phaseId ?? "");
    if (!key || !where) continue;
    if (!phasesPerArtifact.has(key)) phasesPerArtifact.set(key, new Set());
    phasesPerArtifact.get(key)!.add(where);
  }

  for (const p of proposals) {
    const title = String(p.title ?? "").trim();
    if (!title) continue;
    const artifact = String(p.artifact ?? "");
    if (!labels.has(artifact)) { dropped.push({ title, reason: "no artifact named" }); continue; }

    /*
     * Said already — anywhere on the project, not just in this phase. Checked
     * before the cap so the reason given is the true one: a repeat that also
     * happens to arrive at a full phase should be reported as a repeat.
     */
    const key = taskKey(title);
    if (key && saidAlready.has(key)) { dropped.push({ title, reason: "already on the board" }); continue; }

    /*
     * Has this artifact already followed the project into enough phases? The
     * phase being filled now counts as one of them, so an artifact that already
     * owns this phase can keep adding to it up to the per-phase cap — that is one
     * topic being worked through, not a note spreading.
     */
    const seeded = phasesPerArtifact.get(artifact);
    if (phaseId && seeded && !seeded.has(phaseId) && seeded.size >= INJECT_PHASES_PER_ARTIFACT) {
      dropped.push({ title, reason: "that artifact has already set work in enough phases" });
      continue;
    }
    if (admitted.length >= room) { dropped.push({ title, reason: "phase is at its cap" }); continue; }

    const hours = Number(p.estimateHours);
    admitted.push({ ...p, title, description: String(p.description ?? "").trim(), estimateHours: Number.isFinite(hours) && hours > 0 ? Math.min(8, Math.ceil(hours)) : 1 });
    /* Counted as it is admitted, so one call cannot repeat itself either. */
    if (key) saidAlready.add(key);
    if (phaseId) {
      if (!phasesPerArtifact.has(artifact)) phasesPerArtifact.set(artifact, new Set());
      phasesPerArtifact.get(artifact)!.add(phaseId);
    }
  }
  return { admitted, dropped };
}

/**
 * The typical routes through the tree. At a path's final milestone Nova
 * proposes the next one; the case is made from what actually happened, and
 * these are only the defaults it argues from.
 */
export const NEXT_PATHS: Record<ProjectGoal, { goal: ProjectGoal; why: string }[]> = {
  ship_mvp: [
    { goal: "systemize_business", why: "If the loop is paying, the next risk is that it only runs when you do — and Systemize is also where the money to grow it comes from." },
    { goal: "run_company", why: "It has customers now. Keep it on track week to week: the numbers, the team's recurring work, and the next thing to fix." },
  ],
  systemize_business: [
    { goal: "run_company", why: "It runs without you in every step. Now keep it running: a weekly check-in on the numbers and a monthly report on what improved." },
  ],
  run_company: [
    { goal: "systemize_business", why: "The check-ins keep pointing at the same bottleneck — you. Systemize takes you out of it, and finds the money to grow." },
    { goal: "ship_mvp", why: "The business has a problem worth building a product for. Ship a first version of it." },
  ],
};

const LOOP_STOPWORDS = new Set(["the", "a", "an", "and", "or", "of", "to", "on", "in", "for", "with", "by", "at", "it", "its", "get", "then", "from", "into", "loop", "loops"]);
const loopTokens = (s: string) => new Set(s.split(" ").map((w) => w.replace(/s$/, "")).filter((w) => w.length >= 3 && !LOOP_STOPWORDS.has(w)));
/**
 * True when two normalised loop names share at least half of the shorter
 * one's meaningful words. A removed loop stays removed under a new name:
 * "post a weekly update and get feedback" and "ship weekly updates on a
 * project" are the same loop, and that is the test — not the exact title.
 */
export function loopsAlike(a: string, b: string): boolean {
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const ta = loopTokens(a), tb = loopTokens(b);
  if (!ta.size || !tb.size) return false;
  let shared = 0; for (const w of ta) if (tb.has(w)) shared++;
  return shared / Math.min(ta.size, tb.size) >= 0.5;
}

/**
 * A loop whose name spans several of the product's paths ("follow a goal
 * path (Ship/Systemize/Fund)") is the merge the read is told not to make.
 * Split it here, one loop per path named, so it can't reach the tree merged
 * whatever the model did.
 */
export function splitMergedPaths<T extends { title: string; steps: string }>(found: T[]): T[] {
  const out: T[] = [];
  for (const f of found) {
    const hay = `${f.title} ${f.steps}`.toLowerCase();
    const hits = PROJECT_GOALS.filter((g) => {
      const words = g.label.toLowerCase().split(" ");
      // "Fund…" names the funding routes, which live inside Systemize now. And
      // "run" is far too common a word to stand for the Run path on its own —
      // "runs", "rerun" — so that one needs its full name.
      if (g.id === "run_company") return /\brun a company\b|\brun\b(?:\s+\w+){0,2}\s+compan/.test(hay);
      return hay.includes(g.label.toLowerCase()) || hay.includes(words[0]) || (g.id === "systemize_business" && /\bfund/.test(hay));
    });
    if (hits.length >= 2 && /\b(path|paths|goal|goals|journey)\b/.test(hay)) {
      for (const g of hits) out.push({ ...f, title: g.label, steps: f.steps ? `${f.steps} (on the ${g.label} path)` : "" });
    } else out.push(f);
  }
  return out;
}
