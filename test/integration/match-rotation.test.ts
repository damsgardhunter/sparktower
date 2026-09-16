/**
 * Matches that change, and matches that arrive without being asked for.
 *
 * Scoring the same community twice returns the same people in the same order,
 * so before batches existed, a builder who opened Discover on Tuesday saw
 * exactly who they had ignored on Monday — and a builder who never pressed
 * "generate" a second time saw their onboarding-day list forever.
 *
 * Both halves are pinned here: a second run shows new faces, and a plain read
 * regenerates a stale list. The third case is the one that's easy to get
 * wrong — when holding people back would leave too few, repeats beat an empty
 * screen, because a small community would otherwise run itself dry.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function builder(app: any) {
  const agent = request.agent(app);
  n += 1;
  const ip = `203.0.113.${(n % 200) + 20}`;
  const res = await agent.post("/api/auth/register")
    .set("x-forwarded-for", ip)
    .send({ email: `mr-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`, password: "Testpass123!", firstName: `B${n}` });
  expect(res.status).toBe(201);
  await verifyEmail(app, res.body.email, ip);
  // Matchable at all: unonboarded profiles are never candidates, and the score
  // has to clear MATCH_FLOOR, which shared skills and interests do.
  // Matchable at all: unonboarded profiles are never candidates, and the score
  // has to clear MATCH_FLOOR, which shared skills and interests do. The words
  // go through the profile — complete-onboarding only flips the flag.
  await agent.post("/api/profile").send({
    displayName: `Builder ${n}`,
    headline: "Building developer tools",
    bio: "Shipping weekly.",
    skills: ["typescript", "postgres"],
    interests: ["saas", "devtools"],
  });
  await agent.post("/api/profile/complete-onboarding").send({});
  return { agent, id: res.body.id as string };
}

const idsOf = (body: any[]) => body.map((m) => m.matchedUserId as string);

describe("a second run of matches", () => {
  it("shows people the first run didn't, and stops holding back when the pool runs thin", async () => {
    const app = await getTestApp();
    const me = await builder(app);
    for (let i = 0; i < 12; i++) await builder(app);

    const first = await me.agent.post("/api/matches/generate").send({});
    expect(first.status).toBe(200);
    const firstIds = idsOf(first.body);
    expect(firstIds.length).toBeGreaterThan(0);

    const second = await me.agent.post("/api/matches/generate").send({});
    expect(second.status).toBe(200);
    const secondIds = idsOf(second.body);
    expect(secondIds.length).toBe(firstIds.length);
    // The point of the whole feature: nobody from the first run comes back.
    expect(secondIds.filter((id) => firstIds.includes(id))).toEqual([]);

    // By now most of the community has been shown twice. A run that held all of
    // them back would return nothing, so it stops holding back instead.
    const third = await me.agent.post("/api/matches/generate").send({});
    expect(third.status).toBe(200);
    expect(idsOf(third.body).length).toBeGreaterThan(0);
  }, 120_000);
});

describe("opening the matches list", () => {
  it("generates them, so nobody has to press a button to have any", async () => {
    const app = await getTestApp();
    const me = await builder(app);
    for (let i = 0; i < 3; i++) await builder(app);

    const read = await me.agent.get("/api/matches");
    expect(read.status).toBe(200);
    expect(read.body.length).toBeGreaterThan(0);
  }, 60_000);
});
