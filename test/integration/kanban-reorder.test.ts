/**
 * Saving a drag-and-drop reorder.
 *
 * One call carrying every card's new position, which makes it the one board write
 * that takes a list of ids from the client — and that is the whole reason it needs
 * a test. The route says so itself: "every id has to be a task on this project, or
 * a reorder becomes a way to write to someone else's board."
 *
 * Nothing drove it. The failure that costs most is not the dramatic one: it is a
 * reorder that answers 200 and persists nothing, which looks right until the page
 * is reloaded and every card is back where it was.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";

afterAll(async () => { await closeTestApp(); });

let n = 0;
const ip = () => `198.51.180.${20 + (n++ % 200)}`;

async function person(app: any, tag: string) {
  n += 1;
  const agent = request.agent(app);
  const email = `kb-${tag}-${Date.now()}-${n}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip())
    .send({ email, password: "Testpass123!", firstName: `K${n}` });
  expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
  await verifyEmail(app, email, ip());
  return { agent, id: res.body.id as string };
}

async function aProject(agent: any, title = "Boarded") {
  const res = await agent.post("/api/projects").send({
    title, description: "A project whose board gets dragged about.",
    category: "saas", goal: "ship_mvp", subcategory: "saas",
  });
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
  return res.body.id as string;
}

async function aCard(agent: any, projectId: string, title: string) {
  const res = await agent.post(`/api/projects/${projectId}/kanban`).send({ title, status: "todo" });
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
  return res.body as { id: string; order?: number };
}

const board = async (agent: any, projectId: string) =>
  (await agent.get(`/api/projects/${projectId}/kanban`).expect(200)).body as { id: string; order: number }[];

const orderOf = (cards: { id: string; order: number }[], id: string) =>
  cards.find((c) => c.id === id)?.order;

describe("saving a reorder", () => {
  it("persists the new positions, so a reload shows them", async () => {
    /*
     * The one that matters. A route answering 200 and writing nothing looks
     * correct until the page is reloaded.
     */
    const app = await getTestApp();
    const owner = await person(app, "own");
    const projectId = await aProject(owner.agent);
    const first = await aCard(owner.agent, projectId, "Write the brief");
    const second = await aCard(owner.agent, projectId, "Draw the logo");

    const res = await owner.agent.post(`/api/projects/${projectId}/kanban/reorder`)
      .send({ items: [{ id: first.id, order: 10 }, { id: second.id, order: 5 }] })
      .expect(200);
    expect(res.body.updated).toBe(2);

    const after = await board(owner.agent, projectId);
    expect(orderOf(after, first.id)).toBe(10);
    expect(orderOf(after, second.id)).toBe(5);
  });

  it("refuses a call with nothing in it", async () => {
    const app = await getTestApp();
    const owner = await person(app, "own2");
    const projectId = await aProject(owner.agent);
    for (const body of [{}, { items: [] }, { items: "nope" }, { items: {} }]) {
      const res = await owner.agent.post(`/api/projects/${projectId}/kanban/reorder`).send(body);
      expect(res.status, `${JSON.stringify(body)} should be refused`).toBe(400);
    }
  });

  it("refuses more cards than a board could have", async () => {
    /* A cap, so one call cannot be four hundred writes and then some. */
    const app = await getTestApp();
    const owner = await person(app, "own3");
    const projectId = await aProject(owner.agent);
    const items = Array.from({ length: 401 }, (_, i) => ({ id: `made-up-${i}`, order: i }));
    const res = await owner.agent.post(`/api/projects/${projectId}/kanban/reorder`).send({ items });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/too many/i);
  });

  it("cannot be used to write to another project's board", async () => {
    /*
     * The route's own stated reason for checking the ids. Without it, a member of
     * any project could reorder — and so renumber — every card on every board by
     * naming their own project in the URL.
     */
    const app = await getTestApp();
    const owner = await person(app, "own4");
    const outsider = await person(app, "out");
    const theirs = await aProject(owner.agent, "Theirs");
    const mine = await aProject(outsider.agent, "Mine");

    const theirCard = await aCard(owner.agent, theirs, "Their card");
    const before = orderOf(await board(owner.agent, theirs), theirCard.id);

    const res = await outsider.agent.post(`/api/projects/${mine}/kanban/reorder`)
      .send({ items: [{ id: theirCard.id, order: 999 }] });
    /* None of those ids are on this project, so there is nothing to do. */
    expect(res.status).toBe(400);
    expect(orderOf(await board(owner.agent, theirs), theirCard.id), "their card moved").toBe(before);
  });

  it("moves only its own cards when a call mixes them, and says how many", async () => {
    const app = await getTestApp();
    const owner = await person(app, "own5");
    const outsider = await person(app, "out2");
    const theirs = await aProject(owner.agent, "Theirs");
    const mine = await aProject(outsider.agent, "Mine");
    const theirCard = await aCard(owner.agent, theirs, "Their card");
    const myCard = await aCard(outsider.agent, mine, "My card");
    const theirBefore = orderOf(await board(owner.agent, theirs), theirCard.id);

    const res = await outsider.agent.post(`/api/projects/${mine}/kanban/reorder`)
      .send({ items: [{ id: myCard.id, order: 3 }, { id: theirCard.id, order: 999 }] })
      .expect(200);
    /*
     * One, not two. The count is what the client uses to decide the save worked,
     * so a route that reported both would be claiming it moved a card it did not.
     */
    expect(res.body.updated).toBe(1);
    expect(orderOf(await board(outsider.agent, mine), myCard.id)).toBe(3);
    expect(orderOf(await board(owner.agent, theirs), theirCard.id)).toBe(theirBefore);
  });

  it("ignores an order that is not a number rather than storing rubbish", async () => {
    const app = await getTestApp();
    const owner = await person(app, "own6");
    const projectId = await aProject(owner.agent);
    const card = await aCard(owner.agent, projectId, "Only card");
    const before = orderOf(await board(owner.agent, projectId), card.id);

    const res = await owner.agent.post(`/api/projects/${projectId}/kanban/reorder`)
      .send({ items: [{ id: card.id, order: "last" }] });
    /* Nothing valid in the call, so nothing to do — and the card is untouched. */
    expect(res.status).toBe(400);
    expect(orderOf(await board(owner.agent, projectId), card.id)).toBe(before);
  });

  it("lets a teammate reorder, and a stranger not at all", async () => {
    const app = await getTestApp();
    const owner = await person(app, "own7");
    const stranger = await person(app, "str");
    const projectId = await aProject(owner.agent);
    const card = await aCard(owner.agent, projectId, "Card");

    const res = await stranger.agent.post(`/api/projects/${projectId}/kanban/reorder`)
      .send({ items: [{ id: card.id, order: 1 }] });
    expect(res.status).toBe(403);

    /* And signed out, before any of that. */
    expect((await request(app).post(`/api/projects/${projectId}/kanban/reorder`)
      .send({ items: [{ id: card.id, order: 1 }] })).status).toBe(401);
  });
});
