/**
 * The shape of Nova's work on a milestone, by actor. This is what makes the
 * actor label true: nova-drafts and user-decides produce options to pick
 * from, nova-builds produces the thing itself, user-does produces the
 * template for the human part.
 */
import type { Actor } from "./types";
import type { RunGroup } from "./run-steps";

export type WorkKind = "options" | "build" | "template";

export interface WorkOption { title: string; body: string; why?: string }
export interface WorkFile { path: string; language: string; content: string; purpose?: string }

export interface OptionsPayload { kind: "options"; existing?: string; intro: string; options: WorkOption[] }
export interface BuildPayload { kind: "build"; existing?: string; summary: string; files: WorkFile[]; runSteps: string[]; verify: string; assumptions: string[]; /** Which model wrote the files. */ model?: string; /** The run steps as blocks to copy — see run-steps.ts. */ runGroups?: RunGroup[] }
export interface TemplatePayload { kind: "template"; intro: string; template: string; whatNovaDid: string; whatIsLeft: string }
export type WorkPayload = OptionsPayload | BuildPayload | TemplatePayload;

export const workKindFor = (actor: Actor): WorkKind =>
  actor === "nova-builds" ? "build" : actor === "user-does" ? "template" : "options";

export const WORK_ACTION_LABEL: Record<Actor, string> = {
  "nova-builds": "Have Nova build this",
  "nova-drafts": "Have Nova draft options",
  "user-decides": "Have Nova lay out the options",
  "user-does": "Get Nova's template for this",
};
