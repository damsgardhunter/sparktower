/**
 * The merch renderer, and who may ask it to draw.
 *
 * Two endpoints render a PNG of a project's branding: a preview for the
 * campaign editor, and the print file Printful fetches. Both are deliberately
 * unauthenticated — Printful is not going to sign in — and that is fine for
 * what they were written to draw.
 *
 * What they were not written to consider is a *private* project. Private
 * projects are the one thing on this site somebody is told is not visible, and
 * the preview reads the projects table by id with no privacy condition at all:
 * given a project id, it renders that project's title and logo for anybody.
 *
 * The second half is cost. Both are GETs, so the global write floor does not
 * see them, and neither carries a limit of its own — while each one composites
 * an image with sharp and lays out text with opentype. On a single instance
 * that also runs the background loops, an unauthenticated loop over either is
 * a cheap way to take the site down.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { projects } from "@shared/schema";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function builder(app: any) {
  n += 1;
  const agent = request.agent(app);
  const ip = `198.51.188.${(n % 200) + 20}`;
  const email = `merch-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName: `M${n}` });
  expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 200)}`).toBe(201);
  await verifyEmail(app, email, ip);
  return { agent, id: res.body.id as string };
}

async function aProject(owner: { agent: any }, title: string) {
  const res = await owner.agent.post("/api/projects").send({
    title, description: "Something the owner is keeping to themselves.",
    category: "saas", goal: "ship_mvp", subcategory: "saas",
  });
  expect(res.status, res.text).toBe(200);
  return res.body.id as string;
}

describe("a private project's branding", () => {
  it("is not rendered into a PNG for a stranger who knows the id", async () => {
    const app = await getTestApp();
    const owner = await builder(app);
    const id = await aProject(owner, "Secret Skunkworks");
    await db.update(projects).set({ isPrivate: true }).where(eq(projects.id, id));

    /*
     * Signed out entirely: the shape an attacker is in. A project id is not a
     * secret — it is in every URL the owner has ever pasted to a collaborator.
     */
    const res = await request(app).get(`/api/projects/${id}/merch/preview.png`);
    expect(
      res.status,
      "a private project's name and logo must not render for a stranger",
    ).toBe(404);
  });

  it("still renders for the owner, who is the person the preview is for", async () => {
    const app = await getTestApp();
    const owner = await builder(app);
    const id = await aProject(owner, "Secret Skunkworks");
    await db.update(projects).set({ isPrivate: true }).where(eq(projects.id, id));

    const res = await owner.agent.get(`/api/projects/${id}/merch/preview.png`);
    expect(res.status, "the owner is editing their own campaign").toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
  });

  it("renders a public project for anybody, which is the whole point", async () => {
    const app = await getTestApp();
    const owner = await builder(app);
    const id = await aProject(owner, "Open Project");

    const res = await request(app).get(`/api/projects/${id}/merch/preview.png`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
  });
});
