/**
 * "Is there a problem? Report it", end to end.
 *
 * The thing worth protecting is that it takes a report from anybody — a
 * signed-out visitor most of all, because somebody who cannot sign in is by
 * definition not signed in, and "I cannot sign in" is the report you least
 * want to lose.
 *
 * Who may *read* the queue is covered by admin-guards.test.ts, which scans
 * every /api/admin route and refuses it to everyone who shouldn't have it.
 */
import { describe, it, expect } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { passMfa } from "../helpers/mfa";
import { db } from "../../server/db";
import { users, problemReports } from "@shared/schema";

let n = 0;
const ip = () => `198.51.110.${(n % 200) + 20}`;
const password = "Rt7wqz!Mk4vLp";

async function person(app: any, first: string, role?: "admin") {
  n += 1;
  const agent = request.agent(app);
  const email = `problem-${first.toLowerCase()}-${Date.now()}-${n}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip())
    .send({ email, password, firstName: first });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  await verifyEmail(app, email, ip());
  if (role) await db.update(users).set({ platformRole: role }).where(eq(users.id, res.body.id));
  return { agent, id: res.body.id as string, email };
}

describe("reporting a problem", () => {
  it("takes one from a signed-out visitor, with the page they were on", async () => {
    const app = await getTestApp();
    const res = await request(app).post("/api/problem-reports").set("x-forwarded-for", ip())
      .send({ message: "The sign-in button does nothing on my phone.", path: "/?utm_source=ad&q=private" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const [row] = await db.select().from(problemReports).where(eq(problemReports.id, res.body.id));
    expect(row.message).toBe("The sign-in button does nothing on my phone.");
    expect(row.userId, "a signed-out report has nobody attached").toBeNull();
    expect(row.status).toBe("new");
    /* The query string carried a search term and an ad parameter. Neither is needed to find the screen. */
    expect(row.path).toBe("/");
  });

  it("attaches the account when there is one", async () => {
    const app = await getTestApp();
    const her = await person(app, "Ada");
    const res = await her.agent.post("/api/problem-reports").set("x-forwarded-for", ip())
      .send({ message: "Milestones are showing twice on the board.", path: "/projects/x" });
    expect(res.status).toBe(201);
    const [row] = await db.select().from(problemReports).where(eq(problemReports.id, res.body.id));
    expect(row.userId).toBe(her.id);
  });

  it("refuses an empty one, in words the dialog can show", async () => {
    const app = await getTestApp();
    const res = await request(app).post("/api/problem-reports").set("x-forwarded-for", ip()).send({ message: "   " });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/what went wrong/i);
    expect(res.body.field).toBe("message");
  });

  it("stores nothing for a message that isn't a string", async () => {
    const app = await getTestApp();
    const res = await request(app).post("/api/problem-reports").set("x-forwarded-for", ip()).send({ message: { a: 1 } });
    expect(res.status).toBe(400);
  });
});

describe("the queue", () => {
  it("lets an admin read it, and move a report along with a note", async () => {
    const app = await getTestApp();
    const reporter = await person(app, "Bea");
    const admin = await person(app, "Adminy", "admin");
    await passMfa(admin.agent);

    const made = await reporter.agent.post("/api/problem-reports").set("x-forwarded-for", ip())
      .send({ message: "The path card never updates while Nova builds.", path: "/projects/y" });
    expect(made.status).toBe(201);

    const list = await admin.agent.get("/api/admin/problem-reports?status=new").set("x-forwarded-for", ip());
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const mine = list.body.reports.find((r: any) => r.id === made.body.id);
    expect(mine, "the new report is in the new queue").toBeTruthy();
    expect(mine.email, "the admin can see who to reply to").toBe(reporter.email);
    expect(list.body.counts.new).toBeGreaterThan(0);

    const moved = await admin.agent.patch(`/api/admin/problem-reports/${made.body.id}`)
      .set("x-forwarded-for", ip()).send({ status: "looking", note: "Reproduced — it is the poll." });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);

    const [row] = await db.select().from(problemReports).where(eq(problemReports.id, made.body.id));
    expect(row.status).toBe("looking");
    expect(row.note).toBe("Reproduced — it is the poll.");
    /* Who looked, so a queue two people are reading doesn't get read twice. */
    expect(row.handledById).toBe(admin.id);
    expect(row.handledAt).toBeTruthy();

    // And it has left the new queue.
    const after = await admin.agent.get("/api/admin/problem-reports?status=new").set("x-forwarded-for", ip());
    expect(after.body.reports.find((r: any) => r.id === made.body.id)).toBeFalsy();
  });

  it("refuses a state that isn't one of the four", async () => {
    const app = await getTestApp();
    const admin = await person(app, "Adminz", "admin");
    await passMfa(admin.agent);
    const made = await request(app).post("/api/problem-reports").set("x-forwarded-for", ip())
      .send({ message: "Something is wrong with the thing." });
    const res = await admin.agent.patch(`/api/admin/problem-reports/${made.body.id}`)
      .set("x-forwarded-for", ip()).send({ status: "urgent" });
    expect(res.status).toBe(400);
  });
});
