/**
 * Nova building the whole business, for $30.
 *
 * The promise is that every step of the path is laid out. The thing that makes
 * it worth $30 rather than insulting is *which* steps Nova closes: its own,
 * and only its own. A build that answered the builder's decisions for them
 * would hand back a plan they never made a choice in and cannot defend to an
 * investor, a landlord or a co-founder — so the tests here are mostly about
 * what the build refuses to do.
 *
 * Also under test: the run is watchable while it happens, because it outlives
 * the request that paid for it; and a build that stops does not cost a second
 * $30 to finish.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";

/*
 * A model that answers every work packet in the shape produceWork asks for.
 * The shapes differ by kind, and the kind is decided by the step's actor, so
 * one reply that carries all of them lets a single mock serve every step.
 */
vi.mock("openai", () => {
  const answer = JSON.stringify({
    kind: "options",
    intro: "Three ways to go at this.",
    options: [
      { title: "The direct one", body: "Do the obvious version first and see who bites.", why: "Cheapest to find out." },
      { title: "The narrow one", body: "Pick one kind of customer and serve them completely.", why: "Easier to be the best at." },
      { title: "The slow one", body: "Build the thing properly before showing anyone.", why: "Fewer people see a bad first version." },
    ],
    summary: "Wires the thing up in the place it belongs.",
    files: [{ path: "src/thing.ts", language: "ts", content: "export const thing = () => true;", purpose: "The thing." }],
    runGroups: [{ where: "terminal", label: "Run it", commands: ["npm test"] }],
    verify: "The test passes.",
    assumptions: [],
    template: "Hello — we're opening on the first. Here's what to expect.",
    whatNovaDid: "Wrote the note.",
    whatIsLeft: "Send it to your list.",
  });
  class OpenAI {
    chat = { completions: { create: async () => ({ choices: [{ message: { content: answer } }] }) } };
    responses = { create: async () => ({ output_text: answer, output: [] }) };
    images = { generate: async () => { throw new Error("no images in tests"); } };
    static default = OpenAI;
  }
  return { default: OpenAI, OpenAI };
});

const { getTestApp, closeTestApp } = await import("../helpers/app");
const { verifyEmail } = await import("../helpers/verify-email");
const { db } = await import("../../server/db");
const { users, projectKanbanTasks, novaBuildRuns } = await import("@shared/schema");
const { eq, and } = await import("drizzle-orm");
const { OUTCOME_PRICE_CENTS } = await import("@shared/plans");

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function builder(app: any, opts: { balanceCents?: number } = {}) {
  n += 1;
  const email = `build-${Date.now()}-${n}@example.test`;
  const ip = `203.0.115.${(n % 200) + 20}`;
  const agent = request.agent(app);
  const reg = await agent.post("/api/auth/register").set("x-forwarded-for", ip).send({ email, password: "a-good-passphrase-here", firstName: "Bo" });
  expect(reg.status, JSON.stringify(reg.body)).toBe(201);
  await verifyEmail(app, email, ip);
  process.env.RATE_LIMIT_EXEMPT_EMAILS = [process.env.RATE_LIMIT_EXEMPT_EMAILS, email].filter(Boolean).join(",");
  if (opts.balanceCents) await db.update(users).set({ balanceCents: opts.balanceCents }).where(eq(users.id, reg.body.id));
  const project = await agent.post("/api/projects").send({
    title: "The Whole Thing", description: "A project Nova is asked to build out from end to end.",
    category: "saas", goal: "ship_mvp", subcategory: "saas",
  });
  expect(project.status).toBe(200);
  return { agent, userId: reg.body.id as string, projectId: project.body.id as string };
}

/** Wait for the background build to stop, the way the page does. */
async function settled(b: { agent: any; projectId: string }) {
  for (let i = 0; i < 300; i++) {
    const res = await b.agent.get(`/api/projects/${b.projectId}/nova-build`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    if (!res.body.running) return res.body;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("the build never finished");
}

const tasksOf = (projectId: string) =>
  db.select().from(projectKanbanTasks).where(eq(projectKanbanTasks.projectId, projectId));

const tagged = (task: { tags: string[] | null }, prefix: string) =>
  (task.tags ?? []).find((t) => t.startsWith(prefix))?.slice(prefix.length) ?? null;

describe("Nova builds the whole business", () => {
  it("writes its own steps and leaves the builder's decisions open, with the options already on them", async () => {
    const app = await getTestApp();
    const b = await builder(app, { balanceCents: OUTCOME_PRICE_CENTS.business });

    const bought = await b.agent.post("/api/nova/build-my-business").send({ projectId: b.projectId });
    expect(bought.status, JSON.stringify(bought.body)).toBe(201);

    const status = await settled(b);
    expect(status.last.error, "the build ran to the end").toBeNull();
    expect(status.paid).toBe(true);
    expect(status.last.stepsDone + status.last.stepsForYou, "it worked through steps").toBeGreaterThan(0);

    const tasks = await tasksOf(b.projectId);
    const path = tasks.filter((t) => (t.tags ?? []).some((x) => x.startsWith("backbone:")));
    expect(path.length, "the project is on a path").toBeGreaterThan(0);

    /*
     * The line this whole feature is drawn on. Nova's own steps are finished;
     * anything the builder decides or does is still open and waiting for them.
     */
    const novaSteps = path.filter((t) => ["nova-builds", "nova-drafts"].includes(tagged(t, "actor:") ?? ""));
    const theirSteps = path.filter((t) => ["user-decides", "user-does"].includes(tagged(t, "actor:") ?? ""));

    expect(novaSteps.length, "the path has work of Nova's on it").toBeGreaterThan(0);
    for (const step of novaSteps.slice(0, 10)) {
      expect(step.status, `Nova's own step left unfinished: ${step.title}`).toBe("done");
    }
    for (const step of theirSteps.slice(0, 10)) {
      expect(step.status, `a decision answered on the builder's behalf: ${step.title}`).not.toBe("done");
    }

    /*
     * …and an open step is not an empty one: the research is sitting on it,
     * which is the difference between "Nova left this for you" and "Nova
     * didn't get to this". Checked across the steps rather than on the first,
     * because one purchase covers BUILD_STEP_CAP steps and a long path has
     * more than that — a step past the cap is legitimately untouched.
     */
    expect(theirSteps.length, "the path has decisions of the builder's on it").toBeGreaterThan(0);
    let withOptions = 0;
    for (const step of theirSteps) {
      const work = await b.agent.get(`/api/projects/${b.projectId}/path/work/${step.id}`);
      if (work.status === 200 && work.body?.work?.payload) withOptions += 1;
    }
    expect(withOptions, "no open step had Nova's options waiting on it").toBeGreaterThan(0);

    // And what is waiting is the right kind for who has to act: three options
    // to choose between, or the template for something only they can do.
    for (const step of theirSteps) {
      const work = await b.agent.get(`/api/projects/${b.projectId}/path/work/${step.id}`);
      const kind = work.body?.work?.kind;
      if (!kind) continue;
      expect(["options", "template"], `${step.title} got a ${kind} packet`).toContain(kind);
    }
  }, 300_000);

  it("leaves a step alone when its work happens on a surface of its own", async () => {
    /*
     * The build writes Nova's own steps and closes them. Three Run milestones
     * are finished by a screen of their own instead — the roadmap, the jobs
     * list, the quarter's goals — and writing a paragraph onto those would
     * tick them while leaving the board empty. A ticked step with nothing
     * behind it is worse than an untouched one, because the tick is what tells
     * the buyer it was handled.
     */
    const app = await getTestApp();
    const b = await builder(app, { balanceCents: OUTCOME_PRICE_CENTS.business });

    // A Run project, which is where these milestones live.
    const run = await b.agent.post("/api/projects").send({
      title: "The Firm", description: "A company already trading, bought the whole build.",
      category: "saas", goal: "run_company", subcategory: "software",
    });
    expect(run.status).toBe(200);
    const runId = run.body.id as string;

    expect((await b.agent.post("/api/nova/build-my-business").send({ projectId: runId })).status).toBe(201);
    await settled({ agent: b.agent, projectId: runId });

    const path = await b.agent.get(`/api/projects/${runId}/path`);
    const all = (path.body.phases as any[]).flatMap((p) => p.milestones);
    const surfaced = all.filter((m) => m.doneOn);
    expect(surfaced.length, "the Run path has steps with their own surfaces").toBeGreaterThan(0);

    for (const step of surfaced) {
      expect(step.done, `${step.id} was ticked without its surface being used`).toBe(false);
      // …and nothing was written onto it either.
      const work = await b.agent.get(`/api/projects/${runId}/path/work/${step.taskId}`);
      expect(work.body?.work, `${step.id} got a generic answer`).toBeFalsy();
    }
  }, 300_000);

  it("rings the bell when it's done, because the build outlives the page", async () => {
    const app = await getTestApp();
    const b = await builder(app, { balanceCents: OUTCOME_PRICE_CENTS.business });

    expect((await b.agent.post("/api/nova/build-my-business").send({ projectId: b.projectId })).status).toBe(201);
    const status = await settled(b);
    expect(status.last.error).toBeNull();

    /*
     * The whole point of the notification: it takes minutes, so the person who
     * paid has very likely gone to do something else, and the bell is the only
     * thing that will find them.
     */
    const bell = await b.agent.get("/api/notifications");
    expect(bell.status).toBe(200);
    const built = (bell.body.items as any[]).find((x) => x.kind === "nova_build_done");
    expect(built, JSON.stringify(bell.body.items).slice(0, 300)).toBeTruthy();
    expect(built.project.id).toBe(b.projectId);

    // It says what it did, not just that something happened.
    expect(built.text).toContain("Nova finished building");
    expect(built.excerpt).toMatch(/Nova wrote|nothing left to build/i);
    // And it lands back on the path it just built, where the open steps are.
    expect(built.href).toContain(`/projects/${b.projectId}/manage`);

    // It is about their own work, so they are told even though they started it.
    const unread = await b.agent.get("/api/notifications/unread-count");
    expect(unread.body.count ?? unread.body.unread ?? 0).toBeGreaterThan(0);
  }, 300_000);

  it("is watchable while it happens, because it outlives the request that paid for it", async () => {
    const app = await getTestApp();
    const b = await builder(app, { balanceCents: OUTCOME_PRICE_CENTS.business });

    // Before: nothing to see, and not paid for.
    const before = await b.agent.get(`/api/projects/${b.projectId}/nova-build`);
    expect(before.body).toMatchObject({ running: null, last: null, paid: false });

    await b.agent.post("/api/nova/build-my-business").send({ projectId: b.projectId });

    /*
     * The purchase answers immediately and the work carries on behind it, so
     * the run has to be readable from a request that knows nothing about the
     * one that started it.
     */
    let sawItRunning = false;
    for (let i = 0; i < 100; i++) {
      const res = await b.agent.get(`/api/projects/${b.projectId}/nova-build`);
      if (res.body.running) {
        sawItRunning = true;
        expect(res.body.running.stageLabel, "a stage a person can read").toBeTruthy();
        break;
      }
      if (res.body.last) break;  // It finished before we looked; the assertions below still hold.
      await new Promise((r) => setTimeout(r, 50));
    }

    const after = await settled(b);
    expect(sawItRunning || !!after.last, "the run was visible at some point").toBe(true);
    expect(after.last.finishedAt).toBeTruthy();

    // Only the team can watch it.
    const stranger = await builder(app);
    expect((await stranger.agent.get(`/api/projects/${b.projectId}/nova-build`)).status).toBe(403);
  }, 300_000);

  it("finishes a stopped build for nothing, because the $30 was for the outcome", async () => {
    const app = await getTestApp();
    const b = await builder(app, { balanceCents: OUTCOME_PRICE_CENTS.business });

    expect((await b.agent.post("/api/nova/build-my-business").send({ projectId: b.projectId })).status).toBe(201);
    await settled(b);
    const [paid] = await db.select({ balanceCents: users.balanceCents }).from(users).where(eq(users.id, b.userId));
    expect(paid.balanceCents).toBe(0);

    // Run it again: free, and refused only while one is actually in flight.
    const again = await b.agent.post("/api/nova/build-my-business").send({ projectId: b.projectId });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body).toMatchObject({ alreadyPaid: true, paidCents: 0 });

    const racing = await b.agent.post("/api/nova/build-my-business").send({ projectId: b.projectId });
    expect([200, 409], JSON.stringify(racing.body)).toContain(racing.status);
    if (racing.status === 409) expect(racing.body.code).toBe("build_running");

    await settled(b);
    const [after] = await db.select({ balanceCents: users.balanceCents }).from(users).where(eq(users.id, b.userId));
    expect(after.balanceCents, "never charged twice").toBe(0);
  }, 300_000);

  it("calls a run the server died in over, rather than leaving a bar turning forever", async () => {
    const app = await getTestApp();
    const b = await builder(app);

    // A run nothing will ever finish, old enough to be past doubt.
    await db.insert(novaBuildRuns).values({
      projectId: b.projectId, startedById: b.userId, stage: "building",
      startedAt: new Date(Date.now() - 60 * 60_000),
    } as any);

    const status = await b.agent.get(`/api/projects/${b.projectId}/nova-build`);
    expect(status.body.running, "an hour-old unfinished run is not running").toBeNull();
    expect(status.body.last.error).toMatch(/stopped before it finished/);

    // And it was stamped, not just hidden — the next read agrees without redoing the work.
    const [row] = await db.select().from(novaBuildRuns)
      .where(and(eq(novaBuildRuns.projectId, b.projectId), eq(novaBuildRuns.startedById, b.userId)));
    expect(row.finishedAt).toBeTruthy();
  }, 120_000);
});
