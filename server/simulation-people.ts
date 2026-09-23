/**
 * Moving people between chairs: the database half of `closeYear` in
 * `shared/simulation/people.ts`.
 *
 * A seat is fired by its chief executive or resigns when its loyalty runs
 * out. Whoever was in it is replaced by a new hire — a bot, since the market
 * hire is the game's, not another player — and if whoever was in it was a
 * person, they are not simply dropped from the season. They move to another
 * table in the same market that has a bot sitting where a person could be,
 * preferably in the same role, and they are told where they went. A person
 * who has been let go by one company is somebody another company would have
 * wanted; that is the whole of the rule.
 *
 * If no table in the market has a bot to make room, they stay where they are
 * as an adviser — no chair, but still at the table — rather than being put
 * out of a game they are in the middle of.
 */
import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "./db";
import { simSeats, simVentures, users } from "@shared/schema";
import { botsFor } from "@shared/bots";
import { ROLE_TITLES, type Role } from "@shared/simulation/types";
import type { SeatMove } from "@shared/simulation/people";
import { ensureBotUser } from "./bot-accounts";
import { notify } from "./notifications";

export interface MoveOutcome {
  companyId: string;
  role: Role;
  /** A person who had to go somewhere, and where they went. */
  person?: { userId: string; to: string | null; asRole: Role | null };
}

/** A bot nobody at this table already is, for the chair being filled. */
async function newHire(ventureId: string, year: number, role: Role): Promise<string | null> {
  const seated = await db.select({ userId: simSeats.userId }).from(simSeats).where(eq(simSeats.ventureId, ventureId));
  const taken = new Set(seated.map((s) => s.userId));
  for (const identity of botsFor(`${ventureId}:hire:${year}:${role}`, 8)) {
    const id = await ensureBotUser(identity);
    if (id && !taken.has(id)) return id;
  }
  return null;
}

export async function applySeatMoves(input: { seasonId: string; year: number; moves: SeatMove[] }): Promise<MoveOutcome[]> {
  const out: MoveOutcome[] = [];
  for (const move of input.moves) {
    try {
      const [seat] = await db
        .select({ id: simSeats.id, userId: simSeats.userId, isBot: users.isBot })
        .from(simSeats)
        .leftJoin(users, eq(users.id, simSeats.userId))
        .where(and(eq(simSeats.ventureId, move.companyId), eq(simSeats.role, move.role)));
      if (!seat) continue;

      const hire = await newHire(move.companyId, input.year, move.role);
      if (!hire) continue;

      if (seat.isBot) {
        await db.update(simSeats).set({ userId: hire }).where(eq(simSeats.id, seat.id));
        out.push({ companyId: move.companyId, role: move.role });
        continue;
      }

      /*
       * A person. Somewhere else in this market with a bot in a chair, the
       * same role first; never a table they are already at.
       */
      const theirs = await db.select({ ventureId: simSeats.ventureId }).from(simSeats).where(eq(simSeats.userId, seat.userId));
      const already = theirs.map((t) => t.ventureId);
      const open = await db
        .select({ id: simSeats.id, ventureId: simSeats.ventureId, role: simSeats.role })
        .from(simSeats)
        .innerJoin(simVentures, eq(simVentures.id, simSeats.ventureId))
        .innerJoin(users, eq(users.id, simSeats.userId))
        .where(and(
          eq(simVentures.seasonId, input.seasonId),
          eq(simVentures.phase, "running"),
          ne(simSeats.ventureId, move.companyId),
          eq(users.isBot, true),
        ));
      const candidates = open.filter((o) => o.role && !already.includes(o.ventureId));
      const landing = candidates.find((o) => o.role === move.role) ?? candidates[0];

      if (landing) {
        await db.update(simSeats).set({ userId: seat.userId }).where(eq(simSeats.id, landing.id));
        await db.update(simSeats).set({ userId: hire }).where(eq(simSeats.id, seat.id));
        out.push({ companyId: move.companyId, role: move.role, person: { userId: seat.userId, to: landing.ventureId, asRole: landing.role as Role } });
        const [where] = await db.select({ name: simVentures.name }).from(simVentures).where(eq(simVentures.id, landing.ventureId));
        await notify({
          recipients: [seat.userId],
          actorId: seat.userId,
          allowSelf: true,
          kind: "sim_nudge",
          targetId: `${landing.ventureId}:moved:${input.year}`,
          excerpt: `${move.why === "fired" ? "You were replaced" : "You resigned"} as ${ROLE_TITLES[move.role].toLowerCase()}. ${where?.name ?? "Another company"} in the same market wanted you: you're their ${ROLE_TITLES[landing.role as Role].toLowerCase()} now.`,
        });
      } else {
        // Nowhere to go: stay at the table as an adviser, and the new hire takes the chair.
        await db.update(simSeats).set({ role: null }).where(eq(simSeats.id, seat.id));
        await db.insert(simSeats).values({ ventureId: move.companyId, userId: hire, role: move.role, claimedAt: new Date() });
        out.push({ companyId: move.companyId, role: move.role, person: { userId: seat.userId, to: null, asRole: null } });
        await notify({
          recipients: [seat.userId],
          actorId: seat.userId,
          allowSelf: true,
          kind: "sim_nudge",
          targetId: `${move.companyId}:adviser:${input.year}`,
          excerpt: `${move.why === "fired" ? "You were replaced" : "You resigned"} as ${ROLE_TITLES[move.role].toLowerCase()}. No other table had a chair free, so you stay on as an adviser: no decisions, but you can still see everything and talk to the table.`,
        });
      }
    } catch (err) {
      // One failed move must not stop the year from being saved or the rest from moving.
      console.error(`[sim] seat move for ${move.companyId}/${move.role} failed:`, err);
    }
  }
  return out;
}

/** Not used by the tick; exported for tests that want to see who sits where. */
export async function seatsOf(ventureIds: string[]) {
  if (!ventureIds.length) return [];
  return db.select({ ventureId: simSeats.ventureId, userId: simSeats.userId, role: simSeats.role, isBot: users.isBot })
    .from(simSeats).leftJoin(users, eq(users.id, simSeats.userId))
    .where(inArray(simSeats.ventureId, ventureIds));
}
