/**
 * Who may download a certificate, and what they get.
 *
 * It is a claim about a person — "this certifies that X is believer #47 of Y" —
 * so the two things worth pinning are who can mint one and whether the pledge
 * behind it actually settled. A certificate anybody could generate for anybody is
 * worth nothing, and one for a pledge still in flight asserts something that is
 * not yet true.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { projectBackingCampaigns, projectBackings, projects } from "@shared/schema";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function person(app: any, first: string) {
  n += 1;
  const agent = request.agent(app);
  const ip = `198.51.194.${(n % 200) + 20}`;
  const email = `cert-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName: first });
  expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 200)}`).toBe(201);
  await verifyEmail(app, email, ip);
  return { agent, id: res.body.id as string, first };
}

async function campaign(ownerId: string) {
  const [project] = await db.insert(projects).values({
    ownerId, title: `Cert ${++n}`, description: "Something being built.", category: "saas", status: "active",
  } as any).returning();
  await db.insert(projectBackingCampaigns).values({
    projectId: project.id, enabled: true, headline: "Back it", story: "Why.",
    goalCents: 100_000, startedAt: new Date(), reviewStatus: "approved",
  } as any);
  return project;
}

const back = (projectId: string, backerId: string, over: Record<string, unknown> = {}) =>
  db.insert(projectBackings).values({
    projectId, backerId, amountCents: 3_500, status: "released",
    believerNumber: ++n, tierNameAtBacking: "The Shirt", isAnonymous: false, ...over,
  } as any);

describe("downloading your certificate", () => {
  it("gives the backer a PNG, named after the project", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Olive");
    const fan = await person(app, "Fred");
    const project = await campaign(owner.id);
    await back(project.id, fan.id);

    const res = await fan.agent.get(`/api/projects/${project.id}/backing/certificate`);
    expect(res.status, (res.text ?? "").slice(0, 200)).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.headers["content-disposition"]).toContain("certificate.png");
    /* A real PNG, and a substantial one — a blank page would be a few hundred bytes. */
    expect([...res.body.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(res.body.length).toBeGreaterThan(100_000);
  }, 60_000);

  /* Deterministic from the row, which is what lets it be drawn on request rather than stored. */
  it("draws the same file twice", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Omar");
    const fan = await person(app, "Gale");
    const project = await campaign(owner.id);
    await back(project.id, fan.id);

    const url = `/api/projects/${project.id}/backing/certificate`;
    const [a, b] = [await fan.agent.get(url), await fan.agent.get(url)];
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(Buffer.compare(a.body, b.body), "same backing, same certificate").toBe(0);
  }, 60_000);

  it("refuses somebody who never backed it", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Opal");
    const fan = await person(app, "Hana");
    const stranger = await person(app, "Ivo");
    const project = await campaign(owner.id);
    await back(project.id, fan.id);

    const res = await stranger.agent.get(`/api/projects/${project.id}/backing/certificate`);
    expect(res.status, "a certificate is a claim about a person").toBe(404);
  });

  /* A pledge that never settled is not a backing, so it certifies nothing. */
  it("refuses a pledge that did not go through", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Otto");
    const fan = await person(app, "Jun");
    const project = await campaign(owner.id);
    await back(project.id, fan.id, { status: "failed" });

    expect((await fan.agent.get(`/api/projects/${project.id}/backing/certificate`)).status).toBe(404);
  });

  it("needs a session", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Oona");
    const project = await campaign(owner.id);
    const res = await request(app).get(`/api/projects/${project.id}/backing/certificate`);
    expect(res.status).toBe(401);
  });

  /*
   * An anonymous backer's own copy carries their name. Anonymity is a choice
   * about the public wall; this file is theirs and nobody else can fetch it, so
   * withholding their name here would be honouring the flag in the one place it
   * was never about.
   */
  it("still names an anonymous backer on their own copy", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Osmo");
    const shy = await person(app, "Quinn");
    const project = await campaign(owner.id);
    await back(project.id, shy.id, { isAnonymous: true });

    const res = await shy.agent.get(`/api/projects/${project.id}/backing/certificate`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(100_000);
  }, 60_000);
});
