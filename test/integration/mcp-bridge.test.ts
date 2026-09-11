/**
 * The editor bridge.
 *
 * Two things are worth testing here and they're both about where the line
 * sits. The first is the credential: a long-lived token that lives in a config
 * file on someone's laptop will leak eventually, so what matters is that a
 * database read gives an attacker nothing, that revoking is immediate, that a
 * pinned token can't wander into the rest of the account, and that a token
 * can't mint another one.
 *
 * The second is the division of labour. Nova owns verification; the editor-side
 * agent owns the editing. An agent reporting its own work must not be able to
 * close a milestone by saying it did the work — that's the failure the whole
 * design exists to prevent, and it's invisible by inspection.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { mcpTokens } from "@shared/schema";
import { saveWork } from "../../server/phase-trees";

afterAll(async () => { await closeTestApp(); });

const password = "Testpass123!";
const sha256 = (v: string) => crypto.createHash("sha256").update(v).digest("hex");

async function owner(app: any) {
  const agent = request.agent(app);
  const email = `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`;
  await agent.post("/api/auth/register").send({ email, password });
  return agent;
}

const project = (agent: any, title = "Bridge Test") =>
  agent.post("/api/projects").send({
    title, description: "A project used to exercise the editor bridge end to end.",
    category: "saas", goal: "ship_mvp", subcategory: "saas",
  });

async function tokenFor(agent: any, body: Record<string, unknown> = { label: "Test editor" }) {
  const res = await agent.post("/api/mcp-tokens").send(body);
  expect(res.status).toBe(201);
  return res.body;
}

// --- the credential --------------------------------------------------------

describe("tokens", () => {
  it("returns the token once and stores only a hash of it", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const minted = await tokenFor(agent);

    expect(minted.token).toMatch(/^nova_pat_/);
    expect(minted.notice).toMatch(/isn't shown again/);

    const [row] = await db.select().from(mcpTokens).where(eq(mcpTokens.id, minted.id));
    expect(row.tokenHash).toBe(sha256(minted.token));
    // The full token is nowhere in the row — not under another column, not in the prefix.
    expect(JSON.stringify(row)).not.toContain(minted.token);

    // And listing them never hands one back.
    const list = await agent.get("/api/mcp-tokens");
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain(minted.token);
    expect(list.body.tokens[0].prefix).toBe(minted.token.slice(0, minted.prefix.length));
  });

  it("refuses no token, a malformed one, and a revoked one", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const minted = await tokenFor(agent);

    expect((await request(app).get("/api/mcp/manifest")).status).toBe(401);
    expect((await request(app).get("/api/mcp/manifest").set("authorization", "Bearer not-a-nova-token")).status).toBe(401);

    const good = await request(app).get("/api/mcp/manifest").set("authorization", `Bearer ${minted.token}`);
    expect(good.status).toBe(200);
    expect(good.body.tools.map((t: any) => t.name)).toContain("nova_status");

    // Revocation takes effect on the next request, not on the next cache sweep.
    await agent.delete(`/api/mcp-tokens/${minted.id}`).expect(200);
    const after = await request(app).get("/api/mcp/manifest").set("authorization", `Bearer ${minted.token}`);
    expect(after.status).toBe(401);
    expect(after.body.code).toBe("token_invalid");
  });

  it("won't let a token mint another token", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const minted = await tokenFor(agent);

    // A leaked token has to be the end of the damage, not the start of a chain.
    const escalate = await request(app).post("/api/mcp-tokens")
      .set("authorization", `Bearer ${minted.token}`).send({ label: "Second" });
    expect(escalate.status).toBe(401);
    expect((await request(app).get("/api/mcp-tokens").set("authorization", `Bearer ${minted.token}`)).status).toBe(401);
  });

  it("keeps a pinned token inside its project", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const mine = (await project(agent, "Pinned")).body;
    const other = (await project(agent, "Not pinned")).body;
    const minted = await tokenFor(agent, { label: "Repo token", projectId: mine.id });

    const auth = (r: any) => r.set("authorization", `Bearer ${minted.token}`);

    const ok = await auth(request(app).get(`/api/mcp/projects/${mine.id}/status`));
    expect(ok.status).toBe(200);

    const blocked = await auth(request(app).get(`/api/mcp/projects/${other.id}/status`));
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("token_scope");

    // It doesn't even see the rest of the account.
    const list = await auth(request(app).get("/api/mcp/projects"));
    expect(list.body.projects.map((p: any) => p.id)).toEqual([mine.id]);
  });

  it("answers the same way for a project that isn't yours and one that doesn't exist", async () => {
    const app = await getTestApp();
    const mine = await owner(app);
    const theirs = await owner(app);
    const hidden = (await project(theirs, "Someone else's")).body;
    const minted = await tokenFor(mine);

    const stranger = await request(app).get(`/api/mcp/projects/${hidden.id}/status`).set("authorization", `Bearer ${minted.token}`);
    const missing = await request(app).get(`/api/mcp/projects/${crypto.randomUUID()}/status`).set("authorization", `Bearer ${minted.token}`);
    expect(stranger.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(stranger.body.message).toBe(missing.body.message);
  });

  it("doesn't accept a browser session in place of a token", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    // The bridge is token-only, which is what makes it CSRF-proof by
    // construction: a browser never sends a token it wasn't given.
    const withSession = await agent.get("/api/mcp/manifest");
    expect(withSession.status).toBe(401);
    expect(withSession.body.code).toBe("token_required");
  });
});

// --- the division of labour ------------------------------------------------

describe("what the bridge will and won't do", () => {
  it("gives an agent the next step, its actor, and the task to work on", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const p = (await project(agent)).body;
    const minted = await tokenFor(agent);

    const status = await request(app).get(`/api/mcp/projects/${p.id}/status`).set("authorization", `Bearer ${minted.token}`);
    expect(status.status).toBe(200);
    expect(status.body.adopted).toBe(true);
    expect(status.body.next.backboneId).toBe("SHIP.M1.1");
    expect(status.body.next.actor).toBe("nova-drafts");
    expect(status.body.next.workTaskId).toBeTruthy();
    // Trimmed for an agent: the phase summaries, not every milestone of every phase.
    expect(status.body.phases[0]).not.toHaveProperty("milestones");
  });

  it("records what the agent built without marking it done", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const p = (await project(agent)).body;
    const minted = await tokenFor(agent);
    const auth = (r: any) => r.set("authorization", `Bearer ${minted.token}`);

    const before = await auth(request(app).get(`/api/mcp/projects/${p.id}/status`));
    const taskId = before.body.next.workTaskId;

    const submitted = await auth(request(app).post(`/api/mcp/projects/${p.id}/submit`))
      .send({ taskId, summary: "Wrote the product statement into the README.", files: [{ path: "README.md" }], commit: "abc1234" });
    expect(submitted.status).toBe(200);
    expect(submitted.body.recorded).toBe(true);

    // The record landed on the task…
    const tasks = await agent.get(`/api/projects/${p.id}/kanban`);
    const task = tasks.body.find((t: any) => t.id === taskId);
    expect(task.description).toContain("Wrote the product statement");
    expect(task.description).toContain("Not verified");
    // …and changed nothing about whether the milestone is done. An agent
    // saying it did the work is not evidence that the work is done.
    expect(task.status).not.toBe("done");
    const after = await auth(request(app).get(`/api/mcp/projects/${p.id}/status`));
    expect(after.body.next.backboneId).toBe("SHIP.M1.1");
    expect(after.body.progress.done).toBe(0);
  });

  it("refuses a submission against a task that isn't on the path", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const p = (await project(agent)).body;
    const minted = await tokenFor(agent);

    const res = await request(app).post(`/api/mcp/projects/${p.id}/submit`)
      .set("authorization", `Bearer ${minted.token}`)
      .send({ taskId: crypto.randomUUID(), summary: "Something somewhere." });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("not_on_path");
  });

  it("verifies from the tree, and says what it couldn't prove", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const p = (await project(agent)).body;
    const minted = await tokenFor(agent);

    const res = await request(app).post(`/api/mcp/projects/${p.id}/verify`)
      .set("authorization", `Bearer ${minted.token}`)
      .send({
        files: [
          { path: "package.json", content: JSON.stringify({ name: "app", dependencies: { express: "^4.19.0" }, scripts: { dev: "node server/index.js" } }) },
          { path: "server/index.js", content: "const express = require('express');\nconst app = express();\napp.listen(3000);\n" },
          // Dropped by the ingest rules rather than trusted because it was sent.
          { path: "node_modules/left-pad/index.js", content: "module.exports = 1;" },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.scanned.files).toBe(2);
    // The scaffold is something the code proves; a live URL and the capability
    // inventory are not, and come back unproven with the reason rather than
    // silently absent.
    const scaffold = res.body.checks.find((c: any) => c.backboneId === "SHIP.M1.5");
    expect(scaffold.proven).toBe(true);
    expect(scaffold.evidence).toMatch(/scaffold present/);
    expect(res.body.checks.find((c: any) => c.backboneId === "SHIP.M1.8").proven).toBe(false);
    expect(res.body.capabilitiesFrom).toBeNull();
    expect(res.body.note).toMatch(/No full audit/);

    // And having proven it, it marked it — with the evidence as the reason.
    expect(res.body.marked).toContain("SHIP.M1.5");
    const tasks = await agent.get(`/api/projects/${p.id}/kanban`);
    const task = tasks.body.find((t: any) => t.tags?.includes("backbone:SHIP.M1.5"));
    expect(task.status).toBe("done");
    expect(task.description).toMatch(/Verified by the codebase audit/);
  });

  it("never un-marks what a later, thinner tree can't see", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const p = (await project(agent)).body;
    const minted = await tokenFor(agent);
    const auth = (r: any) => r.set("authorization", `Bearer ${minted.token}`);
    const files = [
      { path: "package.json", content: JSON.stringify({ name: "app", dependencies: { express: "^4.19.0" } }) },
      { path: "server/index.js", content: "require('express')();\n" },
    ];

    await auth(request(app).post(`/api/mcp/projects/${p.id}/verify`)).send({ files });
    // A snapshot that shows less is not evidence that something was removed.
    const second = await auth(request(app).post(`/api/mcp/projects/${p.id}/verify`)).send({ files: [{ path: "README.md", content: "# app" }] });
    expect(second.status).toBe(200);

    const tasks = await agent.get(`/api/projects/${p.id}/kanban`);
    expect(tasks.body.find((t: any) => t.tags?.includes("backbone:SHIP.M1.5")).status).toBe("done");
  });

  it("refuses a tree that's too big to be one", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const p = (await project(agent)).body;
    const minted = await tokenFor(agent);

    const res = await request(app).post(`/api/mcp/projects/${p.id}/verify`)
      .set("authorization", `Bearer ${minted.token}`)
      .send({ files: Array.from({ length: 4001 }, (_, i) => ({ path: `src/f${i}.ts` })) });
    expect(res.status).toBe(413);
    expect(res.body.code).toBe("too_many_files");
  });

  it("records a hand-marked milestone as the builder's word, not as verified", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const p = (await project(agent)).body;
    const minted = await tokenFor(agent);

    const res = await request(app).post(`/api/mcp/projects/${p.id}/mark`)
      .set("authorization", `Bearer ${minted.token}`)
      .send({ ids: ["SHIP.M1.1"], evidence: "wrote this months ago" });
    expect(res.status).toBe(200);
    expect(res.body.marked).toContain("SHIP.M1.1");

    const tasks = await agent.get(`/api/projects/${p.id}/kanban`);
    const task = tasks.body.find((t: any) => t.tags?.includes("backbone:SHIP.M1.1"));
    expect(task.status).toBe("done");
    // The map keeps the difference between what Nova proved and what it was told.
    expect(task.description).toMatch(/Marked done by you/);
    expect(task.tags.some((t: string) => t.startsWith("verified:"))).toBe(false);
  });
});

// --- what a UI needs on top of what an agent needs -------------------------

describe("the read side a sidebar draws from", () => {
  it("returns every phase and milestone in one call", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const p = (await project(agent)).body;
    const minted = await tokenFor(agent);

    const res = await request(app).get(`/api/mcp/projects/${p.id}/phases`).set("authorization", `Bearer ${minted.token}`);
    expect(res.status).toBe(200);
    expect(res.body.phases.map((x: any) => x.id)).toEqual(["week-1", "week-2", "branch-build", "week-3", "week-4"]);
    expect(res.body.nextBackboneId).toBe("SHIP.M1.1");
    expect(res.body.currentPhaseId).toBe("week-1");

    // The whole map, unlike the status reply, which is trimmed for an agent.
    const first = res.body.phases[0].milestones[0];
    expect(first).toMatchObject({ id: "SHIP.M1.1", actor: "nova-drafts", done: false });
    expect(first.description).toBeTruthy();
  });

  it("hands back an existing packet without producing another", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const p = (await project(agent)).body;
    const minted = await tokenFor(agent);
    const auth = (r: any) => r.set("authorization", `Bearer ${minted.token}`);

    const status = await auth(request(app).get(`/api/mcp/projects/${p.id}/status`));
    const taskId = status.body.next.workTaskId;

    // Nothing worked yet: null, not an error, and not a charge.
    const empty = await auth(request(app).get(`/api/mcp/projects/${p.id}/work/${taskId}`));
    expect(empty.status).toBe(200);
    expect(empty.body.work).toBeNull();
    expect(empty.body.actor).toBe("nova-drafts");

    await saveWork(p.id, taskId, {
      kind: "options", intro: "Two ways to say it.",
      options: [{ title: "Plain", body: "A tool for solo builders." }, { title: "Sharp", body: "The path from idea to shipped." }],
    } as any);

    const read = await auth(request(app).get(`/api/mcp/projects/${p.id}/work/${taskId}`));
    expect(read.body.work.payload.options).toHaveLength(2);
    expect(read.body.task.status).not.toBe("done");
  });

  it("saves the option the builder picked as the task's answer", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const p = (await project(agent)).body;
    const minted = await tokenFor(agent);
    const auth = (r: any) => r.set("authorization", `Bearer ${minted.token}`);

    const status = await auth(request(app).get(`/api/mcp/projects/${p.id}/status`));
    const taskId = status.body.next.workTaskId;
    const work = await saveWork(p.id, taskId, {
      kind: "options", intro: "Two ways to say it.",
      options: [{ title: "Plain", body: "A tool for solo builders." }, { title: "Sharp", body: "The path from idea to shipped." }],
    } as any);

    const chosen = await auth(request(app).post(`/api/mcp/projects/${p.id}/work/${work.id}/choose`)).send({ index: 1 });
    expect(chosen.status).toBe(200);
    expect(chosen.body.answer).toBe("The path from idea to shipped.");
    expect(chosen.body.status).toBe("done");

    // The answer is on the task, which is what the rest of the path reads.
    const tasks = await agent.get(`/api/projects/${p.id}/kanban`);
    const task = tasks.body.find((t: any) => t.id === taskId);
    expect(task.description).toBe("The path from idea to shipped.");

    // And the path moved on.
    const after = await auth(request(app).get(`/api/mcp/projects/${p.id}/status`));
    expect(after.body.next.backboneId).not.toBe("SHIP.M1.1");
  });

  it("takes the builder's own words over the option", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const p = (await project(agent)).body;
    const minted = await tokenFor(agent);
    const auth = (r: any) => r.set("authorization", `Bearer ${minted.token}`);

    const status = await auth(request(app).get(`/api/mcp/projects/${p.id}/status`));
    const work = await saveWork(p.id, status.body.next.workTaskId, {
      kind: "options", intro: "One way.", options: [{ title: "Plain", body: "Nova's wording." }],
    } as any);

    const chosen = await auth(request(app).post(`/api/mcp/projects/${p.id}/work/${work.id}/choose`))
      .send({ index: 0, text: "What I actually think it is." });
    expect(chosen.body.answer).toBe("What I actually think it is.");
  });

  it("won't let one project's token touch another project's packet", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const mine = (await project(agent, "Mine")).body;
    const other = (await project(agent, "Other")).body;
    const minted = await tokenFor(agent);
    const auth = (r: any) => r.set("authorization", `Bearer ${minted.token}`);

    const status = await auth(request(app).get(`/api/mcp/projects/${other.id}/status`));
    const work = await saveWork(other.id, status.body.next.workTaskId, {
      kind: "options", intro: "x", options: [{ title: "a", body: "b" }],
    } as any);

    // Same account, both projects readable — but a packet belongs to the
    // project it was made for, and the id is scoped, not global.
    const crossed = await auth(request(app).post(`/api/mcp/projects/${mine.id}/work/${work.id}/choose`)).send({ index: 0 });
    expect(crossed.status).toBe(404);
  });
});

// --- loops -----------------------------------------------------------------

describe("the loops a product runs on", () => {
  /** The path's own loop tree, once the project is on it. */
  const loops = (app: any, token: string, projectId: string) =>
    request(app).get(`/api/mcp/projects/${projectId}/loops`).set("authorization", `Bearer ${token}`);

  it("starts empty, with room and the milestone the loops hang off", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const p = (await project(agent)).body;
    const minted = await tokenFor(agent);

    const res = await loops(app, minted.token, p.id);
    expect(res.status).toBe(200);
    expect(res.body.supported).toBe(true);
    expect(res.body.sourceId).toBe("SHIP.M1.2");
    expect(res.body.loops).toEqual([]);
    expect(res.body.remaining).toBe(6);
  });

  it("records a loop and reports it as written but not yet planned", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const p = (await project(agent)).body;
    const minted = await tokenFor(agent);
    const auth = (r: any) => r.set("authorization", `Bearer ${minted.token}`);

    const created = await auth(request(app).post(`/api/mcp/projects/${p.id}/loops`)).send({
      title: "Explore",
      description: "Open Discover → view matched builders → follow or message → return for new matches.",
    });
    expect(created.status).toBe(200);
    expect(created.body.taskId).toBeTruthy();

    const after = await loops(app, minted.token, p.id);
    expect(after.body.loops).toHaveLength(1);
    expect(after.body.loops[0]).toMatchObject({ title: "Explore", state: "written", written: true, total: 0 });
    expect(after.body.remaining).toBe(5);
  });

  it("refuses a seventh loop rather than letting a month's plan sprawl", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const p = (await project(agent)).body;
    const minted = await tokenFor(agent);
    const auth = (r: any) => r.set("authorization", `Bearer ${minted.token}`);

    for (let i = 0; i < 6; i++) {
      const res = await auth(request(app).post(`/api/mcp/projects/${p.id}/loops`)).send({ title: `Loop ${i}` });
      expect(res.status).toBe(200);
    }
    const seventh = await auth(request(app).post(`/api/mcp/projects/${p.id}/loops`)).send({ title: "One more" });
    expect(seventh.status).toBe(409);
    expect(seventh.body.code).toBe("loop_cap");
  });

  it("needs a name", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const p = (await project(agent)).body;
    const minted = await tokenFor(agent);

    const res = await request(app).post(`/api/mcp/projects/${p.id}/loops`)
      .set("authorization", `Bearer ${minted.token}`).send({ description: "steps but no name" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_input");
  });

  it("remembers 'not a loop', so nothing proposes it again", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const p = (await project(agent)).body;
    const minted = await tokenFor(agent);
    const auth = (r: any) => r.set("authorization", `Bearer ${minted.token}`);

    const created = await auth(request(app).post(`/api/mcp/projects/${p.id}/loops`))
      .send({ title: "Browse the leaderboard", description: "Open it, look, leave." });

    const dropped = await auth(request(app).delete(`/api/mcp/projects/${p.id}/loops/${created.body.taskId}`));
    expect(dropped.status).toBe(200);

    const after = await loops(app, minted.token, p.id);
    expect(after.body.loops).toEqual([]);
    // The judgement is kept, not just the deletion: this is what stops the
    // next read re-proposing it under slightly different words.
    expect(after.body.rejected).toContain("Browse the leaderboard");
  });

  it("won't break a loop into steps with nothing written under it, and says what would fix that", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const p = (await project(agent)).body;
    const minted = await tokenFor(agent);
    const auth = (r: any) => r.set("authorization", `Bearer ${minted.token}`);

    const created = await auth(request(app).post(`/api/mcp/projects/${p.id}/loops`)).send({ title: "Explore" });
    const res = await auth(request(app).post(`/api/mcp/projects/${p.id}/loops/${created.body.taskId}/steps`)).send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("artifact_missing");
    expect(res.body.message).toMatch(/draft/);
    expect(res.body.sourceTitle).toBe("Explore");
  });

  it("refuses a loop that isn't on this project", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const p = (await project(agent)).body;
    const minted = await tokenFor(agent);
    const auth = (r: any) => r.set("authorization", `Bearer ${minted.token}`);

    const res = await auth(request(app).delete(`/api/mcp/projects/${p.id}/loops/${crypto.randomUUID()}`));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("not_on_path");
  });

  it("carries the loops on the next step, where the core-loop milestone is", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const p = (await project(agent)).body;
    const minted = await tokenFor(agent);
    const auth = (r: any) => r.set("authorization", `Bearer ${minted.token}`);

    await auth(request(app).post(`/api/mcp/projects/${p.id}/loops`))
      .send({ title: "Explore", description: "Open Discover → view matches → follow → return." });

    // Close the first milestone so the core loop is next.
    await auth(request(app).post(`/api/mcp/projects/${p.id}/mark`)).send({ ids: ["SHIP.M1.1"], evidence: "written" });

    const status = await auth(request(app).get(`/api/mcp/projects/${p.id}/status`));
    expect(status.body.next.backboneId).toBe("SHIP.M1.2");
    // Reading "define your core loop" without being handed the loops is
    // reading half the task.
    expect(status.body.next.loops).toHaveLength(1);
    expect(status.body.next.loops[0]).toMatchObject({ title: "Explore", expanded: false });
  });

  it("says plainly when a path doesn't work in loops", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const funding = (await agent.post("/api/projects").send({
      title: "Raise", description: "Getting the story and the numbers into a shape that gets backed.",
      category: "saas", goal: "raise_funding", subcategory: "startup_equity",
    })).body;
    const minted = await tokenFor(agent);

    const res = await loops(app, minted.token, funding.id);
    expect(res.status).toBe(200);
    expect(res.body.supported).toBe(false);
    expect(res.body.message).toMatch(/doesn't work in loops/);
  });
});
