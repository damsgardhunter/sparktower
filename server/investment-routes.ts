/**
 * Applications to invest in a project.
 *
 * The founder opens applications and writes the ask; an investor who finds the
 * project applies from its public page; the founder reviews them in one inbox
 * and marks each one. Contact details are shown to the founder because the
 * investor consented to it on the form. Nothing here moves money or offers a
 * security — see shared/investment.ts.
 */
import type { Express } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { investmentApplications, projects, users, userProfiles } from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { rateLimit } from "./moderation";
import {
  INVESTMENT_DISCLAIMER, OWNER_STATUSES, sanitizeAsk, validateApplication, type InvestmentAsk,
} from "@shared/investment";

const OPEN_STATUSES = ["new", "reviewing", "accepted"] as const;

async function projectFor(id: string) {
  const [p] = await db.select().from(projects).where(eq(projects.id, id));
  return p ?? null;
}

export function registerInvestmentRoutes(app: Express) {
  /**
   * The ask, for the public page. Anyone who can see the project can read it;
   * a signed-in viewer also gets their own application, if they have one.
   */
  app.get("/api/projects/:id/investment", async (req: any, res) => {
    try {
      const project = await projectFor(req.params.id);
      if (!project) return res.status(404).json({ message: "Project not found" });
      const userId = req.user?.id as string | undefined;
      const isOwner = userId === project.ownerId;
      if (project.isPrivate && !isOwner && !(userId && (await storage.getProjectMembers(project.id)).some((m) => m.userId === userId))) {
        return res.status(404).json({ message: "Project not found" });
      }
      const [mine] = userId && !isOwner
        ? await db.select({ id: investmentApplications.id, status: investmentApplications.status, createdAt: investmentApplications.createdAt })
          .from(investmentApplications)
          .where(and(eq(investmentApplications.projectId, project.id), eq(investmentApplications.investorId, userId)))
          .orderBy(desc(investmentApplications.createdAt)).limit(1)
        : [];
      res.json({
        open: project.investmentOpen && !project.isPrivate,
        ask: (project.investmentAsk as InvestmentAsk | null) ?? null,
        isOwner,
        mine: mine ?? null,
        disclaimer: INVESTMENT_DISCLAIMER,
      });
    } catch (error) {
      console.error("Investment ask error:", error);
      res.status(500).json({ message: "Couldn't load that" });
    }
  });

  /** The founder opening or closing applications, and writing the ask. */
  app.patch("/api/projects/:id/investment", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    try {
      const project = await projectFor(req.params.id);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (project.ownerId !== req.user.id) return res.status(403).json({ message: "Only the project owner can change this." });
      const open = typeof req.body?.open === "boolean" ? req.body.open : project.investmentOpen;
      const ask = req.body?.ask !== undefined ? sanitizeAsk(req.body.ask) : (project.investmentAsk as InvestmentAsk | null);
      if (open && project.isPrivate) return res.status(400).json({ message: "A private project can't take applications — make it public first.", code: "invalid_input" });
      if (open && !ask?.headline) return res.status(400).json({ message: "Write a headline for the ask before opening applications.", code: "invalid_input", field: "headline" });
      const [updated] = await db.update(projects).set({ investmentOpen: open, investmentAsk: ask }).where(eq(projects.id, project.id)).returning();
      res.json({ open: updated.investmentOpen, ask: updated.investmentAsk });
    } catch (error) {
      console.error("Investment settings error:", error);
      res.status(500).json({ message: "Couldn't save that" });
    }
  });

  /** An investor applying. One open application per investor per project. */
  app.post("/api/projects/:id/investment/applications", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    try {
      const project = await projectFor(req.params.id);
      if (!project || project.isPrivate) return res.status(404).json({ message: "Project not found" });
      const userId = req.user.id as string;
      if (!project.investmentOpen) return res.status(400).json({ message: "This project isn't taking investment applications.", code: "not_open" });
      if (project.ownerId === userId || (await storage.getProjectMembers(project.id)).some((m) => m.userId === userId)) {
        return res.status(400).json({ message: "You can't apply to invest in your own project.", code: "invalid_input" });
      }
      const checked = validateApplication(req.body);
      if (!checked.ok) return res.status(400).json({ message: checked.message, code: "invalid_input", field: checked.field });
      const [existing] = await db.select({ id: investmentApplications.id }).from(investmentApplications)
        .where(and(eq(investmentApplications.projectId, project.id), eq(investmentApplications.investorId, userId), inArray(investmentApplications.status, [...OPEN_STATUSES])));
      if (existing) return res.status(409).json({ message: "You've already applied to this project. The founder has your application.", code: "already_applied" });
      const [row] = await db.insert(investmentApplications).values({ projectId: project.id, investorId: userId, ...checked.value }).returning();
      res.status(201).json({ id: row.id, status: row.status, createdAt: row.createdAt });
    } catch (error) {
      console.error("Investment application error:", error);
      res.status(500).json({ message: "Couldn't send your application" });
    }
  });

  /** The founder's inbox, newest first, with who applied and how to reach them. */
  app.get("/api/projects/:id/investment/applications", isAuthenticated, async (req: any, res) => {
    try {
      const project = await projectFor(req.params.id);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (project.ownerId !== req.user.id) return res.status(403).json({ message: "Only the project owner can see applications." });
      const rows = await db.select({
        app: investmentApplications,
        firstName: users.firstName, lastName: users.lastName, email: users.email,
        displayName: userProfiles.displayName, headline: userProfiles.headline, avatarUrl: userProfiles.avatarUrl,
      }).from(investmentApplications)
        .innerJoin(users, eq(users.id, investmentApplications.investorId))
        .leftJoin(userProfiles, eq(userProfiles.userId, investmentApplications.investorId))
        .where(eq(investmentApplications.projectId, project.id))
        .orderBy(desc(investmentApplications.createdAt))
        .limit(200);
      res.json(rows.map((r) => ({
        ...r.app,
        investor: {
          id: r.app.investorId,
          name: r.displayName || [r.firstName, r.lastName].filter(Boolean).join(" ") || "An investor",
          headline: r.headline ?? null, avatarUrl: r.avatarUrl ?? null,
          // Shared because they consented on the form; withdrawn applications keep their contact private again.
          email: r.app.status === "withdrawn" ? null : r.email,
          phone: r.app.status === "withdrawn" ? null : r.app.phone,
        },
      })));
    } catch (error) {
      console.error("Investment inbox error:", error);
      res.status(500).json({ message: "Couldn't load applications" });
    }
  });

  /** The founder marking an application, or the investor withdrawing it. */
  app.patch("/api/investment-applications/:id", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    try {
      const [row] = await db.select().from(investmentApplications).where(eq(investmentApplications.id, req.params.id));
      if (!row) return res.status(404).json({ message: "Application not found" });
      const project = await projectFor(row.projectId);
      const userId = req.user.id as string;
      const status = String(req.body?.status ?? "");
      if (userId === row.investorId) {
        if (status !== "withdrawn") return res.status(400).json({ message: "You can withdraw your application.", code: "invalid_input" });
        if (row.status === "withdrawn") return res.json(row);
        const [updated] = await db.update(investmentApplications).set({ status: "withdrawn", updatedAt: new Date() }).where(eq(investmentApplications.id, row.id)).returning();
        return res.json({ id: updated.id, status: updated.status });
      }
      if (!project || project.ownerId !== userId) return res.status(403).json({ message: "Only the project owner can review applications." });
      if (row.status === "withdrawn") return res.status(400).json({ message: "The investor withdrew this application.", code: "withdrawn" });
      const patch: Partial<typeof investmentApplications.$inferInsert> = { updatedAt: new Date() };
      if (status) {
        if (!(OWNER_STATUSES as readonly string[]).includes(status)) return res.status(400).json({ message: "Unknown status.", code: "invalid_input" });
        patch.status = status as any;
        patch.reviewedAt = new Date();
      }
      if (typeof req.body?.ownerNote === "string") patch.ownerNote = req.body.ownerNote.trim().slice(0, 2000) || null;
      const [updated] = await db.update(investmentApplications).set(patch).where(eq(investmentApplications.id, row.id)).returning();
      res.json(updated);
    } catch (error) {
      console.error("Investment review error:", error);
      res.status(500).json({ message: "Couldn't update that" });
    }
  });
}
