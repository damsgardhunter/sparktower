/**
 * What a suspension actually stops, on the people side.
 *
 * Suspension blocked writes and nothing else, which meant the product kept
 * working on the suspended account's behalf: it still appeared in other
 * people's matches, still had its name and face on their bell, still had a
 * public profile, still advertised for collaborators on the signed-out
 * "who's looking" list — and, worst of the set, could still read every direct
 * message thread with the person it was suspended for harassing. Someone
 * reported harassment, got told the account was suspended, and the account
 * carried on reading their messages.
 *
 * So: suspended and deleted accounts leave the read paths where one person is
 * shown to another, and a suspended account's message reads are closed.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { userMatches, users } from "@shared/schema";
import { eq } from "drizzle-orm";

afterAll(async () => { await closeTestApp(); });

let n = 0;
const password = "Testpass123!";

async function person(app: any, first: string) {
  n += 1;
  const agent = request.agent(app);
  const email = `susp-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.150.${10 + (n % 200)}`)
    .send({ email, password, firstName: first, lastName: `S${n}` });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  await verifyEmail(app, email, `198.51.151.${10 + (n % 200)}`);
  await agent.post("/api/profile/complete-onboarding").send({ displayName: `${first} S${n}` });
  return { agent, id: res.body.id as string, email, first };
}

const suspend = (id: string, reason = "Harassment") =>
  db.update(users).set({ suspendedAt: new Date(), suspendedReason: reason }).where(eq(users.id, id));

describe("a suspended account", () => {
  it("leaves matches, the bell, profiles and the public looking-for list", async () => {
    const app = await getTestApp();
    const pia = await person(app, "Pia");     // stays
    const quin = await person(app, "Quin");   // gets suspended

    // Quin is one of Pia's matches, follows her (which rings her bell), and
    // is advertising on the public "who's looking" list.
    await db.insert(userMatches).values({ userId: pia.id, matchedUserId: quin.id, score: 88 }).onConflictDoNothing();
    await quin.agent.post(`/api/users/${pia.id}/follow`).send({});
    const looking = await quin.agent.post("/api/profile/looking-for")
      .send({ role: "Designer", description: "Looking for a design partner to build with.", isActive: true });
    expect(looking.status, JSON.stringify(looking.body)).toBeLessThan(300);

    // All present to begin with.
    expect((await pia.agent.get("/api/matches")).body.some((m: any) => m.matchedUserId === quin.id)).toBe(true);
    expect((await pia.agent.get("/api/notifications")).body.items.some((i: any) => i.actor?.id === quin.id)).toBe(true);
    expect((await request(app).get("/api/looking-for")).body.some((p: any) => p.userId === quin.id)).toBe(true);
    expect((await pia.agent.get(`/api/users/${quin.id}`)).status).toBe(200);

    await suspend(quin.id);

    // And gone from every one of them.
    expect((await pia.agent.get("/api/matches")).body.some((m: any) => m.matchedUserId === quin.id),
      "a suspended account must not keep being introduced to people").toBe(false);
    expect((await pia.agent.get("/api/notifications")).body.items.some((i: any) => i.actor?.id === quin.id),
      "nor keep its name in somebody's bell").toBe(false);
    expect((await request(app).get("/api/looking-for")).body.some((p: any) => p.userId === quin.id),
      "nor keep advertising for collaborators on a page anyone can read").toBe(false);
    expect((await pia.agent.get(`/api/users/${quin.id}`)).status).toBe(404);
    expect((await pia.agent.get(`/api/users/search?q=${encodeURIComponent(quin.first)}`)).body
      .some((u: any) => u.id === quin.id)).toBe(false);

    // The bell's count agrees with the bell, so nothing is left uncountable.
    const bellCount = (await pia.agent.get("/api/notifications/unread-count")).body.count;
    const bellItems = (await pia.agent.get("/api/notifications")).body.items.filter((i: any) => !i.read).length;
    expect(bellCount).toBe(bellItems);
  });

  it("can no longer read the messages it was suspended over", async () => {
    const app = await getTestApp();
    const rue = await person(app, "Rue");
    const sid = await person(app, "Sid");   // gets suspended

    const req = await sid.agent.post("/api/connections/request").send({ userId: rue.id });
    await rue.agent.post(`/api/connections/${req.body.id}/accept`).send({});
    await sid.agent.post(`/api/messages/${rue.id}`).send({ content: "A message from before the suspension." });

    expect((await sid.agent.get(`/api/messages/${rue.id}`)).status).toBe(200);

    await suspend(sid.id);

    // Writes were already closed; the reads into the relationship are too.
    const read = await sid.agent.get(`/api/messages/${rue.id}`);
    expect(read.status, "a suspended account must not keep reading its target's thread").toBe(403);
    expect(read.body.code).toBe("account_suspended");
    expect((await sid.agent.get("/api/messages/conversations")).status).toBe(403);
    expect((await sid.agent.post(`/api/messages/${rue.id}`).send({ content: "Still here, though." })).status).toBe(403);

    // But the rest of reading stays open: an appeal and a data export are the
    // two things a suspended person is legitimately here for.
    expect((await sid.agent.get("/api/auth/user")).status).toBe(200);
  });
});
