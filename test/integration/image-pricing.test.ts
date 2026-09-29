/**
 * What a picture costs.
 *
 * Images are the most expensive thing in the product per press, and two routes
 * make five of them in one request. They used to be "small actions", which
 * meant a dollar day pass bought unlimited image generation and one small
 * action bought a five-scene storyboard.
 *
 * The rules under test are the ones the product owner set: the first
 * generation for a project is free and so is the first for each badge, after
 * that it is five dollars for a day of them, and the day is capped at fifty an
 * hour so that "unlimited" can never mean a script. Badges stay free to earn
 * and to keep — it is only redrawing their art past the first go that asks.
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
      async writeObjectBuffer() { return "https://files.test/image.png"; }
    },
  };
});

const { getTestApp, closeTestApp } = await import("../helpers/app");
const { verifyEmail } = await import("../helpers/verify-email");
const { db } = await import("../../server/db");
const { users, aiImageRuns } = await import("@shared/schema");
const { eq } = await import("drizzle-orm");
const { OUTCOME_PRICE_CENTS, IMAGE_PASS_HOURLY_LIMIT } = await import("@shared/plans");

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function person(app: any, opts: { balanceCents?: number } = {}) {
  n += 1;
  const ip = `198.51.184.${(n % 200) + 20}`;
  const email = `img-${Date.now()}-${n}@example.test`;
  const agent = request.agent(app);
  const reg = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName: "Im" });
  expect(reg.status, JSON.stringify(reg.body)).toBe(201);
  await verifyEmail(app, email, ip);
  process.env.RATE_LIMIT_EXEMPT_EMAILS = [process.env.RATE_LIMIT_EXEMPT_EMAILS, email].filter(Boolean).join(",");
  if (opts.balanceCents) await db.update(users).set({ balanceCents: opts.balanceCents }).where(eq(users.id, reg.body.id));
  return { agent, id: reg.body.id as string };
}

const postImage = (p: { agent: any }, projectId?: string) =>
  p.agent.post("/api/feed/image").send({ content: "We shipped the thing this week.", ...(projectId ? { projectId } : {}) });

describe("the first pictures are free", () => {
  it("gives an account its free go, then asks for the day of images", async () => {
    const app = await getTestApp();
    const me = await person(app);

    const first = await postImage(me);
    expect(first.status, JSON.stringify(first.body).slice(0, 200)).toBe(200);
    expect(first.body.free, "the first one is the free one").toBe(true);

    // The second is not free, and nothing was charged for being told so.
    const second = await postImage(me);
    expect(second.status).toBe(402);
    expect(second.body.code).toBe("payment_required");
    expect(second.body.outcome).toBe("imagePass");
    expect(second.body.price.cents).toBe(OUTCOME_PRICE_CENTS.imagePass);
    expect(second.body.remedy, "no balance, so the offer is money first").toBe("top_up");
    const [row] = await db.select({ c: users.balanceCents }).from(users).where(eq(users.id, me.id));
    expect(row.c).toBe(0);
  });

  it("counts the free go per project and per badge, not per account", async () => {
    const app = await getTestApp();
    const me = await person(app);
    const project = await me.agent.post("/api/projects").send({
      title: "Pictures", description: "A project that would like some images of itself.",
      category: "saas", goal: "ship_mvp", subcategory: "saas",
    });
    expect(project.status).toBe(200);

    // The account's free go, spent on a post with no project behind it.
    expect((await postImage(me)).status).toBe(200);
    // The project still has its own, because the free go belongs to the thing.
    const onProject = await postImage(me, project.body.id);
    expect(onProject.status, JSON.stringify(onProject.body).slice(0, 200)).toBe(200);
    expect(onProject.body.free).toBe(true);
    // …and now that project has had it.
    expect((await postImage(me, project.body.id)).status).toBe(402);
  });
});

describe("the day of images", () => {
  it("is five dollars, and covers everything for its day", async () => {
    const app = await getTestApp();
    const me = await person(app, { balanceCents: OUTCOME_PRICE_CENTS.imagePass });
    expect((await postImage(me)).status).toBe(200);   // the free one
    expect((await postImage(me)).status).toBe(402);   // and now it asks

    const bought = await me.agent.post("/api/nova/image-pass");
    expect(bought.status, JSON.stringify(bought.body)).toBe(200);
    expect(bought.body.wallet.balanceCents).toBe(0);
    expect(bought.body.wallet.imagePassActive).toBe(true);

    // Unlimited for the day, and it doesn't touch the month's free actions.
    for (let i = 0; i < 3; i++) expect((await postImage(me)).status).toBe(200);
    const wallet = await me.agent.get("/api/nova/wallet");
    expect(wallet.body.wallet.allowanceUsed, "pictures are not small actions").toBe(0);
    expect(wallet.body.wallet.balanceCents, "and the day is bought once").toBe(0);

    // Pressing it again while it runs is not a second charge.
    const again = await me.agent.post("/api/nova/image-pass");
    expect(again.status).toBe(200);
    expect(again.body.alreadyActive).toBe(true);
  });

  it("stops at fifty an hour, because unlimited has to mean unlimited for a person", async () => {
    const app = await getTestApp();
    const me = await person(app, { balanceCents: OUTCOME_PRICE_CENTS.imagePass });
    expect((await postImage(me)).status).toBe(200);
    expect((await me.agent.post("/api/nova/image-pass")).status).toBe(200);

    /*
     * The hour's worth, written straight in rather than drawn: what is under
     * test is the ceiling, not the model.
     */
    await db.insert(aiImageRuns).values({
      userId: me.id, scope: "account", scopeId: me.id, images: IMAGE_PASS_HOURLY_LIMIT, free: false,
    } as any);

    const over = await postImage(me);
    expect(over.status).toBe(429);
    expect(over.body.code).toBe("image_hourly_limit");
    expect(over.body.hourlyLimit).toBe(IMAGE_PASS_HOURLY_LIMIT);
    expect(over.headers["retry-after"], "told when, not just no").toBeTruthy();
  });
});

describe("badges", () => {
  it("are free to have, and their art is free once", async () => {
    const app = await getTestApp();
    const me = await person(app);
    const project = await me.agent.post("/api/projects").send({
      title: "Badged", description: "A project whose backer earned a badge for believing in it.",
      category: "saas", goal: "ship_mvp", subcategory: "saas",
    });
    expect(project.status).toBe(200);
    /*
     * The founder's own badge, which the project made for them on creation —
     * free to have, which is the half of this that does not change.
     */
    const { backerBadges } = await import("@shared/schema");
    const [badge] = await db.select().from(backerBadges).where(eq(backerBadges.projectId, project.body.id));
    expect(badge, "creating a project earns its founder a badge").toBeTruthy();
    expect(badge.userId).toBe(me.id);

    const first = await me.agent.post(`/api/backer-badges/${badge.id}/generate`);
    expect(first.status, JSON.stringify(first.body).slice(0, 200)).toBe(200);
    expect(first.body.free).toBe(true);

    /*
     * This route had no check of any kind before: anyone with a badge could
     * redraw it on a loop for nothing, which is the one unmetered image call
     * that existed.
     */
    const second = await me.agent.post(`/api/backer-badges/${badge.id}/generate`);
    expect(second.status).toBe(402);
    expect(second.body.outcome).toBe("imagePass");
  });
});
