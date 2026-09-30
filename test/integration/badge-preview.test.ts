/**
 * The badge preview a creator looks at before anyone has pledged.
 *
 * `POST /api/projects/:id/backing/badge-preview` had no test, and it reaches
 * `openai.images.edit` on every press. Its own comment records that it used to
 * have no gate at all — "the badge preview was the one picture nobody paid
 * for" — so the metering is the thing most worth holding here, and the shape
 * of the failure if it slips is somebody's OpenAI bill rather than a broken
 * screen.
 *
 * The pricing *rules* — first go free per project, then the image pass, capped
 * per hour and per day — belong to `image-pricing.test.ts` and are not
 * restated. What this file adds is the route's own behaviour: who may ask, what
 * it does with a level it does not know, where the result is cached, and the
 * order those checks happen in.
 *
 * That last one matters more than it looks. Validation runs before metering,
 * so a creator who sends a typo gets a 400 and still has their free image. If
 * that order were swapped a mistyped level would cost them the one free go on
 * the project, and they would never be told why.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";

vi.mock("openai", () => {
  const png = { data: [{ b64_json: Buffer.from("not-really-a-png").toString("base64") }] };
  class OpenAI {
    chat = { completions: { create: async () => ({ choices: [{ message: { content: "[]" } }] }) } };
    images = { generate: async () => png, edit: async () => png };
    static default = OpenAI;
  }
  return { default: OpenAI, OpenAI };
});

vi.mock("../../server/objectStorage", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    ObjectStorageService: class {
      async writeObjectBuffer() { return "https://files.test/badge.png"; }
    },
  };
});

const { getTestApp, closeTestApp } = await import("../helpers/app");
const { verifyEmail } = await import("../helpers/verify-email");
const { db } = await import("../../server/db");
const { projectBackingCampaigns } = await import("@shared/schema");
const { eq } = await import("drizzle-orm");

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function person(app: any) {
  n += 1;
  const ip = `198.51.186.${(n % 200) + 20}`;
  const email = `badge-${Date.now()}-${n}@example.test`;
  const agent = request.agent(app);
  const reg = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName: "Bd" });
  expect(reg.status, JSON.stringify(reg.body)).toBe(201);
  await verifyEmail(app, email, ip);
  /* The route is on the shared AI burst limit; this file presses it repeatedly. */
  process.env.RATE_LIMIT_EXEMPT_EMAILS = [process.env.RATE_LIMIT_EXEMPT_EMAILS, email].filter(Boolean).join(",");
  return { agent, id: reg.body.id as string };
}

async function aProject(agent: any) {
  const res = await agent.post("/api/projects").send({
    title: "Badged", description: "A project used to check what a badge preview costs and who may ask for one.",
    category: "saas", goal: "ship_mvp", subcategory: "saas",
  });
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
  return res.body.id as string;
}

const preview = (agent: any, projectId: string, level?: string) =>
  agent.post(`/api/projects/${projectId}/backing/badge-preview`).send(level === undefined ? {} : { level });

const previewsOf = async (projectId: string) =>
  ((await db.select().from(projectBackingCampaigns).where(eq(projectBackingCampaigns.projectId, projectId)))[0]
    ?.badgePreviews ?? {}) as Record<string, string>;

describe("previewing a backer's badge", () => {
  it("draws one for the owner and remembers it against the level", async () => {
    const app = await getTestApp();
    const creator = await person(app);
    const projectId = await aProject(creator.agent);

    const res = await preview(creator.agent, projectId, "gold");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.level).toBe("gold");
    expect(res.body.imageUrl, "a stored path came back").toBeTruthy();

    const cached = await previewsOf(projectId);
    expect(cached.gold, "cached on the campaign, because each press costs a model call").toBe(res.body.imageUrl);
  }, 180_000);

  /*
   * The metering, asked as one question: is there a gate at all? The rules
   * behind the gate are `image-pricing.test.ts`'s business. What must never
   * come back is a second free picture.
   */
  it("is metered, so the second one asks to be paid for", async () => {
    const app = await getTestApp();
    const creator = await person(app);
    const projectId = await aProject(creator.agent);

    expect((await preview(creator.agent, projectId, "bronze")).status, "the first go on a project is free").toBe(200);

    const second = await preview(creator.agent, projectId, "silver");
    expect(second.status, "the second picture is not free").toBe(402);
    expect((await previewsOf(projectId)).silver, "and nothing was drawn or cached for it").toBeUndefined();
  }, 180_000);

  /*
   * A typo must not cost the free image. This asserts the order of the two
   * checks by spending the refusal first and then the free go.
   */
  it("refuses a level it doesn't know without spending the free image on it", async () => {
    const app = await getTestApp();
    const creator = await person(app);
    const projectId = await aProject(creator.agent);

    /* Not "": `level || "bronze"` makes an empty value the default, which the test below covers. */
    for (const bad of ["diamond", "Bronze", "1"]) {
      const res = await preview(creator.agent, projectId, bad);
      expect(res.status, `"${bad}" is not a badge level`).toBe(400);
    }
    expect(Object.keys(await previewsOf(projectId)), "no picture was cached for any of them").toEqual([]);

    /* The free go survived every one of those refusals. */
    expect((await preview(creator.agent, projectId, "platinum")).status, "the typos did not cost the free image").toBe(200);
  }, 180_000);

  it("defaults to bronze when no level is named", async () => {
    const app = await getTestApp();
    const creator = await person(app);
    const projectId = await aProject(creator.agent);
    const res = await preview(creator.agent, projectId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.level).toBe("bronze");
  }, 180_000);

  it("is the owner's to ask for, and needs an account at all", async () => {
    const app = await getTestApp();
    const creator = await person(app);
    const stranger = await person(app);
    const projectId = await aProject(creator.agent);

    const byStranger = await preview(stranger.agent, projectId, "bronze");
    expect(byStranger.status).toBe(403);
    expect(Object.keys(await previewsOf(projectId)), "a stranger drew nothing").toEqual([]);

    const signedOut = await request(app).post(`/api/projects/${projectId}/backing/badge-preview`)
      .set("x-forwarded-for", "198.51.186.250").send({ level: "bronze" });
    expect(signedOut.status).toBe(401);
  }, 180_000);
});
