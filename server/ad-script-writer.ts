/**
 * Getting a usable advert script out of a model, which takes more than asking.
 *
 * `shared/ad-script.ts` holds the rules: how many characters each beat has,
 * which phrases are legal claims, that the call to action is reproduced rather
 * than improved. This is the half that calls the model and refuses to hand
 * back an answer that breaks them.
 *
 * ## Why it retries rather than repairs
 *
 * A line that is nine characters too long cannot be fixed here. Truncating it
 * puts a sentence on screen that stops mid-word; dropping its last word
 * changes what the business said. Both are the compositor confidently
 * rendering something nobody wrote. The model wrote the line and the model
 * shortens it, told exactly what was wrong with it — which is what
 * `describeProblem` is for, and why `checkScript` returns every problem at
 * once instead of the first. Three attempts at a script with four problems is
 * three paid calls; four rounds of one correction each is four.
 *
 * ## The one thing it does repair
 *
 * The call to action, when the business supplied one. That is not a judgment
 * call: the exact string is already in hand, the model returned something
 * else, and putting the given value back is restoring an input, not writing
 * copy. It saves a paid round trip on the single most common way a model
 * deviates — it cannot resist tidying "Order at acme.test" into "Order today
 * at Acme!" — and the repair is recorded so nobody mistakes it for the model
 * having complied.
 *
 * ## Why it can fail
 *
 * After the last attempt, a script with problems left in it throws. There is
 * no partial advert worth rendering: a missing beat is a silent gap in the
 * footage, and an unsupported claim is the business's legal problem rather
 * than a cosmetic one. Failing costs the attempts and renders nothing, which
 * is the cheaper of the two outcomes — a render is the expensive half.
 */
import { openai } from "./openai-client";
import { parseModelJson } from "./ai-json";
import { TEXT_MODEL } from "./aiModels";
import { aiStubbed } from "./ai-stub";
import type { AdBeatId } from "@shared/ads";
import {
  checkScript, describeProblem, lineLimit, scriptPrompt,
  type AdScript, type ScriptProblem,
} from "@shared/ad-script";

/**
 * How many times the model is asked.
 *
 * Three, because the second attempt is where the correction lands and the
 * third is the one that catches a model having a bad run. Past that the
 * returns are gone and the bill is not: a fourth attempt on a script that
 * has failed three times is nearly always the same failure again.
 */
export const SCRIPT_ATTEMPTS = 3;

export interface ScriptRequest {
  brief: string;
  style: { label: string; bestFor: string; avoid: string; logoRole?: string | null };
  beats: { id: AdBeatId; seconds: number }[];
  voice: { label: string; how: string };
  businessName?: string | null;
  callToAction?: string | null;
  avoidWords?: string[];
  supportedClaims?: string[];
}

export interface WrittenScript {
  script: AdScript;
  /** Model calls it took. One means it was right first time. */
  attempts: number;
  /** Fixed here without asking again — the call to action, and only ever that. */
  repaired: ScriptProblem[];
  /** What each rejected attempt got wrong, in order. Empty when the first was good. */
  rejected: ScriptProblem[][];
}

/**
 * A script that is still wrong after every attempt.
 *
 * 422 rather than 502: the model answered, and the answer was readable and
 * unusable. A 502 would tell the person waiting to try again, and trying
 * again is what just happened three times.
 */
export class ScriptUnusableError extends Error {
  status = 422;
  code = "script_unusable";
  constructor(public problems: ScriptProblem[], public attempts: number) {
    super(
      `Nova could not write an advert script that fits in ${attempts} attempts. ` +
      `What was still wrong: ${problems.map(describeProblem).join(" ")}`,
    );
    this.name = "ScriptUnusableError";
  }
}

/** The model call, as one function, so a test can stand in for it without a network. */
export type AskModel = (prompt: { system: string; user: string }) => Promise<string>;

/**
 * Module-level and free of interpolation, so it is the byte-identical cached
 * prefix of every script call. Everything that varies is in the user message.
 */
const SCRIPT_RULES = `You are writing the words for a short advert that will be set large over moving footage.
Every line is read in the time it is on screen, so lines are a few words, not sentences. Write only what the business told you: never invent a customer, a quote, a number, a price, a result or an award.
Respond ONLY with JSON of exactly this shape: {"lines":[{"beat":"","onScreen":"","voiceover":""}],"callToAction":""}`;

const askOpenAi: AskModel = async ({ system, user }) => {
  const completion = await openai.chat.completions.create({
    model: TEXT_MODEL,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
  }, { timeout: 60_000 });
  return completion.choices[0]?.message?.content ?? "";
};

/**
 * Write a script, check it, and ask again with the problems named.
 *
 * `ask` exists so the retry behaviour can be driven deterministically in a
 * test. Every failure mode here — a too-long line, a fabricated claim, a model
 * that fixes one problem and introduces another — is a specific answer from
 * the model, and waiting for the real one to produce each of them on cue is
 * not a test, it is a coin toss with a bill attached.
 */
export async function writeAdScript(
  input: ScriptRequest,
  opts: { ask?: AskModel; attempts?: number } = {},
): Promise<WrittenScript> {
  const ask = opts.ask ?? (aiStubbed() ? stubAsk(input) : askOpenAi);
  const limit = Math.max(1, opts.attempts ?? SCRIPT_ATTEMPTS);
  const base = scriptPrompt(input);
  const rejected: ScriptProblem[][] = [];
  let last: ScriptProblem[] = [];

  for (let attempt = 1; attempt <= limit; attempt++) {
    const user = attempt === 1 ? base : `${base}\n\n${correction(last)}`;
    const raw = await ask({ system: SCRIPT_RULES, user });
    const script = readScript(raw);

    const { repaired } = repairCta(script, input.callToAction);
    const problems = checkScript(script, input.beats, input);

    if (problems.length === 0) return { script, attempts: attempt, repaired, rejected };

    rejected.push(problems);
    last = problems;
  }

  throw new ScriptUnusableError(last, limit);
}

/** What the model is told after a rejected attempt. */
function correction(problems: ScriptProblem[]): string {
  return [
    `Your last answer could not be used. Every problem with it:`,
    ...problems.map((p) => `- ${describeProblem(p)}`),
    `Fix exactly these. Leave every other line as it was.`,
  ].join("\n");
}

/**
 * The call to action, put back to the string the business gave.
 *
 * Mutates the script rather than returning a copy because the caller holds the
 * only reference and a copy here would be a second object to keep in step.
 */
function repairCta(script: AdScript, expected?: string | null): { repaired: ScriptProblem[] } {
  if (!expected?.trim()) return { repaired: [] };
  const was = script.callToAction ?? "";
  if (was.trim() === expected.trim()) return { repaired: [] };
  script.callToAction = expected;
  return { repaired: [{ kind: "cta_changed", expected, was }] };
}

/**
 * The model's answer as a script, with the shape checked before the rules are.
 *
 * `parseModelJson` guarantees JSON and nothing else, so an answer that parses
 * to a number or an array of strings would otherwise reach `checkScript` and
 * be reported as five missing beats — which reads as a model that wrote a bad
 * script rather than one that did not write a script.
 */
function readScript(raw: string): AdScript {
  const parsed = parseModelJson<any>(raw, "advert script");
  const lines = Array.isArray(parsed?.lines) ? parsed.lines : [];
  return {
    lines: lines
      .filter((l: any) => l && typeof l.beat === "string" && typeof l.onScreen === "string")
      .map((l: any) => ({
        beat: l.beat as AdBeatId,
        onScreen: l.onScreen.trim(),
        voiceover: typeof l.voiceover === "string" ? l.voiceover.trim() : undefined,
        scene: typeof l.scene === "string" ? l.scene.trim() : undefined,
      })),
    callToAction: typeof parsed?.callToAction === "string" ? parsed.callToAction.trim() : "",
  };
}

// ---------------------------------------------------------------------------
// Without spending anything
// ---------------------------------------------------------------------------

/**
 * A real script, written locally, when AI_STUB is on.
 *
 * The generic stub in `server/ai-stub.ts` cannot do this one. It reads the
 * JSON shape out of the system prompt and fills every string with "", which
 * here is five missing beats, three rejected attempts and a 422 — so the
 * stubbed server, whose whole purpose is to let the rest of the pipeline run
 * for free, would be the one configuration in which adverts never render.
 *
 * So the stub writes something that passes `checkScript` for real: lines
 * within each beat's limit, the supplied call to action reproduced exactly,
 * and no claim phrases. It is deliberately dull. The point is to get a valid
 * script into the compositor without a bill, not to pretend to be a copywriter.
 */
export function stubScript(input: ScriptRequest): AdScript {
  const name = input.businessName?.trim();
  const say: Record<AdBeatId, string> = {
    hook: name ? `This is ${name}` : "Here is the idea",
    problem: "The old way takes too long",
    product: name ? `${name}` : "The new way",
    proof: "Made by people who use it",
    cta: "Take a look",
  };

  /*
   * A scene per beat, so a stubbed script passes the same checks a real one
   * does. Deliberately dull and deliberately concrete — the point is to prove
   * the shape, not to direct a film.
   */
  const scene: Record<AdBeatId, string> = {
    hook: "A hand reaching for a cold mug on a desk by a window, early morning light.",
    problem: "A kitchen table at night, papers spread across it, one lamp on.",
    product: "A clean wooden worktop by a window, empty, lit evenly from the side.",
    proof: "Two people side by side at a workbench, seen from behind, mid-conversation.",
    cta: "An open doorway onto a bright street, shot from inside, shallow focus.",
  };

  return {
    lines: input.beats.map((b) => {
      const want = say[b.id] ?? "A few words";
      return { beat: b.id, onScreen: safeLine(want, b, input), voiceover: "", scene: scene[b.id] };
    }),
    callToAction: input.callToAction?.trim() || "See the site",
  };
}

/**
 * A line that fits and says nothing it was told not to.
 *
 * The fallback has no letters in it at all, which is the only way to be
 * certain of that: `avoidWords` is whatever the business typed, and any
 * English placeholder could contain one of them.
 */
function safeLine(want: string, beat: { id: AdBeatId; seconds: number }, input: ScriptRequest): string {
  const limit = lineLimit(beat.id, beat.seconds);
  const trimmed = want.slice(0, limit);
  const haystack = trimmed.toLowerCase();
  const banned = (input.avoidWords ?? []).some((w) => w && haystack.includes(w.toLowerCase()));
  return banned ? "· · ·" : trimmed;
}

const stubAsk = (input: ScriptRequest): AskModel => async () => JSON.stringify(stubScript(input));
