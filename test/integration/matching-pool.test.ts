/**
 * Who matching is allowed to consider, and how often it can be asked.
 *
 * Matching used to draw its candidates from `searchUsers("")` — five hundred
 * rows, ordered by join date, descending. That is invisible on a small site
 * and is the whole product on a large one: member five hundred and one
 * onwards is not a candidate for anybody, and since everyone shares the same
 * five hundred rows, the earliest members are matchable by nobody at all. The
 * failure is silent, it gets worse as the site grows, and nothing in the code
 * says the number 500 means "the community".
 *
 * The fix is to cut the pool in SQL on the thing matching cares about —
 * shared skills and interests — with join date as the tiebreaker only. So
 * that is what this pins: given a limit far smaller than the number of
 * people, the people who are picked are the ones with something in common,
 * not the ones who signed up most recently.
 *
 * The second half is the cost of asking. One press of "generate matches" used
 * to run three queries per candidate, serially, with no rate limit on the
 * route at all — roughly fifteen hundred queries per click, repeatable as
 * fast as a finger moves.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { storage } from "../../server/storage";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function builder(app: any, profile: { skills: string[]; interests: string[] }) {
  n += 1;
  const agent = request.agent(app);
  const ip = `198.51.111.${(n % 200) + 20}`;
  const email = `pool-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName: `P${n}` });
  expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 300)}`).toBe(201);
  await verifyEmail(app, email, ip);
  await agent.post("/api/profile").send({
    displayName: `Pool ${n}`,
    headline: "Building things",
    bio: "Shipping weekly.",
    skills: profile.skills,
    interests: profile.interests,
  });
  await agent.post("/api/profile/complete-onboarding").send({});
  return { agent, id: res.body.id as string, email };
}

describe("the matching pool", () => {
  it("picks on what people have in common, not on when they signed up", async () => {
    const app = await getTestApp();

    /*
     * The one with something in common registers *first*, so recency alone
     * would rank them last. Under the old 500-newest cut this is exactly the
     * person who disappears as a community grows.
     */
    const kindred = await builder(app, { skills: ["rustacean-lang"], interests: ["orbital-farming"] });
    const strangers = [];
    for (let i = 0; i < 4; i++) {
      strangers.push(await builder(app, { skills: ["macrame"], interests: ["philately"] }));
    }
    const me = await builder(app, { skills: ["rustacean-lang"], interests: ["orbital-farming"] });

    /*
     * A limit far below the number of people, which is the situation the bug
     * lived in: with a cap of two and five candidates, recency-ordering would
     * return the two newest strangers and never the match.
     */
    const pool = await storage.matchCandidates(
      me.id,
      { skills: ["rustacean-lang"], interests: ["orbital-farming"] },
      2,
    );
    expect(pool.map((p) => p.id), "the oldest account with shared skills must survive the cut")
      .toContain(kindred.id);
    expect(pool.map((p) => p.id), "and the viewer is never their own candidate").not.toContain(me.id);

    // And the route agrees: this is who actually comes back.
    const generated = await me.agent.post("/api/matches/generate").send({});
    expect(generated.status).toBe(200);
    expect(generated.body.map((m: any) => m.matchedUserId)).toContain(kindred.id);

    // Sanity: the strangers exist and are matchable, so the assertion above is
    // about ordering rather than about nobody else being there.
    const wide = await storage.matchCandidates(me.id, { skills: ["rustacean-lang"], interests: [] }, 100);
    for (const s of strangers) expect(wide.map((p) => p.id)).toContain(s.id);
  }, 180_000);

  it("rate-limits generation, which used to be an unlimited full scan per click", async () => {
    const app = await getTestApp();
    const me = await builder(app, { skills: ["limit-test-skill"], interests: ["limit-test-interest"] });

    /*
     * The shared AI budget is 30 in ten minutes. Pressed in a loop, the limiter
     * has to say no at some point — before this route had one, it never did,
     * and each "no" it now gives is a full candidate scan that didn't happen.
     */
    let refused = 0;
    for (let i = 0; i < 34 && refused === 0; i++) {
      const res = await me.agent.post("/api/matches/generate").send({});
      if (res.status === 429) refused += 1;
      else expect([200, 400]).toContain(res.status);
    }
    expect(refused, "POST /api/matches/generate must be rate limited").toBe(1);
  }, 180_000);
});
