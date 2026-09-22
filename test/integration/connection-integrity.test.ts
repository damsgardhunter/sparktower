/**
 * Connections, and the three ways the pair state used to come apart.
 *
 *   - Two rows for one pair. `sendConnectionRequest` was a check-then-insert,
 *     so a double-submitted button — or A and B pressing "connect" on each
 *     other in the same second — wrote two rows. `getConnectionStatus` then
 *     returned whichever the planner handed back first, and messaging between
 *     the two answered 403 on some requests and 200 on others.
 *   - A decline that lasted forever. `rejectConnection` left a `rejected` row,
 *     and a request was refused while any row existed either way round, so one
 *     mis-tap sealed the pair for good: "Requested", greyed out, for the rest
 *     of time, with no way back for either of them.
 *   - An inbox listing threads that 403 when opened, with an unread badge
 *     nobody could clear, because clearing it meant opening the thread.
 *
 * Each of those is a bug somebody experiences as "messaging is broken" and
 * nobody can reproduce, which is why they're pinned here rather than left to
 * a code read.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { connections } from "@shared/schema";
import { and, eq, or, sql } from "drizzle-orm";

afterAll(async () => { await closeTestApp(); });

let n = 0;
const password = "Testpass123!";

async function person(app: any, first: string) {
  n += 1;
  const agent = request.agent(app);
  const email = `conn-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.140.${10 + (n % 200)}`)
    .send({ email, password, firstName: first, lastName: `R${n}` });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  await verifyEmail(app, email, `198.51.141.${10 + (n % 200)}`);
  await agent.post("/api/profile/complete-onboarding").send({ displayName: `${first} R${n}` });
  return { agent, id: res.body.id as string, email, first };
}

const rowsBetween = (a: string, b: string) =>
  db.select().from(connections).where(or(
    and(eq(connections.requesterId, a), eq(connections.receiverId, b)),
    and(eq(connections.requesterId, b), eq(connections.receiverId, a)),
  ));

describe("one connection per pair", () => {
  it("survives a double submit and a simultaneous request from both sides", async () => {
    const app = await getTestApp();
    const eve = await person(app, "Eve");
    const ash = await person(app, "Ash");

    // The double-submitted button: two identical requests, at once.
    const [first, second] = await Promise.all([
      eve.agent.post("/api/connections/request").send({ userId: ash.id }),
      eve.agent.post("/api/connections/request").send({ userId: ash.id }),
    ]);
    // Both answer sensibly — the loser reads back the row that won, since the
    // person pressing twice should see their own request, not an error.
    for (const r of [first, second]) expect(r.status, JSON.stringify(r.body)).toBeLessThan(500);
    expect(await rowsBetween(eve.id, ash.id)).toHaveLength(1);

    // And the harder one: A and B asking each other in the same second, which
    // reads as two different pairs to anything that looks one direction at a time.
    const bo = await person(app, "Bo");
    const cy = await person(app, "Cy");
    await Promise.all([
      bo.agent.post("/api/connections/request").send({ userId: cy.id }),
      cy.agent.post("/api/connections/request").send({ userId: bo.id }),
    ]);
    expect(await rowsBetween(bo.id, cy.id), "a pair is a pair, whichever way round it was asked").toHaveLength(1);
  });

  it("answers the same every time when old rows disagree, and messaging follows it", async () => {
    const app = await getTestApp();
    const ivy = await person(app, "Ivy");
    const jun = await person(app, "Jun");

    const req = await ivy.agent.post("/api/connections/request").send({ userId: jun.id });
    await jun.agent.post(`/api/connections/${req.body.id}/accept`).send({});

    /*
     * A second, contradictory row for the same pair — the state the old
     * check-then-insert could reach, and the state every database written
     * before the unique index is already in.
     *
     * The index stops new ones, so it comes off for a moment to write the row
     * the old code would have written. That is the point of the test: the
     * index fixes the future, and `getConnectionStatus` has to give a stable
     * answer for the rows that are already there. An authorisation check must
     * never depend on which row the planner happens to return first.
     */
    await db.execute(sql`DROP INDEX IF EXISTS connections_pair_unique`);
    try {
      await db.execute(sql`
        INSERT INTO connections (requester_id, receiver_id, status, created_at)
        VALUES (${jun.id}, ${ivy.id}, 'pending', now() - interval '1 day')
      `);
      expect(await rowsBetween(ivy.id, jun.id), "two rows, on purpose").toHaveLength(2);

      for (let i = 0; i < 5; i++) {
        const status = await ivy.agent.get(`/api/connections/status/${jun.id}`);
        expect(status.body.status, "accepted beats pending, every time").toBe("accepted");
      }
      const sent = await ivy.agent.post(`/api/messages/${jun.id}`).send({ content: "This should always go through." });
      expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    } finally {
      // Put the pair back to one row and the index back on, so the rest of the
      // file (and any other test sharing this database) sees the real schema.
      await db.execute(sql`
        DELETE FROM connections
        WHERE requester_id = ${jun.id} AND receiver_id = ${ivy.id} AND status = 'pending'
      `);
      await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS connections_pair_unique
          ON connections (least(requester_id, receiver_id), greatest(requester_id, receiver_id))
      `);
    }
  });
});

describe("declining a request", () => {
  it("releases the pair instead of sealing it forever", async () => {
    const app = await getTestApp();
    const lee = await person(app, "Lee");
    const max = await person(app, "Max");

    const req = await lee.agent.post("/api/connections/request").send({ userId: max.id });
    expect(req.status).toBe(200);
    const declined = await max.agent.post(`/api/connections/${req.body.id}/reject`).send({});
    expect(declined.status, JSON.stringify(declined.body)).toBe(200);

    // No row is left behind, so neither side is looking at a lie: the person
    // who asked no longer sees "Requested" forever, and the person who
    // declined gets their Connect button back.
    expect(await rowsBetween(lee.id, max.id)).toHaveLength(0);
    expect((await lee.agent.get(`/api/connections/status/${max.id}`)).body.status).toBe("none");
    expect((await max.agent.get(`/api/connections/status/${lee.id}`)).body.status).toBe("none");
    const statuses = await lee.agent.get(`/api/connections/statuses?ids=${max.id}`);
    expect(statuses.body[max.id].state).toBe("none");

    // An accidental decline can be undone by asking again — which is what
    // "declined" means everywhere else, and what the rate limit is for.
    const again = await lee.agent.post("/api/connections/request").send({ userId: max.id });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body.id).toBeTruthy();

    // The other direction works too: the decliner can start it themselves.
    await max.agent.post(`/api/connections/${again.body.id}/reject`).send({});
    const theirTurn = await max.agent.post("/api/connections/request").send({ userId: lee.id });
    expect(theirTurn.status, JSON.stringify(theirTurn.body)).toBe(200);
  });
});

describe("the inbox", () => {
  it("lists only threads that open, and the badge counts only those", async () => {
    const app = await getTestApp();
    const ned = await person(app, "Ned");
    const oli = await person(app, "Oli");

    const req = await ned.agent.post("/api/connections/request").send({ userId: oli.id });
    const accept = await oli.agent.post(`/api/connections/${req.body.id}/accept`).send({});
    expect(accept.status).toBe(200);
    const connectionId = req.body.id as string;

    await oli.agent.post(`/api/messages/${ned.id}`).send({ content: "A message that will go unread." });

    // While connected: in the list, and counted.
    expect((await ned.agent.get("/api/messages/conversations")).body.some((c: any) => c.userId === oli.id)).toBe(true);
    expect((await ned.agent.get("/api/messages/unread-count")).body.count).toBe(1);

    // Now the connection is removed. The thread can no longer be opened...
    expect((await ned.agent.delete(`/api/connections/${connectionId}`)).status).toBe(200);
    expect((await ned.agent.get(`/api/messages/${oli.id}`)).status).toBe(403);

    // ...so it must not still be sitting in the list with an unread badge that
    // nothing can clear — which is exactly what it used to do.
    expect((await ned.agent.get("/api/messages/conversations")).body.some((c: any) => c.userId === oli.id)).toBe(false);
    expect((await ned.agent.get("/api/messages/unread-count")).body.count).toBe(0);

    // The messages are not destroyed: reconnecting brings the thread back.
    const again = await ned.agent.post("/api/connections/request").send({ userId: oli.id });
    await oli.agent.post(`/api/connections/${again.body.id}/accept`).send({});
    const back = await ned.agent.get("/api/messages/conversations");
    const thread = back.body.find((c: any) => c.userId === oli.id);
    expect(thread, "history comes back with the connection").toBeTruthy();
    expect(thread.lastMessage.content).toBe("A message that will go unread.");
  });
});
