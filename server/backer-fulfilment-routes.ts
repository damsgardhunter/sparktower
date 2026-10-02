/**
 * What the team owes its backers, and marking it done.
 *
 * Most of what a tier promises is the platform's job and needs no tracking: the
 * name on the wall, the believer number, the badge, the certificate are all true
 * the moment the pledge lands. Two are not. `early_access` and `video_thankyou`
 * carry `fulfilledBy: "creator"` in shared/backing.ts, which means a person has to
 * go and do something — and until now nothing anywhere recorded whether they had.
 *
 * So the owner's list showed what each backer was *owed* and never what was
 * *done*, which meant running a campaign properly required a spreadsheet beside
 * it. And the backer who paid for a personal video had no way of knowing whether
 * it was coming.
 *
 * ## Who can see this
 *
 * Any member of the project, not just the owner — recording thank-you videos is
 * exactly the kind of work a team splits up, and a list only the owner can open is
 * a list the owner does alone.
 *
 * That is wider than `GET /api/projects/:id/backing/backers`, which is owner-only
 * and says so, and the difference is deliberate rather than an oversight: **this
 * route never sends an email address or a postal address.** Those are on the
 * owner's list because the owner may need them; nobody needs to read an address by
 * hand to fulfil anything, because Printful is given it directly. A team member
 * gets a name, what is owed, and what has been done.
 *
 * ## Which pledges count
 *
 * `held`, `released` and `converted` — the same three `server/platform-revenue.ts`
 * uses for "the money was actually taken". A refunded backer is owed nothing, and
 * a pending or failed one never paid. Showing those would have a team recording
 * videos for people who did not back them.
 */
import type { Express, Response } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import {
  backerRewardFulfilments, projectBackerTiers, projectBackings, projectMembers,
  projectMerchOrders, projects, userProfiles,
} from "@shared/schema";
import { users } from "@shared/models/auth";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { rateLimit } from "./moderation";
import { DIGITAL_REWARDS, digitalReward, merchProduct } from "@shared/backing";
import { notify } from "./notifications";
import { ObjectStorageService } from "./replit_integrations/object_storage";

/** The pledge states that mean the money was taken and not given back. */
const OWING = ["held", "released", "converted"] as const;

/**
 * The reward keys a person has to go and do. Everything else happens by itself,
 * so putting it on a to-do list would be a list that is never empty.
 */
const CREATOR_REWARDS = DIGITAL_REWARDS.filter((r) => r.fulfilledBy === "creator").map((r) => r.key);

/**
 * The project, if this person is on it; otherwise a 404 has been sent.
 *
 * Re-read here rather than imported because `isProjectMember` in server/routes.ts
 * is not exported — the same thing `server/company-rhythm-routes.ts` does, for the
 * same reason. 404 rather than 403 so a project id is not confirmable.
 */
async function memberProject(res: Response, projectId: string, userId: string) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  let member = !!project && project.ownerId === userId;
  if (project && !member) {
    const [row] = await db.select({ id: projectMembers.id }).from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
    member = !!row;
  }
  if (!project || !member) {
    res.status(404).json({ message: "No such project." });
    return null;
  }
  return project;
}

export function registerBackerFulfilmentRoutes(app: Express) {
  /**
   * Everyone who backed, what they are owed, and what has been done.
   *
   * One query per table rather than one joined query: a backer can have several
   * merch orders and several fulfilments, and joining them multiplies the rows —
   * which is how a list like this comes to show somebody twice.
   */
  app.get("/api/projects/:id/backing/fulfilment", isAuthenticated, async (req: any, res) => {
    try {
      const project = await memberProject(res, String(req.params.id), req.user.id);
      if (!project) return;

      const backings = await db.select({
        backing: projectBackings,
        tierName: projectBackerTiers.name,
        tierRewards: projectBackerTiers.digitalRewards,
        tierMerch: projectBackerTiers.merchProducts,
        firstName: users.firstName,
        lastName: users.lastName,
        profileImageUrl: users.profileImageUrl,
        displayName: userProfiles.displayName,
        avatarUrl: userProfiles.avatarUrl,
      })
        .from(projectBackings)
        .innerJoin(users, eq(users.id, projectBackings.backerId))
        .leftJoin(userProfiles, eq(userProfiles.userId, projectBackings.backerId))
        .leftJoin(projectBackerTiers, eq(projectBackerTiers.id, projectBackings.tierId))
        .where(and(eq(projectBackings.projectId, project.id), inArray(projectBackings.status, OWING as any)))
        .orderBy(desc(projectBackings.createdAt));

      if (!backings.length) {
        return res.json({ rewards: rewardCatalogue(), backers: [], owed: 0, done: 0, merchInFlight: 0 });
      }

      const ids = backings.map((b) => b.backing.id);
      const [doneRows, merchRows] = await Promise.all([
        db.select().from(backerRewardFulfilments).where(inArray(backerRewardFulfilments.backingId, ids)),
        db.select().from(projectMerchOrders).where(inArray(projectMerchOrders.backingId, ids)),
      ]);

      const doneBy = new Map<string, typeof doneRows>();
      for (const row of doneRows) doneBy.set(row.backingId, [...(doneBy.get(row.backingId) ?? []), row]);
      const merchBy = new Map<string, typeof merchRows>();
      for (const row of merchRows) merchBy.set(row.backingId, [...(merchBy.get(row.backingId) ?? []), row]);

      /* Who did it, for a team that wants to see who covered what. */
      const actorIds = [...new Set(doneRows.map((r) => r.deliveredBy).filter((v): v is string => !!v))];
      const actors = actorIds.length
        ? await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
          .from(users).where(inArray(users.id, actorIds))
        : [];
      const actorName = new Map(actors.map((a) => [a.id, [a.firstName, a.lastName].filter(Boolean).join(" ") || "A teammate"]));

      let owed = 0;
      let done = 0;
      let merchInFlight = 0;

      const backers = backings.map((row) => {
        const tierRewards: string[] = Array.isArray(row.tierRewards) ? row.tierRewards as string[] : [];
        /* Only the ones somebody has to do. */
        const toDo = tierRewards.filter((key) => CREATOR_REWARDS.includes(key));
        const fulfilled = doneBy.get(row.backing.id) ?? [];
        const byKey = new Map(fulfilled.map((f) => [f.rewardKey, f]));

        const tasks = toDo.map((key) => {
          const record = byKey.get(key);
          if (record) done++; else owed++;
          return {
            rewardKey: key,
            label: digitalReward(key)?.label ?? key,
            done: !!record,
            deliveredAt: record?.deliveredAt ?? null,
            deliveredByName: record?.deliveredBy ? actorName.get(record.deliveredBy) ?? null : null,
            note: record?.note ?? null,
            hasVideo: !!record?.assetPath,
          };
        });

        const orders = (merchBy.get(row.backing.id) ?? []).map((order) => {
          if (order.status === "queued" || order.status === "submitted") merchInFlight++;
          return {
            id: order.id,
            status: order.status,
            /* The product names, not their keys: this is a list a person reads. */
            items: (Array.isArray(order.items) ? order.items as { product?: string }[] : [])
              .map((i) => merchProduct(String(i?.product ?? ""))?.label ?? i?.product)
              .filter(Boolean),
            trackingUrl: order.trackingUrl,
            submittedAt: order.submittedAt,
            lastError: order.lastError,
          };
        });

        return {
          backingId: row.backing.id,
          believerNumber: row.backing.believerNumber,
          /*
           * Named even when they chose to be anonymous, and flagged as such.
           * Anonymity governs the public wall, not whether the team recording a
           * personal video knows who it is for — the existing owner list makes the
           * same call, for the same reason.
           */
          name: row.displayName || [row.firstName, row.lastName].filter(Boolean).join(" ") || "A backer",
          anonymousOnWall: row.backing.isAnonymous,
          avatarUrl: row.avatarUrl || row.profileImageUrl || null,
          amountCents: row.backing.amountCents,
          tierName: row.backing.tierNameAtBacking || row.tierName,
          backedAt: row.backing.createdAt,
          message: row.backing.message,
          tasks,
          /* What the tier promises in merch, so a tier with no order yet still reads. */
          merchPromised: (Array.isArray(row.tierMerch) ? row.tierMerch as string[] : [])
            .map((key) => merchProduct(key)?.label ?? key),
          merchOrders: orders,
          /*
           * Whether an address was collected, without sending it. A shipping
           * reward and no address is the one merch problem a person has to chase.
           */
          hasShippingAddress: !!row.backing.shippingAddress,
        };
      });

      res.json({ rewards: rewardCatalogue(), backers, owed, done, merchInFlight });
    } catch (error) {
      console.error("Backer fulfilment list error:", error);
      res.status(500).json({ message: "Couldn't load your backers." });
    }
  });

  /**
   * Mark one owed reward done, and tell the backer.
   *
   * The telling is the point. Nothing else in the product changes visibly when a
   * creator records a video, so a delivery nobody is notified about is a file in a
   * bucket.
   */
  app.post("/api/projects/:id/backing/fulfilment", isAuthenticated, rateLimit("write"), async (req: any, res) => {
    try {
      const project = await memberProject(res, String(req.params.id), req.user.id);
      if (!project) return;

      const backingId = String(req.body?.backingId ?? "");
      const rewardKey = String(req.body?.rewardKey ?? "");
      if (!CREATOR_REWARDS.includes(rewardKey)) {
        return res.status(400).json({
          message: "That reward isn't one somebody has to deliver.",
          code: "invalid_input", field: "rewardKey",
        });
      }

      const [row] = await db.select({
        backing: projectBackings,
        tierRewards: projectBackerTiers.digitalRewards,
      })
        .from(projectBackings)
        .leftJoin(projectBackerTiers, eq(projectBackerTiers.id, projectBackings.tierId))
        .where(and(eq(projectBackings.id, backingId), eq(projectBackings.projectId, project.id)));
      if (!row) return res.status(404).json({ message: "No such backer on this project." });
      if (!(OWING as readonly string[]).includes(row.backing.status)) {
        return res.status(400).json({ message: "That pledge isn't standing, so nothing is owed on it.", code: "not_owing" });
      }

      /*
       * The tier has to actually promise it. Otherwise a mis-click records a
       * delivery against somebody who was never owed one, and the backer gets a
       * notification about a reward they did not buy.
       */
      const promised: string[] = Array.isArray(row.tierRewards) ? row.tierRewards as string[] : [];
      if (!promised.includes(rewardKey)) {
        return res.status(400).json({ message: "This backer's tier doesn't include that.", code: "not_promised" });
      }

      const assetPath = typeof req.body?.assetPath === "string" ? req.body.assetPath.trim() : "";
      if (assetPath && !assetPath.startsWith("/objects/")) {
        return res.status(400).json({ message: "That isn't an uploaded file.", code: "invalid_input", field: "assetPath" });
      }
      const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 1000) || null : null;

      const [saved] = await db.insert(backerRewardFulfilments)
        .values({
          backingId, projectId: project.id, rewardKey,
          assetPath: assetPath || null, note,
          deliveredBy: req.user.id, deliveredAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [backerRewardFulfilments.backingId, backerRewardFulfilments.rewardKey],
          /* Re-recording replaces: a video sent again is the same promise, kept better. */
          set: { assetPath: assetPath || null, note, deliveredBy: req.user.id, deliveredAt: new Date() },
        })
        .returning();

      /*
       * `allowSelf`, because a creator who backed their own project would
       * otherwise silently not be told — and `once` is wrong here: a video
       * re-recorded and re-sent is worth saying again.
       */
      await notify({
        recipients: [row.backing.backerId],
        actorId: req.user.id,
        kind: "reward_delivered",
        targetId: saved.id,
        projectId: project.id,
        excerpt: note ?? digitalReward(rewardKey)?.label ?? null,
        allowSelf: true,
      });

      res.json({ ok: true, fulfilment: saved });
    } catch (error) {
      console.error("Backer fulfilment save error:", error);
      res.status(500).json({ message: "Couldn't record that." });
    }
  });

  /** Undo it. Somebody will tick the wrong person, and the row is the only record. */
  app.delete("/api/projects/:id/backing/fulfilment/:backingId/:rewardKey", isAuthenticated, rateLimit("write"), async (req: any, res) => {
    try {
      const project = await memberProject(res, String(req.params.id), req.user.id);
      if (!project) return;
      await db.delete(backerRewardFulfilments).where(and(
        eq(backerRewardFulfilments.projectId, project.id),
        eq(backerRewardFulfilments.backingId, String(req.params.backingId)),
        eq(backerRewardFulfilments.rewardKey, String(req.params.rewardKey)),
      ));
      /*
       * The notification already sent is left alone. It said something true at the
       * time, and silently deleting what somebody was told is worse than a
       * notification about a video that is being re-recorded.
       */
      res.json({ ok: true });
    } catch (error) {
      console.error("Backer fulfilment undo error:", error);
      res.status(500).json({ message: "Couldn't undo that." });
    }
  });

  /**
   * The video itself.
   *
   * Addressed to one person, so it is served through a route that checks who is
   * asking rather than being made public: a link that works for anybody holding it
   * is not a personal thank-you, it is a file.
   *
   * The backer it was made for, or anybody on the project — the team needs to be
   * able to check what was sent.
   */
  app.get("/api/projects/:id/backing/fulfilment/:backingId/:rewardKey/video", isAuthenticated, async (req: any, res) => {
    try {
      const [row] = await db.select({
        fulfilment: backerRewardFulfilments,
        backerId: projectBackings.backerId,
      })
        .from(backerRewardFulfilments)
        .innerJoin(projectBackings, eq(projectBackings.id, backerRewardFulfilments.backingId))
        .where(and(
          eq(backerRewardFulfilments.projectId, String(req.params.id)),
          eq(backerRewardFulfilments.backingId, String(req.params.backingId)),
          eq(backerRewardFulfilments.rewardKey, String(req.params.rewardKey)),
        ));
      if (!row?.fulfilment.assetPath) return res.status(404).json({ message: "No video for that." });

      const isBacker = row.backerId === req.user.id;
      if (!isBacker) {
        /* Not the backer, so it has to be the team — and a 404 either way. */
        const project = await memberProject(res, String(req.params.id), req.user.id);
        if (!project) return;
      }

      const objects = new ObjectStorageService();
      const file = await objects.getObjectEntityFile(row.fulfilment.assetPath);
      /*
       * As a download when asked, like every other generated file — a backer may
       * want to keep the video somebody made for them.
       */
      const wantsDownload = req.query?.download === "1";
      await objects.downloadObject(file, res, 3600, undefined, wantsDownload ? "thank-you video" : undefined);
    } catch (error) {
      console.error("Backer fulfilment video error:", error);
      if (!res.headersSent) res.status(404).json({ message: "No video for that." });
    }
  });
}

/**
 * The other side of it: what *I* have been given, for the things I backed.
 *
 * In this file rather than beside `GET /api/me/backings`, which lives in
 * server/backing-routes.ts, because the two are about different things — that one
 * is the money, this one is what came of it — and because the fulfilment table is
 * here. A backer with nothing delivered gets an empty list rather than a 404: the
 * absence is the answer.
 */
export function registerMyRewardRoutes(app: Express) {
  app.get("/api/me/rewards", isAuthenticated, async (req: any, res) => {
    try {
      const rows = await db.select({
        fulfilment: backerRewardFulfilments,
        projectId: projects.id,
        projectTitle: projects.title,
        backingId: projectBackings.id,
      })
        .from(backerRewardFulfilments)
        .innerJoin(projectBackings, eq(projectBackings.id, backerRewardFulfilments.backingId))
        .innerJoin(projects, eq(projects.id, backerRewardFulfilments.projectId))
        .where(eq(projectBackings.backerId, req.user.id))
        .orderBy(desc(backerRewardFulfilments.deliveredAt));

      res.json(rows.map((r) => ({
        projectId: r.projectId,
        projectTitle: r.projectTitle,
        rewardKey: r.fulfilment.rewardKey,
        label: digitalReward(r.fulfilment.rewardKey)?.label ?? r.fulfilment.rewardKey,
        note: r.fulfilment.note,
        deliveredAt: r.fulfilment.deliveredAt,
        /*
         * The URL rather than a flag, so the client has nothing to assemble — and
         * null when there is no file, because "early access was opened up" has
         * nothing to watch.
         */
        videoUrl: r.fulfilment.assetPath
          ? `/api/projects/${r.projectId}/backing/fulfilment/${r.backingId}/${r.fulfilment.rewardKey}/video`
          : null,
      })));
    } catch (error) {
      console.error("My rewards error:", error);
      res.status(500).json({ message: "Couldn't load your rewards." });
    }
  });
}

/** The rewards a team can be on the hook for, so the client names them the same way. */
const rewardCatalogue = () =>
  DIGITAL_REWARDS.filter((r) => r.fulfilledBy === "creator")
    .map((r) => ({ key: r.key, label: r.label, description: r.description }));
