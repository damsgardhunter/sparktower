/**
 * Featured tools, through the API: the feed gets the catalog with what admins
 * set, minus the hidden ones; an offer appears only with a referral link; only
 * admins can change them, and bad links are refused; the browser's promo events
 * are recorded with nothing but their three properties.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { activityEvents, users } from "@shared/schema";
import { PROMOTION_CATALOG } from "@shared/promotions";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function person(app: any, role?: "admin") {
  const agent = request.agent(app);
  n += 1;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.104.${10 + n}`).send({ email: `promo-${Date.now()}-${n}@example.test`, password: "Testpass123!" });
  expect(res.status).toBe(201);
  if (role) await db.update(users).set({ platformRole: role }).where(eq(users.id, res.body.id));
  return { agent, id: res.body.id as string };
}

describe("featured tools", () => {
  it("serves the catalog to signed-in people, lets only admins change it, and shows offers only with a referral link", async () => {
    const app = await getTestApp();
    expect((await request(app).get("/api/promotions")).status).toBe(401);
    const viewer = await person(app);
    const admin = await person(app, "admin");

    const first = (await viewer.agent.get("/api/promotions")).body.promotions as any[];
    expect(first.length).toBe(PROMOTION_CATALOG.length);
    expect(first.find((p) => p.id === "replit")).toMatchObject({ name: "Replit", url: "https://replit.com", videoUrl: null, referralUrl: null, offer: null });

    // Not an admin: the route doesn't exist.
    expect((await viewer.agent.put("/api/admin/promotions/replit").send({ referralUrl: "https://replit.com/refer/x" })).status).toBe(404);
    expect((await viewer.agent.get("/api/admin/promotions")).status).toBe(404);

    // Bad links are refused; unknown companies too.
    expect((await admin.agent.put("/api/admin/promotions/replit").send({ videoUrl: "https://evil.test/page" })).body).toMatchObject({ field: "videoUrl" });
    expect((await admin.agent.put("/api/admin/promotions/replit").send({ referralUrl: "javascript:alert(1)" })).body).toMatchObject({ field: "referralUrl" });
    expect((await admin.agent.put("/api/admin/promotions/not-a-company").send({})).status).toBe(404);

    const saved = await admin.agent.put("/api/admin/promotions/replit").send({ headline: "Agent 3 builds and tests your app", videoUrl: "https://youtu.be/dQw4w9WgXcQ", referralUrl: "https://replit.com/refer/sparktower" });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.promotion.promotion).toMatchObject({ headline: "Agent 3 builds and tests your app", offer: "$10 in credits", referralUrl: "https://replit.com/refer/sparktower" });
    await admin.agent.put("/api/admin/promotions/cursor").send({ active: false }).expect(200);
    // Saving again updates the same row.
    await admin.agent.put("/api/admin/promotions/replit").send({ headline: "Agent 3 builds and tests your app", videoUrl: "https://youtu.be/dQw4w9WgXcQ", referralUrl: "https://replit.com/refer/sparktower", perk: "$10 of credit" }).expect(200);

    const feed = (await viewer.agent.get("/api/promotions")).body.promotions as any[];
    expect(feed.some((p) => p.id === "cursor")).toBe(false);
    expect(feed.find((p) => p.id === "replit")).toMatchObject({ videoUrl: "https://youtu.be/dQw4w9WgXcQ", offer: "$10 of credit" });
    const everything = (await admin.agent.get("/api/admin/promotions")).body.promotions as any[];
    expect(everything.find((r) => r.promotion.id === "cursor")).toMatchObject({ active: false });
  });

  it("records the browser's promo events with only their three properties, and drops unknown companies", async () => {
    const app = await getTestApp();
    const viewer = await person(app);
    await viewer.agent.post("/api/track").send({ events: [
      { name: "promo.click", path: "/", props: { promotionId: "vercel", slot: 1, referral: false, email: "leak@example.test" } },
      { name: "promo.impression", path: "/", props: { promotionId: "not-a-company", slot: 0 } },
    ] }).expect(202);
    await new Promise((r) => setTimeout(r, 400));
    const rows = await db.select().from(activityEvents).where(and(eq(activityEvents.userId, viewer.id), sql`${activityEvents.name} like 'promo.%'`));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "promo.click", props: { promotionId: "vercel", slot: 1, referral: false } });
  });
});

describe("reading logos and videos from a company's own pages", () => {
  it("stores the logo and an embeddable launch video, serves the logo from here, and lets an admin's values win", async () => {
    const app = await getTestApp();
    const { syncPromotion } = await import("../../server/promotion-sync");
    const { promotionSettings, promotionSources } = await import("@shared/schema");
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(400, 1)]);
    const pages: Record<string, { status?: number; type?: string; body: string | Buffer }> = {
      "https://supabase.com": { body: `<link rel="apple-touch-icon" href="/touch.png" sizes="180x180"><a href="https://youtube.com/c/supabase">YouTube</a>` },
      "https://supabase.com/touch.png": { type: "image/png", body: png },
      "https://www.youtube.com/c/supabase": { body: `{"externalId":"UCNTVzV1InxHV-YR0fSajqPQ"}` },
      "https://www.youtube.com/feeds/videos.xml?channel_id=UCNTVzV1InxHV-YR0fSajqPQ": { body: `<feed><entry><yt:videoId>bbbbbbbbbb1</yt:videoId><title>Not embeddable launch</title><published>${new Date().toISOString()}</published></entry><entry><yt:videoId>bbbbbbbbbb2</yt:videoId><title>Introducing Branching</title><published>${new Date().toISOString()}</published></entry></feed>` },
      [`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent("https://www.youtube.com/watch?v=bbbbbbbbbb1")}`]: { status: 401, body: "Unauthorized" },
      [`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent("https://www.youtube.com/watch?v=bbbbbbbbbb2")}`]: { body: "{}" },
    };
    const requested: string[] = [];
    const fetcher = async (url: string) => {
      requested.push(url);
      const p = pages[url];
      return { ok: !!p && (p.status ?? 200) < 400, status: p?.status ?? 404, url, contentType: p?.type ?? "text/html", body: Buffer.isBuffer(p?.body) ? p!.body as Buffer : Buffer.from(String(p?.body ?? "")) };
    };

    expect(await syncPromotion("supabase", fetcher)).toMatchObject({ logo: true, videoId: "bbbbbbbbbb2", error: null });
    const viewer = await person(app);
    const supabase = ((await viewer.agent.get("/api/promotions")).body.promotions as any[]).find((p) => p.id === "supabase");
    expect(supabase).toMatchObject({ videoUrl: "https://www.youtube.com/watch?v=bbbbbbbbbb2", headline: "Introducing Branching", logoUrl: expect.stringMatching(/^\/api\/promotions\/supabase\/logo\?v=\d+$/) });
    const logo = await request(app).get("/api/promotions/supabase/logo");
    expect(logo.status).toBe(200);
    expect(logo.headers["content-type"]).toBe("image/png");
    expect(logo.headers["x-content-type-options"]).toBe("nosniff");
    expect(Buffer.compare(logo.body, png)).toBe(0);
    expect((await request(app).get("/api/promotions/vercel/logo")).status).toBe(404);

    // An admin's video and headline win over the synced ones.
    const admin = await person(app, "admin");
    await admin.agent.put("/api/admin/promotions/supabase").send({ videoUrl: "https://youtu.be/dQw4w9WgXcQ", headline: "Our pick" }).expect(200);
    expect(((await viewer.agent.get("/api/promotions")).body.promotions as any[]).find((p) => p.id === "supabase")).toMatchObject({ videoUrl: "https://youtu.be/dQw4w9WgXcQ", headline: "Our pick" });

    // A guessed channel is used only when its page links the company's domain.
    const guessPages: Record<string, string> = {
      "https://posthog.com": "<html>no youtube link</html>",
      "https://www.youtube.com/@posthog": `{"externalId":"UCn4mJ4kK5KVSvozJre645LA"} posthog.com posthog.com`,
      "https://www.youtube.com/feeds/videos.xml?channel_id=UCn4mJ4kK5KVSvozJre645LA": `<feed><entry><yt:videoId>ccccccccccc</yt:videoId><title>Meet Max</title><published>${new Date().toISOString()}</published></entry></feed>`,
      [`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent("https://www.youtube.com/watch?v=ccccccccccc")}`]: "{}",
      "https://www.youtube.com/@plausible": `{"externalId":"UCAAAAAAAAAAAAAAAAAAAAAA"} an impostor`,
    };
    const guessFetcher = async (url: string) => ({ ok: url in guessPages, status: url in guessPages ? 200 : 404, url, contentType: "text/html", body: Buffer.from(guessPages[url] ?? "") });
    expect(await syncPromotion("posthog", guessFetcher)).toMatchObject({ videoId: "ccccccccccc" });
    expect(await syncPromotion("plausible", guessFetcher)).toMatchObject({ videoId: null, error: expect.stringContaining("no YouTube channel linked or confirmed") });

    // A page on someone else's platform isn't read at all.
    const before = requested.length;
    expect(await syncPromotion("gemini-cli", fetcher)).toMatchObject({ logo: false, videoId: null });
    expect(requested.length).toBe(before);
    void promotionSettings; void promotionSources;
  });
});
