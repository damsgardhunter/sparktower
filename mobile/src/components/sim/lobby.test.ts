/**
 * The lobby's arithmetic and its wording, driven through the cases that would
 * show four people something different from each other.
 *
 * The clock is the one worth the most care: the room is live, everyone is
 * watching the same number, and a countdown that drifts or ticks backwards is
 * how a phase ends "early" on one phone and not on another.
 */
import { describe, it, expect } from "vitest";
import {
  clockIsUrgent, formatCount, formatCountdown, incumbentHold, liveVentures, loyaltyRead,
  phaseCopy, remainingSeconds, seasonOver, seatStatus, ventureAction, ventureRoute,
  ventureSubtitle, ventureTitle, venturesPollMs, VENTURES_POLL_FAST_MS, VENTURES_POLL_IDLE_MS,
  deskPollMs, DESK_POLL_CLOSING_MS, DESK_POLL_IDLE_MS, DESK_CLOSING_WINDOW_MS, standingsPollMs, STANDINGS_POLL_CLOSING_MS, STANDINGS_POLL_IDLE_MS,
  venturePollMs, VENTURE_POLL_GATHERING_MS, VENTURE_POLL_RUNNING_MS,
  type LiveVenture, type SimPhase, type SimSeat,
} from "./lobby";

const seat = (over: Partial<SimSeat> = {}): SimSeat => ({
  userId: "u1", name: "Dana", avatarUrl: null, role: null, assigned: false, isYou: false, ...over,
});

describe("the countdown between polls", () => {
  it("ticks down locally from the server's reading", () => {
    const anchor = { secondsLeft: 120, atMs: 1_000_000 };
    expect(remainingSeconds(anchor, 1_000_000)).toBe(120);
    expect(remainingSeconds(anchor, 1_003_000)).toBe(117);
  });

  it("re-anchors rather than accumulating drift", () => {
    // A poll two and a half seconds later says 100, not 117.5: the server's
    // answer replaces the local one outright, which is the whole point.
    const fresh = { secondsLeft: 100, atMs: 1_002_500 };
    expect(remainingSeconds(fresh, 1_002_500)).toBe(100);
  });

  it("never runs backwards, even if the device clock steps back", () => {
    const anchor = { secondsLeft: 60, atMs: 1_000_000 };
    expect(remainingSeconds(anchor, 990_000)).toBe(60);
  });

  it("stops at zero instead of going negative while a poll is in flight", () => {
    expect(remainingSeconds({ secondsLeft: 2, atMs: 0 }, 60_000)).toBe(0);
  });

  it("passes an unbounded phase through untouched", () => {
    // `secondsLeft` is Infinity for a phase with no deadline; formatting owns
    // that case rather than the arithmetic pretending it's a number.
    expect(remainingSeconds({ secondsLeft: Infinity, atMs: 0 }, 9e9)).toBe(Infinity);
    expect(formatCountdown(Infinity)).toBe("--:--");
  });
});

describe("formatting the clock", () => {
  it("pads the seconds so the number doesn't jump about", () => {
    expect(formatCountdown(125)).toBe("2:05");
    expect(formatCountdown(9)).toBe("0:09");
    expect(formatCountdown(0)).toBe("0:00");
  });

  it("floors rather than rounds, so it never shows a second that's already gone", () => {
    expect(formatCountdown(59.9)).toBe("0:59");
  });

  it("calls the last minute urgent", () => {
    expect(clockIsUrgent(61)).toBe(false);
    expect(clockIsUrgent(60)).toBe(true);
    expect(clockIsUrgent(Infinity)).toBe(false);
  });
});

describe("what the room says, to whom", () => {
  const base = { here: 3, lobbySize: 5, yourRoleTitle: null, isCeo: false, ceoName: null, companyName: null };

  it("counts down the people, not the seats, while filling", () => {
    expect(phaseCopy({ ...base, phase: "filling" }).title).toBe("Waiting for 2 more");
    expect(phaseCopy({ ...base, phase: "filling", here: 5 }).title).toBe("The room is full");
  });

  it("tells someone without a seat that one will be dealt to them", () => {
    const copy = phaseCopy({ ...base, phase: "claiming" });
    expect(copy.title).toBe("Pick a seat");
    expect(copy.body).toMatch(/dealt out/);
  });

  it("tells someone with a seat they can still swap", () => {
    const copy = phaseCopy({ ...base, phase: "claiming", yourRoleTitle: "Chief Financial Officer" });
    expect(copy.title).toBe("You're the Chief Financial Officer");
    expect(copy.body).toMatch(/release/i);
  });

  it("names whose turn it is during naming, for the four people waiting", () => {
    expect(phaseCopy({ ...base, phase: "naming", ceoName: "Dana" }).title).toBe("Dana is naming the company");
    expect(phaseCopy({ ...base, phase: "naming", isCeo: true }).title).toBe("Name the company");
  });

  it("falls back to the seat when the room has no name for the chief executive yet", () => {
    expect(phaseCopy({ ...base, phase: "naming" }).title).toMatch(/chief executive/i);
  });

  it("hands off to year one under the company's own name", () => {
    expect(phaseCopy({ ...base, phase: "running", companyName: "Kestrel Works" }).title).toBe("Kestrel Works is trading");
    expect(phaseCopy({ ...base, phase: "running" }).title).toBe("Year one has begun");
  });

  it("explains a retired room instead of leaving a dead end", () => {
    expect(phaseCopy({ ...base, phase: "retired" }).body).toMatch(/another/);
    // A finished season is not a room that never filled.
    const over = phaseCopy({ ...base, phase: "retired", seasonOver: true });
    expect(over.title).toBe("Season over");
    expect(over.body).not.toMatch(/not enough/i);
  });
});

describe("a seat in the list", () => {
  it("says a dealt seat was dealt", () => {
    const s = seatStatus(seat({ role: "coo", assigned: true }), "Chief Operating Officer");
    expect(s.label).toBe("Chief Operating Officer");
    expect(s.note).toMatch(/Dealt by the clock/);
  });

  it("says nothing extra about a seat somebody chose", () => {
    expect(seatStatus(seat({ role: "coo" }), "Chief Operating Officer").note).toBeNull();
  });

  it("marks the people who haven't decided, because they're who the clock is for", () => {
    const s = seatStatus(seat(), null);
    expect(s.settled).toBe(false);
    expect(s.label).toBe("Still choosing");
  });
});

describe("reading a market", () => {
  it("turns loyalty into the thing it decides", () => {
    expect(loyaltyRead(0.86).label).toBe("Locked in");
    expect(loyaltyRead(0.72).label).toBe("Sticky");
    expect(loyaltyRead(0.45).label).toBe("Persuadable");
    expect(loyaltyRead(0.18).label).toBe("On the rope");
  });

  it("adds the incumbents up to the ~90% a team has to take from", () => {
    expect(incumbentHold([{ name: "a", share: 0.34, posture: "fortress" }, { name: "b", share: 0.26, posture: "brawler" }])).toBe(60);
    expect(incumbentHold([])).toBe(0);
  });

  it("shortens customer counts so two segments can be compared at a glance", () => {
    expect(formatCount(420_000)).toBe("420k");
    expect(formatCount(22_000)).toBe("22k");
    expect(formatCount(1_250_000)).toBe("1.3m");
    expect(formatCount(2_000_000)).toBe("2m");
    expect(formatCount(840)).toBe("840");
  });

  it("treats a finished or abandoned season as over, and anything else as live", () => {
    // Positive check against the two closed states: a status this build
    // hasn't heard of should leave a screen working rather than silently
    // disable every button on it.
    expect(seasonOver("finished")).toBe(true);
    expect(seasonOver("abandoned")).toBe(true);
    expect(seasonOver("running")).toBe(false);
    expect(seasonOver("forming")).toBe(false);
    expect(seasonOver("paused-for-maintenance")).toBe(false);
    expect(seasonOver(null)).toBe(false);
    expect(seasonOver(undefined)).toBe(false);
  });
});

const venture = (over: Partial<LiveVenture> = {}): LiveVenture => ({
  id: "v1", phase: "running", name: "Ledgerly", role: "cfo",
  niche: { id: "bookkeeping", name: "Bookkeeping software" }, secondsLeft: null, ...over,
});

describe("getting back into a company you are already running", () => {
  it("sends a trading company to the desk and a lobby to the room", () => {
    // Two different screens: the room for a trading company is a dead lobby,
    // and the desk for a room still picking seats has no year to show.
    expect(ventureRoute(venture({ phase: "running" }))).toBe("/sim/desk/v1");
    for (const phase of ["filling", "claiming", "naming"] as SimPhase[]) {
      expect(ventureRoute(venture({ phase }))).toBe("/sim/v1");
    }
  });

  /*
   * The list is polled because the route above depends on a row's phase. How
   * often it is worth polling follows from which flips can actually happen —
   * see `venturesPollMs`. It matters more than it looks: this query is mounted
   * by the Sprints tab, so the fast rate applied to people who were nowhere
   * near a simulation, and at two hundred players it was 45% of everything the
   * phone asked the server for.
   */
  it("keeps asking quickly while a row could still change which screen it opens", () => {
    for (const phase of ["filling", "claiming", "naming"] as SimPhase[]) {
      expect(venturesPollMs([venture({ phase })]), phase).toBe(VENTURES_POLL_FAST_MS);
    }
    // One row still deciding is reason enough, however many are already running.
    expect(venturesPollMs([venture({ phase: "running" }), venture({ phase: "claiming" })]))
      .toBe(VENTURES_POLL_FAST_MS);
  });

  it("slows down once every row is somewhere it will stay", () => {
    // `running` is the only phase with a desk behind it, and nothing moves from
    // running back to a lobby — so no row here can start opening a different
    // screen, and there is nothing to be quick about.
    expect(venturesPollMs([venture({ phase: "running" })])).toBe(VENTURES_POLL_IDLE_MS);
    expect(venturesPollMs([venture({ phase: "running" }), venture({ phase: "retired" })]))
      .toBe(VENTURES_POLL_IDLE_MS);
  });

  it("does not poll an empty or missing list quickly", () => {
    /*
     * Nothing is waiting on this query to notice a new room: joining a market
     * navigates straight into the one it returns (`app/sim/index.tsx`), so an
     * empty list has nothing to be fast for.
     */
    expect(venturesPollMs([])).toBe(VENTURES_POLL_IDLE_MS);
    expect(venturesPollMs(undefined)).toBe(VENTURES_POLL_IDLE_MS);
  });

  it("asks more often while something is in flight than when nothing is", () => {
    // The relationship, so tuning the two numbers cannot invert them.
    expect(VENTURES_POLL_FAST_MS).toBeLessThan(VENTURES_POLL_IDLE_MS);
  });

  it("leaves retired rooms out of the list entirely", () => {
    // A retired room is one that ended before it started; a "resume" pointing
    // at it is an invitation to a screen that can only say no.
    const kept = liveVentures([
      venture({ id: "a", phase: "retired" }),
      venture({ id: "b", phase: "claiming" }),
      venture({ id: "c", phase: "running" }),
    ]);
    expect(kept.map((v) => v.id)).toEqual(["b", "c"]);
  });

  it("treats no ventures and no response as the same empty branch", () => {
    // Empty means the market picker is the whole screen, so an absent
    // response must not look like a company nobody can open.
    expect(liveVentures([])).toEqual([]);
    expect(liveVentures(undefined)).toEqual([]);
    expect(liveVentures([venture()]).length).toBe(1);
  });

  it("names an unnamed company rather than showing a blank row", () => {
    expect(ventureTitle(venture({ name: "Ledgerly" }))).toBe("Ledgerly");
    expect(ventureTitle(venture({ name: null }))).toBe("Your company");
    expect(ventureTitle(venture({ name: "   " }))).toBe("Your company");
  });

  it("says where the company trades and which seat is yours", () => {
    expect(ventureSubtitle(venture(), "Chief Financial Officer")).toBe("Bookkeeping software · you're the Chief Financial Officer");
    // Titles arrive with /api/sim/niches; until they do, the seat id in
    // capitals still tells a player the row is theirs.
    expect(ventureSubtitle(venture())).toBe("Bookkeeping software · you're the CFO");
    expect(ventureSubtitle(venture({ role: null }))).toBe("Bookkeeping software · seat not settled yet");
    expect(ventureSubtitle(venture({ niche: null }))).toBe("A market · you're the CFO");
  });

  it("says out loud which of the two screens the tap opens", () => {
    expect(ventureAction(venture({ phase: "running" }))).toBe("Open your desk");
    expect(ventureAction(venture({ phase: "filling" }))).toBe("Back to the room");
  });
});

describe("how often the desk asks about itself", () => {
  const NOW = 1_700_000_000_000;
  const at = (msFromNow: number) => new Date(NOW + msFromNow).toISOString();

  it("asks quickly while the year is closing, which is what the screen is for", () => {
    // Inside the window, and exactly on its edge.
    expect(deskPollMs({ phase: "running", resolvesAt: at(30_000) }, NOW)).toBe(DESK_POLL_CLOSING_MS);
    expect(deskPollMs({ phase: "running", resolvesAt: at(DESK_CLOSING_WINDOW_MS) }, NOW)).toBe(DESK_POLL_CLOSING_MS);
  });

  it("keeps asking quickly once the deadline has passed", () => {
    /*
     * The year is resolving right now, or the tick is a little behind it. Either
     * way this is the moment somebody is watching for, and a slow poll here
     * would be slow at precisely the wrong time.
     */
    expect(deskPollMs({ phase: "running", resolvesAt: at(-5_000) }, NOW)).toBe(DESK_POLL_CLOSING_MS);
  });

  it("settles down for the rest of the period", () => {
    // Still live enough to watch a teammate's filing arrive, which is the other
    // thing this screen is for — and the rate the browser's desk uses.
    expect(deskPollMs({ phase: "running", resolvesAt: at(6 * 60 * 60_000) }, NOW)).toBe(DESK_POLL_IDLE_MS);
    // And when the server says nothing about a deadline at all.
    expect(deskPollMs({ phase: "running" }, NOW)).toBe(DESK_POLL_IDLE_MS);
    expect(deskPollMs({ phase: "running", resolvesAt: null }, NOW)).toBe(DESK_POLL_IDLE_MS);
    expect(deskPollMs({ phase: "running", resolvesAt: "not a date" }, NOW)).toBe(DESK_POLL_IDLE_MS);
    expect(deskPollMs(undefined, NOW)).toBe(DESK_POLL_IDLE_MS);
  });

  it("keeps asking before year one, because year one is the thing that changes", () => {
    /*
     * `not_started` was once in the stop list, on the reasoning that nothing
     * changes before year one. Something does: year one. This is the one screen
     * whose whole content is "this will change shortly".
     */
    expect(deskPollMs({ phase: "not_started" }, NOW)).toBe(DESK_POLL_IDLE_MS);
  });

  it("stops once the season can no longer move", () => {
    for (const phase of ["finished", "over"]) {
      expect(deskPollMs({ phase, resolvesAt: at(10_000) }, NOW), phase).toBe(false);
    }
  });

  it("never asks more slowly while closing than at rest", () => {
    // The relationship, so tuning the two numbers cannot invert them.
    expect(DESK_POLL_CLOSING_MS).toBeLessThan(DESK_POLL_IDLE_MS);
  });
});

describe("how often the standings table asks", () => {
  const NOW = 1_700_000_000_000;
  const at = (ms: number) => new Date(NOW + ms).toISOString();

  it("is quick around the tick, which is the only moment the table changes", () => {
    /*
     * Quicker than the flat rate it replaced, on the screen somebody is most
     * likely to be staring at when a year lands — the original reason this
     * polled hard, now applied only when it is true.
     */
    expect(standingsPollMs({ status: "running", resolvesAt: at(20_000) }, NOW)).toBe(STANDINGS_POLL_CLOSING_MS);
    expect(standingsPollMs({ status: "running", resolvesAt: at(-3_000) }, NOW)).toBe(STANDINGS_POLL_CLOSING_MS);
  });

  it("barely asks between ticks, because the table cannot change", () => {
    expect(standingsPollMs({ status: "running", resolvesAt: at(4 * 60 * 60_000) }, NOW)).toBe(STANDINGS_POLL_IDLE_MS);
  });

  it("treats a missing deadline as not imminent", () => {
    /*
     * The safe direction. Guessing "imminent" from an absent field would make
     * every screen poll hard for ever on any response that omitted it.
     */
    expect(standingsPollMs({ status: "running" }, NOW)).toBe(STANDINGS_POLL_IDLE_MS);
    expect(standingsPollMs({ status: "running", resolvesAt: null }, NOW)).toBe(STANDINGS_POLL_IDLE_MS);
    expect(standingsPollMs(undefined, NOW)).toBe(STANDINGS_POLL_IDLE_MS);
  });

  it("stops on a finished season, which is a final table", () => {
    expect(standingsPollMs({ status: "finished", resolvesAt: at(1_000) }, NOW)).toBe(false);
  });

  it("rests more slowly than the desk does, and wakes just as fast", () => {
    // The desk has filings arriving between ticks; this table has nothing.
    expect(STANDINGS_POLL_IDLE_MS).toBeGreaterThan(DESK_POLL_IDLE_MS);
    expect(STANDINGS_POLL_CLOSING_MS).toBe(DESK_POLL_CLOSING_MS);
  });
});

describe("how often the room screen asks about itself", () => {
  it("asks quickly while the room is still gathering", () => {
    for (const phase of ["filling", "claiming", "naming"] as SimPhase[]) {
      expect(venturePollMs(phase), phase).toBe(VENTURE_POLL_GATHERING_MS);
    }
    // And before the first response, when the phase is not known yet.
    expect(venturePollMs(undefined)).toBe(VENTURE_POLL_GATHERING_MS);
  });

  it("keeps asking once the company is trading, slowly, so it learns the season ended", () => {
    /*
     * This used to stop. A season ends, the room goes `retired`, and the screen
     * never found out — so it went on saying "your company is trading… it's
     * yours for the season" about a season that was over, with the branch that
     * would have said otherwise sitting unreachable below it.
     */
    expect(venturePollMs("running")).toBe(VENTURE_POLL_RUNNING_MS);
    expect(venturePollMs("running")).not.toBe(false);
  });

  it("stops once the room is retired, which is genuinely final", () => {
    expect(venturePollMs("retired")).toBe(false);
  });

  it("asks less often once trading than while gathering", () => {
    // Gathering is the live part; trading changes once, at the end.
    expect(VENTURE_POLL_GATHERING_MS).toBeLessThan(VENTURE_POLL_RUNNING_MS);
  });
});
