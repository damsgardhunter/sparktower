/**
 * Who appears on the public builder-index ranking.
 *
 * This endpoint is open to anybody, signed in or not, and it is the one place
 * the product says out loud that one builder is ahead of another. So the
 * question it has to get right is not the arithmetic — `shared/reputation.ts`
 * owns that and is tested on its own — but *whose* rows it is willing to rank.
 *
 * Three kinds of account are excluded from every other listing in
 * `server/storage.ts` and were on this one, because it read the score table and
 * joined the account afterwards with no conditions at all:
 *
 *   - a bot, which carries an ordinary name by design and so reads as a person
 *     who out-built everybody,
 *   - a suspended account, gone from every other surface the moment it was
 *     suspended,
 *   - a closed account, whose anonymised tombstone kept its score and its place.
 *
 * Each is given the top score here, so a regression cannot pass by accident:
 * if the filter goes, the excluded row is first and the real builder is second.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { users, userProfiles, userReputationScores } from "@shared/schema";

afterAll(async () => { await closeTestApp(); });

let n = 0;

/** An account with a score, created directly: this test is about the read. */
async function scored(opts: {
  name: string;
  index: number;
  isBot?: boolean;
  suspended?: boolean;
  deleted?: boolean;
}): Promise<string> {
  n += 1;
  const [user] = await db.insert(users).values({
    email: `rank-${Date.now()}-${n}@example.test`,
    firstName: opts.name,
    isBot: opts.isBot ?? false,
    suspendedAt: opts.suspended ? new Date() : null,
    deletedAt: opts.deleted ? new Date() : null,
  } as any).returning();

  await db.insert(userProfiles).values({
    userId: user.id, displayName: opts.name, isOnboarded: true,
  } as any);

  await db.insert(userReputationScores).values({
    userId: user.id,
    builderIndex: opts.index,
    execution: opts.index, contribution: opts.index, market: opts.index, strategy: opts.index,
  } as any);

  return user.id;
}

const names = (body: any): string[] =>
  (body as { user: { firstName: string | null } }[]).map((r) => r.user.firstName ?? "");

describe("the public builder-index ranking", () => {
  it("ranks people, and leaves out bots, suspended and closed accounts", async () => {
    const app = await getTestApp();

    /*
     * The three excluded ones score higher than the real builder, so each would
     * be above them if it were included at all. 99 rather than 100 for the
     * person, to leave room above.
     */
    await scored({ name: "Botly", index: 100, isBot: true });
    await scored({ name: "Suspendra", index: 100, suspended: true });
    await scored({ name: "Closedia", index: 100, deleted: true });
    await scored({ name: "Realbuilder", index: 99 });

    const res = await request(app).get("/api/leaderboard/reputation?limit=50");
    expect(res.status).toBe(200);

    const listed = names(res.body);
    expect(listed, "the real builder is ranked").toContain("Realbuilder");
    expect(listed, "a bot is not a person to rank").not.toContain("Botly");
    expect(listed, "a suspended account is off every other surface").not.toContain("Suspendra");
    expect(listed, "a closed account's tombstone is not a builder").not.toContain("Closedia");
  });

  it("orders by the index, highest first", async () => {
    const app = await getTestApp();

    await scored({ name: "Middling", index: 55 });
    await scored({ name: "Topmost", index: 95 });
    await scored({ name: "Lowly", index: 15 });

    const res = await request(app).get("/api/leaderboard/reputation?limit=50");
    expect(res.status).toBe(200);

    const listed = names(res.body);
    const order = ["Topmost", "Middling", "Lowly"].map((who) => listed.indexOf(who));
    expect(order.every((i) => i >= 0), `all three are listed: ${listed.join(", ")}`).toBe(true);
    expect(order, "highest index first").toEqual([...order].sort((a, b) => a - b));
  });

});
