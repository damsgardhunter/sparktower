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
import { documentedEndpoints, pickLoopEvidence } from "../../server/audit-loop-reads";

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

  it("finds the goal-path loop through its doc, check-in wording and all", () => {
    const { paths, docs } = pickLoopEvidence({
      title: "Build: follow a goal path (Ship/Systemize/Fund) → do the next milestone task → post weekly check-in",
      description: "Choose/enter active project goal path → see “next step” for the path → complete task/artifact → post weekly check-in → receive comments/feedback → return to next step",
    }, files);
    expect(docs[0]).toBe("docs/path-loop.md");
    expect(paths).toEqual(expect.arrayContaining([
      "server/path-return.ts", "server/feed-routes.ts", "server/notifications.ts", "client/src/pages/post-detail.tsx", "e2e/path-loop.spec.ts",
    ]));
  });

  it("keeps the first pass's own evidence, and stays within its budget", () => {
    const { paths } = pickLoopEvidence({ title: "Something unrelated entirely", description: "" }, files, ["server/app.ts"], 3);
    expect(paths[0]).toBe("server/app.ts");
    expect(paths.length).toBeLessThanOrEqual(3);
  });

  it("doesn't crown a document that shares a couple of ordinary words with the title", () => {
    /*
     * This is how the rule above broke: a runbook about connecting a domain
     * contained "something" and "entirely", scored as the loop's own doc, and
     * its cited paths displaced the first pass's evidence at the front of the
     * read. A doc has to say something about the loop's steps, or be headed
     * with its name, before it counts as being about it.
     */
    const { docs } = pickLoopEvidence({ title: "Something unrelated entirely", description: "" }, files);
    expect(docs).toEqual([]);
    // A real loop with real steps still finds its doc — the rule didn't just turn the feature off.
    const real = pickLoopEvidence({
      title: "Admin: review safety signals and act on reports",
      description: "Review reports/rate-limit hits/loop metrics → take moderation action (remove/ban/flag surface) → monitor impact → repeat",
    }, files);
    expect(real.docs[0]).toBe("docs/safety-loop.md");
  });

  it("reads a loop's own doc over a long plan that mentions every loop's words", () => {
    const growth = pickLoopEvidence({ title: "Publish path artifact", type: "growth", description: "Finish a Path Step and click Generate Artifact → Publish to Feed with public title + tags + link back to Project/Path → public indexable URL → stranger signs up → publishes their own" }, files);
    expect(growth.docs[0]).toBe("docs/growth-loop.md");
    expect(growth.paths).toEqual(expect.arrayContaining(["server/artifact-routes.ts", "client/src/pages/public-artifact.tsx", "e2e/growth-loop.spec.ts"]));

    const revenue = pickLoopEvidence({ title: "Hit AI credits limit", type: "revenue", description: "Use Path tools and click Generate on an AI-backed Artifact → spend through free AI credits → Upgrade to keep generating with plan options → subscribe via Stripe → renewal/top-up" }, files);
    expect(revenue.docs[0]).toBe("docs/revenue-loop.md");
    expect(revenue.paths).toEqual(expect.arrayContaining(["server/entitlements.ts", "client/src/components/upgrade-to-keep-generating.tsx", "server/billing-credits.ts", "e2e/revenue-loop.spec.ts"]));
  });

describe("the endpoints a loop's writing names", () => {
  const routes = [
    { label: "POST /api/projects/:id/follow", file: "server/routes.ts" },
    { label: "POST /api/users/:userId/follow", file: "server/routes.ts" },
    { label: "POST /api/connections/request", file: "server/routes.ts" },
    { label: "POST /api/messages/:userId", file: "server/routes.ts" },
    { label: "GET /api/discover/updates", file: "server/explore-routes.ts" },
  ];

  it("says which exist, wherever they're registered, and which don't", () => {
    const doc = `The loop: open Discover, follow a builder with POST /api/users/:id/follow, ask to connect
      (POST /api/connections/request), message them at POST /api/messages/:userId, and come back
      through GET /api/discover/updates. Later we'll add POST /api/discover/dismiss.`;
    const lines = documentedEndpoints([doc], routes);
    expect(lines).toContain("POST /api/users/:userId/follow  — registered in server/routes.ts");
    expect(lines).toContain("POST /api/connections/request  — registered in server/routes.ts");
    expect(lines).toContain("POST /api/messages/:userId  — registered in server/routes.ts");
    expect(lines).toContain("GET /api/discover/updates  — registered in server/explore-routes.ts");
    // The one that doesn't exist is the finding, and it's marked as such.
    expect(lines).toContain("POST /api/discover/dismiss  — NOT FOUND anywhere in the files read");
  });

  it("matches on the endpoint, not the name someone gave a parameter", () => {
    expect(documentedEndpoints(["POST /api/messages/:recipientId"], routes)[0]).toMatch(/registered in server\/routes\.ts/);
    expect(documentedEndpoints(["`/api/projects/:projectId/follow`"], routes)[0]).toMatch(/registered/);
  });

  it("treats a wildcard as the family it is, rather than a missing endpoint", () => {
    /*
     * The bug this pins: a read of the path loop reported that "/api/artifacts/*
     * is NOT REGISTERED in the repository" and told the builder to go and write
     * routes that were already mounted. `/api/artifacts/*` isn't an endpoint —
     * looking it up as one finds nothing, and the "not in the route list" line
     * landed directly above the line correctly reporting the real route as
     * registered. The model believed the wrong one.
     */
    const withFamily = [
      ...routes,
      { label: "POST /api/artifacts/:id/publish", file: "server/artifact-routes.ts" },
      { label: "POST /api/artifacts/:id/unpublish", file: "server/artifact-routes.ts" },
    ];
    const [family] = documentedEndpoints(["The client publishes via /api/artifacts/* and it works."], withFamily);
    expect(family).toContain("a family, not one endpoint: 2 registered");
    expect(family).toContain("POST /api/artifacts/:id/publish");
    expect(family).not.toContain("NOT");

    // A family with nothing under it is still a real finding, and says so plainly.
    const [empty] = documentedEndpoints(["We'll add /api/webhooks/* later."], withFamily);
    expect(empty).toContain("NOT ONE route is registered under it");
  });

  it("answers with the method that was asked about, when that route exists", () => {
    const both = [
      ...routes,
      { label: "DELETE /api/kanban/:taskId", file: "server/routes.ts" },
      { label: "PATCH /api/kanban/:taskId", file: "server/routes.ts" },
    ];
    // Reporting DELETE to someone who asked about PATCH reads as "that's not the one I meant".
    expect(documentedEndpoints(["mark it done with PATCH /api/kanban/:taskId"], both)[0])
      .toBe("PATCH /api/kanban/:taskId  — registered in server/routes.ts");
    expect(documentedEndpoints(["remove it with DELETE /api/kanban/:taskId"], both)[0])
      .toBe("DELETE /api/kanban/:taskId  — registered in server/routes.ts");
  });

  it("names each endpoint once, keeps to the cap, and ignores prose without paths", () => {
    const many = Array.from({ length: 30 }, (_, i) => `POST /api/thing-${i}`).join(" ");
    expect(documentedEndpoints([many], routes).length).toBe(20);
    expect(documentedEndpoints(["POST /api/messages/:userId and again POST /api/messages/:userId"], routes)).toHaveLength(1);
    expect(documentedEndpoints(["The user follows a builder and comes back."], routes)).toEqual([]);
    expect(documentedEndpoints([""], routes)).toEqual([]);
  });
});

  it("doesn't call a route missing when the code plainly has it", () => {
    /*
     * The route list is a list, not the repository: it can be clipped, and a
     * detector can miss a shape. Telling a builder to write a route that is
     * already there is worse than saying nothing, so a path found in the code
     * is reported as found, with where to look.
     */
    const files = [
      { path: "server/artifact-routes.ts", content: 'app.post("/api/artifacts/:id/publish", isAuthenticated, handler);', size: 1 },
      { path: "client/src/components/continue-path-card.tsx", content: 'apiRequest("POST", `/api/artifacts/${id}/publish`)', size: 1 },
    ] as any;
    const lines = documentedEndpoints(["publish with POST /api/artifacts/:id/publish"], [], files);
    expect(lines[0]).toBe("POST /api/artifacts/:id/publish  — not in the route list, but this path is written in server/artifact-routes.ts (check how it's mounted)");

    // Client code alone isn't evidence a server route exists: that's the call, not the handler.
    const clientOnly = documentedEndpoints(["POST /api/artifacts/:id/publish"], [], [files[1]] as any);
    expect(clientOnly[0]).toContain("NOT FOUND anywhere in the files read");
  });
});

describe("which files a loop's steps pull in", () => {
  it("matches a name's parts, not any substring that happens to be inside one", () => {
    /*
     * "land" matched landing.tsx, "share" matched shared.ts, "build" matched
     * document-builder.tsx. Each coincidence matched exactly one file, so the
     * rarity sort — which is meant to favour the specific — promoted all three
     * above the files that genuinely share a rarer noun.
     */
    const loop = {
      title: "Land and share",
      description: "land on home, share the build with a stored artifact",
    };
    const { paths } = pickLoopEvidence(loop, files);
    expect(paths).not.toContain("client/src/pages/landing.tsx");
    expect(paths.some((p) => /shared\.ts$/.test(p))).toBe(false);
    // And a real name still matches, plural or singular.
    const artifacts = pickLoopEvidence({ title: "Publish an artifact", description: "publish the artifact" }, files);
    expect(artifacts.paths.some((p) => /artifact/.test(p))).toBe(true);
  });

  it("doesn't spend a slot on the generic UI kit", () => {
    // "select" is a word in half the loops written and also a file in every shadcn project.
    const { paths } = pickLoopEvidence({ title: "Select a project", description: "select a project, see progress" }, files);
    expect(paths.filter((p) => /components\/ui\//.test(p))).toEqual([]);
  });
});
