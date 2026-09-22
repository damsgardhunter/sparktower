/**
 * "Posted 5 hours ago", a second after posting.
 *
 * Nearly every time column in the schema is `timestamp` with no zone, and the
 * two halves of a round trip disagreed about what that meant: a column
 * defaulting to `now()` stored the database session's wall clock, and the
 * driver read a zoneless value back as UTC. On a machine five hours behind
 * UTC, everything the database timestamped for itself came back five hours
 * old — posts, comments, reactions, everything Nova dates.
 *
 * What made it hard to see is that it was only half the writes: anything
 * written as a JS Date was stored in UTC and was right. So the same screen
 * showed some correct times and some five hours out.
 *
 * The fix is one line in server/db.ts — every connection is pinned to UTC —
 * and this is the test that says so, from the outside: put a row in, read it
 * back, and it should have happened just now.
 */
import { describe, it, expect, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { feedPosts, users } from "@shared/schema";

afterAll(async () => { await closeTestApp(); });

/** Anything a person would read as "just now". */
const MINUTE = 60_000;

describe("what the database timestamps for itself", () => {
  it("connects in UTC, whatever the machine's clock is set to", async () => {
    await getTestApp();
    const result: any = await db.execute(sql`select current_setting('TimeZone') as tz`);
    expect((result.rows ?? result)[0].tz).toBe("UTC");
  });

  it("gives a row created now a time of now, not of five hours ago", async () => {
    const app = await getTestApp();
    const [author] = await db.insert(users).values({
      email: `stamp-${Date.now()}@example.test`, firstName: "Stamp",
    } as any).returning();

    const before = Date.now();
    const [post] = await db.insert(feedPosts).values({
      authorId: author.id, postType: "update", content: "Posted just now.",
    } as any).returning();

    expect(post.createdAt, "a Date, as the browser will be handed").toBeInstanceOf(Date);
    const age = before - post.createdAt.getTime();
    expect(Math.abs(age), `a post ${Math.round(age / MINUTE)} minutes old the moment it was written`).toBeLessThan(MINUTE);

    await db.delete(feedPosts).where(eq(feedPosts.id, post.id));
    await db.delete(users).where(eq(users.id, author.id));
    expect(app).toBeTruthy();
  });
});
