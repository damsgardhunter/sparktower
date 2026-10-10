/**
 * What the marketplace tells people about their money.
 *
 * The backing side has five of these — a pledge arriving, a reviewer's
 * decision, a refund starting, a refund landing, money released — and its own
 * comment says why they exist: "A refund appearing in a bank statement weeks
 * later, unexplained, is how a person decides a product took their money."
 *
 * The marketplace shipped with none at all. This is the first, and it is the
 * one that cannot wait: when a seller closes their account, every buyer holding
 * unused seats is refunded (`refundOpenSeatsOnSellerClose`) without having
 * asked for anything. Money moving on somebody's balance with no word about it
 * is the exact failure the sentence above describes.
 *
 * The rest followed: a sale, the hold releasing, and a reviewer's takedown —
 * three events a seller previously learned by going and looking, by watching a
 * balance, and by trying to use something that had been removed.
 *
 * And one that reaches outwards rather than inwards. `listingPublished` tells
 * the people who follow a builder that they have put a new market up for sale,
 * which is the same promise `followed_post` already makes about their posts.
 * It is the only one of the five that is not about money, and the only one that
 * deliberately does not push: interesting is not urgent, and a push for every
 * listing by everybody you follow is how people turn pushes off altogether.
 */
import { eq } from "drizzle-orm";
import { db } from "./db";
import { users, userFollows, simulationListings } from "@shared/schema";
import { notify } from "./notifications";
import { sendEmail } from "./email";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** Their seats went back, because the person who sold them has gone. */
export async function seatsRefunded(input: {
  buyerId: string;
  listingId: string;
  seats: number;
  amountCents: number;
}): Promise<void> {
  const [buyer] = await db
    .select({ id: users.id, email: users.email, deletedAt: users.deletedAt })
    .from(users).where(eq(users.id, input.buyerId));
  /* A closed account has no bell to ring and no inbox to reach. */
  if (!buyer || buyer.deletedAt) return;

  const [listing] = await db
    .select({ title: simulationListings.title })
    .from(simulationListings).where(eq(simulationListings.id, input.listingId));
  const title = listing?.title ?? "a simulation you bought";
  const seats = `${input.seats} seat${input.seats === 1 ? "" : "s"}`;

  await notify({
    recipients: [buyer.id],
    /*
     * The actor is the buyer, as it is for a refund on the backing side:
     * nobody did this *to* them, and `allowSelf` is what carries that.
     */
    actorId: buyer.id,
    kind: "seats_refunded",
    targetId: `seats-refunded:${input.listingId}`,
    excerpt: `${money(input.amountCents)} back for ${seats} on ${title}`,
    allowSelf: true,
  });

  if (!buyer.email) return;
  await sendEmail({
    to: buyer.email,
    subject: `Refunded: ${money(input.amountCents)} for ${seats}`,
    text:
      `The person who wrote ${title} has closed their account, so the ${seats} you bought and `
      + `hadn't used have been refunded in full — ${money(input.amountCents)} is back on your balance.\n\n`
      + `Any seasons you already started from it are still yours and still playable. `
      + `There's nothing for you to do.`,
    tag: "seats_refunded",
  });
}

/**
 * A builder put a new market up for sale; the people who follow them hear.
 *
 * Fanned out to followers of the *person*, not of a project — a listing belongs
 * to its author rather than to the project whose season it came from, and
 * somebody following a project is following that project's progress, not its
 * owner's shop.
 *
 * No email. A bell is proportionate for "somebody you follow published
 * something"; an email for each one is how a product teaches people to filter
 * it out, and `followed_post` makes the same call for the same reason.
 */
export async function listingPublished(input: { listingId: string; authorId: string; title: string }): Promise<void> {
  const followers = await db.select({ id: userFollows.followerId })
    .from(userFollows).where(eq(userFollows.followeeId, input.authorId));
  if (!followers.length) return;

  await notify({
    recipients: followers.map((f) => f.id),
    actorId: input.authorId,
    kind: "listing_published",
    targetId: input.listingId,
    excerpt: input.title.slice(0, 160),
  });
}

/** Somebody bought seats. The seller has no other way to find out. */
export async function listingSold(input: {
  sellerId: string;
  listingId: string;
  seats: number;
  paidCents: number;
  heldDays: number;
}): Promise<void> {
  const [seller] = await db
    .select({ id: users.id, email: users.email, deletedAt: users.deletedAt })
    .from(users).where(eq(users.id, input.sellerId));
  if (!seller || seller.deletedAt) return;

  const [listing] = await db.select({ title: simulationListings.title })
    .from(simulationListings).where(eq(simulationListings.id, input.listingId));
  const title = listing?.title ?? "your simulation";
  const seats = `${input.seats} seat${input.seats === 1 ? "" : "s"}`;

  await notify({
    recipients: [seller.id],
    /*
     * The seller is the actor, not the buyer. Who bought it is not the seller's
     * business — the marketplace has never told a seller who its customers are,
     * and a notification is a poor place to start.
     */
    actorId: seller.id,
    kind: "listing_sold",
    targetId: input.listingId,
    excerpt: `${seats} of ${title}`,
    allowSelf: true,
  });

  if (!seller.email) return;
  await sendEmail({
    to: seller.email,
    subject: `${seats} sold: ${title}`,
    text:
      `Somebody bought ${seats} of ${title}.\n\n`
      + (input.paidCents > 0
        ? `Your share is held for ${input.heldDays} days while the buyer can still ask for a refund on seats `
          + `they haven't used, and then it's yours — you'll get another note when it lands.\n\n`
        : `It's a free listing, so there's nothing to pay out.\n\n`)
      + `Your earnings so far are on your marketplace page.`,
    tag: "listing_sold",
  });
}

/** The hold elapsed and the money is theirs. */
export async function earningsReleased(input: {
  sellerId: string;
  listingId: string;
  amountCents: number;
}): Promise<void> {
  const [seller] = await db
    .select({ id: users.id, email: users.email, deletedAt: users.deletedAt })
    .from(users).where(eq(users.id, input.sellerId));
  if (!seller || seller.deletedAt) return;

  const [listing] = await db.select({ title: simulationListings.title })
    .from(simulationListings).where(eq(simulationListings.id, input.listingId));
  const title = listing?.title ?? "a simulation you sold";

  await notify({
    recipients: [seller.id],
    actorId: seller.id,
    kind: "listing_earnings_released",
    targetId: input.listingId,
    excerpt: `${money(input.amountCents)} from ${title} is yours`,
    allowSelf: true,
  });

  if (!seller.email) return;
  await sendEmail({
    to: seller.email,
    subject: `${money(input.amountCents)} from ${title} is yours`,
    text:
      `The refund window on a sale of ${title} has closed, so ${money(input.amountCents)} has moved from `
      + `held to your balance.\n\nIt is income, and it is yours to declare — your marketplace page keeps `
      + `the record of what you earned and when.`,
    tag: "listing_earnings_released",
  });
}

/**
 * A reviewer removed it.
 *
 * The one notice here that is bad news, and the one most clearly owed: it is a
 * decision taken about somebody's work, with a written reason already recorded,
 * which they otherwise discover by trying to publish or play it and being
 * refused. The reason travels with it — a takedown somebody cannot understand
 * is a takedown they cannot answer or avoid repeating.
 */
export async function listingTakenDown(input: {
  authorId: string;
  listingId: string;
  reason: string;
}): Promise<void> {
  const [author] = await db
    .select({ id: users.id, email: users.email, deletedAt: users.deletedAt })
    .from(users).where(eq(users.id, input.authorId));
  if (!author || author.deletedAt) return;

  const [listing] = await db.select({ title: simulationListings.title })
    .from(simulationListings).where(eq(simulationListings.id, input.listingId));
  const title = listing?.title ?? "your simulation";

  await notify({
    recipients: [author.id],
    /*
     * The author, not the reviewer. Who decided is not the author's to see —
     * naming a reviewer on a moderation decision points a grievance at a
     * person — and the appeal route is the platform, not them.
     */
    actorId: author.id,
    kind: "listing_taken_down",
    targetId: input.listingId,
    excerpt: input.reason.slice(0, 200),
    allowSelf: true,
  });

  if (!author.email) return;
  await sendEmail({
    to: author.email,
    subject: `Taken down: ${title}`,
    text:
      `${title} has been taken off the marketplace by a reviewer.\n\nWhy: ${input.reason}\n\n`
      + `Seasons people already started from it keep working — nobody loses what they paid for. `
      + `It cannot be republished as it stands. If you think this is wrong, reply to this email.`,
    tag: "listing_taken_down",
  });
}
