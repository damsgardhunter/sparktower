/**
 * The `users` rows behind the product's bots.
 *
 * One place, because there is one cast (`shared/bots.ts`) and one `is_bot`
 * column. A simulation lobby and a sprint queue reaching for the same identity
 * must get the same account: a bot that existed twice would hold a league
 * table history under one row and a sprint history under another, and nothing
 * would tie them together.
 */
import { eq } from "drizzle-orm";
import { db } from "./db";
import { users } from "@shared/schema";
import type { BotIdentity } from "@shared/bots";

/**
 * The account behind one bot identity, created if this is its first outing.
 *
 * Looked up by the identity's address, which is stable for a given index, so a
 * bot keeps one account across seasons, sprints and deployments.
 * `onConflictDoNothing` rather than a read-then-write: two lobbies filling at
 * the same instant will both reach for the same identity, and the unique index
 * on email is the only thing that can settle that.
 */
export async function ensureBotUser(bot: BotIdentity): Promise<string | null> {
  await db.insert(users)
    .values({
      email: bot.email,
      firstName: bot.firstName,
      lastName: bot.lastName,
      // No password hash and no provider: nothing can sign in as one of these.
      authProvider: "bot",
      isBot: true,
    } as any)
    .onConflictDoNothing({ target: users.email });

  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, bot.email));
  return row?.id ?? null;
}
