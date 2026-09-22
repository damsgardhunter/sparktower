/**
 * Getting away from someone, end to end.
 *
 * Before blocking existed, the only thing a person being harassed could do was
 * file a report, and a report changes nothing between the two of them: the same
 * account could still send connection requests with a note attached, still
 * turned up in matches and people search, still appeared on the profile, and
 * still rang the bell. So the thing worth pinning here is not "the row is
 * written" — it's that every one of those doors is shut by the one action, and
 * that unblocking opens them again.
 *
 * The other half of the design, tested just as hard: the blocked person is
 * never told. A connection request they send is accepted with a normal-looking
 * answer and lands nowhere; the profile is a plain 404, the same one a deleted
 * account gives. Anything that reads differently is a way to find out you were
 * blocked, and that is how a block becomes the start of the next argument.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { userMatches } from "@shared/schema";

afterAll(async () => { await closeTestApp(); });

let n = 0;
const password = "Testpass123!";

async function person(app: any, first: string) {
  n += 1;
  const agent = request.agent(app);
  const email = `block-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.130.${10 + (n % 200)}`)
    .send({ email, password, firstName: first, lastName: `Q${n}` });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  await verifyEmail(app, email, `198.51.131.${10 + (n % 200)}`);
  await agent.post("/api/profile/complete-onboarding").send({ displayName: `${first} Q${n}` });
  return { agent, id: res.body.id as string, email, first };
}

/** Connect two accounts — the precondition for messaging. */
async function connect(a: any, b: any) {
  const req = await a.agent.post("/api/connections/request").send({ userId: b.id });
  expect(req.status, JSON.stringify(req.body)).toBe(200);
  const accept = await b.agent.post(`/api/connections/${req.body.id}/accept`).send({});
  expect(accept.status, JSON.stringify(accept.body)).toBe(200);
}

describe("blocking someone", () => {
  it("shuts every door between two people, and unblocking opens them again", async () => {
    const app = await getTestApp();
    const ada = await person(app, "Ada");        // does the blocking
    const kit = await person(app, "Kit");        // gets blocked

    await connect(ada, kit);
    const hello = await kit.agent.post(`/api/messages/${ada.id}`).send({ content: "Hello there, this is a message." });
    expect(hello.status, JSON.stringify(hello.body)).toBe(200);

    /*
     * A stored match row, the way a generated batch leaves one — against a
     * third person, because a match against somebody you're already connected
     * to is cleared as stale by the read path and would prove nothing here.
     */
    const noa = await person(app, "Noa");
    await db.insert(userMatches).values({ userId: ada.id, matchedUserId: noa.id, score: 90 }).onConflictDoNothing();
    expect((await ada.agent.get("/api/matches")).body.some((m: any) => m.matchedUserId === noa.id),
      "the match should be there to begin with").toBe(true);

    // --- the block ---
    const blocked = await ada.agent.post("/api/blocks").send({ userId: kit.id });
    expect(blocked.status, JSON.stringify(blocked.body)).toBe(200);

    // 1. The connection is gone, both ways.
    expect((await ada.agent.get(`/api/connections/status/${kit.id}`)).body.status).toBe("none");
    expect((await kit.agent.get(`/api/connections/status/${ada.id}`)).body.status).toBe("none");

    // 2. The blocked person cannot ask to connect. The answer looks ordinary —
    //    that's the point — but nothing is written and nobody is notified.
    const reRequest = await kit.agent.post("/api/connections/request")
      .send({ userId: ada.id, note: "Let me back in, this is a note of some length." });
    expect(reRequest.status, JSON.stringify(reRequest.body)).toBe(200);
    expect(reRequest.body.id, "a blocked request must not create a row").toBeFalsy();
    expect((await ada.agent.get("/api/connections/requests")).body).toEqual([]);

    // 3. Neither can message the other.
    expect((await kit.agent.post(`/api/messages/${ada.id}`).send({ content: "Still here, still writing to you." })).status).toBe(403);
    expect((await ada.agent.post(`/api/messages/${kit.id}`).send({ content: "Please stop writing to me now." })).status).toBe(403);
    expect((await kit.agent.get(`/api/messages/${ada.id}`)).status).toBe(403);

    // 4. The thread leaves the inbox, and the badge with it — an unread count
    //    over a thread that can't be opened is a badge nobody can ever clear.
    const conversations = await ada.agent.get("/api/messages/conversations");
    expect(conversations.body.some((c: any) => c.userId === kit.id)).toBe(false);
    expect((await ada.agent.get("/api/messages/unread-count")).body.count).toBe(0);

    // 5. Out of matches. The stored row is deleted by the block and the read
    //    path filters it besides, so neither half can resurface them.
    expect((await ada.agent.post("/api/blocks").send({ userId: noa.id })).status).toBe(200);
    expect((await ada.agent.get("/api/matches")).body.some((m: any) => m.matchedUserId === noa.id)).toBe(false);

    // 6. Out of search, in both directions.
    const adaSearch = await ada.agent.get(`/api/users/search?q=${encodeURIComponent(kit.first)}`);
    expect(adaSearch.body.some((u: any) => u.id === kit.id), "the blocker must not find them").toBe(false);
    const kitSearch = await kit.agent.get(`/api/users/search?q=${encodeURIComponent(ada.first)}`);
    expect(kitSearch.body.some((u: any) => u.id === ada.id), "the blocked person must not find them either").toBe(false);

    // 7. The profile is hidden from each — as a plain 404, indistinguishable
    //    from an account that never existed.
    expect((await kit.agent.get(`/api/users/${ada.id}`)).status).toBe(404);
    expect((await ada.agent.get(`/api/users/${kit.id}`)).status).toBe(404);

    // 8. And nothing the blocked person does rings the bell.
    await kit.agent.post(`/api/users/${ada.id}/follow`).send({});
    const bell = await ada.agent.get("/api/notifications");
    expect(bell.body.items.some((i: any) => i.actor?.id === kit.id), "a blocked person must not reach the bell").toBe(false);

    // --- and back again ---
    const unblocked = await ada.agent.delete(`/api/blocks/${kit.id}`);
    expect(unblocked.status, JSON.stringify(unblocked.body)).toBe(200);

    expect((await kit.agent.get(`/api/users/${ada.id}`)).status).toBe(200);
    expect((await ada.agent.get(`/api/users/${kit.id}`)).status).toBe(200);
    const afterSearch = await ada.agent.get(`/api/users/search?q=${encodeURIComponent(kit.first)}`);
    expect(afterSearch.body.some((u: any) => u.id === kit.id)).toBe(true);

    // The connection is not restored — it has to be asked for again, which is
    // the honest state — but asking is possible once more.
    const asking = await kit.agent.post("/api/connections/request").send({ userId: ada.id });
    expect(asking.status, JSON.stringify(asking.body)).toBe(200);
    expect(asking.body.id, "a real request now").toBeTruthy();
  });

  it("lists who you blocked, only to you, and blocking twice is one block", async () => {
    const app = await getTestApp();
    const mo = await person(app, "Mo");
    const rex = await person(app, "Rex");

    expect((await mo.agent.post("/api/blocks").send({ userId: rex.id, reason: "Kept messaging after I asked" })).status).toBe(200);
    // A double-tapped confirm is the same block, not two rows needing two undos.
    expect((await mo.agent.post("/api/blocks").send({ userId: rex.id })).status).toBe(200);

    const list = await mo.agent.get("/api/blocks");
    expect(list.status).toBe(200);
    expect(list.body.filter((b: any) => b.userId === rex.id)).toHaveLength(1);
    expect(list.body.find((b: any) => b.userId === rex.id).reason).toBe("Kept messaging after I asked");

    // The blocked person's own list is empty: blocks held against you are not
    // yours to see, and this endpoint must never become the way to find out.
    expect((await rex.agent.get("/api/blocks")).body).toEqual([]);
    expect((await rex.agent.get(`/api/blocks/${mo.id}`)).body.blocked).toBe(false);
    expect((await mo.agent.get(`/api/blocks/${rex.id}`)).body.blocked).toBe(true);

    // One unblock is enough.
    expect((await mo.agent.delete(`/api/blocks/${rex.id}`)).status).toBe(200);
    expect((await mo.agent.get("/api/blocks")).body.some((b: any) => b.userId === rex.id)).toBe(false);
  });

  it("refuses to block yourself, and needs somebody real", async () => {
    const app = await getTestApp();
    const solo = await person(app, "Solo");
    expect((await solo.agent.post("/api/blocks").send({ userId: solo.id })).status).toBe(400);
    expect((await solo.agent.post("/api/blocks").send({})).status).toBe(400);
    expect((await solo.agent.post("/api/blocks").send({ userId: "00000000-0000-0000-0000-000000000000" })).status).toBe(404);
  });
});

describe("reporting a direct message", () => {
  it("takes the message itself, only from the person it was sent to", async () => {
    const app = await getTestApp();
    const sam = await person(app, "Sam");
    const val = await person(app, "Val");
    await connect(sam, val);

    const sent = await sam.agent.post(`/api/messages/${val.id}`).send({ content: "Something worth reporting, at length." });
    expect(sent.status).toBe(200);
    const messageId = sent.body.id as string;

    // The recipient can report what was said — which, until now, was
    // impossible: the only reportable thing about a private conversation was
    // the person, so a reviewer got an accusation with no words attached.
    const filed = await val.agent.post("/api/reports").send({ targetType: "message", targetId: messageId, reason: "abuse" });
    expect(filed.status, JSON.stringify(filed.body)).toBe(200);
    expect(filed.body.received).toBe(true);

    // The sender can't report their own message — and gets the same "not
    // found" a stranger gets, since the rule is "you must be the recipient".
    expect((await sam.agent.post("/api/reports").send({ targetType: "message", targetId: messageId, reason: "abuse" })).status).toBe(404);

    // And a stranger gets "not found", not "not allowed": the endpoint must not
    // confirm that a message id exists, or it becomes a private-message oracle.
    const nosy = await person(app, "Nosy");
    const pry = await nosy.agent.post("/api/reports").send({ targetType: "message", targetId: messageId, reason: "abuse" });
    expect(pry.status).toBe(404);
  });
});
