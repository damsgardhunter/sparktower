/**
 * Answers by tapping, and plans by Nova: the pure halves.
 *
 * Checking a set of tapped answers against the questions, turning them into
 * the sentence that becomes the milestone's written answer (and what Nova
 * reads on every later step), and holding a model's plan to its shape — all
 * here, where they're tested without a model or a database.
 */
import type { IntakeQuestion } from "./types";
import type { PlanPayload } from "./work";

export type IntakeAnswers = Record<string, string[]>;

/** Whether a question is asked, given the answers to the questions before it. */
export function isAsked(q: IntakeQuestion, answers: IntakeAnswers): boolean {
  if (!q.showIf) return true;
  return (answers[q.showIf.question] ?? []).some((a) => q.showIf!.in.includes(a));
}

/** The longest a text answer can be. */
export const INTAKE_TEXT_MAX = 300;

/** The answers that fit the questions, or the first reason they don't. */
export function validateIntake(questions: IntakeQuestion[], raw: unknown): { ok: true; answers: IntakeAnswers } | { ok: false; message: string; field: string } {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const answers: IntakeAnswers = {};
  for (const q of questions) {
    // A question that isn't asked keeps no answer, whatever was sent for it.
    if (!isAsked(q, answers)) { answers[q.id] = []; continue; }
    const given = input[q.id];
    if (q.kind === "text") {
      const text = String(Array.isArray(given) ? given[0] ?? "" : given ?? "").trim().slice(0, INTAKE_TEXT_MAX);
      if (!text && !q.optional) return { ok: false, message: `Answer "${q.prompt}" to continue.`, field: q.id };
      answers[q.id] = text ? [text] : [];
      continue;
    }
    const picked = (Array.isArray(given) ? given : given == null || given === "" ? [] : [given]).map(String);
    const valid = picked.filter((id, i) => q.options.some((o) => o.id === id) && picked.indexOf(id) === i);
    if (valid.length !== picked.length) return { ok: false, message: `"${q.prompt}" — pick one of the choices.`, field: q.id };
    if (!q.multi && valid.length > 1) return { ok: false, message: `"${q.prompt}" takes one answer.`, field: q.id };
    if (!valid.length && !q.optional) return { ok: false, message: `Answer "${q.prompt}" to continue.`, field: q.id };
    answers[q.id] = valid;
  }
  return { ok: true, answers };
}

/** The answers as lines, "Question: choice", which become the milestone's written answer. */
export function renderIntake(questions: IntakeQuestion[], answers: IntakeAnswers): string {
  return questions.filter((q) => isAsked(q, answers)).map((q) => {
    const labels = q.kind === "text"
      ? (answers[q.id] ?? [])
      : (answers[q.id] ?? []).map((id) => q.options.find((o) => o.id === id)?.label ?? id);
    return `${q.prompt} ${labels.length ? labels.join(", ") : "Not sure yet"}`;
  }).join("\n");
}

/**
 * A field cut to length, at a word and said out loud.
 *
 * This was `.slice(0, max)`, which cuts wherever the character count lands —
 * and a plan is read as prose, so the result was sentences ending mid-word:
 * "pending proof and el". Nothing is wrong with the plan; the field it was
 * stored in simply stopped. A reader cannot tell that from a model that lost
 * its thread, which is the damage.
 *
 * Two changes. The cut moves back to the last space, so a word survives or goes
 * whole; and an ellipsis marks it, so a short field reads as shortened rather
 * than as all there was. A single token longer than the limit — a URL, a long
 * identifier — still gets cut where it must, because the alternative is dropping
 * it entirely.
 *
 * The 60% floor stops the word-boundary rule from throwing away most of the
 * field: a limit of 60 landing inside a long first word would otherwise clip
 * back to almost nothing.
 */
const clip = (v: unknown, max: number): string => {
  const text = String(v ?? "").trim();
  if (text.length <= max) return text;
  const room = Math.max(1, max - 1);
  const cut = text.slice(0, room);
  const lastSpace = cut.lastIndexOf(" ");
  const body = lastSpace > room * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${body.replace(/[\s,;:.\-]+$/, "")}\u2026`;
};

/* Kept as the name every field below uses; the behaviour is `clip`'s. */
const str = (v: unknown, max: number) => clip(v, max);
const list = <T>(v: unknown, max: number, map: (x: any) => T | null): T[] =>
  (Array.isArray(v) ? v : []).slice(0, max).map(map).filter((x): x is T => x != null);

/**
 * A model's plan, reduced to what the page can render and trust: bounded
 * lists, text everywhere, tables whose rows match their columns. Throws when
 * there's nothing a builder could use.
 */
export function sanitizePlan(parsed: any): PlanPayload {
  const plan: PlanPayload = {
    kind: "plan",
    summary: str(parsed?.summary, 1500),
    figures: list(parsed?.figures, 12, (f) => (f?.label && f?.value != null ? { label: str(f.label, 80), value: str(f.value, 60), ...(f.note ? { note: str(f.note, 200) } : {}) } : null)),
    tables: list(parsed?.tables, 4, (t) => {
      const columns = list(t?.columns, 8, (c) => str(c, 60) || null);
      if (!columns.length) return null;
      const rows = list(t?.rows, 40, (r) => (Array.isArray(r) ? columns.map((_, i) => str(r[i], 120)) : null));
      return rows.length ? { title: str(t?.title, 120), columns, rows } : null;
    }),
    sections: list(parsed?.sections, 8, (s) => (s?.body ? { heading: str(s.heading, 120), body: str(s.body, 3000) } : null)),
    assumptions: list(parsed?.assumptions, 10, (a) => str(a, 300) || null),
    gaps: list(parsed?.gaps, 10, (g) => str(g, 300) || null),
    actions: list(parsed?.actions, 25, (a) => (a?.title ? { title: str(a.title, 140), detail: str(a.detail, 600), ...(a.when ? { when: str(a.when, 60) } : {}), ...(a.moves ? { moves: str(a.moves, 200) } : {}) } : null)),
    ...(parsed?.verifyWith ? { verifyWith: str(parsed.verifyWith, 300) } : {}),
  };
  if (!plan.summary && !plan.figures.length && !plan.sections.length && !plan.tables.length) {
    throw Object.assign(new Error("Nova didn't come back with a usable plan. Try again."), { status: 502 });
  }
  return plan;
}

/** A plan as the milestone's written answer: what later steps read, compact. */
export function renderPlanAnswer(plan: PlanPayload): string {
  const joined = [
    plan.summary,
    plan.figures.length ? `Figures: ${plan.figures.map((f) => `${f.label} ${f.value}`).join("; ")}` : "",
    plan.gaps.length ? `Gaps: ${plan.gaps.join("; ")}` : "",
    plan.actions.length ? `Actions: ${plan.actions.map((a) => `${a.when ? `[${a.when}] ` : ""}${a.title}`).join("; ")}` : "",
    plan.assumptions.length ? `Assumed: ${plan.assumptions.join("; ")}` : "",
    /* Same rule as the fields above: a written answer that later steps read
       should end at a word, and say that it was cut. */
  ].filter(Boolean).join("\n");
  return clip(joined, 4000);
}
