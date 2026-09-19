/**
 * Who everybody is: the two screens you open by tapping a name.
 *
 * The simulation had names everywhere and nothing behind any of them. A
 * standings table listed "Ember 39%" and a desk listed four rivals by price,
 * and in both cases the name was the end of the road — there was nowhere to go
 * to find out who Ember is, why they are at 39%, or what you would have to do
 * to take a point off them. The same was true of the four people you are
 * playing with: the desk said "still deciding" next to a name and gave you no
 * way to see what they were deciding, or to say anything to them about it.
 *
 * Both gaps are the same gap. A fortnight-long game is held together by the
 * fiction that there are other people in it — four teammates and eight rivals
 * with their own ideas — and a name with nothing behind it quietly dissolves
 * that back into a spreadsheet.
 *
 * ## Three routes
 *
 * A **company profile** for anybody in the market, incumbent or team: who they
 * are, where they stand, how they have moved over the season, and — the part
 * that makes it worth opening — how they compare with you, said in words
 * rather than left as two numbers next to each other.
 *
 * A **teammate profile**: their seat, what they have filed this year, how
 * often they turn up, and how their own challenge is going.
 *
 * A **nudge**: one notification, to one teammate, about one year.
 *
 * ## What a rival team is allowed to know about you
 *
 * Exactly what the standings already publish, and no more. Share, customers,
 * revenue, price and what the founders hold are on the league table for
 * everybody to read, so repeating them here leaks nothing. Cash, debt, credit
 * and what is in the research pipeline are not, and stay out — a game where
 * you can read a rival's bank balance is a game where the interesting decision
 * (do they have the money to follow me down?) has been answered for you.
 *
 * Quality, brand and service sit in between. They are genuinely observable —
 * you can tell whether a rival's product is good — so they are here, but as a
 * comparison rather than a number: "better regarded than you" rather than "71
 * against your 64". That is both more useful to read and impossible to
 * reverse-engineer a rival's exact position from.
 *
 * Incumbents get none of that discretion. They are the puzzle, and a puzzle
 * you cannot examine is just a wall.
 */
import type { Express } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db } from "./db";
import {
  simSeasons, simSeats, simVentures, simDecisions, simReports, simChallenges,
  users, userProfiles,
} from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { enforceRateLimit } from "./moderation";
import { nicheById } from "@shared/simulation/niches";
import { ROLE_TITLES, ROLE_LEVERS, type Role, type World, type Company, type Niche } from "@shared/simulation/types";
import { postureBlurb } from "@shared/simulation/incumbents";
import { notify } from "./notifications";

/** The seat this person holds in this venture, or nothing. */
async function seatOf(ventureId: string, userId: string) {
  const [seat] = await db.select().from(simSeats)
    .where(and(eq(simSeats.ventureId, ventureId), eq(simSeats.userId, userId)));
  return seat ?? null;
}

/**
 * The venture, the season and the world, for somebody who is actually in it.
 *
 * A stranger gets 404 rather than 403, deliberately and consistently with the
 * rest of the feature: "you are not allowed to see this company" confirms the
 * company exists, which is a thing a rival should not be able to establish by
 * trying identifiers.
 */
async function standing(ventureId: string, userId: string) {
  const [venture] = await db.select().from(simVentures).where(eq(simVentures.id, ventureId));
  if (!venture) return null;
  const seat = await seatOf(venture.id, userId);
  if (!seat) return null;
  const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, venture.seasonId));
  if (!season?.world) return null;
  const niche = nicheById(season.nicheId);
  if (!niche) return null;
  return { venture, seat, season, niche, world: season.world as World };
}

const headcount = (c: Company) => Object.values(c.customers).reduce((sum, n) => sum + n, 0);

/** What the owners hold — the figure the standings order by, so the same one here. */
function worth(c: Company): number {
  const assets = c.assets.reduce((sum, a) => sum + a.bookValue * 0.8, 0);
  return Math.max(0, Math.round((headcount(c) * c.price * 1.2 + assets - c.debt) * (c.founderShare ?? 1)));
}

/**
 * A comparison, in words.
 *
 * The whole reason to open somebody else's profile is the question "are they
 * beating me, and at what" — and two numbers side by side do not answer it.
 * Ninety-one against eighty-four is a rout or a rounding error depending on
 * the market, and the player has no way to know which.
 *
 * The bands are deliberately coarse. A precise answer here would be a way of
 * reading a rival's exact position off the screen, which is the thing the
 * discretion above exists to prevent.
 */
function compare(theirs: number, yours: number, better: string, worse: string, level: string): { verdict: string; edge: "them" | "you" | "level" } {
  const gap = theirs - yours;
  if (Math.abs(gap) < 4) return { verdict: level, edge: "level" };
  if (gap >= 18) return { verdict: `Far ${better}`, edge: "them" };
  if (gap > 0) return { verdict: better[0].toUpperCase() + better.slice(1), edge: "them" };
  if (gap <= -18) return { verdict: `Far ${worse}`, edge: "you" };
  return { verdict: worse[0].toUpperCase() + worse.slice(1), edge: "you" };
}

/**
 * Where this company and yours are fighting over the same people.
 *
 * The most actionable thing on the page. A rival with 30% of the market you
 * have never once competed with is a headline; a rival holding the segment you
 * are trying to take is your afternoon.
 */
function contested(them: Company, you: Company, niche: Niche) {
  return niche.segments
    .map((segment) => {
      const mine = you.customers[segment.id] ?? 0;
      const theirs = them.customers[segment.id] ?? 0;
      return { id: segment.id, name: segment.name, loyalty: segment.loyalty, yours: mine, theirs };
    })
    .filter((s) => s.theirs > 0)
    .sort((a, b) => b.theirs - a.theirs)
    .map((s) => ({
      ...s,
      /*
       * Whether this is a door or a wall, said plainly. Loyalty is the single
       * number that decides whether a segment can be taken at all, and it is
       * the one thing a player cannot work out by watching.
       */
      note: s.loyalty >= 0.7
        ? s.yours > 0
          ? "They hold this and it stays held. What you have taken here took years and will not come back easily."
          : "Loyal to them. Years of consistency, not one good campaign."
        : s.yours > 0
          ? "Contested, and these ones move. Whoever is best this year has them next year."
          : "They hold this and it is loose. This is the way in.",
    }));
}

export function registerSimulationProfileRoutes(app: Express): void {
  /**
   * Anybody in the market, opened from anywhere their name appears.
   */
  app.get("/api/sim/ventures/:id/companies/:companyId", isAuthenticated, async (req: any, res) => {
    const found = await standing(req.params.id, req.user.id);
    if (!found) return res.status(404).json({ message: "No such company." });
    const { venture, season, niche, world } = found;

    const you = world.companies.find((c) => c.id === venture.id);
    const them = world.companies.find((c) => c.id === req.params.companyId);
    if (!you || !them) return res.status(404).json({ message: "Nobody by that name in this market." });

    const seed = niche.incumbents.find((i) => i.id === them.id);
    const isYou = them.id === you.id;
    const isTeam = them.kind === "player";

    const total = world.companies.reduce((sum, c) => sum + headcount(c), 0);
    const ranked = [...world.companies].sort((a, b) => worth(b) - worth(a));
    const rank = ranked.findIndex((c) => c.id === them.id) + 1;

    /*
     * The season so far, from the reports. Written for every company in the
     * world and not only the player teams, which is what makes an incumbent's
     * history real rather than a sparkline over one number.
     */
    const history = await db
      .select({ year: simReports.year, report: simReports.report })
      .from(simReports)
      .where(and(eq(simReports.seasonId, season.id), eq(simReports.companyId, them.id)))
      .orderBy(desc(simReports.year))
      .limit(6);

    /*
     * A rival team's name for its own product is public — it is on the
     * standings and in the lobby — so it is here too.
     */
    const [theirVenture] = isTeam
      ? await db.select({ product: simVentures.product }).from(simVentures).where(eq(simVentures.id, them.id))
      : [];

    res.json({
      id: them.id,
      name: them.name,
      kind: them.kind,
      isYou,
      product: theirVenture?.product ?? null,
      /** Only incumbents have one. A player team's character is whatever they do. */
      persona: seed?.persona ?? null,
      posture: them.posture ?? null,
      posturedAs: them.posture ? postureBlurb(them.posture) : null,
      voice: niche.voice,

      standing: {
        rank,
        of: world.companies.length,
        customers: headcount(them),
        share: total > 0 ? headcount(them) / total : 0,
        revenue: Math.round(headcount(them) * them.price),
        price: Math.round(them.price),
        founderValue: worth(them),
        /** A team that has sold its business reads as empty; say which kind of empty. */
        soldBusinessIn: them.soldBusinessIn ?? null,
        bankrupt: !!them.bankruptSince,
      },

      /*
       * How they measure up against you. Numbers for an incumbent and for your
       * own company, comparisons for a rival team — see the note at the top.
       */
      reads: isYou ? [] : [
        {
          label: niche.voice.quality,
          ...(isTeam
            ? compare(them.quality, you.quality, "better than yours", "behind yours", "much the same as yours")
            : { verdict: `${Math.round(them.quality)} against your ${Math.round(you.quality)}`, edge: them.quality > you.quality ? "them" : "you" }),
        },
        {
          label: niche.voice.brand,
          ...(isTeam
            ? compare(them.brand, you.brand, "better known than you", "less known than you", "about as known as you")
            : { verdict: `${Math.round(them.brand)} against your ${Math.round(you.brand)}`, edge: them.brand > you.brand ? "them" : "you" }),
        },
        {
          label: niche.voice.service,
          ...(isTeam
            ? compare(them.service, you.service, "better than yours", "worse than yours", "level with yours")
            : { verdict: `${Math.round(them.service)} against your ${Math.round(you.service)}`, edge: them.service > you.service ? "them" : "you" }),
        },
        {
          label: `price ${niche.voice.per}`,
          verdict: them.price > you.price * 1.05
            ? `${Math.round(them.price).toLocaleString()} — dearer than you`
            : them.price < you.price * 0.95
              ? `${Math.round(them.price).toLocaleString()} — cheaper than you`
              : `${Math.round(them.price).toLocaleString()} — much what you charge`,
          edge: them.price < you.price ? "them" : "you",
        },
      ],

      /** Where the two of you are actually fighting. Empty when you are reading your own. */
      contested: isYou ? [] : contested(them, you, niche),

      history: history.map((h) => {
        const r = h.report as any;
        return {
          year: h.year,
          share: r?.marketShare ?? 0,
          shareChange: r?.shareChange ?? 0,
          customers: r?.customers ?? 0,
          /*
           * One line of what happened to them that year. An incumbent's note
           * is written by the engine when it decides how to defend, which is
           * the closest thing this game has to hearing a rival think.
           */
          note: Array.isArray(r?.notes) ? r.notes[0] ?? null : null,
        };
      }),
    });
  });

  /**
   * The year-end report: everything that happened to your company in one year.
   *
   * ## The single biggest gap in the game, closed here
   *
   * A year used to come back as four numbers and a handful of notes. You could
   * see that you lost two million and not which line lost it; that you ended
   * with fewer customers and not who took them or why. Decisions that cannot
   * be traced to outcomes cannot be learned from, and a fortnight of turning up
   * is supposed to be fourteen chances to learn.
   *
   * So this sends the whole of it: the accounts line by line, why the bank
   * balance moved, every segment's customers in and out by rival with the
   * reason for the biggest loss, and what every rival visibly did.
   *
   * Your own company's only. A rival's report is its private accounts; what
   * you may know about them is already in `rivals`, estimated from outside.
   * Readable after the season finishes, because the end of a season is when
   * people most want to read back through it.
   */
  /*
   * `{/:year}`, not `/:year?`. Express 5's router rejects the question-mark
   * form outright, and it rejects it when the route is registered — so the
   * old spelling does not fail this request, it fails the server's boot.
   */
  app.get("/api/sim/ventures/:id/reports{/:year}", isAuthenticated, async (req: any, res) => {
    const found = await standing(req.params.id, req.user.id);
    if (!found) return res.status(404).json({ message: "No such company." });
    const { venture, season, niche } = found;

    const rows = await db
      .select({ year: simReports.year, report: simReports.report })
      .from(simReports)
      .where(and(eq(simReports.seasonId, season.id), eq(simReports.companyId, venture.id)))
      .orderBy(desc(simReports.year));

    if (rows.length === 0) {
      return res.json({ years: [], report: null, niche: { id: niche.id, name: niche.name, voice: niche.voice } });
    }

    const wanted = req.params.year ? Number(req.params.year) : rows[0].year;
    const row = rows.find((r) => r.year === wanted);
    if (!row) return res.status(404).json({ message: "No report for that year." });

    res.json({
      years: rows.map((r) => r.year).sort((a, b) => a - b),
      year: row.year,
      totalYears: season.totalYears,
      companyName: venture.name,
      niche: { id: niche.id, name: niche.name, voice: niche.voice },
      report: row.report,
    });
  });

  /**
   * One of the four people you are doing this with.
   *
   * What they have filed is deliberately readable by the whole table. That is
   * not a concession, it is the design: five people privately making
   * reasonable decisions that are collectively ruinous is the failure this
   * game is built around, and the only defence against it is being able to see
   * what the others have committed while there is still time to argue.
   */
  app.get("/api/sim/ventures/:id/seats/:userId", isAuthenticated, async (req: any, res) => {
    const found = await standing(req.params.id, req.user.id);
    if (!found) return res.status(404).json({ message: "No such company." });
    const { venture, season, niche, world } = found;

    const [them] = await db
      .select({
        userId: simSeats.userId, role: simSeats.role, joinedAt: simSeats.joinedAt,
        firstName: users.firstName, lastName: users.lastName, isBot: users.isBot,
        displayName: userProfiles.displayName, headline: userProfiles.headline, avatarUrl: userProfiles.avatarUrl,
      })
      .from(simSeats)
      .leftJoin(users, eq(users.id, simSeats.userId))
      .leftJoin(userProfiles, eq(userProfiles.userId, simSeats.userId))
      .where(and(eq(simSeats.ventureId, venture.id), eq(simSeats.userId, req.params.userId)));

    if (!them) return res.status(404).json({ message: "Nobody by that name at this table." });

    const role = them.role as Role | null;
    const year = season.year;

    const [filed] = role
      ? await db.select().from(simDecisions).where(and(
          eq(simDecisions.ventureId, venture.id), eq(simDecisions.role, role), eq(simDecisions.year, year)))
      : [];

    /*
     * How often they turn up, counted rather than felt.
     *
     * A teammate who missed one year and a teammate who has never once opened
     * the app are completely different problems — one needs a nudge, the other
     * needs the chief executive to dissolve the seat and get the salary back.
     * The screen cannot tell them apart without this, and neither can the
     * person reading it.
     */
    const filedYears = role
      ? await db.select({ year: simDecisions.year }).from(simDecisions)
        .where(and(eq(simDecisions.ventureId, venture.id), eq(simDecisions.role, role)))
      : [];

    const challenges = role
      ? await db.select({ year: simChallenges.year, challenge: simChallenges.challenge, result: simChallenges.result })
        .from(simChallenges)
        .where(and(eq(simChallenges.ventureId, venture.id), eq(simChallenges.role, role)))
        .orderBy(desc(simChallenges.year))
        .limit(4)
      : [];

    const company = world.companies.find((c) => c.id === venture.id);
    const dissolved = !!role && !!company && !company.seats.includes(role);

    res.json({
      userId: them.userId,
      name: them.isBot ? [them.firstName, them.lastName].filter(Boolean).join(" ") : (them.displayName || them.firstName || "Someone"),
      headline: them.isBot ? null : them.headline,
      avatarUrl: them.isBot ? null : them.avatarUrl,
      isBot: !!them.isBot,
      isYou: them.userId === req.user.id,
      role,
      title: role ? ROLE_TITLES[role] : null,
      levers: role ? ROLE_LEVERS[role] : [],
      /** The seat exists on the team sheet but the engine no longer charges for it. */
      dissolved,

      year,
      filed: !!filed,
      /** What they actually committed. The whole point of the screen. */
      decision: filed?.payload ?? null,
      filedAt: filed?.submittedAt ?? null,

      turnout: {
        filed: new Set(filedYears.map((f) => f.year)).size,
        of: Math.max(0, year - 1) + 1,
        /** Consecutive years missed, ending with this one — the number worth acting on. */
        missedRunning: (() => {
          const had = new Set(filedYears.map((f) => f.year));
          let run = 0;
          for (let y = year; y >= 1; y--) {
            if (had.has(y)) break;
            run += 1;
          }
          return run;
        })(),
      },

      challenges: challenges.map((c) => ({
        year: c.year,
        title: (c.challenge as any)?.title ?? null,
        brief: (c.challenge as any)?.brief ?? null,
        met: (c.result as any)?.met ?? null,
      })),

      niche: { id: niche.id, name: niche.name, voice: niche.voice },
    });
  });

  /**
   * Tell a teammate the table is waiting on them.
   *
   * ## Why this is one notification and not a message
   *
   * The thing people need is not a chat, it is a tap. Somebody opens the desk,
   * sees three seats filed and one not, and wants to do the one thing that
   * might change it before tonight. Anything with a text box in it is a thing
   * they compose, reconsider, and close.
   *
   * ## Why it cannot be used twice
   *
   * The notification table is unique on (recipient, actor, kind, target), and
   * the target here carries the year — so one nudge per person, per teammate,
   * per year, and the second tap refreshes the first rather than stacking.
   * Without that this is a button for sending somebody fourteen notifications
   * in an afternoon, which is not a reminder, it is a reason to leave.
   *
   * And you cannot nudge somebody who has already filed. A reminder to do the
   * thing you did last night is worse than silence.
   */
  app.post("/api/sim/ventures/:id/nudge", isAuthenticated, async (req: any, res) => {
    if (!(await enforceRateLimit(res, req.user.id, "session"))) return;

    const found = await standing(req.params.id, req.user.id);
    if (!found) return res.status(404).json({ message: "No such company." });
    const { venture, season } = found;

    const targetId = String(req.body?.userId ?? "");
    if (!targetId) return res.status(400).json({ message: "Who?" });
    if (targetId === req.user.id) {
      return res.status(400).json({ message: "You know already." });
    }

    const [them] = await db
      .select({ userId: simSeats.userId, role: simSeats.role, isBot: users.isBot })
      .from(simSeats)
      .leftJoin(users, eq(users.id, simSeats.userId))
      .where(and(eq(simSeats.ventureId, venture.id), eq(simSeats.userId, targetId)));
    if (!them) return res.status(404).json({ message: "Nobody by that name at this table." });

    /*
     * A bot has no inbox and is going to file anyway. Refused in words rather
     * than silently succeeding, so nobody sits there wondering why the stand-in
     * never answered.
     */
    if (them.isBot) {
      return res.status(409).json({ message: "That seat is a stand-in. It files every year without being asked.", code: "is_bot" });
    }
    if (!them.role) {
      return res.status(409).json({ message: "They have not taken a seat yet.", code: "no_seat" });
    }

    const [already] = await db.select().from(simDecisions).where(and(
      eq(simDecisions.ventureId, venture.id), eq(simDecisions.role, them.role), eq(simDecisions.year, season.year)));
    if (already) {
      return res.status(409).json({ message: "They have already filed this year.", code: "already_filed" });
    }

    await notify({
      recipients: [targetId],
      actorId: req.user.id,
      kind: "sim_nudge",
      targetId: `${venture.id}:${season.year}`,
      excerpt: `${venture.name ?? "Your company"} is waiting on the ${ROLE_TITLES[them.role as Role].toLowerCase()} for year ${season.year}.`,
    });

    res.json({ ok: true, message: "Told them." });
  });
}
