/**
 * Every GitHub Action stays pinned to a commit SHA.
 *
 * A workflow step runs third-party code inside CI, with the repository
 * checked out and whatever secrets the job can see. `uses: actions/foo@v4`
 * does not name code — it names a tag, and a tag is a movable pointer the
 * publishing account can repoint at any commit, at any time, without a
 * release. So `@v4` means "whatever that account publishes later", and that
 * is exactly how an action supply-chain attack lands: the attacker takes the
 * upstream account, moves the tag, and the next CI run on every dependent
 * repository executes their code with its secrets. (tj-actions/changed-files
 * in March 2025 is the worked example: one moved tag, thousands of repos
 * printing their secrets into public build logs.)
 *
 * A 40-character commit SHA can't be repointed — it is the content. The
 * readable version lives in a trailing `# v4` comment so upgrades are still
 * reviewable. Without this test, one unpinned `uses:` slips into a PR and
 * nothing notices until it matters.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const DIR = join(import.meta.dirname, "..", "..", ".github", "workflows");

const WHY = [
  "A GitHub Action must be pinned to a full 40-character commit SHA, with the",
  "version as a trailing comment: `uses: owner/repo@<sha> # v4`. A tag is not",
  "enough — a tag can be moved to point at different code, so `@v4` means",
  "\"whatever that account publishes later\", and repointing it is how an action",
  "supply-chain attack reaches your secrets. Get the SHA from the release you",
  "actually reviewed (`gh api repos/<owner>/<repo>/commits/v4 --jq .sha`).",
].join(" ");

/** `uses:` lines, with the file and line number so a failure says where to look. */
const steps = readdirSync(DIR)
  .filter((n) => /\.ya?ml$/.test(n))
  .flatMap((name) =>
    readFileSync(join(DIR, name), "utf8").split("\n").flatMap((line, i) => {
      const m = line.match(/^\s*(?:-\s*)?uses:\s*(\S+)(.*)$/);
      return m ? [{ where: `${name}:${i + 1}`, ref: m[1].replace(/^["']|["']$/g, ""), rest: m[2] }] : [];
    }),
  );

describe("GitHub Actions are pinned", () => {
  it("has workflows to check", () => {
    // A rename or a moved directory would otherwise make this whole file pass by finding nothing.
    expect(steps.length).toBeGreaterThan(0);
  });

  it("pins every third-party action to a commit SHA", () => {
    const unpinned = steps
      // Local actions live in this repository and are reviewed with it; a
      // docker:// ref is resolved by its own digest or tag, not by GitHub's.
      .filter((s) => !s.ref.startsWith("./") && !s.ref.startsWith("docker://"))
      .filter((s) => !/^[^@\s]+@[0-9a-f]{40}$/.test(s.ref))
      .map((s) => `${s.where} → ${s.ref}`);
    expect(unpinned, WHY).toEqual([]);
  });

  it("keeps a readable version comment next to each SHA", () => {
    /*
     * The SHA is unreadable on purpose, which makes it easy to never upgrade
     * — nobody can tell at a glance that a pin is two majors behind. The
     * comment is what makes the diff reviewable, so it is part of the rule.
     */
    const uncommented = steps
      .filter((s) => /^[^@\s]+@[0-9a-f]{40}$/.test(s.ref))
      .filter((s) => !/#\s*v?\d+(\.\d+)*/i.test(s.rest))
      .map((s) => `${s.where} → ${s.ref}`);
    expect(uncommented, "Pinned, but with no `# v4`-style comment saying which release the SHA is.").toEqual([]);
  });
});
