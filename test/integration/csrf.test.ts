/**
 * Cookie-authenticated writes refuse requests another site started.
 *
 * A signed-in browser carries its session cookie on every request, including
 * ones a hostile page fires at us. Each case below is that page's attempt,
 * sent with the real session: it must be refused with nothing written, while
 * the site's own requests and cookieless clients (the mobile app, the Stripe
 * webhook) are unaffected.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";

afterAll(async () => { await closeTestApp(); });

const HOST = "sparktower.test";
const email = () => `csrf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

async function signedIn() {
  const app = await getTestApp();
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", "198.51.100.61").send({ email: email(), password: "Testpass123!", firstName: "Csrf" });
  expect(res.status).toBe(201);
  return { app, agent };
}

const post = (content: string) => ({ postType: "looking_for_help", content });

describe("cross-site writes with a session cookie", () => {
  it("are refused, and nothing is written", async () => {
    const { agent } = await signedIn();
    const attempts: [string, Record<string, string>][] = [
      ["a form on another site", { "Sec-Fetch-Site": "cross-site" }],
      ["a sibling subdomain", { "Sec-Fetch-Site": "same-site" }],
      ["an older browser, foreign Origin", { Host: HOST, Origin: "https://evil.example" }],
      ["a sandboxed frame (Origin: null)", { Host: HOST, Origin: "null" }],
      ["no Origin, foreign Referer", { Host: HOST, Referer: "https://evil.example/page" }],
      ["a lookalike host", { Host: HOST, Origin: `https://${HOST}.evil.example` }],
    ];
    for (const [label, headers] of attempts) {
      const content = `Forged post via ${label} ${Math.random()}`;
      const res = await agent.post("/api/feed").set(headers).send(post(content));
      expect(res.status, label).toBe(403);
      expect(res.body.code, label).toBe("cross_site");
      const mine = await agent.get("/api/feed?limit=50");
      expect(mine.body.posts.some((p: any) => p.content === content), label).toBe(false);
    }
  });

  it("covers every unsafe method, not just POST", async () => {
    const { agent } = await signedIn();
    const created = await agent.post("/api/feed").set("Sec-Fetch-Site", "same-origin").send(post("A post someone will try to delete from elsewhere."));
    expect(created.status).toBe(200);
    const id = created.body.id;

    const del = await agent.delete(`/api/feed/${id}`).set("Sec-Fetch-Site", "cross-site");
    expect(del.status).toBe(403);
    expect((await agent.get(`/api/feed/${id}`)).status).toBe(200);

    const patch = await agent.patch("/api/profile").set({ Host: HOST, Origin: "https://evil.example" }).send({ headline: "Hijacked" });
    expect(patch.status).toBe(403);
    expect((await agent.get("/api/profile")).body.headline).not.toBe("Hijacked");
  });

  it("lets the site's own requests through", async () => {
    const { agent } = await signedIn();
    expect((await agent.post("/api/feed").set("Sec-Fetch-Site", "same-origin").send(post("From our own page, modern browser."))).status).toBe(200);
    expect((await agent.post("/api/feed").set({ Host: HOST, Origin: `https://${HOST}` }).send(post("From our own page, older browser."))).status).toBe(200);
    expect((await agent.post("/api/feed").set({ Host: HOST, Referer: `https://${HOST}/home` }).send(post("From our own page, Referer only."))).status).toBe(200);
    // Reads are never in scope.
    expect((await agent.get("/api/profile").set("Sec-Fetch-Site", "cross-site")).status).toBe(200);
  });

  it("leaves cookieless clients alone", async () => {
    const app = await getTestApp();
    // No cookie, so there's no session to ride: it reaches auth and gets the ordinary 401.
    expect((await request(app).post("/api/feed").set("Sec-Fetch-Site", "cross-site").send(post("No session here at all."))).status).toBe(401);
    // Stripe posts from its own servers; its signature check still decides.
    const hook = await request(app).post("/api/stripe/webhook").set({ "Content-Type": "application/json", Origin: "https://stripe.com", Cookie: "x=1" }).send("{}");
    expect(hook.status).toBe(400);
    expect(hook.body.error).toMatch(/stripe-signature/i);
  });
});
