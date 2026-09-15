/**
 * Which files an open loop is judged on in its close read — checked against
 * this repository's own loops, which the first pass reported "not evidenced"
 * because their proof sat outside the digest's sample.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
vi.mock("openai", () => ({ default: class { chat = { completions: { create: async () => ({}) } }; } }));
vi.mock("../../server/db", () => ({ db: {}, pool: {} }));
import { pickLoopEvidence } from "../../server/audit-loop-reads";

const root = join(__dirname, "..", "..");
const walk = (dir: string, out: { path: string; size: number; content: string }[] = []) => {
  for (const name of readdirSync(join(root, dir))) {
    if (["node_modules", ".git", "dist", "test-results", "migrations", ".objects"].includes(name)) continue;
    const rel = dir ? `${dir}/${name}` : name;
    const st = statSync(join(root, rel));
    if (st.isDirectory()) walk(rel, out);
    else if (/\.(tsx?|md)$/.test(name) && st.size < 400_000) out.push({ path: rel, size: st.size, content: readFileSync(join(root, rel), "utf8") });
  }
  return out;
};
const files = [...walk("server"), ...walk("client/src"), ...walk("shared"), ...walk("docs"), ...walk("test"), ...walk("e2e")];

describe("the close read of an open loop", () => {
  it("finds the admin safety loop's routes, page and tests through its doc", () => {
    const { paths, docs } = pickLoopEvidence({
      title: "Admin: review safety signals and act on reports",
      description: "Review reports/rate-limit hits/loop metrics → take moderation action (remove/ban/flag surface) → monitor impact → repeat",
    }, files);
    expect(docs[0]).toBe("docs/safety-loop.md");
    expect(paths).toEqual(expect.arrayContaining([
      "server/safety-routes.ts", "client/src/pages/admin-safety.tsx", "server/moderation.ts",
      "test/integration/safety-loop.test.ts", "e2e/safety-review.spec.ts",
    ]));
    // Source first: the code closes the loop, the tests prove it.
    expect(paths.indexOf("server/safety-routes.ts")).toBeLessThan(paths.indexOf("test/integration/safety-loop.test.ts"));
  });

  it("finds the feedback loop's last step, which the first pass also couldn't see", () => {
    const { paths, docs } = pickLoopEvidence({
      title: "Build: publish a project progress post and get feedback",
      description: "Post a project update with specific asks → people answer → team turns feedback into a task → next update credits it → commenter sees their feedback was used",
    }, files);
    expect(docs[0]).toBe("docs/feedback-loop.md");
    expect(paths).toEqual(expect.arrayContaining(["server/feedback-loop-routes.ts", "client/src/components/feedback-inbox.tsx", "e2e/feedback-loop.spec.ts"]));
  });

  it("keeps the first pass's own evidence, and stays within its budget", () => {
    const { paths } = pickLoopEvidence({ title: "Something unrelated entirely", description: "" }, files, ["server/app.ts"], 3);
    expect(paths[0]).toBe("server/app.ts");
    expect(paths.length).toBeLessThanOrEqual(3);
  });
});
