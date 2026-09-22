/**
 * The guard that makes the takedown policy hold next month.
 *
 * Hiding content is easy to *do* and easy to stop doing by accident. The
 * moderation action writes one column; being hidden, on the other hand, is a
 * property of every read — and the number of reads only ever goes up. A person
 * adding "recently discussed projects" to a sidebar next quarter is not
 * thinking about a doxxing report from last March, and nothing in the type
 * system, the review checklist or the integration tests will remind them: the
 * feature works, the page renders, and content a reviewer took down is on it.
 *
 * That is the failure this file is for. It reads the server source, finds
 * every query that reads a content table, and fails when one of them applies
 * neither the shared policy (server/visibility.ts) nor an explicit exemption
 * written down here with a reason. Same shape as the rate-limit guard in
 * test/unit/route-guards.test.ts, and for the same reason: a rule nobody can
 * forget is worth more than a rule everybody agrees with.
 *
 * The exemptions are real and there are a lot of them, because most reads of
 * these tables genuinely aren't public reads — a moderator has to see what
 * they are judging, an author has to see their own draft, a delete has to find
 * the row it is deleting. Every one of them says which it is. The cost of the
 * list is that it has to be maintained; the benefit is that "this read is
 * allowed to serve hidden content" becomes a sentence someone had to write.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const root = join(__dirname, "..", "..");
const serverDir = join(root, "server");

const walk = (d: string, out: string[] = []): string[] => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.ts$/.test(n)) out.push(p);
  }
  return out;
};

/**
 * The tables a takedown acts on and a suspension should empty out. `projects`
 * is deliberately not here: two thirds of its reads are a workspace loading
 * one project by id for its own team, where the policy would be wrong, and a
 * guard whose exemption list is longer than its findings teaches people to add
 * lines to the exemption list. The project listings that do face the public
 * (`getProjects`, `getLeaderboard`, the sitemap, scouting) go through
 * `publiclyVisible.project()` and are covered by test/integration/public-edges
 * and the drill below.
 */
const CONTENT_TABLES = ["feedPosts", "feedComments", "projectComments", "pathArtifacts"] as const;

/** Anything exported by server/visibility.ts counts as going through the policy. */
const POLICY = /\b(publiclyVisible|notTakenDown|feedPostVisibleTo|feedCommentVisibleTo|projectCommentVisibleTo|publicArtifactVisible|commentVisibleTo|authorIsLive)\b/;

interface Unit { name: string; line: number }
interface Read { file: string; table: string; unit: string; body: string }

/**
 * The declarations a read can sit inside: a mounted route, a top-level
 * function, a class method on `DatabaseStorage`, or a route handler assigned
 * to a name (`setHidden`). Deliberately not every arrow function: a read's
 * conditions are often built a dozen lines above it, in the same function but
 * outside any nested helper, so the unit has to be the function a person would
 * say the read is "in".
 */
function unitsOf(lines: string[]): Unit[] {
  const out: Unit[] = [];
  const skip = ["if", "for", "while", "switch", "catch", "return", "await", "else", "do", "try"];
  lines.forEach((line, i) => {
    const route = /^\s*app\.(get|post|put|patch|delete)\(\s*"([^"]+)"/.exec(line);
    if (route) return void out.push({ name: `${route[1].toUpperCase()} ${route[2]}`, line: i });
    const fn = /^(?:export )?(?:async )?function ([A-Za-z_$][\w$]*)/.exec(line)
      ?? /^(?:export )?const ([A-Za-z_$][\w$]*) = (?:async )?\(/.exec(line)
      ?? /^ {2}const ([A-Za-z_$][\w$]*) = async \((?:req|entry)/.exec(line)
      ?? /^ {2}(?:private )?(?:async )?([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\(/.exec(line);
    if (fn && !skip.includes(fn[1])) out.push({ name: fn[1], line: i });
  });
  return out;
}

/**
 * Every `db.select(…).from(<content table>)` in the server, attributed to the
 * function it is in, and checked against that whole function's text.
 *
 * The *function*, not the statement: drizzle queries are assembled — a feed
 * read builds a `conditions` array and passes it to `where` fifty lines later
 * — so a statement-sized window would report the conditions as missing when
 * they are right there. Text, not an AST, because what this has to catch is
 * "somebody wrote a new query and didn't think about takedowns", and for that,
 * reading the function the way a reviewer reads it is enough.
 */
function readsOf(file: string, src: string): Read[] {
  const lines = src.split("\n");
  const units = unitsOf(lines);
  const out: Read[] = [];
  lines.forEach((line, i) => {
    for (const table of CONTENT_TABLES) {
      if (!line.includes(`.from(${table})`)) continue;
      let u = -1;
      for (let k = 0; k < units.length && units[k].line <= i; k++) u = k;
      const start = u === -1 ? 0 : units[u].line;
      const end = u === -1 || u + 1 >= units.length ? lines.length : units[u + 1].line;
      out.push({
        file: `server/${file}`,
        table,
        unit: u === -1 ? "(top level)" : units[u].name,
        body: lines.slice(start, end).join("\n"),
      });
    }
  });
  return out;
}

/**
 * Reads that are allowed to see hidden content, each with the reason.
 *
 * Keyed by `server/<file>:<route or function>`. Three honest kinds:
 *
 *   - A reviewer's read. Blinding the moderation queue to hidden content would
 *     make the takedown un-reviewable and the undo impossible — the people who
 *     have to judge it must see it, with its state. This is the case the task
 *     of applying the policy everywhere exists to *not* break.
 *   - A read that finds a row in order to change it: a hide, a restore, a
 *     delete, an edit, a reaction. It isn't serving content to anybody, and
 *     filtering it would mean a reviewer couldn't restore what they hid.
 *   - A read whose own caller applies the policy immediately afterwards
 *     (usually by rehydrating through `storage.getFeedPost`, which does).
 */
const MAY_SEE_HIDDEN: Record<string, string> = {
  // --- Reviewers, who have to see what they are deciding about --------------
  "server/moderation.ts:snapshotOf": "files the report: snapshots the words at the moment of reporting, including of something already hidden",
  "server/moderation.ts:GET /api/admin/reports": "the moderation queue: it exists to show hidden items and their state",

  // --- Reads that exist to write ------------------------------------------
  "server/feed-routes.ts:DELETE /api/companies/:id/posts/:postId": "finds the post in order to delete it",
  "server/feed-routes.ts:POST /api/feed/:id/comments": "parent-comment lookup for a reply; refuses a hidden or deleted parent in the handler",
  "server/feed-routes.ts:POST /api/feed/comments/:commentId/react": "finds the comment to react to; refuses a hidden one in the handler",
  "server/storage.ts:deleteProjectComment": "author-or-owner delete: finds the row to delete it",
  "server/storage.ts:projectOfComment": "returns only the project id, so a caller can check the viewer may see it",
  "server/storage.ts:deleteFeedPost": "author delete: asks whether anyone else has replied, so the thread survives",
  "server/storage.ts:deleteFeedComment": "author delete: asks whether the comment has replies under it",
  "server/artifact-routes.ts:generateArtifact": "the team's own draft of a step, before anything is published",
  "server/artifact-routes.ts:GET /api/projects/:id/artifacts": "a project's own artifacts, for its team — including one taken down, so they can see it was",
  "server/artifact-routes.ts:POST /api/artifacts/:id/publish": "finds the artifact in order to publish it; refuses a hidden one in the handler",
  "server/artifact-routes.ts:POST /api/artifacts/:id/unpublish": "finds the artifact in order to unpublish it",
  "server/artifact-routes.ts:artifactForTask": "tells the team's own task board whether this step's page is live",
  "server/feedback-loop-routes.ts:closableComments": "validates ids a team is crediting in its own update; the comments were already shown through projectFeedback",
  "server/feedback-loop-routes.ts:creditsFor": "names the people a post credited; the credit is the project's own record of it",
  "server/feedback-loop-routes.ts:POST /api/feed/comments/:commentId/apply": "the team turning feedback into a task; refuses a hidden or deleted comment in the handler",

  // --- Reads whose caller applies the policy -------------------------------
  "server/storage.ts:hydrateFeedPost": "decorates a post already admitted by getFeedPost/getFeedPosts: the credits on it, and the artifact it published",
  "server/notifications.ts:notifyComment": "reads the parent comment's author id to address a reply notification; the notification itself is filtered where it is read, and withholding the address would silently drop replies",
  "server/feed-routes.ts:DELETE /api/feed/:id": "author delete: finds the post in order to remove it",
};

const reads = walk(serverDir)
  .map((p) => ({ file: p.slice(serverDir.length + 1), src: readFileSync(p, "utf8") }))
  .filter((f) => f.file !== "visibility.ts")
  .flatMap((f) => readsOf(f.file, f.src));

const key = (r: Read) => `${r.file}:${r.unit}`;

describe("every read of a content table answers to the takedown policy", () => {
  it("finds the reads at all — a guard that matches nothing guards nothing", () => {
    expect(reads.length).toBeGreaterThan(20);
    for (const t of CONTENT_TABLES) {
      expect(reads.some((r) => r.table === t), `no read of ${t} found; did the table get renamed?`).toBe(true);
    }
  });

  it("goes through server/visibility.ts, or says in writing why it doesn't", () => {
    const offenders = reads
      .filter((r) => !POLICY.test(r.body))
      .filter((r) => !(key(r) in MAY_SEE_HIDDEN))
      .map((r) => `${key(r)} — reads ${r.table}`);
    const unique = [...new Set(offenders)];
    expect(
      unique,
      "These reads can serve content a reviewer took down.\n" +
      "Apply a helper from server/visibility.ts, or add the read to MAY_SEE_HIDDEN with the reason it is allowed:\n  " +
      unique.join("\n  "),
    ).toEqual([]);
  });

  it("keeps the exemption list honest: every entry names a read that still exists and still skips the policy", () => {
    for (const k of Object.keys(MAY_SEE_HIDDEN)) {
      const matching = reads.filter((r) => key(r) === k);
      expect(matching.length, `${k} is exempt but no such read exists any more — delete the line`).toBeGreaterThan(0);
      expect(
        matching.some((r) => !POLICY.test(r.body)),
        `${k} now goes through the visibility policy — delete the line`,
      ).toBe(true);
    }
  });

  it("gives every exemption a reason a person wrote, not a placeholder", () => {
    for (const [k, why] of Object.entries(MAY_SEE_HIDDEN)) {
      expect(why.length, `${k} needs a real reason`).toBeGreaterThan(25);
      expect(why, `${k}: "TODO" is not a reason`).not.toMatch(/todo|fixme|xxx/i);
    }
  });
});

describe("the policy itself", () => {
  const src = readFileSync(join(serverDir, "visibility.ts"), "utf8");

  it("tests both halves for every content table: taken down, and the author's account", () => {
    for (const t of ["feedPosts", "feedComments", "projectComments", "projects", "pathArtifacts"]) {
      expect(src, `publiclyVisible has no rule for ${t}`).toContain(`${t}.hiddenAt`);
    }
    expect(src).toContain("suspended_at is null");
    expect(src).toContain("deleted_at is null");
  });

  it("imports nothing but the schema, so no read path can be caught in a cycle through it", () => {
    const imports = [...src.matchAll(/^import .*? from "([^"]+)";$/gm)].map((m) => m[1]);
    expect(imports.sort()).toEqual(["@shared/schema", "drizzle-orm"]);
  });
});
