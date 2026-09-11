/**
 * The server side of Follow, Connect and Message on Discover's cards.
 *
 * What the cards rely on: a note that reaches the person it's for and no one
 * else's inbox; one request that tells a page where you stand with everyone on
 * it; a follow that sets a state rather than flipping one, so an instant UI
 * can't undo itself; and a limit on requests, now that they carry text to
 * people who haven't agreed to hear from you.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";
import { RATE_LIMITS, CONNECTION_NOTE_MAX } from "@shared/moderation";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function person(app: any) {
  const agent = request.agent(app);
  n += 1;
  const res = await agent.post("/api/auth/register")
    .set("x-forwarded-for", `198.51.100.${100 + n}`)
    .send({ email: `da-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`, password: "Testpass123!", firstName: `P${n}` });
  expect(res.status).toBe(201);
  return { agent, id: res.body.id as string };
}

describe("a connection request's note", () => {
  it("reaches the person it's for — trimmed, capped, and absent when empty", async () => {
    const app = await getTestApp();
    const [ari, bea, cai, dee] = [await person(app), await person(app), await person(app), await person(app)];

    expect((await ari.agent.post("/api/connections/request").send({ userId: bea.id, note: "  Nova matched us on analytics.  " })).status).toBe(200);
    expect((await cai.agent.post("/api/connections/request").send({ userId: bea.id, note: "x".repeat(400) })).status).toBe(200);
    expect((await dee.agent.post("/api/connections/request").send({ userId: bea.id, note: "   " })).status).toBe(200);

    const requests = (await bea.agent.get("/api/connections/requests")).body as any[];
    const from = (id: string) => requests.find((r) => r.requesterId === id);
    expect(from(ari.id).note).toBe("Nova matched us on analytics.");
    expect(from(cai.id).note).toHaveLength(CONNECTION_NOTE_MAX);
    expect(from(dee.id).note).toBeNull();
  });
});

describe("where you stand with everyone on a page", () => {
  it("comes back in one request, from your side", async () => {
    const app = await getTestApp();
    const [ari, bea, cai, dee, eve] = [await person(app), await person(app), await person(app), await person(app), await person(app)];

    await ari.agent.post("/api/connections/request").send({ userId: bea.id });            // Ari asked Bea
    await cai.agent.post("/api/connections/request").send({ userId: ari.id });            // Cai asked Ari
    const toDee = (await ari.agent.post("/api/connections/request").send({ userId: dee.id })).body;
    await dee.agent.post(`/api/connections/${toDee.id}/accept`);                          // Ari and Dee connected

    const res = await ari.agent.get(`/api/connections/statuses?ids=${[bea.id, cai.id, dee.id, eve.id].join(",")}`);
    expect(res.status).toBe(200);
    expect(res.body[bea.id].state).toBe("requested");
    expect(res.body[cai.id].state).toBe("incoming");
    expect(res.body[cai.id].connectionId).toBeTruthy();   // so Ari can accept from the card
    expect(res.body[dee.id].state).toBe("connected");
    expect(res.body[eve.id]).toEqual({ state: "none", connectionId: null });

    expect((await request(app).get(`/api/connections/statuses?ids=${bea.id}`)).status).toBe(401);
  });
});

describe("following a project", () => {
  it("sets the state it's asked for, so asking twice doesn't undo it — and still toggles when not asked", async () => {
    const app = await getTestApp();
    const [owner, fan] = [await person(app), await person(app)];
    const project = (await owner.agent.post("/api/projects").send({
      title: "Follow Me", description: "A project that exists to be followed and unfollowed in a test.",
      category: "saas", goal: "ship_mvp", subcategory: "saas",
    })).body;
    const follow = (body?: object) => fan.agent.post(`/api/projects/${project.id}/follow`).send(body ?? {});

    expect((await follow({ following: true })).body).toEqual({ following: true });
    expect((await follow({ following: true })).body).toEqual({ following: true });
    expect((await fan.agent.get(`/api/projects/${project.id}/follow-status`)).body.following).toBe(true);

    expect((await follow({ following: false })).body).toEqual({ following: false });
    expect((await follow()).body).toEqual({ following: true });   // the old toggle, for older clients
  });
});

describe("the limit on connection requests", () => {
  it("refuses past its own budget, whatever the requests were", async () => {
    const app = await getTestApp();
    const [ari, bea] = [await person(app), await person(app)];
    let last: any;
    for (let i = 0; i <= RATE_LIMITS.connect.max; i++) {
      last = await ari.agent.post("/api/connections/request").send({ userId: bea.id, note: "hello" });
    }
    expect(last.status).toBe(429);
    expect(last.body).toMatchObject({ code: "rate_limited", action: "connect" });
  }, 60_000);
});
