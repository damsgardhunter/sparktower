/**
 * The max-reputation seeder will only ever raise one account: the creator's.
 *
 * A fabricated 100 is the strongest claim the product makes about a person. It
 * is shown on the public profile, ranked on the leaderboard, and fed into
 * co-founder matching — so a second account that could be given one would not
 * merely be flattered, it would be recommended to strangers as a partner on the
 * strength of donations that were never pledged and help that was never given.
 *
 * The creator's own profile is the one case where nobody is deceived, because
 * nobody wonders who owns the platform they are looking at. So the rule is one
 * account, and these are the ways it could quietly stop being one account:
 *
 *   - an ordinary user named on the command line;
 *   - a *second* admin, because admin is a role the platform hands out to
 *     support and moderators, and every such grant would otherwise be a licence
 *     to mint a perfect reputation;
 *   - no admin at all, where failing open would seed whoever was asked for.
 */
import { describe, it, expect, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { users } from "@shared/schema";
import { assertIsCreator, creatorId } from "../../script/seed-max-reputation";

afterAll(async () => { await closeTestApp(); });

let seq = 0;
async function account(role: "user" | "admin", createdAt: Date): Promise<string> {
  seq += 1;
  const [row] = await db.insert(users).values({
    email: `creator-only-${Date.now()}-${seq}-${Math.random().toString(36).slice(2, 6)}@example.test`,
    firstName: `Person${seq}`, platformRole: role, createdAt,
  } as any).returning();
  return row.id;
}

/* The gatherer reads every admin on the database, so each case starts from none. */
async function clearAccounts(): Promise<void> {
  await db.execute(sql`delete from users where email like 'creator-only-%@example.test'`);
}

describe("who the max-reputation seeder will seed", () => {
  it("refuses an ordinary user", async () => {
    await clearAccounts();
    const founder = await account("admin", new Date("2024-01-01"));
    const punter = await account("user", new Date("2024-06-01"));

    await expect(assertIsCreator(punter), "an ordinary account must never be seedable")
      .rejects.toThrow(/only seeds the creator/i);
    await expect(assertIsCreator(founder)).resolves.toBeUndefined();
  });

  /*
   * The case a plain `platform_role = 'admin'` check would have got wrong, and
   * the reason the script does not use one. Who founded the platform is a fact
   * about history; admin is a permission, and permissions get handed out.
   */
  it("refuses an admin who is not the founder, however they were promoted", async () => {
    await clearAccounts();
    const founder = await account("admin", new Date("2024-01-01"));
    const moderator = await account("admin", new Date("2025-03-01"));

    expect(await creatorId(), "the earliest admin is the creator").toBe(founder);
    await expect(assertIsCreator(moderator), "a later admin grant must not become a licence")
      .rejects.toThrow(/only seeds the creator/i);
  });

  /* Promoting somebody today must not move the title, even if they are promoted first in id order. */
  it("keeps the title with the founder when somebody is promoted afterwards", async () => {
    await clearAccounts();
    const founder = await account("admin", new Date("2023-05-05"));
    await account("admin", new Date("2026-01-01"));
    await account("admin", new Date("2026-02-02"));

    expect(await creatorId()).toBe(founder);
  });

  it("fails closed when there is no admin at all", async () => {
    await clearAccounts();
    const punter = await account("user", new Date("2024-06-01"));

    expect(await creatorId()).toBeNull();
    await expect(assertIsCreator(punter), "no creator means nobody is seedable, not anybody")
      .rejects.toThrow(/no admin account exists/i);
  });

  /* A deleted founder does not hand the title to the next admin by accident. */
  it("ignores deleted accounts when working out who the creator is", async () => {
    await clearAccounts();
    const founder = await account("admin", new Date("2023-01-01"));
    const successor = await account("admin", new Date("2025-01-01"));
    expect(await creatorId()).toBe(founder);

    await db.update(users).set({ deletedAt: new Date() } as any).where(eq(users.id, founder));
    expect(await creatorId(), "a deleted founder is not the creator").toBe(successor);
    await expect(assertIsCreator(founder)).rejects.toThrow(/only seeds the creator/i);
  });
});
