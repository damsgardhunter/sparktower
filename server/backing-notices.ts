/**
 * Telling people what happened to their money.
 *
 * Backing was built end to end — checkout, a reviewer's decision, a hold, a
 * release, a refund — and told nobody any of it. A backer paid and heard
 * nothing; their project was rejected and they heard nothing; the refund
 * arrived in their bank statement weeks later with no idea what it was. A
 * creator's campaign was approved or turned down in silence, and the money
 * landed, or didn't, without a word.
 *
 * Both channels, on purpose. The bell is where the product's own news lives,
 * and email is the only one that reaches somebody who isn't coming back today
 * — which is exactly the person whose pledge was refunded. Nothing here is
 * marketing, so nothing here needs an unsubscribe: it is the record of one
 * person's money, sent to the person whose money it is.
 *
 * Nothing in here throws. A pledge is not lost because an email bounced, and
 * a refund is not rolled back because the bell was unreachable — every caller
 * is in the middle of something that matters more.
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { users, projects, projectBackings } from "@shared/schema";
import { notify } from "./notifications";
import { sendEmail } from "./email";
import { publicBaseUrl } from "./public-url";

/** "$25.00", the way a receipt writes it. */
export const money = (cents: number): string =>
  `$${(Math.max(0, Math.round(cents)) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Recipient = { id: string; email: string | null; firstName: string | null; deletedAt: Date | null };

async function peopleFor(userIds: string[]): Promise<Recipient[]> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return [];
  return db.select({ id: users.id, email: users.email, firstName: users.firstName, deletedAt: users.deletedAt })
    .from(users).where(inArray(users.id, ids));
}

/** One message, to one person, by both routes. A closed account gets neither. */
async function tell(input: {
  to: Recipient;
  kind: Parameters<typeof notify>[0]["kind"];
  actorId: string;
  targetId: string;
  projectId: string;
  excerpt: string;
  subject: string;
  body: string;
  tag: string;
}): Promise<void> {
  const { to } = input;
  if (to.deletedAt) return;
  await notify({
    recipients: [to.id], actorId: input.actorId, kind: input.kind, targetId: input.targetId,
    projectId: input.projectId, excerpt: input.excerpt, allowSelf: true,
  });
  if (!to.email) return;
  await sendEmail({ to: to.email, subject: input.subject, text: input.body, tag: input.tag });
}

const projectOf = async (projectId: string) =>
  (await db.select({ id: projects.id, title: projects.title, ownerId: projects.ownerId })
    .from(projects).where(eq(projects.id, projectId)))[0];

/** Somebody backed a project: its owner hears about it. */
export async function pledgeReceived(input: { projectId: string; backerId: string; amountCents: number; tierName?: string | null }): Promise<void> {
  try {
    const project = await projectOf(input.projectId);
    if (!project) return;
    const [owner] = await peopleFor([project.ownerId]);
    const [backer] = await peopleFor([input.backerId]);
    if (!owner) return;
    const who = backer?.firstName || "Somebody";
    const link = `${publicBaseUrl()}/projects/${project.id}`;
    await tell({
      to: owner, kind: "pledge_received", actorId: input.backerId, targetId: `backing:${input.projectId}`,
      projectId: project.id,
      excerpt: `${money(input.amountCents)}${input.tierName ? ` · ${input.tierName}` : ""}`,
      subject: `${who} backed ${project.title} — ${money(input.amountCents)}`,
      body:
        `${who} backed ${project.title} with ${money(input.amountCents)}${input.tierName ? ` (${input.tierName})` : ""}.\n\n` +
        `The money is held until a reviewer has looked at your campaign, and you'll hear from us either way.\n\n${link}`,
      tag: "pledge_received",
    });
  } catch (err) {
    console.error("[backing] couldn't announce a pledge (non-fatal):", err);
  }
}

/** A reviewer decided. The creator is told; on a rejection, so is every backer, because their money is coming back. */
export async function campaignDecided(input: { projectId: string; decision: "approved" | "rejected"; reviewerId: string; notes?: string | null }): Promise<void> {
  try {
    const project = await projectOf(input.projectId);
    if (!project) return;
    const [owner] = await peopleFor([project.ownerId]);
    const link = `${publicBaseUrl()}/projects/${project.id}`;
    const approved = input.decision === "approved";
    if (owner) {
      await tell({
        to: owner, kind: "campaign_decision", actorId: input.reviewerId, targetId: `campaign:${project.id}:${input.decision}`,
        projectId: project.id,
        excerpt: approved ? "Your campaign was approved" : "Your campaign wasn't approved",
        subject: approved ? `${project.title}: your campaign is approved` : `${project.title}: your campaign wasn't approved`,
        body: approved
          ? `A reviewer approved backing for ${project.title}. Money already pledged can be released to you, and new pledges are no longer held.\n\n${link}`
          : `A reviewer didn't approve backing for ${project.title}.` +
            `${input.notes ? `\n\nWhat they said: ${input.notes}` : ""}\n\n` +
            `Every pledge is being refunded in full — your backers are being told, and nobody is out of pocket. You can fix what was raised and submit again.\n\n${link}`,
        tag: "campaign_decision",
      });
    }
    if (approved) return;

    // The backers, who are about to see money come back and deserve to know why.
    const held = await db.select({ userId: projectBackings.backerId, amountCents: projectBackings.amountCents })
      .from(projectBackings)
      .where(eq(projectBackings.projectId, project.id));
    const backers = await peopleFor(held.map((b) => b.userId));
    for (const backer of backers) {
      const mine = held.filter((b) => b.userId === backer.id).reduce((sum, b) => sum + b.amountCents, 0);
      if (mine <= 0) continue;
      await tell({
        to: backer, kind: "pledge_refunding", actorId: input.reviewerId, targetId: `campaign:${project.id}:rejected`,
        projectId: project.id,
        excerpt: `${money(mine)} is being refunded`,
        subject: `${project.title} wasn't approved — your ${money(mine)} is being refunded`,
        body:
          `${project.title} wasn't approved for backing on SparkTower, so your pledge of ${money(mine)} is being refunded in full.\n\n` +
          `Refunds go back to the card you paid with and usually appear within a few days, depending on your bank. You don't need to do anything.\n\n${link}`,
        tag: "pledge_refunding",
      });
    }
  } catch (err) {
    console.error("[backing] couldn't announce a review decision (non-fatal):", err);
  }
}

/** The money went to the creator. Each backer is told what theirs did. */
export async function pledgesReleased(input: { projectId: string; releasedBy: string; backings: { backerId: string; amountCents: number }[] }): Promise<void> {
  try {
    if (!input.backings.length) return;
    const project = await projectOf(input.projectId);
    if (!project) return;
    const link = `${publicBaseUrl()}/projects/${project.id}`;
    const backers = await peopleFor(input.backings.map((b) => b.backerId));
    for (const backer of backers) {
      const mine = input.backings.filter((b) => b.backerId === backer.id).reduce((sum, b) => sum + b.amountCents, 0);
      if (mine <= 0) continue;
      await tell({
        to: backer, kind: "pledge_released", actorId: input.releasedBy, targetId: `released:${project.id}`,
        projectId: project.id,
        excerpt: `${money(mine)} went to ${project.title}`,
        subject: `Your ${money(mine)} went to ${project.title}`,
        body:
          `${project.title} passed review, so your pledge of ${money(mine)} has gone to the people building it.\n\n` +
          `You'll see their updates in your feed, and anything you were promised comes from them.\n\n${link}`,
        tag: "pledge_released",
      });
    }
  } catch (err) {
    console.error("[backing] couldn't announce a release (non-fatal):", err);
  }
}

/** A refund actually went through — the sweep, a closed account, a campaign that ended. */
export async function pledgeRefunded(input: { projectId: string; backerId: string; amountCents: number; reason: "not_approved" | "creator_left" | "expired" }): Promise<void> {
  try {
    const project = await projectOf(input.projectId);
    const [backer] = await peopleFor([input.backerId]);
    if (!backer) return;
    const title = project?.title ?? "a project you backed";
    const why = input.reason === "creator_left"
      ? "The person building it closed their account, so the project is gone."
      : input.reason === "not_approved"
        ? "It wasn't approved for backing on SparkTower."
        : "It didn't go ahead in time.";
    await tell({
      to: backer,
      kind: "pledge_refunded",
      // Nobody did this to them: the actor is the backer, and allowSelf carries it.
      actorId: input.backerId,
      targetId: `refunded:${input.projectId}`,
      projectId: input.projectId,
      excerpt: `${money(input.amountCents)} refunded`,
      subject: `Refunded: ${money(input.amountCents)} from ${title}`,
      body:
        `Your pledge of ${money(input.amountCents)} to ${title} has been refunded in full.\n\n${why}\n\n` +
        `It goes back to the card you paid with and usually appears within a few days, depending on your bank. There's nothing for you to do.`,
      tag: "pledge_refunded",
    });
  } catch (err) {
    console.error("[backing] couldn't announce a refund (non-fatal):", err);
  }
}
