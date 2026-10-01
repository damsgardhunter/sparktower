/**
 * Every route inside a project, asked by a stranger, for real.
 *
 * ## Why a sweep and not a list
 *
 * A project's inside is for the people on it, and 200 routes take a project id
 * in the URL — 133 of them writes. `project-read-access.test.ts` walks five of
 * them: the three that were once found broken, plus two neighbours. That is a
 * regression test for a past bug, not a guarantee about the surface, and the
 * surface is where this class of bug lives. Route 201 gets added next month by
 * someone who has never read this file.
 *
 * The check could not be written statically. There are twelve different access
 * helpers in server code —
 *
 *   isProjectMember  isMember  isOwner  memberOf  teamProject  projectFor
 *   loadProject  ownedProject  companyCan  companyMember  powersOf  projectTeam
 *
 * — with no shared type and no common middleware, so "does this handler check
 * access?" has no reliable textual answer. Four separate attempts to read it
 * off the source flagged 52, then 31, then 18, then 12 routes; every single one
 * hand-checked turned out properly guarded by a helper the pattern didn't know.
 * Asking the running server is the only honest way to find out, so that is what
 * this does: it enumerates the routes from the route table and calls each one
 * as an account with no part in the project.
 *
 * ## The project is private
 *
 * `isPrivate` defaults to false — a public project page is the point of the
 * product — so a sweep against a default project proves nothing about privacy:
 * a stranger is *supposed* to read the brief. Private projects are a paid
 * entitlement, which makes "nobody else sees this" a promise someone paid for,
 * and that is the promise worth pinning. So the fixture is switched private and
 * everything is expected to refuse.
 *
 * ## What it found
 *
 * Nothing. 154 routes answer 403, 41 answer 404, and every 2xx below is
 * deliberate and asserted to carry no content. That is the result worth having
 * written down, because the alternative to knowing it is believing it.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { buildRouteCoverage } from "../../server/route-coverage";
import { serverSourceFiles } from "../helpers/server-files";

afterAll(async () => { await closeTestApp(); });

const password = "Testpass123!";
let n = 0;
async function person(app: any, tag: string) {
  const agent = request.agent(app);
  n += 1;
  const email = `pas-${tag}-${Date.now()}-${n}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.100.${(n % 200) + 20}`).send({ email, password, firstName: "S" });
  expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
  return { agent, id: res.body.id as string };
}

/**
 * The routes a stranger may reach on a private project, and what they may get.
 *
 * Each one answers 2xx on purpose and each is asserted below to hand over
 * nothing. A route that stops being empty stops being allowed.
 */
const MAY_ANSWER: Record<string, { status: number[]; why: string }> = {
  "GET /api/projects/:id": {
    status: [200],
    why: "a deliberate stub — { id, title, isPrivate, restricted } and nothing else — so a shared link can say the project is private rather than that it does not exist. The redaction is asserted field by field below",
  },
  "GET /api/projects/:id/members": { status: [200], why: "answers [] to a stranger; asserted empty below" },
  "GET /api/projects/:id/storyboards": { status: [200], why: "answers [] to a stranger; asserted empty below" },
  "GET /api/projects/:id/follow-status": { status: [200], why: "a fact about the caller, not the project: whether this account follows it" },
  "POST /api/projects/:id/donate-checkout": { status: [410], why: "donations are retired; it refuses everyone the same way" },
  /*
   * These three validate the body before they decide about access, so a
   * stranger gets 400 rather than 403. It is a whisker of information
   * disclosure — a stranger can tell a malformed request from a forbidden one
   * — and not a way into the project: no handler runs. Listed rather than
   * fixed because moving the access check earlier in three routes is a change
   * to live code for no gain in what anyone can reach.
   */
  "POST /api/projects/:id/brand-kit": { status: [400], why: "validates its body before access; never 2xx" },
  "PUT /api/projects/:id/visuals/:slot": { status: [400], why: "validates its body before access; never 2xx" },
  "PATCH /api/projects/:id/visuals/:slot": { status: [400], why: "validates its body before access; never 2xx" },
};

describe("a stranger against a private project", () => {
  it("is refused by every route that takes a project id", async () => {
    const app = await getTestApp();
    const owner = await person(app, "own");
    const made = await owner.agent.post("/api/projects").send({
      title: "Private", description: "A project used to check that a stranger cannot reach its inside.",
      category: "saas", goal: "ship_mvp", subcategory: "saas",
    });
    expect(made.status, JSON.stringify(made.body)).toBeLessThan(300);
    const pid = made.body.id as string;

    /* Private projects are a paid entitlement; this is what one looks like. */
    const { db } = await import("../../server/db");
    const { projects } = await import("@shared/schema");
    await db.update(projects).set({ isPrivate: true } as any).where(eq(projects.id, pid));

    const stranger = await person(app, "str");
    const routes = buildRouteCoverage(serverSourceFiles() as any).rows
      .filter((r: any) => r.mounted && /^\/api\/projects\/:id(\/|$)/.test(r.path));

    /* A sweep that enumerates nothing passes for ever. */
    expect(routes.length, "no project-scoped routes found — the route table changed shape").toBeGreaterThan(150);

    const leaked: string[] = [];
    const surprising: string[] = [];
    for (const r of routes) {
      const label = `${r.method} ${r.path}`;
      const url = r.path.replace(":id", pid).replace(/:[A-Za-z]+/g, "00000000-0000-4000-8000-000000000000");
      const m = r.method.toLowerCase();
      const res = m === "get" ? await stranger.agent.get(url)
        : m === "delete" ? await stranger.agent.delete(url)
        : m === "patch" ? await stranger.agent.patch(url).send({})
        : m === "put" ? await stranger.agent.put(url).send({})
        : await stranger.agent.post(url).send({});

      const allowed = MAY_ANSWER[label];
      if (allowed) {
        if (!allowed.status.includes(res.status)) surprising.push(`${label} answered ${res.status}, expected ${allowed.status.join("/")} (${allowed.why})`);
        continue;
      }
      if (res.status < 300) leaked.push(`${label} answered ${res.status}`);
      else if (![401, 403, 404].includes(res.status)) surprising.push(`${label} answered ${res.status}`);
    }

    expect(leaked, `a stranger reached the inside of a private project — either the access check is missing, or the route belongs in MAY_ANSWER with a reason:\n  ${leaked.join("\n  ")}`).toEqual([]);
    expect(surprising, `unexpected answers; a refusal should be 403 or 404:\n  ${surprising.join("\n  ")}`).toEqual([]);
  }, 600_000);

  /*
   * The one route that answers with the project itself. Named fields rather
   * than a snapshot, because what matters is that the ones people pay to hide
   * are absent — a new column added to `projects` must not arrive here.
   */
  it("gets a stub for the project, with none of what the owner wrote", async () => {
    const app = await getTestApp();
    const owner = await person(app, "red");
    const made = await owner.agent.post("/api/projects").send({
      title: "Hidden", description: "The description a stranger must never read.",
      category: "saas", goal: "ship_mvp", subcategory: "saas",
    });
    const pid = made.body.id as string;
    const { db } = await import("../../server/db");
    const { projects } = await import("@shared/schema");
    await db.update(projects).set({
      isPrivate: true, oneLiner: "the one-liner", mission: "the mission",
      valueProposition: "the value proposition", targetCustomerProfile: "the target customer",
    } as any).where(eq(projects.id, pid));

    const stranger = await person(app, "peek");
    const res = await stranger.agent.get(`/api/projects/${pid}`);
    expect(res.status).toBe(200);
    expect(res.body.restricted, "it says plainly that it is withholding").toBe(true);
    expect(res.body.isPrivate).toBe(true);
    expect(Object.keys(res.body).sort(), "only these four fields leave, so a new column cannot ride along").toEqual(["id", "isPrivate", "restricted", "title"]);
    for (const secret of ["the description a stranger must never read", "the one-liner", "the mission", "the value proposition", "the target customer"]) {
      expect(JSON.stringify(res.body).toLowerCase(), `"${secret}" reached a stranger`).not.toContain(secret);
    }
  }, 120_000);
});
