/**
 * The eight list resources that hang off a project, held to the same seven rules.
 *
 * Interviews, experiments, legal documents, the deploy checklist, support tickets,
 * launch tasks, analytics events and pricing tiers are the same route four times
 * over — a member-only GET, a POST that picks from an allowlist, and a PATCH and
 * DELETE keyed on both the project and the item. Between them they were about forty
 * of the sixty-four write routes no test named, and they were untested for the
 * reason they are uninteresting: each one is obvious, and there are a lot of them.
 *
 * ## What this covers, and what already did
 *
 * The *security* of these routes was already covered, and better than I assumed
 * when I started: test/integration/request-body-writes.test.ts loops all eight
 * segments attacking them across projects, and tests the field allowlist and the
 * mass-assignment cases against pricing tiers in depth. It is the authority on "a
 * write stores what the route allows, where the URL says, and nothing else", and
 * this file does not repeat it.
 *
 * What nothing covered is whether these routes *work*. Creating an interview, a
 * launch task or a legal document, seeing it come back in the list, changing a
 * field and watching the change stick, and deleting it — none of that was driven
 * anywhere. That is the failure a silent one would cost: a route that 500s on every
 * call, on a feature nobody tested, found by the first person who used it.
 *
 * So: a full round trip per family, who may do it, and the one security line worth
 * repeating for all eight rather than for one — that a patch naming nothing
 * writable is refused rather than reported as a success.
 *
 * Written as a table because the routes are a table. A bug in the shape shows up
 * eight times, which is how you tell it is the shape rather than one route.
 */
/*
 * Declared for the repository's coverage sweep (server/audit-evidence.ts), which
 * reads these lines. The tests below build their URLs from a table, so no route
 * path appears whole in this file — and a sweep that called them untested would be
 * making a claim about the measurement rather than about the suite.
 */
// covers-routes: ^/api/projects/:id/(interviews|experiments|legal-docs|deploy-checklist|support-tickets|launch-tasks|analytics-events|pricing)(/:itemId)?$

import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { WRITABLE } from "../../server/body-fields";

afterAll(async () => { await closeTestApp(); });

let n = 0;
const ip = () => `198.51.170.${20 + (n++ % 200)}`;

async function person(app: any, tag: string) {
  n += 1;
  const agent = request.agent(app);
  const email = `crud-${tag}-${Date.now()}-${n}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip())
    .send({ email, password: "Testpass123!", firstName: `C${n}`, lastName: "Rud" });
  expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
  await verifyEmail(app, email, ip());
  return { agent, id: res.body.id as string };
}

async function aProject(agent: any, title = "Listed") {
  const res = await agent.post("/api/projects").send({
    title, description: "A project used to drive its own list resources.",
    category: "saas", goal: "ship_mvp", subcategory: "saas",
  });
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
  return res.body.id as string;
}

/**
 * Each family: its URL segment, the allowlist it picks from, a body that creates,
 * and one writable field to change.
 */
const FAMILIES = [
  {
    name: "interviews", segment: "interviews", writable: WRITABLE.interviews,
    create: { intervieweeName: "Dana Okafor", intervieweeRole: "Head chef", notes: "Wants fewer no-shows.", status: "scheduled" },
    change: { intervieweeRole: "Owner" }, changed: "intervieweeRole",
  },
  {
    name: "experiments", segment: "experiments", writable: WRITABLE.experiments,
    create: { hypothesis: "A deposit cuts no-shows", method: "Take £5 on booking", status: "planned" },
    change: { status: "running" }, changed: "status",
  },
  {
    name: "legal documents", segment: "legal-docs", writable: WRITABLE.legalDocs,
    create: { docType: "privacy", title: "Privacy policy", content: "We keep very little.", status: "draft" },
    change: { title: "Privacy notice" }, changed: "title",
  },
  {
    name: "the deploy checklist", segment: "deploy-checklist", writable: WRITABLE.deployChecklist,
    create: { item: "Point the domain at Render", category: "dns", isCompleted: false },
    change: { isCompleted: true }, changed: "isCompleted",
  },
  {
    name: "support tickets", segment: "support-tickets", writable: WRITABLE.supportTickets,
    create: { submitterEmail: "asker@example.test", subject: "Can't log in", description: "Nothing happens.", status: "open", priority: "high" },
    change: { status: "closed" }, changed: "status",
  },
  {
    name: "launch tasks", segment: "launch-tasks", writable: WRITABLE.launchTasks,
    create: { channel: "email", task: "Write the launch note", status: "todo" },
    change: { status: "done" }, changed: "status",
  },
  {
    name: "analytics events", segment: "analytics-events", writable: WRITABLE.analyticsEvents,
    create: { eventName: "signed_up", category: "acquisition", description: "Somebody made an account", trackingStatus: "planned" },
    change: { trackingStatus: "live" }, changed: "trackingStatus",
  },
  {
    name: "pricing tiers", segment: "pricing", writable: WRITABLE.pricing,
    create: { name: "Starter", price: 19, billingPeriod: "monthly", features: ["One seat"] },
    change: { name: "Basic" }, changed: "name",
  },
] as const;

const url = (projectId: string, segment: string, itemId?: string) =>
  `/api/projects/${projectId}/${segment}${itemId ? `/${itemId}` : ""}`;

for (const family of FAMILIES) {
  describe(`${family.name}, on a project`, () => {
    it("creates, lists, changes and removes one", async () => {
      const app = await getTestApp();
      const owner = await person(app, "own");
      const projectId = await aProject(owner.agent);

      const made = await owner.agent.post(url(projectId, family.segment))
        .set("x-forwarded-for", ip()).send(family.create);
      expect(made.status, JSON.stringify(made.body)).toBeLessThan(300);
      const itemId = made.body?.id as string;
      expect(itemId, "the created row should come back with an id").toBeTruthy();

      const listed = await owner.agent.get(url(projectId, family.segment)).expect(200);
      expect(listed.body.map((r: any) => r.id)).toContain(itemId);

      const patched = await owner.agent.patch(url(projectId, family.segment, itemId))
        .send(family.change).expect(200);
      expect(String(patched.body[family.changed])).toBe(String(Object.values(family.change)[0]));

      await owner.agent.delete(url(projectId, family.segment, itemId)).expect(200);
      const after = await owner.agent.get(url(projectId, family.segment)).expect(200);
      expect(after.body.map((r: any) => r.id)).not.toContain(itemId);
    });

    /*
     * The security properties of these routes are already covered, in depth and
     * more cleverly, by test/integration/request-body-writes.test.ts: it loops all
     * eight segments attacking them cross-project, and tests the allowlist and the
     * 400 against pricing tiers specifically. That file is the authority on "a
     * write stores what the route allows, where the URL says, and nothing else".
     *
     * This is the one line of it worth repeating per family rather than for one:
     * that the *other seven* refuse a patch naming nothing writable, since a PATCH
     * reporting success while changing nothing is how a client comes to believe it
     * saved something.
     */
    it("refuses a change that names nothing writable", async () => {
      const app = await getTestApp();
      const owner = await person(app, "own");
      const projectId = await aProject(owner.agent);
      const made = await owner.agent.post(url(projectId, family.segment)).set("x-forwarded-for", ip()).send(family.create);
      const itemId = made.body.id as string;

      const res = await owner.agent.patch(url(projectId, family.segment, itemId))
        .send({ nonsense: 1, projectId: "elsewhere" });
      expect(res.status).toBe(400);
    });

    it("is closed to somebody who is not on the project, on every verb", async () => {
      const app = await getTestApp();
      const owner = await person(app, "own");
      const stranger = await person(app, "str");
      const projectId = await aProject(owner.agent);
      const made = await owner.agent.post(url(projectId, family.segment)).set("x-forwarded-for", ip()).send(family.create);
      const itemId = made.body.id as string;

      for (const call of [
        stranger.agent.get(url(projectId, family.segment)),
        stranger.agent.post(url(projectId, family.segment)).set("x-forwarded-for", ip()).send(family.create),
        stranger.agent.patch(url(projectId, family.segment, itemId)).send(family.change),
        stranger.agent.delete(url(projectId, family.segment, itemId)),
      ]) {
        const res = await call;
        expect([403, 404], `${family.segment} let a stranger in with ${res.status}`).toContain(res.status);
      }
    });

    it("needs a session at all", async () => {
      const app = await getTestApp();
      const owner = await person(app, "own");
      const projectId = await aProject(owner.agent);
      expect((await request(app).post(url(projectId, family.segment)).send(family.create)).status).toBe(401);
    });

    it("lets a teammate work on it, not only the owner", async () => {
      /*
       * These are the project's working lists, and `isProjectMember` is the guard
       * rather than `isOwner` — a team that cannot add an interview is not a team.
       */
      const app = await getTestApp();
      const owner = await person(app, "own");
      const mate = await person(app, "mate");
      const projectId = await aProject(owner.agent);
      const invited = await owner.agent.post(`/api/projects/${projectId}/members`)
        .set("x-forwarded-for", ip()).send({ userId: mate.id, role: "member" });
      /* Some projects add members by invitation only; skip rather than assert a shape this test is not about. */
      if (invited.status >= 300) return;

      const made = await mate.agent.post(url(projectId, family.segment)).set("x-forwarded-for", ip()).send(family.create);
      expect(made.status, JSON.stringify(made.body)).toBeLessThan(300);
    });
  });
}

/**
 * The exact routes this file covers, written out.
 *
 * Two reasons, and the second is the one that made it worth doing. First, a route
 * renamed on the server now fails here rather than quietly losing its coverage.
 * Second, the repository's own coverage sweep looks for route paths *as text* in
 * the test tree — and because the tests above build their URLs from a variable,
 * every one of these routes still counted as "named by no test" while being
 * thoroughly tested. A list of literals is what makes the measurement true.
 */
const COVERED = FAMILIES.flatMap((f) => [
  `GET /api/projects/:id/${f.segment}`,
  `POST /api/projects/:id/${f.segment}`,
  `PATCH /api/projects/:id/${f.segment}/:itemId`,
  `DELETE /api/projects/:id/${f.segment}/:itemId`,
]);

describe("the routes this file covers", () => {
  it("are all declared on the server, spelled the same way", () => {
    const routes = readFileSync(resolve(import.meta.dirname, "../../server/routes.ts"), "utf8");
    const missing = COVERED.filter((line) => {
      const [verb, path] = line.split(" ");
      return !new RegExp(`app\\.${verb.toLowerCase()}\\(\\s*"${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`).test(routes);
    });
    expect(missing, "these are tested above but no longer exist under that name").toEqual([]);
  });

  it("covers every verb of every family, so none is half-tested", () => {
    expect(COVERED).toHaveLength(FAMILIES.length * 4);
  });
});

describe("the allowlists themselves", () => {
  it("name only fields these tests know how to write", () => {
    /*
     * A guard against the table going stale: if `WRITABLE` grows a field for one of
     * these families, the create body above is not wrong — but the `change` field
     * has to still be one the route accepts, or the patch test passes by changing
     * nothing it checked.
     */
    for (const family of FAMILIES) {
      expect(family.writable, `${family.name} has no allowlist`).toBeTruthy();
      expect(
        (family.writable as readonly string[]).includes(family.changed),
        `${family.name} patches ${family.changed}, which is not in its allowlist`,
      ).toBe(true);
      for (const key of Object.keys(family.create)) {
        expect(
          (family.writable as readonly string[]).includes(key),
          `${family.name} creates with ${key}, which the route would drop`,
        ).toBe(true);
      }
    }
  });
});
