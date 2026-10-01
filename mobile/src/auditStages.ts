/**
 * What each phase of a code read is called, on the phone.
 *
 * Lifted out of `sections.ts` into a module with no imports, so
 * `test/unit/mobile-mirror.test.ts` can compare these against
 * `client/src/lib/audit-status.ts` — `sections.ts` reaches for React Native
 * through its hooks, and the test runner cannot parse anything that does.
 *
 * Word for word from the web's copy, and worth keeping that way for a reason the
 * history shows: `reading` once said "Reading the code" here and "Nova is reading
 * it" there, so the same audit described itself differently depending on which
 * screen you watched it from. The fallback below is the web's too, which is what
 * makes "no stage reported" and "the reading stage" read alike rather than
 * disagreeing within one file.
 */
export const AUDIT_STAGE_LABEL: Record<string, string> = {
  fetching: "Fetching the code",
  reading: "Nova is reading it",
  saving: "Saving what it found",
};

export const auditStageLabel = (stage: string | null | undefined) => AUDIT_STAGE_LABEL[stage ?? ""] ?? "Nova is reading it";

/** The three phases in order, as both clients list them. */
export const AUDIT_STAGES = ["fetching", "reading", "saving"].map((id) => ({ id, label: auditStageLabel(id) }));
