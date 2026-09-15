/**
 * The shape of Nova's work on a milestone, by actor. This is what makes the
 * actor label true: nova-drafts and user-decides produce options to pick
 * from, nova-builds produces the thing itself, user-does produces the
 * template for the human part.
 */
import type { Actor } from "./types";
import type { RunGroup } from "./run-steps";

export type WorkKind = "options" | "build" | "template" | "plan" | "intake";

export interface WorkOption { title: string; body: string; why?: string }
export interface WorkFile { path: string; language: string; content: string; purpose?: string }

export interface OptionsPayload { kind: "options"; existing?: string; intro: string; options: WorkOption[] }
export interface BuildPayload { kind: "build"; existing?: string; summary: string; files: WorkFile[]; runSteps: string[]; verify: string; assumptions: string[]; /** Which model wrote the files. */ model?: string; /** The run steps as blocks to copy — see run-steps.ts. */ runGroups?: RunGroup[] }
export interface TemplatePayload { kind: "template"; intro: string; template: string; whatNovaDid: string; whatIsLeft: string }
/**
 * A plan Nova builds: the numbers, the tables behind them, what it assumed,
 * and the dated actions that follow — a financial model, a loan-readiness
 * check, a roadmap. A document rather than code, so it isn't a build.
 */
export interface PlanFigure { label: string; value: string; note?: string }
export interface PlanTable { title: string; columns: string[]; rows: string[][] }
export interface PlanAction { title: string; detail: string; when?: string; moves?: string }
export interface PlanPayload {
  kind: "plan";
  summary: string;
  figures: PlanFigure[];
  tables: PlanTable[];
  sections: { heading: string; body: string }[];
  assumptions: string[];
  /** What's missing or weak, in plain words. */
  gaps: string[];
  actions: PlanAction[];
  /** Who to check the plan with before relying on it: a lender, a CPA, an attorney. */
  verifyWith?: string;
}
/** Tapped answers to a milestone's questions, saved as its work so they can be changed. */
export interface IntakePayload { kind: "intake"; answers: Record<string, string[]>; summary: string }
export type WorkPayload = OptionsPayload | BuildPayload | TemplatePayload | PlanPayload | IntakePayload;

/** What Nova produces on a milestone: its own `work` if it names one, else the actor's default. */
export const workKindFor = (actor: Actor, override?: WorkKind): WorkKind =>
  override ?? (actor === "nova-builds" ? "build" : actor === "user-does" ? "template" : "options");

/** The work button's label: a plan says so, whatever the actor. */
export const workActionLabel = (actor: Actor, kind?: WorkKind) =>
  kind === "plan" ? "Have Nova build this plan" : WORK_ACTION_LABEL[actor];

export const WORK_ACTION_LABEL: Record<Actor, string> = {
  "nova-builds": "Have Nova build this",
  "nova-drafts": "Have Nova draft options",
  "user-decides": "Have Nova lay out the options",
  "user-does": "Get Nova's template for this",
};
