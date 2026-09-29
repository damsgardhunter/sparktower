/**
 * Which projects are mid-build, so the rest of the server can stop shouting.
 *
 * Finishing a step on a path tells the team and the project's followers, which
 * is right when a person finished it: it happened once, somebody did it, and
 * the news is worth a line in the bell. An unattended build finishes eighteen
 * of them in fourteen minutes. The first real run of "Nova builds the whole
 * business" left its buyer with twenty unread notifications — nineteen of them
 * about work they had paid precisely so they would not have to watch — and the
 * one that mattered, "your build is done", was at the top of a pile that made
 * it look like noise.
 *
 * So a build marks its project quiet while it runs, and the per-step
 * notifications stand down. Nothing is lost: the build ends with a single
 * notification saying what it wrote, and the steps themselves are on the path
 * where they always were.
 *
 * In-process and deliberately not in the database. The thing it describes — a
 * fire-and-forget promise doing the work — is in-process too, so a restart
 * that loses this set has already lost the build it referred to.
 */
const quiet = new Set<string>();

/** Runs `work` with this project's per-step notifications held back. */
export async function whileBuilding<T>(projectId: string, work: () => Promise<T>): Promise<T> {
  quiet.add(projectId);
  try {
    return await work();
  } finally {
    quiet.delete(projectId);
  }
}

/** True while a build is working through this project's path. */
export const buildIsWorking = (projectId: string): boolean => quiet.has(projectId);
