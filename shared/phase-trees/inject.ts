/**
 * The injected layer's rules, and the routes between paths. Pure, so the cap
 * and the grounding requirement are enforced by code that a test can hold
 * to account, not by a sentence in a prompt.
 */
import type { ProjectGoal } from "../goals";

/** Injected tasks per phase. The doc says 2–3; three is the ceiling. */
export const INJECT_CAP_PER_PHASE = 3;

export interface Artifact {
  /** The exact label Nova must name to justify a task. */
  label: string;
  kind: "milestone" | "check-in" | "decision";
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

/**
 * Admits the proposals that name a real artifact, up to the cap for the
 * phase. A proposal Nova can't ground is dropped, and the reason is returned
 * so the caller can say what happened rather than quietly shrinking the list.
 */
export function admitInjections(
  proposals: InjectionProposal[], artifacts: Artifact[], existingInPhase: number,
): { admitted: AdmittedInjection[]; dropped: { title: string; reason: string }[] } {
  const labels = new Set(artifacts.map((a) => a.label));
  const room = Math.max(0, INJECT_CAP_PER_PHASE - existingInPhase);
  const admitted: AdmittedInjection[] = [];
  const dropped: { title: string; reason: string }[] = [];
  for (const p of proposals) {
    const title = String(p.title ?? "").trim();
    if (!title) continue;
    if (!labels.has(String(p.artifact ?? ""))) { dropped.push({ title, reason: "no artifact named" }); continue; }
    if (admitted.length >= room) { dropped.push({ title, reason: "phase is at its cap" }); continue; }
    const hours = Number(p.estimateHours);
    admitted.push({ ...p, title, description: String(p.description ?? "").trim(), estimateHours: Number.isFinite(hours) && hours > 0 ? Math.min(8, Math.ceil(hours)) : 1 });
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
    { goal: "raise_funding", why: "You have a product and a read on who wants it. That is the strongest evidence a raise can carry." },
    { goal: "systemize_business", why: "If the loop is paying, the next risk is that it only runs when you do." },
  ],
  systemize_business: [
    { goal: "raise_funding", why: "A business that runs without you, with numbers on a dashboard, is what gets financed for growth." },
  ],
  raise_funding: [
    { goal: "ship_mvp", why: "The money is for building. Put a first version in front of real people." },
    { goal: "systemize_business", why: "Capital raised against a plan now needs operations that hold up without you." },
  ],
};

const LOOP_STOPWORDS = new Set(["the", "a", "an", "and", "or", "of", "to", "on", "in", "for", "with", "by", "at", "it", "its", "get", "then", "from", "into", "loop", "loops"]);
const loopTokens = (s: string) => new Set(s.split(" ").map((w) => w.replace(/s$/, "")).filter((w) => w.length >= 3 && !LOOP_STOPWORDS.has(w)));
/**
 * True when two normalised loop names share at least half of the shorter
 * one's meaningful words. A removed loop stays removed under a new name:
 * "post a weekly check-in and get feedback" and "ship weekly check-ins on a
 * project" are the same loop, and that is the test — not the exact title.
 */
export function loopsAlike(a: string, b: string): boolean {
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const ta = loopTokens(a), tb = loopTokens(b);
  if (!ta.size || !tb.size) return false;
  let shared = 0; for (const w of ta) if (tb.has(w)) shared++;
  return shared / Math.min(ta.size, tb.size) >= 0.5;
}
