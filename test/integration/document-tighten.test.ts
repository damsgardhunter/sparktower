/**
 * Making a page fit on one printed page.
 *
 * `POST /api/documents/:docId/tighten` had no test. It is the route that
 * rewrites a builder's own words, in place, with a model — the most destructive
 * thing the document builder does — and three of its properties are the kind
 * that hold until somebody edits the function and then quietly do not.
 *
 *   - **It refuses when there is nothing to do.** The overflow is measured from
 *     a real render, not guessed, and a document that already fits gets a 400
 *     before the model is reached. A version that asked anyway would spend a
 *     model call, and rewrite prose that was fine, every time somebody pressed
 *     a button that should have been inert.
 *   - **A failed rewrite changes nothing.** If the model cannot shorten the
 *     page it answers 502 and the document must be exactly as it was. The
 *     alternative — saving a partial pass — loses the builder's words in the
 *     one operation they cannot undo by retyping, because the original is gone.
 *   - **`pageIndex` means that page.** Tightening one page must not quietly
 *     rewrite the rest of the document, which is what happens if the filter
 *     stops being applied to the render map.
 *
 * The model is under the test's control and returns the shape the route parses,
 * `{ blocks: [{ id, content }] }`. The rendering, the measurement, the loop and
 * the save are the route's own and run for real.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { verifyEmail } from "../helpers/verify-email";

/** What the model says, and how many times it was asked. */
let reply: (prompt: string) => unknown = () => ({ blocks: [] });
let asked = 0;
vi.mock("openai", () => {
  class OpenAI {
    chat = { completions: { create: async (body: any) => {
      asked += 1;
      const prompt = (body?.messages ?? []).map((m: any) => m.content).join("\n");
      return { choices: [{ message: { content: JSON.stringify(reply(prompt)) } }] };
    } } };
    images = { generate: async () => { throw new Error("not in tests"); } };
    static default = OpenAI;
  }
  return { default: OpenAI, OpenAI };
});

const { getTestApp, closeTestApp } = await import("../helpers/app");
const { db } = await import("../../server/db");
const { storage } = await import("../../server/storage");
const { users } = await import("@shared/schema");

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function person(app: any) {
  const agent = request.agent(app);
  n += 1;
  const ip = `198.51.124.${10 + (n % 200)}`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email: `tighten-${Date.now()}-${n}@example.test`, password: "Testpass123!", firstName: "Ti" });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  await verifyEmail(app, res.body.email, ip);
  await db.update(users).set({ balanceCents: 100_000 }).where(eq(users.id, res.body.id));
  return { agent, id: res.body.id as string };
}

async function project(who: { agent: any }) {
  const res = await who.agent.post("/api/projects").send({
    title: `Tightened ${Date.now()}-${n}`, description: "A project with a document whose pages run long.",
    category: "saas", goal: "ship_mvp", subcategory: "saas",
  });
  expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
  return res.body;
}

const block = (id: string, content: string) => ({
  id, kind: "text", headline: "A section", intent: "Say the thing", content,
  col: 0, row: 0, colSpan: 1, rowSpan: 1,
});

const page = (id: string, content: string) => ({
  id, title: "The long page", purpose: "Carry the detail", columns: 1, isChapterPage: false,
  blocks: [block(`${id}-blk`, content)],
});

/*
 * Comfortably more than one printed page — the "already fits" test above is
 * what makes that claim checkable rather than assumed.
 *
 * Kept under 20,000 characters on purpose. `normalizePage` clamps a block's
 * content at that, and every save runs through it, so a longer fixture comes
 * back truncated and the test reads as a scope bug when it is only an
 * unrealistic page: 20,000 characters is over three thousand words in one
 * block, which no real document page holds.
 */
const LONG = Array.from({ length: 150 }, (_, i) =>
  `Sentence ${i} carries a specific decision, a number like ${i * 37}, and a constraint that must survive editing.`).join(" ");
const SHORT = "One short line that fits.";

const doc = (projectId: string, userId: string, pages: unknown[]) =>
  storage.createDocument({
    projectId, createdById: userId, title: "The Plan", kind: "plan", status: "draft",
    outline: [], pages, settings: {},
  } as any);

const pagesOf = async (id: string) => ((await storage.getDocument(id))?.pages ?? []) as any[];

describe("tightening a document that already fits", () => {
  it("refuses, and never reaches the model", async () => {
    const app = await getTestApp();
    const owner = await person(app);
    const p = await project(owner);
    const d = await doc(p.id, owner.id, [page("page-1", SHORT)]);
    asked = 0;

    const res = await owner.agent.post(`/api/documents/${d.id}/tighten`).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(String(res.body.message)).toMatch(/overflow|already fits/i);
    expect(asked, "a document that fits costs nothing to leave alone").toBe(0);
    expect((await pagesOf(d.id))[0].blocks[0].content, "and the words are untouched").toBe(SHORT);
  }, 300_000);
});

describe("tightening a page that runs over", () => {
  it("shortens it and saves what the model gave back", async () => {
    const app = await getTestApp();
    const owner = await person(app);
    const p = await project(owner);
    const d = await doc(p.id, owner.id, [page("page-1", LONG)]);

    asked = 0;
    reply = () => ({ blocks: [{ id: "page-1-blk", content: SHORT }] });
    const res = await owner.agent.post(`/api/documents/${d.id}/tighten`).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(asked, "the model was asked, which is what makes the fixture long enough to be a test").toBeGreaterThan(0);
    expect((await pagesOf(d.id))[0].blocks[0].content, "the saved page is the shortened one").toBe(SHORT);
  }, 300_000);

  /*
   * The one that matters most. A rewrite the model could not do must leave the
   * original alone — there is no undo for prose the server replaced with a
   * half-finished pass.
   */
  it("leaves the document exactly as it was when the model can't shorten it", async () => {
    const app = await getTestApp();
    const owner = await person(app);
    const p = await project(owner);
    const d = await doc(p.id, owner.id, [page("page-1", LONG)]);
    const before = await pagesOf(d.id);

    asked = 0;
    reply = () => ({ blocks: [] }); // nothing it can cut
    const res = await owner.agent.post(`/api/documents/${d.id}/tighten`).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(502);
    expect(asked).toBeGreaterThan(0);
    expect(await pagesOf(d.id), "a failed tighten is not a partial save").toEqual(before);
  }, 300_000);

  it("confines itself to the page it was given", async () => {
    const app = await getTestApp();
    const owner = await person(app);
    const p = await project(owner);
    const d = await doc(p.id, owner.id, [page("page-1", LONG), page("page-2", LONG)]);

    asked = 0;
    reply = () => ({ blocks: [{ id: "page-1-blk", content: SHORT }, { id: "page-2-blk", content: SHORT }] });
    const res = await owner.agent.post(`/api/documents/${d.id}/tighten`).send({ pageIndex: 0 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const after = await pagesOf(d.id);
    expect(after[0].blocks[0].content, "the page asked for was shortened").toBe(SHORT);
    expect(after[1].blocks[0].content, "the page that was not asked for kept every word").toBe(LONG);
  }, 300_000);
});

describe("who may rewrite somebody's document", () => {
  it("nobody outside the project, and nobody signed out", async () => {
    const app = await getTestApp();
    const owner = await person(app);
    const stranger = await person(app);
    const p = await project(owner);
    const d = await doc(p.id, owner.id, [page("page-1", LONG)]);

    asked = 0;
    reply = () => ({ blocks: [{ id: "page-1-blk", content: SHORT }] });

    const byStranger = await stranger.agent.post(`/api/documents/${d.id}/tighten`).send({});
    expect([403, 404], `a stranger got ${byStranger.status}`).toContain(byStranger.status);

    const signedOut = await request(app).post(`/api/documents/${d.id}/tighten`)
      .set("x-forwarded-for", "198.51.124.251").send({});
    expect(signedOut.status).toBe(401);

    expect(asked, "neither of them reached the model").toBe(0);
    expect((await pagesOf(d.id))[0].blocks[0].content, "and the document is as its owner left it").toBe(LONG);
  }, 300_000);
});
