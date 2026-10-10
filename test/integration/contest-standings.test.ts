/**
 * A contest the product scores itself: highest ten-year valuation wins.
 *
 * The first one is a real contest with a hundred dollars on it, which is the
 * reason this file is long. Every rule below is a way the wrong person could be
 * paid:
 *
 *  - a game played outside the contest's dates counting
 *  - a *fallback* verdict counting, which is a number the model never gave
 *  - only one of the two players getting credit for the game they built together
 *  - a tie broken silently instead of shared
 *  - somebody who never played being ranked above somebody who played badly
 *  - a valuation over two billion coming back wrong, because `score` on
 *    `contest_participants` is a 32-bit integer and a ten-year valuation is not
 *
 * Standings are computed when read, so each test writes rows and asks.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { contestParticipants, contests, startupGameVerdicts, startupGames, users } from "@shared/schema";
import { standingsFor } from "../../server/contest-standings";
import { finishOnboarding } from "../helpers/onboarding";

afterAll(async () => { await closeTestApp(); });

let n = 0;
const ip = () => `198.51.140.${20 + (n++ % 200)}`;
const day = 86_400_000;

async function person(first: string) {
  n += 1;
  const [row] = await db.insert(users).values({
    email: `stand-${first}-${Date.now()}-${n}@example.test`,
    firstName: first,
  }).returning();
  return row;
}

async function contest(fields: Partial<typeof contests.$inferInsert> = {}) {
  const [row] = await db.insert(contests).values({
    title: `Ten Years, best valuation ${Date.now()}-${n++}`,
    description: "Highest ten-year valuation wins $100.",
    category: "game",
    status: "active",
    scoredBy: "ten_years_from_now",
    startDate: new Date(Date.now() - 7 * day),
    endDate: new Date(Date.now() + 7 * day),
    ...fields,
  } as any).returning();
  return row;
}

const enter = (contestId: string, userId: string) =>
  db.insert(contestParticipants).values({ contestId, userId }).onConflictDoNothing();

/** A finished game between two people, with a verdict worth `tenYear`. */
async function playedGame(opts: {
  a: string; b: string; tenYear: number; when?: Date; fromModel?: boolean; company?: string;
}) {
  const [game] = await db.insert(startupGames).values({
    player1Id: opts.a,
    player2Id: opts.b,
    round: "verdict",
    idea: { name: opts.company ?? "Acme" },
  } as any).returning();
  await db.insert(startupGameVerdicts).values({
    gameId: game.id,
    growth: 500, capital: 500, product: 500, acquisition: 500, risk: 500,
    overall: 500,
    tenYear: opts.tenYear,
    peak: opts.tenYear,
    peakYear: 10,
    summary: "A verdict.",
    fromModel: opts.fromModel ?? true,
    createdAt: opts.when ?? new Date(),
  } as any);
  return game;
}

const by = (s: Awaited<ReturnType<typeof standingsFor>>, userId: string) =>
  s!.standings.find((r) => r.userId === userId)!;

describe("the highest score in the window", () => {
  it("takes each entrant's best game, not their latest or their first", async () => {
    const c = await contest();
    const dana = await person("Dana");
    const partner = await person("Partner");
    await enter(c.id, dana.id);

    await playedGame({ a: dana.id, b: partner.id, tenYear: 1_000_000_000, company: "First" });
    await playedGame({ a: dana.id, b: partner.id, tenYear: 4_200_000_000, company: "Best" });
    await playedGame({ a: dana.id, b: partner.id, tenYear: 2_000_000_000, company: "Latest" });

    const s = await standingsFor(c.id);
    expect(by(s, dana.id).best).toBe(4_200_000_000);
    expect(by(s, dana.id).company, "the standing should name the company that scored it").toBe("Best");
    expect(by(s, dana.id).played, "all three count as games played").toBe(3);
  });

  it("credits both players, because the verdict belongs to the game", async () => {
    /*
     * Ten Years From Now is played in pairs and there is one verdict. Crediting
     * only `player1` would mean half of all entrants scored nothing through no
     * fault of their own.
     */
    const c = await contest();
    const one = await person("One");
    const two = await person("Two");
    await enter(c.id, one.id);
    await enter(c.id, two.id);

    await playedGame({ a: one.id, b: two.id, tenYear: 3_000_000_000 });

    const s = await standingsFor(c.id);
    expect(by(s, one.id).best).toBe(3_000_000_000);
    expect(by(s, two.id).best).toBe(3_000_000_000);
    /* And they share the rank, rather than one of them being arbitrarily second. */
    expect(by(s, one.id).rank).toBe(1);
    expect(by(s, two.id).rank).toBe(1);
  });

  it("counts a game played before they entered, as long as it is inside the dates", async () => {
    /*
     * The chosen rule. The alternative — only games after joining — loses a good
     * game played the day before somebody remembered to enter, and there is no
     * reason to punish that.
     */
    const c = await contest();
    const late = await person("Late");
    const partner = await person("Partner2");
    await playedGame({ a: late.id, b: partner.id, tenYear: 5_000_000_000, when: new Date(Date.now() - 3 * day) });
    /* Entered after the game was played. */
    await enter(c.id, late.id);

    const s = await standingsFor(c.id);
    expect(by(s, late.id).best).toBe(5_000_000_000);
  });

  it("ignores a game from before the contest opened, and one from after it closed", async () => {
    const c = await contest();
    const dana = await person("Window");
    const partner = await person("Partner3");
    await enter(c.id, dana.id);

    await playedGame({ a: dana.id, b: partner.id, tenYear: 9_000_000_000, when: new Date(Date.now() - 30 * day) });
    await playedGame({ a: dana.id, b: partner.id, tenYear: 8_000_000_000, when: new Date(Date.now() + 30 * day) });
    await playedGame({ a: dana.id, b: partner.id, tenYear: 1_000_000_000 });

    const s = await standingsFor(c.id);
    expect(by(s, dana.id).best, "only the one inside the dates counts").toBe(1_000_000_000);
    expect(by(s, dana.id).played).toBe(1);
  });

  it("ignores a verdict the model did not write", async () => {
    /*
     * `fromModel: false` is the honest fallback when the model could not be
     * reached. The game's own boards leave those out because a placeholder that
     * ranks is a lie — and here it would be a lie worth a hundred dollars.
     */
    const c = await contest();
    const dana = await person("Fallback");
    const partner = await person("Partner4");
    await enter(c.id, dana.id);

    await playedGame({ a: dana.id, b: partner.id, tenYear: 999_000_000_000, fromModel: false });
    await playedGame({ a: dana.id, b: partner.id, tenYear: 2_000_000_000 });

    const s = await standingsFor(c.id);
    expect(by(s, dana.id).best).toBe(2_000_000_000);
    expect(by(s, dana.id).played).toBe(1);
  });

  it("leaves out somebody who never entered, however well they played", async () => {
    const c = await contest();
    const entrant = await person("In");
    const outsider = await person("Out");
    await enter(c.id, entrant.id);

    await playedGame({ a: entrant.id, b: outsider.id, tenYear: 2_000_000_000 });

    const s = await standingsFor(c.id);
    expect(s!.standings.map((r) => r.userId)).toEqual([entrant.id]);
  });

  it("carries a valuation far past what a 32-bit integer holds", async () => {
    /*
     * `contest_participants.score` is an integer and would overflow at about 2.1
     * billion — which is an ordinary result in this game. The standings never go
     * through that column; this is the test that says so.
     */
    const c = await contest();
    const dana = await person("Huge");
    const partner = await person("Partner5");
    await enter(c.id, dana.id);
    const huge = 840_000_000_000;
    await playedGame({ a: dana.id, b: partner.id, tenYear: huge });

    const s = await standingsFor(c.id);
    expect(by(s, dana.id).best).toBe(huge);
  });
});

describe("the order of the table", () => {
  it("ranks highest first, shares a tie, and skips the rank after it", async () => {
    const c = await contest();
    const first = await person("Alpha");
    const tiedA = await person("TiedA");
    const tiedB = await person("TiedB");
    const third = await person("Low");
    const partner = await person("Partner6");
    for (const p of [first, tiedA, tiedB, third]) await enter(c.id, p.id);

    await playedGame({ a: first.id, b: partner.id, tenYear: 9_000_000_000 });
    await playedGame({ a: tiedA.id, b: partner.id, tenYear: 5_000_000_000 });
    await playedGame({ a: tiedB.id, b: partner.id, tenYear: 5_000_000_000 });
    await playedGame({ a: third.id, b: partner.id, tenYear: 1_000_000_000 });

    const s = await standingsFor(c.id);
    expect(by(s, first.id).rank).toBe(1);
    expect(by(s, tiedA.id).rank).toBe(2);
    expect(by(s, tiedB.id).rank).toBe(2);
    /* Two seconds are followed by a fourth, which is what people expect. */
    expect(by(s, third.id).rank).toBe(4);
  });

  it("puts somebody who has not played last, without a rank", async () => {
    /*
     * Not the same as having built something worth nothing. An unplayed entrant
     * sorted among the zeroes reads as a score, and a rank on them would claim
     * they are beating somebody.
     */
    const c = await contest();
    const played = await person("Played");
    const idle = await person("Idle");
    const partner = await person("Partner7");
    await enter(c.id, played.id);
    await enter(c.id, idle.id);
    await playedGame({ a: played.id, b: partner.id, tenYear: 1_000 });

    const s = await standingsFor(c.id);
    expect(s!.standings.map((r) => r.userId)).toEqual([played.id, idle.id]);
    expect(by(s, idle.id).best).toBeNull();
    expect(by(s, idle.id).rank).toBeNull();
    expect(s!.played).toBe(1);
    expect(s!.entrants).toBe(2);
  });
});

describe("the two kinds of contest", () => {
  it("has no standings for a contest a person judges", async () => {
    const judged = await contest({ scoredBy: null });
    expect(await standingsFor(judged.id)).toBeNull();
  });

  it("answers the route with 404 and a reason, not an empty table", async () => {
    /* `[]` would read as "nobody is winning" rather than "this isn't that kind". */
    const app = await getTestApp();
    const judged = await contest({ scoredBy: null });
    const res = await request(app).get(`/api/contests/${judged.id}/standings`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("not_scored");
  });

  it("serves the standings signed out, since a leaderboard nobody sees is not one", async () => {
    const app = await getTestApp();
    const c = await contest();
    const dana = await person("Public");
    const partner = await person("Partner8");
    await enter(c.id, dana.id);
    await playedGame({ a: dana.id, b: partner.id, tenYear: 7_000_000_000, company: "Shown" });

    const res = await request(app).get(`/api/contests/${c.id}/standings`).expect(200);
    expect(res.body.standings[0].best).toBe(7_000_000_000);
    expect(res.body.standings[0].company).toBe("Shown");
    /* A name, a face, a number — and nothing about an account. */
    expect(Object.keys(res.body.standings[0]).sort())
      .toEqual(["avatarUrl", "best", "company", "gameId", "name", "played", "rank", "userId"]);
    expect(JSON.stringify(res.body)).not.toContain("@example.test");
  });

  it("refuses a filed link on a scored contest, and says why", async () => {
    /*
     * There is nothing to file. The screens do not offer it, so reaching the
     * route means a stale page — and accepting the link would leave an entry
     * nobody reads beside a standing worked out from games.
     */
    const app = await getTestApp();
    const agent = request.agent(app);
    const email = `scored-${Date.now()}@example.test`;
    const made = await agent.post("/api/auth/register").set("x-forwarded-for", ip())
      .send({ email, password: "Testpass123!", firstName: "Filer" }).expect(201);
    await verifyEmail(app, email, ip());
    /* Entering a contest needs a finished profile. See shared/onboarding.ts. */
    await finishOnboarding(made.body.id, { displayName: "Filer" });
    const c = await contest();
    await agent.post(`/api/contests/${c.id}/join`).set("x-forwarded-for", ip()).send({}).expect(200);

    const res = await agent.post(`/api/contests/${c.id}/submit`).set("x-forwarded-for", ip())
      .send({ submissionUrl: "https://example.test/nope" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("scored_not_judged");
    const [row] = await db.select().from(contestParticipants).where(eq(contestParticipants.contestId, c.id));
    expect(row.submissionUrl, "nothing should have been written").toBeNull();
  });

  it("says whether the window is still open, so closed standings read as final", async () => {
    const open = await contest();
    const over = await contest({ startDate: new Date(Date.now() - 30 * day), endDate: new Date(Date.now() - day), status: "completed" });
    expect((await standingsFor(open.id))!.open).toBe(true);
    expect((await standingsFor(over.id))!.open).toBe(false);
  });
});
