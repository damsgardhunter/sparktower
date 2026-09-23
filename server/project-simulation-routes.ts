/**
 * A season from a project, for somebody who has no company.
 *
 * The Simulations tab told most people the truth and left them nowhere to go:
 * private seasons belong to a company, this project belongs to a person, so
 * there is nothing here — set up a company account. Which is a form, about an
 * organisation that does not exist, standing between somebody and the thing
 * they came for.
 *
 * A project is already a business with a name, a description and a path
 * through it. That is enough to stand a company up from, so this does: one
 * company, owned by them, named after the project and linked to it, and then
 * a season in a market Nova writes from what they are actually building.
 *
 * The company is real, not a fiction. It is the same row a company account
 * uses, so the seasons list, the seats, the team and everything else work
 * afterwards — and if the project grows into a real company, it already has
 * one. What makes it feel temporary is that nobody had to fill in a form.
 */
import type { Express } from "express";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { companies, companyMembers, projects, simSeasons } from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { rateLimit } from "./moderation";
import { requireCredits, modelFor } from "./entitlements";
import { CREDIT_COSTS } from "@shared/plans";
import { storage } from "./storage";
import { openai, openAiConfigured } from "./openai-client";
import { respondToAiError, ModelResponseError } from "./ai-json";
import { buildMarketPrompt, parseMarket } from "./nova-market";
import { nicheById, NICHES } from "@shared/simulation/niches";
import { marketNameOf } from "./simulation-scope";
import { TRAINING_YEARS_MIN, joinPathFor, newSeasonCode } from "./company-season-routes";
import { pathStatus } from "./phase-trees";

/** A slug that says nothing about how many companies share a name. */
const slugify = (name: string) =>
  `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "company"}-${crypto.randomBytes(4).toString("hex")}`;

/**
 * Where the project has got to, if it is on a path.
 *
 * Nova is writing a market for a business, and a business that has shipped
 * nothing is not the same business as one with customers. Quietly skipped
 * when there is no path, rather than failing.
 */
async function progressOf(projectId: string): Promise<string | null> {
  try {
    const status = await pathStatus(projectId);
    if (!status?.adopted) return null;
    const phases = status.phases ?? [];
    const done = phases.reduce((sum: number, p: any) => sum + (p.done ?? 0), 0);
    const total = phases.reduce((sum: number, p: any) => sum + (p.total ?? 0), 0);
    const current = phases.find((p: any) => (p.done ?? 0) < (p.total ?? 0));
    return `Path: ${status.goal ?? "unnamed"} — ${done} of ${total} milestones done.${current ? ` Currently: ${current.title}.` : " Path complete."}`;
  } catch {
    return null;
  }
}

/** The catalogue market closest to a category, for when Nova cannot write one. */
function nearestMarket(project: { category?: string | null; description?: string | null }): string {
  const text = `${project.category ?? ""} ${project.description ?? ""}`.toLowerCase();
  const hit = NICHES.find((n) => text.includes(n.id.replace(/_/g, " ")) || text.includes(n.name.toLowerCase()));
  return hit?.id ?? NICHES[0].id;
}

export function registerProjectSimulationRoutes(app: Express): void {
  /**
   * Stand a company up from this project and give it a season in its own
   * market.
   *
   * Safe to press twice: a project that already has a company reuses it, so a
   * double-click is a second season rather than a second company.
   */
  app.post("/api/projects/:id/simulation", isAuthenticated, rateLimit("workspace"), async (req: any, res) => {
    try {
      const [project] = await db.select().from(projects).where(eq(projects.id, req.params.id));
      if (!project) return res.status(404).json({ message: "No such project." });
      /*
       * The owner's, and only the owner's. This creates a company and puts
       * them in it as owner, which is not a thing a collaborator should be
       * able to do to somebody else's project.
       */
      if (project.ownerId !== req.user.id) {
        return res.status(403).json({ code: "not_yours", message: "Only the person who owns this project can turn it into a company." });
      }

      if (!openAiConfigured()) {
        return res.status(503).json({ code: "nova_unavailable", message: "Nova can't reach the model right now. You can still play the public market." });
      }

      const ent = await requireCredits(res, req.user.id, CREDIT_COSTS.simulationBuild, "building your simulation", "simulationBuild");
      if (!ent) return;

      const progress = await progressOf(project.id);
      const prompt = buildMarketPrompt({ project, progress });

      let written;
      try {
        const completion = await openai.chat.completions.create({
          model: modelFor(ent),
          messages: [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
          ],
        });
        written = parseMarket(completion.choices[0]?.message?.content ?? "", `project_${project.id.slice(0, 8)}`);
      } catch (error) {
        return respondToAiError(res, error, "your market");
      }
      await storage.deductCredits(req.user.id, CREDIT_COSTS.simulationBuild);

      /*
       * A market Nova could not write is not a dead end. The nearest of the
       * seven is a worse fit and a perfectly good game, and somebody who
       * pressed a button should get a season either way.
       */
      const fellBack = !written;
      const nicheId = written ? written.id : nearestMarket(project);
      if (!written && !nicheById(nicheId)) {
        return res.status(502).json({ code: "model_unreadable", message: "Nova couldn't write a market for this. Try again in a moment." });
      }

      const now = new Date();
      const made = await db.transaction(async (tx) => {
        // The project's company, or a new one standing in for it.
        let [company] = await tx.select().from(companies).where(eq(companies.projectId, project.id));
        if (!company) {
          const name = (project.title ?? "My company").slice(0, 80);
          [company] = await tx.insert(companies).values({
            name,
            slug: slugify(name),
            description: (project.description ?? "").slice(0, 2000) || null,
            industry: project.category ?? null,
            projectId: project.id,
            createdBy: req.user.id,
            createdAt: now,
          }).returning();
          await tx.insert(companyMembers).values({ companyId: company.id, userId: req.user.id, role: "owner", joinedAt: now });
        }

        const [season] = await tx.insert(simSeasons).values({
          nicheId,
          name: `${written?.name ?? project.title ?? "Your market"} — season one`,
          status: "forming",
          totalYears: Math.max(TRAINING_YEARS_MIN, 8),
          periodMinutes: null,
          companyId: company.id,
          inviteCode: newSeasonCode(),
          createdAt: now,
          scope: "home",
          botTeams: 3,
          origin: "nova",
          customMarket: written ?? null,
        }).returning();
        return { company, season };
      });

      res.status(201).json({
        companyId: made.company.id,
        companyName: made.company.name,
        seasonId: made.season.id,
        inviteCode: made.season.inviteCode,
        joinUrl: made.season.inviteCode ? joinPathFor(made.season.inviteCode) : null,
        market: {
          name: marketNameOf(made.season),
          premise: written?.premise ?? nicheById(nicheId)?.premise ?? "",
          written: !fellBack,
          segments: (written ?? nicheById(nicheId))?.segments.map((s) => ({ name: s.name, description: s.description, size: s.size })) ?? [],
          regions: (written ?? nicheById(nicheId))?.cities.map((c) => ({ name: c.name, note: c.note })) ?? [],
          rivals: (written ?? nicheById(nicheId))?.incumbents.map((i) => ({ name: i.name, knock: i.persona.knock })) ?? [],
        },
        /** Said plainly, because a market that is not theirs should not pretend to be. */
        fellBack,
      });
    } catch (error) {
      console.error("Project simulation error:", error);
      res.status(500).json({ message: "Couldn't set that up." });
    }
  });
}
