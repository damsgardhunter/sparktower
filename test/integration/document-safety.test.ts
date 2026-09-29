/**
 * The document builder and the artifact page, on the things that lose or leak
 * a builder's work.
 *
 * Five failures, each of which had already happened rather than being
 * imagined: a published PDF served to anyone with the link because nothing set
 * an ACL on it; a fill that snapshotted the pages, ran for minutes, and wrote
 * the snapshot back over everything typed meanwhile; a re-plan that carried
 * content across by exact block id and so dropped it whenever the model
 * re-emitted a block without one; a refresh of a live artifact republishing
 * working notes with nobody's say-so; and deleting a document leaving its PDF
 * and its Files row behind.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { verifyEmail } from "../helpers/verify-email";

/**
 * The model, under the test's control. Each test sets `reply` to the JSON it
 * wants back, and may do work of its own first — which is how the concurrent
 * edit in the fill test happens at exactly the moment a fill is mid-flight.
 */
let reply: (prompt: string) => Promise<unknown> | unknown = () => ({ blocks: [] });
vi.mock("openai", () => {
  class OpenAI {
    chat = { completions: { create: async (body: any) => {
      const prompt = (body?.messages ?? []).map((m: any) => m.content).join("\n");
      return { choices: [{ message: { content: JSON.stringify(await reply(prompt)) } }] };
    } } };
    images = { generate: async () => { throw new Error("not in tests"); } };
    static default = OpenAI;
  }
  return { default: OpenAI, OpenAI };
});

const { getTestApp, closeTestApp } = await import("../helpers/app");
const { db } = await import("../../server/db");
const { storage } = await import("../../server/storage");
const { projectFiles, projectMembers, users, pathArtifacts } = await import("@shared/schema");

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function person(app: any, first: string) {
  const agent = request.agent(app);
  n += 1;
  const ip = `198.51.120.${10 + (n % 200)}`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email: `docsafe-${first}-${Date.now()}-${n}@example.test`, password: "Testpass123!", firstName: first });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  await verifyEmail(app, res.body.email, `198.51.121.${10 + (n % 200)}`);
  // A document costs $3; what it costs is not what any of this is about.
  await db.update(users).set({ balanceCents: 100_000 }).where(eq(users.id, res.body.id));
  return { agent, id: res.body.id as string };
}

async function project(who: { agent: any }, title: string, extra: Record<string, unknown> = {}) {
  const res = await who.agent.post("/api/projects").send({
    title, description: "A project that needs a written document and a page about it.",
    category: "saas", goal: "ship_mvp", subcategory: "saas", ...extra,
  });
  expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
  return res.body;
}

const block = (id: string, headline: string, over: Record<string, unknown> = {}) => ({
  id, kind: "text", headline, intent: `Write ${headline}`, content: "", col: 0, row: 0, colSpan: 1, rowSpan: 1, ...over,
});

/** A document straight into storage: the planner is not what these tests are about. */
async function document(projectId: string, userId: string, pages: unknown[], title = "The Plan") {
  return storage.createDocument({
    projectId, createdById: userId, title, kind: "plan", status: "draft",
    outline: [], pages, settings: {},
  } as any);
}

describe("a published document's PDF", () => {
  it("is not readable by a signed-out stranger, and is readable by the project's team", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Owner");
    const mate = await person(app, "Mate");
    const outsider = await person(app, "Outsider");
    const p = await project(owner, `Private Plan ${Date.now()}`, { isPrivate: true });
    // Joined through the table: the membership is the point, not the route that makes it.
    await db.insert(projectMembers).values({ projectId: p.id, userId: mate.id, role: "member" } as any);

    const doc = await document(p.id, owner.id, [{
      id: "page-1", title: "The quiet page", purpose: "", columns: 1, isChapterPage: false,
      blocks: [block("b1", "Runway", { content: "We have eleven months of runway and no term sheet yet." })],
    }]);

    const published = await owner.agent.post(`/api/documents/${doc.id}/publish`).send({ folder: "docs" });
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    const url = published.body.document.pdfUrl as string;
    expect(url).toMatch(/^\/objects\//);

    // The whole point: no account, just the URL.
    const anonymous = await request(app).get(url);
    expect(anonymous.status, "a signed-out request must not get a private project's PDF").toBe(404);

    // Someone signed in who isn't on the project is no better off.
    expect((await outsider.agent.get(url)).status).toBe(404);

    // The team still gets their own file, which is the half that's easy to break.
    const mine = await owner.agent.get(url);
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    const theirs = await mate.agent.get(url);
    expect(theirs.status, "a project member must still be able to download it").toBe(200);
  });
});

describe("deleting a document", () => {
  it("takes its Files row with it and stops serving the PDF", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Deleter");
    const p = await project(owner, `Deleted Doc ${Date.now()}`);
    const doc = await document(p.id, owner.id, [{
      id: "page-1", title: "Goes away", purpose: "", columns: 1, isChapterPage: false,
      blocks: [block("b1", "Body", { content: "Something worth deleting later." })],
    }]);

    const published = await owner.agent.post(`/api/documents/${doc.id}/publish`).send({ folder: "docs" });
    expect(published.status).toBe(200);
    const fileId = published.body.file.id as string;
    const url = published.body.document.pdfUrl as string;
    // While it exists, its own team can read it.
    expect((await owner.agent.get(url)).status).toBe(200);

    expect((await owner.agent.delete(`/api/documents/${doc.id}`)).status).toBe(200);

    // The Files row is gone, not left pointing at a document that isn't there.
    const rows = await db.select().from(projectFiles).where(eq(projectFiles.id, fileId));
    expect(rows).toHaveLength(0);
    expect((await owner.agent.get(`/api/projects/${p.id}/files`)).body.find((f: any) => f.id === fileId)).toBeUndefined();

    // And the stored PDF is no longer readable by anyone, owner included.
    expect((await request(app).get(url)).status).toBe(404);
    expect((await owner.agent.get(url)).status).toBe(404);
  });
});

describe("filling a document", () => {
  it("merges onto the current pages instead of writing back the snapshot it started with", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Filler");
    const p = await project(owner, `Filled Doc ${Date.now()}`);
    const doc = await document(p.id, owner.id, [{
      id: "page-1", title: "One page", purpose: "", columns: 1, isChapterPage: false,
      blocks: [block("b1", "Nova writes this"), block("b2", "The builder types this", { row: 1 })],
    }]);

    /*
     * The builder types into b2 while Nova is writing b1. Done from inside the
     * model call, because that is exactly the window the old code lost: it had
     * already read the pages and would PATCH the whole array back afterwards.
     */
    reply = async () => {
      const current = await storage.getDocument(doc.id);
      const pages = (current!.pages as any[]).map((pg) => ({
        ...pg,
        blocks: pg.blocks.map((b: any) => (b.id === "b2" ? { ...b, content: "Typed by hand during the fill." } : b)),
      }));
      await storage.updateDocument(doc.id, { pages } as any);
      return { blocks: [{ id: "b1", content: "Written by Nova." }] };
    };

    const res = await owner.agent.post(`/api/documents/${doc.id}/fill`).send({ pageIndex: 0 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const after = await storage.getDocument(doc.id);
    const blocks = (after!.pages as any[])[0].blocks as any[];
    expect(blocks.find((b) => b.id === "b1").content).toContain("Written by Nova");
    expect(blocks.find((b) => b.id === "b2").content, "the builder's own typing must survive the fill").toContain("Typed by hand");
  });

  it("caps how many pages one request attempts and says what's left", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Capper");
    const p = await project(owner, `Long Doc ${Date.now()}`);
    const pages = Array.from({ length: 5 }, (_, i) => ({
      id: `page-${i}`, title: `Page ${i}`, purpose: "", columns: 1, isChapterPage: false,
      blocks: [block(`b${i}`, `Section ${i}`)],
    }));
    const doc = await document(p.id, owner.id, pages);

    reply = (prompt: string) => {
      const id = prompt.match(/- id: (b\d)/)?.[1];
      return { blocks: id ? [{ id, content: `Prose for ${id}.` }] : [] };
    };

    const res = await owner.agent.post(`/api/documents/${doc.id}/fill`).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.pagesRemaining, "a single request must not try to write the whole document").toBe(2);
    expect(res.body.nextPageIndex).toBe(3);

    const after = await storage.getDocument(doc.id);
    const written = (after!.pages as any[]).filter((pg) => pg.blocks[0].content.trim()).length;
    expect(written).toBe(3);
  });

  it("remembers which blocks failed so they can be retried on their own", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Failer");
    const p = await project(owner, `Failing Doc ${Date.now()}`);
    const doc = await document(p.id, owner.id, [
      {
        id: "page-0", title: "Works", purpose: "", columns: 1, isChapterPage: false,
        blocks: [block("ok1", "Fine")],
      },
      {
        id: "page-1", title: "Breaks", purpose: "", columns: 1, isChapterPage: false,
        blocks: [block("bad1", "Breaks")],
      },
    ]);

    reply = (prompt: string) => {
      if (prompt.includes("- id: bad1")) throw new Error("the model fell over");
      return { blocks: [{ id: "ok1", content: "This one landed." }] };
    };

    const first = await owner.agent.post(`/api/documents/${doc.id}/fill`).send({});
    expect(first.status).toBe(200);
    expect(first.body.failedBlockIds).toEqual(["bad1"]);
    // It outlives the response: a reload still knows what to retry.
    expect(((await storage.getDocument(doc.id))!.fillFailures as string[])).toEqual(["bad1"]);

    reply = () => ({ blocks: [{ id: "bad1", content: "It worked the second time." }] });
    const retry = await owner.agent.post(`/api/documents/${doc.id}/fill`).send({ retryFailed: true });
    expect(retry.status, JSON.stringify(retry.body)).toBe(200);
    expect(retry.body.failedBlockIds).toEqual([]);
    const after = await storage.getDocument(doc.id);
    expect((after!.pages as any[])[1].blocks[0].content).toContain("second time");
  });
});

describe("restructuring a document", () => {
  const writtenPages = [{
    id: "page-1", title: "Everything", purpose: "", columns: 1, isChapterPage: false,
    blocks: [
      block("keep-me", "The long section", { content: Array.from({ length: 300 }, (_, i) => `word${i}`).join(" ") }),
      block("also-me", "The short section", { row: 1, content: "Twenty words that also matter to whoever wrote them down here in this second block of prose." }),
    ],
  }];

  it("carries content across when the model re-emits a block without its id", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Replanner");
    const p = await project(owner, `Replan Doc ${Date.now()}`);
    const doc = await document(p.id, owner.id, writtenPages);

    // No ids at all, which is what the prompt asks for on new blocks — and
    // what used to make every surviving block look brand new.
    reply = () => ({
      approach: "Same sections, tidier grid.",
      pages: [{
        title: "Everything", purpose: "", columns: 1, isChapterPage: false,
        blocks: [
          { kind: "text", headline: "The long section", intent: "", content: "", col: 0, row: 0, colSpan: 1, rowSpan: 1 },
          { kind: "text", headline: "The short section", intent: "", content: "", col: 0, row: 1, colSpan: 1, rowSpan: 1 },
        ],
      }],
    });

    const res = await owner.agent.post(`/api/documents/${doc.id}/replan`).send({ feedback: "Tidy it up." });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.lostWords).toBe(0);
    const blocks = (res.body.document.pages as any[])[0].blocks as any[];
    expect(blocks[0].content).toContain("word299");
    expect(blocks[1].content).toContain("Twenty words");
  });

  it("refuses a restructure that would drop most of the writing, unless it's confirmed, and can be undone", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Discarder");
    const p = await project(owner, `Discard Doc ${Date.now()}`);
    const doc = await document(p.id, owner.id, writtenPages);
    const creditsUsed = async () => (await owner.agent.get("/api/subscription")).body.creditsUsed as number;

    // Nothing in common with what exists: different headlines, different page.
    reply = () => ({
      approach: "Started again.",
      pages: [{
        title: "A different document", purpose: "", columns: 1, isChapterPage: false,
        blocks: [{ kind: "text", headline: "Something else entirely", intent: "", content: "", col: 0, row: 0, colSpan: 1, rowSpan: 1 }],
      }],
    });

    const before = await creditsUsed();
    const refused = await owner.agent.post(`/api/documents/${doc.id}/replan`).send({ feedback: "Start again." });
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe("replan_discards_content");
    expect(refused.body.lostWords).toBeGreaterThan(200);
    expect(refused.body.lostBlocks.map((b: any) => b.headline)).toContain("The long section");
    // Nothing happened, so nothing was charged and nothing was written.
    expect(await creditsUsed()).toBe(before);
    expect(((await storage.getDocument(doc.id))!.pages as any[])[0].blocks).toHaveLength(2);

    const confirmed = await owner.agent.post(`/api/documents/${doc.id}/replan`).send({ feedback: "Start again.", confirmDiscard: true });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    expect((confirmed.body.document.pages as any[])[0].title).toBe("A different document");

    // And it is not a one-way door.
    const undone = await owner.agent.post(`/api/documents/${doc.id}/undo`).send({});
    expect(undone.status, JSON.stringify(undone.body)).toBe(200);
    const restored = (undone.body.document.pages as any[])[0].blocks as any[];
    expect(restored.find((b) => b.id === "keep-me").content).toContain("word299");
  });
});

describe("refreshing an artifact that is already public", () => {
  it("holds the new text as a draft rather than republishing it, until it's published", async () => {
    const app = await getTestApp();
    const author = await person(app, "Publisher");
    const p = await project(author, `Artifact Doc ${Date.now()}`);
    const tasks = (await author.agent.get(`/api/projects/${p.id}/kanban`)).body;
    const step = tasks.find((t: any) => (t.tags ?? []).includes("backbone:SHIP.M1.1"));
    await author.agent.patch(`/api/kanban/${step.id}`).send({ status: "done", description: "A meal planner for the week ahead." }).expect(200);

    const made = await author.agent.post(`/api/projects/${p.id}/path/tasks/${step.id}/artifact`);
    expect(made.status, JSON.stringify(made.body)).toBe(200);
    await author.agent.post(`/api/artifacts/${made.body.id}/publish`).send({ title: "How we plan a week of dinners" }).expect(200);

    // The builder goes back to the step and pastes something internal into it.
    await author.agent.patch(`/api/kanban/${step.id}`).send({
      description: "A meal planner for the week ahead. INTERNAL: Kate at Bellweather pays 40k, do not say this publicly.",
    }).expect(200);

    // Re-opening the publish dialog re-assembles the artifact. It must not go live.
    const refreshed = await author.agent.post(`/api/projects/${p.id}/path/tasks/${step.id}/artifact`);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.hasDraft).toBe(true);
    expect(refreshed.body.body, "the live body must be untouched by a refresh").not.toMatch(/Bellweather/);
    expect(refreshed.body.draftBody).toMatch(/Bellweather/);

    const live = await request(app).get(`/api/public/artifacts/${made.body.id}`);
    expect(live.status).toBe(200);
    expect(live.body.body, "the public page must not have changed").not.toMatch(/Bellweather/);

    // Publishing is what moves it across — someone has looked at it by then.
    const promoted = await author.agent.post(`/api/artifacts/${made.body.id}/publish`).send({ title: "How we plan a week of dinners" });
    expect(promoted.status, JSON.stringify(promoted.body)).toBe(200);
    expect(promoted.body.promotedDraft).toBe(true);
    const [row] = await db.select().from(pathArtifacts).where(eq(pathArtifacts.id, made.body.id));
    expect(row.body).toMatch(/Bellweather/);
    expect(row.draftAt).toBeNull();
  });

  it("counts one view per visitor, not one per refresh, and offers to remove the post when the page comes down", async () => {
    const app = await getTestApp();
    const author = await person(app, "Counter");
    const p = await project(author, `Counted Doc ${Date.now()}`);
    const tasks = (await author.agent.get(`/api/projects/${p.id}/kanban`)).body;
    const step = tasks.find((t: any) => (t.tags ?? []).includes("backbone:SHIP.M1.1"));
    await author.agent.patch(`/api/kanban/${step.id}`).send({ status: "done", description: "One line about what this product is." }).expect(200);
    const made = (await author.agent.post(`/api/projects/${p.id}/path/tasks/${step.id}/artifact`)).body;
    const pub = await author.agent.post(`/api/artifacts/${made.id}/publish`).send({ title: "The one-line product statement" });
    expect(pub.status, JSON.stringify(pub.body)).toBe(200);

    // One reader, refreshing. The cookie jar is what makes them the same person.
    const reader = request.agent(app);
    for (let i = 0; i < 4; i++) expect((await reader.get(`/api/public/artifacts/${made.id}`)).status).toBe(200);
    const [counted] = await db.select().from(pathArtifacts).where(eq(pathArtifacts.id, made.id));
    expect(counted.views, "refreshing must not inflate the read count").toBe(1);

    // Taking the page down can take the post announcing it with it.
    const down = await author.agent.post(`/api/artifacts/${made.id}/unpublish`).send({ removePost: true });
    expect(down.status, JSON.stringify(down.body)).toBe(200);
    expect(down.body.postId).toBe(pub.body.postId);
    expect(down.body.post).toBe("deleted");
    expect((await author.agent.get(`/api/feed/${pub.body.postId}`)).status).toBe(404);
  });
});
