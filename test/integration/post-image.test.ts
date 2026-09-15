/**
 * An image for a feed post: drawn from the post first, the project's logo and
 * brief second (only for a project the author is on), charged only when an
 * image comes back, and handed back as an upload the composer attaches.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";

const calls: { kind: "edit" | "generate"; prompt: string; images: number }[] = [];
let fail = false;
vi.mock("openai", () => {
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201ff9c6a2a0000000049454e44ae426082", "hex").toString("base64");
  class OpenAI {
    images = {
      generate: async (body: any) => { calls.push({ kind: "generate", prompt: body.prompt, images: 0 }); if (fail) return { data: [] }; return { data: [{ b64_json: png }] }; },
      edit: async (body: any) => { calls.push({ kind: "edit", prompt: body.prompt, images: (body.image ?? []).length }); return { data: [{ b64_json: png }] }; },
    };
    chat = { completions: { create: async () => ({ choices: [{ message: { content: "{}" } }] }) } };
    responses = { create: async () => ({ output_text: "{}", output: [] }) };
    static default = OpenAI;
  }
  return { default: OpenAI, OpenAI, toFile: async (buf: Buffer, name: string) => ({ buf, name }) };
});

const { getTestApp, closeTestApp } = await import("../helpers/app");
const { db } = await import("../../server/db");
const { users, projects } = await import("@shared/schema");
const { eq } = await import("drizzle-orm");
const { ObjectStorageService } = await import("../../server/replit_integrations/object_storage");
afterAll(async () => { await closeTestApp(); });

async function person(app: any, first: string, ip: string) {
  const agent = request.agent(app);
  const email = `img-${first}-${Date.now()}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip).send({ email, password: "Testpass123!", firstName: first });
  expect(res.status).toBe(201);
  return { agent, id: res.body.id as string, email };
}
const credits = async (agent: any) => (await agent.get("/api/subscription")).body?.creditsUsed ?? (await agent.get("/api/auth/user")).body?.creditsUsed;

describe("post images", () => {
  it("draws the post first and the logo second, charges only for an image, and keeps other people's logos out", async () => {
    const app = await getTestApp();
    const me = await person(app, "Poster", "203.0.113.201");
    const other = await person(app, "Other", "203.0.113.202");
    await db.update(users).set({ subscriptionTier: "pro" }).where(eq(users.id, me.id));

    // Too short to draw.
    expect((await me.agent.post("/api/feed/image").send({ content: "hi" })).status).toBe(400);

    // No project: the post alone, generated — and charged once it comes back.
    const start = await credits(me.agent);
    calls.length = 0;
    const plain = await me.agent.post("/api/feed/image").send({ content: "We just crossed 1,000 people on the waitlist this morning.", postType: "milestone" });
    expect(plain.status, JSON.stringify(plain.body)).toBe(200);
    expect(plain.body).toMatchObject({ usedLogo: false, creditsCharged: 2 });
    expect(plain.body.url).toMatch(/^\/objects\//);
    expect(await credits(me.agent)).toBe(start + 2);
    expect(calls).toHaveLength(1);
    expect(calls[0].kind).toBe("generate");
    expect(calls[0].prompt).toMatch(/THE POST IS THE MAIN SUBJECT/);
    expect(calls[0].prompt).toContain("1,000 people on the waitlist");
    expect(calls[0].prompt).not.toMatch(/logo/i);

    // On a project with a logo: an edit with the logo as the one reference, framed as secondary, brief included.
    const project = (await me.agent.post("/api/projects").send({ title: "Waitlist Rocket", description: "Launch pages that turn visitors into a waitlist.", category: "saas", goal: "ship_mvp", subcategory: "saas", oneLiner: "Waitlists that convert" })).body;
    const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001", "hex");
    const logoUrl = await new ObjectStorageService().writeObjectBuffer(png, "image/png");
    await db.update(projects).set({ logoUrl }).where(eq(projects.id, project.id));
    calls.length = 0;
    const withLogo = await me.agent.post("/api/feed/image").send({ content: "Shipped the new referral screen for our waitlist.", projectId: project.id });
    expect(withLogo.status, JSON.stringify(withLogo.body)).toBe(200);
    expect(withLogo.body.usedLogo).toBe(true);
    expect(calls[0]).toMatchObject({ kind: "edit", images: 1 });
    expect(calls[0].prompt).toMatch(/logo\. It is SECONDARY/);
    expect(calls[0].prompt.indexOf("THE POST IS THE MAIN SUBJECT")).toBeLessThan(calls[0].prompt.indexOf("logo"));
    expect(calls[0].prompt).toContain("Waitlists that convert");

    // Someone else's project: refused before any model call.
    calls.length = 0;
    await db.update(users).set({ subscriptionTier: "pro" }).where(eq(users.id, other.id));
    expect((await other.agent.post("/api/feed/image").send({ content: "Borrowing a logo that isn't mine for this.", projectId: project.id })).status).toBe(403);
    expect(calls).toHaveLength(0);

    // An empty answer from the model: 502, nothing charged.
    const before = await credits(me.agent);
    expect(typeof before).toBe("number");
    fail = true;
    const empty = await me.agent.post("/api/feed/image").send({ content: "This one the model will return nothing for." });
    fail = false;
    expect(empty.status).toBe(502);
    expect(await credits(me.agent)).toBe(before);
  });
});
