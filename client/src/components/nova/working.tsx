/**
 * What the machine is doing right now, while you wait for it.
 *
 * ## The thing a spinner refuses to say
 *
 * A spinner says "something is happening". It does not say what, how far
 * through, how long it has taken, or whether it is stuck — and those are the
 * only four questions anybody has while they watch one. On a wait of two
 * seconds that does not matter. On a wait of two minutes, which is what
 * reading a repository or building a business actually costs, a bare spinner
 * is the product declining to answer.
 *
 * So: a segment per stage, the current one pulsing; the stage named in plain
 * words — "Nova is reading it", not "PROCESSING"; and, where the caller knows
 * them, who started it and how long ago. That last pair matters more than it
 * looks, because these runs are shared: a teammate can start a code read, and
 * "Dana · 1:05" is the difference between a screen that seems frozen and one
 * that is obviously somebody else's work in progress.
 *
 * ## Why the stages are words rather than a percentage
 *
 * A percentage on work whose length nobody knows is invented. These runs are a
 * handful of named phases with genuinely different characters — fetching is
 * network, reading is the model, saving is the database — and naming the phase
 * is both honest and more informative than a number that jumps from 30% to 90%
 * because a stage boundary moved.
 *
 * The current stage is drawn at 60% rather than a growing fill for the same
 * reason: nothing here knows how far through a stage it is, and a bar that
 * crept to 95% and sat there would be making it up.
 *
 * ## Written down once
 *
 * The Codebase tab and the whole-business build each had their own hand-copied
 * version of this, already subtly different. Anything with a wait longer than
 * a breath should use this one, so a builder learns the shape of a Nova wait
 * exactly once.
 */
import type { ReactNode } from "react";
import { LiveDot } from "./live-dot";
import { NOVA_GRADIENT } from "./tokens";

export interface WorkingStage {
  id: string;
  /** What the machine is doing here, as a person would say it. Sentence case, no ellipsis — this adds one. */
  label: string;
}

export interface WorkingProps {
  /** The stages in the order they happen. Two to five; more than that is a log, not a progress bar. */
  stages: readonly WorkingStage[];
  /**
   * Which stage is happening, by id. Null or unrecognised means it has been
   * asked for and has not reported yet, which is drawn as nothing started
   * rather than as the first stage finished.
   */
  current?: string | null;
  /**
   * What to say instead of the current stage's own label.
   *
   * For the moments the server has no stage for because they are happening in
   * the browser — "Uploading the zip" before a run exists at all. Without it
   * those seconds either say nothing or claim a stage that has not begun.
   */
  saying?: string | null;
  /** Who and how long, on the right. Usually `<>Dana · 1:05</>`. */
  meta?: ReactNode;
  /** A second line under the bar: "19 of 28 steps · Writing your pricing page". */
  detail?: ReactNode;
  /**
   * How far through the *current* stage, 0–1, for the rare caller that
   * genuinely knows — a build counting steps off a list, say.
   *
   * Omitted everywhere else on purpose. The 60% below is an admission that
   * nothing knows; replacing it with a number that is also invented, but looks
   * precise, would be the worse lie of the two. Floored well above zero so a
   * stage that has only just begun still reads as begun.
   */
  progress?: number | null;
  testId?: string;
}

export function Working({ stages, current, saying, meta, detail, progress, testId = "working" }: WorkingProps) {
  const index = current ? stages.findIndex((s) => s.id === current) : -1;
  const label = saying ?? (index >= 0 ? stages[index].label : "Getting started");

  return (
    <div className="space-y-1.5" data-testid={testId}>
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${Math.max(1, stages.length)}, minmax(0, 1fr))` }}
        // The words below say the same thing, and a screen reader does not need it twice.
        aria-hidden
      >
        {stages.map((stage, i) => (
          <div key={stage.id} className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full ${NOVA_GRADIENT} transition-all duration-700 ${i === index ? "animate-pulse" : ""}`}
              /* Done is full, later is nothing, and now is 60% unless the caller can do better. */
              style={{
                width: i < index ? "100%"
                  : i !== index ? "0%"
                  : typeof progress === "number" && Number.isFinite(progress)
                    ? `${Math.min(100, Math.max(8, Math.round(progress * 100)))}%`
                    : "60%",
              }}
            />
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5 font-medium text-foreground" data-testid={`${testId}-stage`}>
          <LiveDot />
          {/*
            * Announced politely rather than assertively: this changes every
            * thirty seconds or so, and a screen reader interrupting whatever
            * the person is doing to say "saving what it found" is worse than
            * not saying it.
            */}
          <span role="status" aria-live="polite">{label}…</span>
        </span>
        {meta && <span className="flex min-w-0 items-center gap-1.5" data-testid={`${testId}-meta`}>{meta}</span>}
      </div>

      {detail && <p className="truncate text-xs text-muted-foreground" data-testid={`${testId}-detail`}>{detail}</p>}
    </div>
  );
}

/**
 * The same idea where there is nothing on screen yet at all.
 *
 * A first load has no stages and no elapsed time to report, so it gets the
 * gradient bar and one honest sentence rather than a spinner in the middle of
 * an empty page. Use it for the initial fetch of a screen; use `Working` for
 * anything the person set off themselves.
 */
export function Loading({ what = "Loading", testId = "loading" }: { what?: string; testId?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12" data-testid={testId}>
      <div className="h-1.5 w-40 overflow-hidden rounded-full bg-muted">
        <div className={`h-full w-1/3 rounded-full ${NOVA_GRADIENT} animate-pulse`} />
      </div>
      <p className="text-xs text-muted-foreground" role="status" aria-live="polite">{what}…</p>
    </div>
  );
}
