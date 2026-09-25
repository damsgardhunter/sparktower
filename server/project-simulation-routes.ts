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
import { buildMarketPrompt, parseMarket } from "./nova-market";
import { respondToAiError } from "./ai-json";
import { nicheById, NICHES } from "@shared/simulation/niches";
import type { Niche } from "@shared/simulation/types";
import { marketShares, RIVALS_IN_A_CUSTOM_SEASON } from "@shared/simulation/custom-market";
import { marketScale } from "@shared/simulation/world";
import { STARTING_CASH } from "@shared/simulation/season";
import { marketNameOf } from "./simulation-scope";
import { TRAINING_YEARS_MIN, joinPathFor, newSeasonCode, seatKindFor, seatsHeld, SEAT_COLUMN, SEAT_PRICE_CENTS } from "./company-season-routes";
import { CADENCES, DEFAULT_YEARS, PERIOD_NAME, type Cadence } from "@shared/simulation/cadence";
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

      /*
       * How often the table decides: once a year, once a quarter, once a
       * month. The engine has run on periods rather than years for a while and
       * company seasons have been able to choose ever since — this one always
       * quietly picked yearly, which is the wrong default for somebody
       * rehearsing a business they are running *now*. A founder deciding
       * twelve times a simulated year is the closest this gets to their actual
       * week.
       *
       * `DEFAULT_YEARS` already knows how long each shape should run for, so
       * picking monthly does not also mean answering a question about length.
       */
      const cadence: Cadence = CADENCES.includes(req.body?.cadence) ? req.body.cadence : "yearly";

      /*
       * Playing again a market this project already paid for.
       *
       * A written market is the one thing in here that cannot be regenerated:
       * it exists for one business, and pressing the button twice produced two
       * different worlds — two different sets of rivals, two different shares —
       * so the season somebody learned from was stranded the moment it ended,
       * and a company could not run the same market twice to compare two
       * teams. It was stored all along (`customMarket`), and nothing ever read
       * it back.
       *
       * A replay costs nothing and is not a model call: same JSON, same
       * rivals, same arithmetic, provably. The cadence may change, because
       * "the same market, decided monthly instead of yearly" is a fair thing
       * to want and does not touch the market itself.
       */
      const replayOf = typeof req.body?.fromSeasonId === "string" ? req.body.fromSeasonId : null;
      let written: Niche | null = null;
      let replayed = false;

      if (replayOf) {
        const [prior] = await db.select().from(simSeasons).where(eq(simSeasons.id, replayOf));
        /*
         * It has to be this project's own. A season id is not a secret, and
         * "replay" must never become a way to read the market somebody else
         * paid Nova to write for their business.
         */
        const owner = prior?.companyId
          ? (await db.select({ projectId: companies.projectId }).from(companies).where(eq(companies.id, prior.companyId)))[0]
          : null;
        if (!prior || owner?.projectId !== project.id) {
          return res.status(404).json({ code: "no_such_season", message: "That season isn't one of this project's." });
        }
        written = prior.customMarket ? parseMarket(JSON.stringify(prior.customMarket), prior.nicheId) : null;
        if (!written) {
          return res.status(409).json({
            code: "nothing_to_replay",
            message: "That season plays one of our markets rather than one Nova wrote, so there is nothing of yours to replay. Build a new one.",
          });
        }
        replayed = true;
      }

      if (!replayed) {
      if (!openAiConfigured()) {
        return res.status(503).json({ code: "nova_unavailable", message: "Nova can't reach the model right now. You can still play the public market." });
      }

      const ent = await requireCredits(res, req.user.id, CREDIT_COSTS.simulationBuild, "building your simulation", { projectId: project.id, action: "simulationBuild" });
      if (!ent) return;

      const progress = await progressOf(project.id);
      const prompt = buildMarketPrompt({ project, progress, startup: true });

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
        /*
         * A call that threw and an answer that couldn't be read are the same
         * thing from here: no market came back. They used to be treated as
         * opposites — an unreadable answer fell through to the catalogue and
         * a thrown call returned a bare 500 — which meant whether somebody got
         * a season at all turned on how the model failed rather than on
         * anything about them. The fallback three lines down is the route's
         * stated promise ("not a dead end"), so a thrown call takes it too,
         * and `fellBack` tells them the market isn't theirs.
         */
        console.warn("[project-sim] the model failed; falling back to the nearest market:", (error as Error)?.message ?? error);
        written = null;
        /*
         * Unless there is nothing to fall back to. The catalogue is what makes
         * a failed call survivable, so when this project matches none of it
         * the unreadable answer is all there is, and it is said as one —
         * `respondToAiError` turns it into the 502 model_unreadable every
         * other AI route answers with, rather than a silent stock market
         * nobody asked for.
         */
        if (!nicheById(nearestMarket(project))) return respondToAiError(res, error, "your market");
      }
      }
      /*
       * A market Nova could not write is not a dead end. The nearest of the
       * seven is a worse fit and a perfectly good game, and somebody who
       * pressed a button should get a season either way.
       */
      /*
       * Four rivals, however many came back.
       *
       * The prompt asks for exactly four and models mostly oblige, but "mostly"
       * is not a thing to build a screen on: the panel lays them out side by
       * side as *the* competition, and five of them would be a lie about who is
       * seated. Trimmed by share so what goes is always the smallest — the four
       * that are left are the four a founder would have named anyway.
       */
      if (written && written.incumbents.length > RIVALS_IN_A_CUSTOM_SEASON) {
        written.incumbents = [...written.incumbents]
          .sort((a, b) => b.startingShare - a.startingShare)
          .slice(0, RIVALS_IN_A_CUSTOM_SEASON);
      }

      const fellBack = !written;
      const nicheId = written ? written.id : nearestMarket(project);
      if (!written && !nicheById(nicheId)) {
        return res.status(502).json({ code: "model_unreadable", message: "Nova couldn't write a market for this. Try again in a moment." });
      }

      /*
       * Charged for a market Nova actually wrote, and not for the catalogue —
       * and never for a replay, which called no model at all.
       *
       * This used to run the moment the model returned, above the line that
       * works out whether anything usable came back — so an empty or
       * unreadable answer took the credit, handed over one of the seven
       * stock markets and said nothing about it. The fallback is the right
       * behaviour and it is why the button is safe to press; billing it is
       * charging somebody for the thing they didn't ask for. A route that
       * simply never calls this has its hold released when the response ends
       * (server/credit-reservations.ts), so leaving it unpaid costs nothing.
       */
      if (!fellBack && !replayed) await storage.deductCredits(req.user.id, CREDIT_COSTS.simulationBuild);

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

        /*
         * The builder's own seat, so what they made is theirs to play.
         *
         * The gate on starting a season counts everybody sitting down against
         * the seats the company holds, and a new company holds none — so the
         * person who had just had a market written for their business was
         * asked to buy a seat before they could sit at their own table, every
         * time. Building includes one seat, and seats stay with the company,
         * so every replay after this is free too.
         *
         * Topped up to one rather than added: three markets built is three
         * markets, not three seats. The second person at the table is the
         * thing that is sold, and that is unchanged.
         */
        const seatKind = seatKindFor("nova", cadence);
        const column = SEAT_COLUMN[seatKind];
        if ((seatsHeld(company)[seatKind] ?? 0) < 1) {
          await tx.update(companies).set({ [column]: 1 }).where(eq(companies.id, company.id));
        }

        const [season] = await tx.insert(simSeasons).values({
          nicheId,
          name: `${written?.name ?? project.title ?? "Your market"} — season one`,
          status: "forming",
          /*
           * Long enough to be a season at whichever cadence they picked. A
           * monthly season running eight simulated years is ninety-six
           * decisions, which nobody finishes; `DEFAULT_YEARS` is the length
           * each shape was balanced for.
           */
          totalYears: cadence === "yearly" ? Math.max(TRAINING_YEARS_MIN, 8) : DEFAULT_YEARS[cadence],
          cadence,
          periodMinutes: null,
          companyId: company.id,
          inviteCode: newSeasonCode(),
          createdAt: now,
          scope: "home",
          /*
           * No bot companies beside the four. The panel says "here is who
           * already has this market", and seating three anonymous extras
           * behind that screen makes it untrue — the season I ran while
           * testing this listed nine companies against a market that had
           * promised four. The incumbents Nova wrote *are* the competition.
           */
          botTeams: 0,
          /*
           * Competent teammates, not filler.
           *
           * Every seat this person does not take is played by a bot, and the
           * default ones are called `filler` for a reason. Somebody running
           * their own business against four rivals should have a marketing
           * seat that spends like it means it — otherwise the season teaches
           * them that their plan failed when what failed was their table.
           */
          botSkill: "survivor",
          origin: "nova",
          customMarket: written ?? null,
        }).returning();
        return { company, season };
      });

      /*
       * What they are walking into, worked out from the world that was just
       * written rather than described in prose beside it.
       *
       * `marketShares` gives the four rivals and the room left over;
       * `marketScale` is the same factor `season.ts` sizes the opening bank
       * with, so the figure on this screen is the figure in the bank on the
       * first day — not an estimate of it.
       */
      const playing = (written ?? nicheById(nicheId))!;
      const { rivals, open } = marketShares(playing);
      const openingCash = Math.round(STARTING_CASH * marketScale(playing));

      res.status(201).json({
        companyId: made.company.id,
        companyName: made.company.name,
        seasonId: made.season.id,
        inviteCode: made.season.inviteCode,
        joinUrl: made.season.inviteCode ? joinPathFor(made.season.inviteCode) : null,
        market: {
          name: marketNameOf(made.season),
          premise: playing.premise ?? "",
          written: !fellBack,
          segments: playing.segments.map((s) => ({ name: s.name, description: s.description, size: s.size })),
          regions: playing.cities.map((c) => ({ name: c.name, note: c.note })),
          rivals: rivals.map((r) => ({ name: r.name, knock: r.knock, share: r.share, posture: r.posture })),
          /** The share no incumbent holds: what year one is actually played for. */
          openShare: open,
        },
        /** How often the table decides, and what one decision is called. */
        cadence,
        periodName: PERIOD_NAME[cadence].one,
        /*
         * Whether this cost anything, and what the next person at the table
         * costs — both said here so the panel never has to guess at its own
         * pricing, which is how a screen ends up promising something the
         * server does not do.
         */
        replayed,
        /** Seats the company holds for this shape of season, the builder's included. */
        seatsHeld: Math.max(1, seatsHeld(made.company)[seatKindFor("nova", cadence)] ?? 0),
        seatPriceCents: SEAT_PRICE_CENTS[seatKindFor("nova", cadence)],
        /** What the company starts with, in the currency the project counts in. */
        openingCash,
        currency: project.currency ?? "USD",
        /*
         * Whether the other four seats will be played by people or by Nova.
         * A solo project is not asked to find four colleagues before it can
         * begin — the seats fill themselves, and the panel says so rather
         * than leaving somebody waiting for a table that is never coming.
         */
        solo: !!project.soloMode,
        /** Said plainly, because a market that is not theirs should not pretend to be. */
        fellBack,
      });
    } catch (error) {
      console.error("Project simulation error:", error);
      res.status(500).json({ message: "Couldn't set that up." });
    }
  });
}
