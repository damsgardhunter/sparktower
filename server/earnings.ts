/**
 * What somebody has earned here, where it went, and where it should go next.
 *
 * The pieces for paying people existed and there was nowhere to stand. Stripe
 * Connect onboarding was wired up, but the only door to it was inside one
 * project's backing setup, three screens deep, and only if that project had a
 * campaign. `GET /api/payouts` existed and nothing in the client ever called
 * it. So a person whose project had been backed had no page that said so.
 *
 * Money can reach a person two ways here, and they are genuinely different:
 *
 *  - **Their SparkTower balance.** Instant, needs no bank, no onboarding and
 *    no identity check, and is spendable on Nova the moment it lands. A
 *    challenge prize has always arrived this way — `releasePrize` credits the
 *    winner in the same transaction that takes the prize out of escrow.
 *  - **Their bank, through Stripe.** Real money leaving the platform, which
 *    needs a connected account and everything Stripe asks for to open one.
 *
 * Backed pledges used to have only the second route, and refused outright
 * without a connected account, so a creator who never got over Stripe's
 * identity checks could not be paid at all and the backers' money sat in
 * escrow indefinitely. `users.payoutTarget` is the fix, and this module is
 * what shows a person the consequences of that choice.
 *
 * ## Why the figures are split by destination rather than summed
 *
 * Because "you have earned $450" is not a fact a person can act on if $200 of
 * it is escrowed pending a reviewer, $150 is spendable here right now and $100
 * left for their bank a fortnight ago. Those are three different answers to
 * three different questions, and one total answers none of them.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { projects, projectBackings, challengePrizes, companyChallenges, users } from "@shared/schema";
import { creatorPayoutCents, platformFeeCents } from "@shared/backing";

export type EarningState = "held" | "balance" | "bank";

export interface EarningLine {
  id: string;
  kind: "backing" | "prize";
  /** What the person actually receives, net of the platform's cut. */
  amountCents: number;
  /** What it is, in their own terms: the project backed, the challenge won. */
  what: string;
  at: string;
  /**
   * Where the money is.
   *
   *  - `held`    — collected, waiting on an approval that isn't theirs to give.
   *  - `balance` — landed in their SparkTower balance; spendable now.
   *  - `bank`    — sent out to their connected account.
   */
  state: EarningState;
  /** One line saying what has to happen next, when something does. */
  note: string | null;
}

export interface EarningsRead {
  /** Earned and landed here, spendable on Nova. */
  toBalanceCents: number;
  /** Earned and sent out to their bank. */
  toBankCents: number;
  /** Collected, and waiting on a decision that is not theirs. */
  heldCents: number;
  lines: EarningLine[];
  /** Their whole spendable balance, which includes top-ups as well as earnings. */
  balanceCents: number;
  /** Where money they earn from here on should go. */
  payoutTarget: "balance" | "bank";
  bank: {
    connected: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
    /** False when Stripe isn't configured on this server at all. */
    available: boolean;
  };
}

const money = (n: number | null | undefined) => Math.max(0, Math.round(Number(n ?? 0)));

/** Everything owed to, or already paid to, one person — newest first. */
export async function earningsFor(userId: string): Promise<EarningsRead> {
  const [me] = await db.select({
    balanceCents: users.balanceCents,
    payoutTarget: users.payoutTarget,
  }).from(users).where(eq(users.id, userId));

  const bank = await bankStateFor(userId);

  const mine = await db.select({ id: projects.id, title: projects.title })
    .from(projects).where(eq(projects.ownerId, userId));
  const byProject = new Map(mine.map((p) => [p.id, p.title]));

  const lines: EarningLine[] = [];

  if (mine.length) {
    const backings = await db.select().from(projectBackings)
      .where(and(
        inArray(projectBackings.projectId, mine.map((p) => p.id)),
        inArray(projectBackings.status, ["held", "released"]),
      ));
    for (const b of backings) {
      /*
       * The creator's share, not the pledge. The platform takes a cut on
       * release (`creatorPayoutCents`), so reporting the gross would promise
       * a creator money that was never going to arrive — and the difference
       * is not small enough to round away.
       */
      const net = creatorPayoutCents(money(b.amountCents));
      const fee = platformFeeCents(money(b.amountCents));
      if (b.status === "held") {
        lines.push({
          id: b.id, kind: "backing", amountCents: net,
          what: `Backing on ${byProject.get(b.projectId) ?? "your project"}`,
          at: (b.createdAt ?? new Date()).toISOString(),
          state: "held",
          note: fee > 0
            ? "Held by SparkTower until your project is approved. Shown after our fee."
            : "Held by SparkTower until your project is approved for payouts.",
        });
        continue;
      }
      /*
       * Released. A pledge settled into the balance carries no transfer id
       * because there was no transfer — that absence is how the two routes
       * are told apart after the fact.
       */
      const wentToBank = Boolean(b.stripeTransferId);
      lines.push({
        id: b.id, kind: "backing", amountCents: net,
        what: `Backing on ${byProject.get(b.projectId) ?? "your project"}`,
        at: (b.releasedAt ?? b.createdAt ?? new Date()).toISOString(),
        state: wentToBank ? "bank" : "balance",
        note: wentToBank ? "Sent to your bank account." : "Added to your SparkTower balance.",
      });
    }
  }

  /*
   * Prizes are looked up by who won them rather than by project: a challenge
   * is posted by a company and won by a person, who need have no project here
   * at all. Only "awarded" can belong to a winner — a prize that goes back to
   * the company that funded it is "refunded" or "released", and neither names
   * a winner — so this is the whole of it.
   *
   * These are already money in hand. `releasePrize` credits the winner's
   * balance in the same transaction that takes the prize out of escrow, so a
   * won prize has never been something waiting to be collected, and saying it
   * was would have had people waiting for money they had already been paid.
   */
  const prizes = await db.select({
    id: challengePrizes.challengeId,
    amountCents: challengePrizes.amountCents,
    awardedAt: challengePrizes.awardedAt,
    settledAt: challengePrizes.settledAt,
    title: companyChallenges.title,
  }).from(challengePrizes)
    .leftJoin(companyChallenges, eq(companyChallenges.id, challengePrizes.challengeId))
    .where(and(
      eq(challengePrizes.awardedTo, userId),
      eq(challengePrizes.state, "awarded"),
    ));
  for (const p of prizes) {
    lines.push({
      id: p.id, kind: "prize", amountCents: money(p.amountCents),
      what: `Won ${p.title ?? "a challenge"}`,
      at: (p.awardedAt ?? p.settledAt ?? new Date()).toISOString(),
      state: "balance",
      note: "Added to your SparkTower balance when you won it.",
    });
  }

  lines.sort((a, b) => b.at.localeCompare(a.at));
  const sum = (state: EarningState) =>
    lines.filter((l) => l.state === state).reduce((n, l) => n + l.amountCents, 0);

  return {
    toBalanceCents: sum("balance"),
    toBankCents: sum("bank"),
    heldCents: sum("held"),
    lines,
    balanceCents: money(me?.balanceCents),
    /*
     * The destination that would actually be used, not the stored override.
     * Null means "hasn't said", and the page has to show where the money will
     * really go rather than where a column happens to be blank.
     */
    payoutTarget: effectiveTarget(me?.payoutTarget, bank),
    bank,
  };
}

/**
 * Where money would actually go, given what they have and what they've said.
 *
 * An explicit choice wins, except that "bank" cannot survive losing the
 * account it pointed at — a stored preference for a bank Stripe will no longer
 * pay is how money stops moving without anybody being told.
 */
export function effectiveTarget(
  stored: string | null | undefined,
  bank: { connected: boolean; payoutsEnabled: boolean },
): "balance" | "bank" {
  if (stored === "balance") return "balance";
  return bank.connected ? "bank" : "balance";
}

/**
 * Where this person's future earnings should land.
 *
 * "bank" is refused without a connected account that Stripe will actually pay,
 * because the whole failure this replaced was money with nowhere to go: a
 * creator who picks a destination that cannot receive money has chosen the old
 * dead end back again, and would find out weeks later.
 */
export async function setPayoutTarget(
  userId: string,
  target: "balance" | "bank",
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (target === "bank") {
    const bank = await bankStateFor(userId);
    if (!bank.available) return { ok: false, reason: "Payouts to a bank aren't switched on for this server." };
    if (!bank.connected) return { ok: false, reason: "Connect a bank account first." };
    if (!bank.payoutsEnabled) {
      return { ok: false, reason: "Stripe isn't ready to pay that account yet. Finish its setup, then switch." };
    }
  }
  await db.update(users).set({ payoutTarget: target }).where(eq(users.id, userId));
  return { ok: true };
}

/**
 * What Stripe says about their ability to be paid.
 *
 * Asked of Stripe rather than remembered, because the answer changes without
 * us: somebody finishes the form on Stripe's own pages, or Stripe later asks
 * for a document, and nothing calls back here. A remembered "connected" that
 * has since been suspended is how a person waits a fortnight for money that
 * was never going to move.
 */
async function bankStateFor(userId: string): Promise<EarningsRead["bank"]> {
  const [user] = await db.select({ accountId: users.stripeConnectAccountId })
    .from(users).where(eq(users.id, userId));
  /*
   * `available` is answered from the server's own configuration, not from a
   * Stripe call that only happens once somebody already has an account.
   *
   * It used to be hardcoded true here, so a server with no Stripe keys showed
   * "Connect a bank account" to everyone who had never connected one — and the
   * button failed somewhere inside the SDK when pressed. The one case the
   * comment on the field describes, "Stripe isn't configured on this server at
   * all", was the case it got wrong.
   */
  const { isStripeConfigured } = await import("./stripeClient");
  const none = { connected: false, payoutsEnabled: false, detailsSubmitted: false, available: isStripeConfigured() };
  if (!user?.accountId) return none;
  try {
    const { getUncachableStripeClient } = await import("./stripeClient");
    const stripe = await getUncachableStripeClient();
    const account = await stripe.accounts.retrieve(user.accountId);
    return {
      connected: true,
      payoutsEnabled: Boolean(account.payouts_enabled),
      detailsSubmitted: Boolean(account.details_submitted),
      available: true,
    };
  } catch (err) {
    /*
     * No Stripe on this server, or it refused. The page says "not available
     * here" rather than "you have no bank account", because those are
     * different things and only one of them is the person's to fix.
     */
    console.error(`[earnings] couldn't read the connected account for ${userId}:`, (err as Error)?.message ?? err);
    return { ...none, connected: true, available: false };
  }
}
