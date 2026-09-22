/**
 * What the audit actually read, in one line a person can check.
 *
 * Three audits went wrong this week in the same way, and in every one of them
 * the builder had no way of telling from the page what the audit had in front
 * of it. One graded a zip the builder had uploaded days earlier and told them
 * to cancel a wedge they had shipped since. One reported the admin safety loop
 * as four partial steps when every route, page and test existed — in the part
 * of the archive that was over the byte budget and never read. One called
 * tables missing that are declared in shared/schema.ts.
 *
 * None of that is visible in "Nova read your code and it's 62% built". This is
 * the provenance: where the code came from, which commit if a commit is
 * knowable, when the snapshot was taken, and how much of it was read. It rides
 * on the audit row and prints in the header, so "that audit is about last
 * Tuesday's zip" is a glance rather than an investigation.
 *
 * Honesty over completeness: an uploaded archive carries no commit, so this
 * says so instead of inventing one. A field that might be a guess is null.
 */
export interface AuditProvenance {
  /** Where the code came from. */
  kind: "github" | "upload" | "worktree";
  /** The raw source string the audit was stored with ("github:owner/repo@main"). */
  source: string;
  /** Repository or archive name, without the scheme. */
  name: string;
  /** The branch or tag read, when the source has one. */
  ref: string | null;
  /** The commit the snapshot is of, when it is knowable. Null is a real answer. */
  commit: string | null;
  /** When this snapshot was taken (ISO). */
  capturedAt: string;
  /**
   * The newest file in the archive, when the archive carries timestamps. For an
   * upload this is the closest thing to "how old is this code" there is: a zip
   * made last Tuesday says Tuesday here however fresh the upload was.
   */
  contentAt: string | null;
  fileCount: number;
  readCount: number;
  /**
   * Source files that were listed and not read — over the size cap, over the
   * byte budget, or unreadable. Not lockfiles, images or fonts: those are
   * skipped on purpose and hold no answer the audit was going to grade.
   */
  unreadSource: number;
  /** The digest was a view, not the repository: clipped, or source left unread. */
  partial: boolean;
}

const KIND_LABEL: Record<AuditProvenance["kind"], string> = {
  github: "GitHub",
  upload: "Zip upload",
  worktree: "Editor working tree",
};

const day = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? null : t.toISOString().slice(0, 10);
};

/**
 * The provenance as one sentence.
 *
 * Deliberately says the unknowns out loud. "No commit — an uploaded archive
 * doesn't carry one" is longer than saying nothing, and it is the difference
 * between a builder trusting the verdict and a builder checking it.
 */
export function describeProvenance(p: AuditProvenance | null | undefined): string {
  if (!p) return "Source unknown — this audit predates provenance being recorded.";
  const where = `${KIND_LABEL[p.kind] ?? p.kind} ${p.name}${p.ref ? `@${p.ref}` : ""}`.trim();
  const commit = p.commit
    ? `commit ${p.commit}`
    : p.kind === "upload"
      ? "no commit (an uploaded archive doesn't carry one)"
      : "no commit recorded";
  const taken = day(p.capturedAt);
  const content = day(p.contentAt);
  const when = taken
    ? `snapshot taken ${taken}${content && content !== taken ? `, newest file in it ${content}` : ""}`
    : "snapshot time unknown";
  /*
   * Said in terms of source, because that is what decides whether an absence
   * means anything. "1,200 of 1,410 files read" alarms nobody when the other
   * 210 are images and a lockfile; "8 source files unread" is the number that
   * should stop a reader trusting a verdict of "missing".
   */
  const unread = p.unreadSource ?? 0;
  const read = p.fileCount
    ? `${p.readCount} of ${p.fileCount} files read${
        p.partial
          ? ` — ${unread > 0 ? `${unread} source file${unread === 1 ? "" : "s"} unread` : "a clipped view"}, so anything not read is unknown, not absent`
          : " (every source file among them)"
      }`
    : "no files read";
  return `${where} · ${commit} · ${when} · ${read}`;
}

/**
 * Was this a view rather than the repository? The one question every absence
 * claim turns on.
 *
 * Counted in source files, not in files. Every repository holds a lockfile, a
 * PNG, a font — all skipped deliberately, none of them a place a feature could
 * be hiding. Treating those as "partial" would make every audit partial and no
 * verdict of "missing" could ever survive, which trades a false negative for a
 * useless one: an audit that can never say a thing is absent cannot tell you
 * what to build next.
 *
 * `unreadSource` is undefined on audits recorded before it existed; those fall
 * back to the blunt comparison, which errs towards "partial" and so towards
 * "unknown". Erring that way on old records is the right side to be wrong on.
 */
export function isPartialView(p: { truncated?: boolean; fileCount: number; readCount: number; unreadSource?: number }): boolean {
  if (p.truncated) return true;
  if (typeof p.unreadSource === "number") return p.unreadSource > 0;
  return p.readCount < p.fileCount;
}
