/**
 * The rules of the room, and the dice the whole engine is built on.
 *
 * Both of these are load-bearing and neither had a test of its own. The lobby
 * rules were covered only through integration tests, which exercise them
 * through a database and an HTTP layer and therefore say nothing precise about
 * the rule itself; and `random.ts` had nothing at all, despite every claim
 * about a re-runnable tick resting on it.
 */
import { describe, it, expect } from "vitest";
import {
  LOBBY_SIZE, PHASE_SECONDS, ASSIGNMENT_ORDER,
  assignRemaining, allSeated, openRoles, canClaim, nextPhase, placeholderName,
  type SeatView,
} from "@shared/simulation/lobby";
import { hash, rng, pick, sample, between } from "@shared/simulation/random";
import { ROLES, type Role } from "@shared/simulation/types";

const seat = (userId: string, role: Role | null = null): SeatView => ({ userId, role, assigned: false });

describe("dealing out the seats nobody claimed", () => {
  it("leaves the seats people chose alone", () => {
    const out = assignRemaining([seat("a", "cto"), seat("b"), seat("c")]);
    expect(out.find((s) => s.userId === "a")!.role).toBe("cto");
    expect(out.find((s) => s.userId === "a")!.assigned).toBe(false);
  });

  it("gives everybody a job, and never the same one twice", () => {
    /*
     * A team of three with two empty seats is a team missing two of its five
     * sets of decisions every year, through no fault of the three who showed
     * up. Two people holding the same seat is worse.
     */
    const out = assignRemaining([seat("a"), seat("b"), seat("c"), seat("d"), seat("e")]);
    expect(out.every((s) => !!s.role)).toBe(true);
    expect(new Set(out.map((s) => s.role)).size).toBe(5);
    expect(out.every((s) => s.assigned)).toBe(true);
  });

  it("deals the seats with the most to do first", () => {
    const out = assignRemaining([seat("a"), seat("b")]);
    expect(out.map((s) => s.role)).toEqual(ASSIGNMENT_ORDER.slice(0, 2));
  });

  it("resolves the same room the same way every time", () => {
    // A dispute needs an answer, and a test needs something to check.
    const room = [seat("a", "cmo"), seat("b"), seat("c"), seat("d")];
    expect(assignRemaining(room)).toEqual(assignRemaining(room));
  });

  it("copes with more people than there are seats", () => {
    const out = assignRemaining([seat("a"), seat("b"), seat("c"), seat("d"), seat("e"), seat("f")]);
    // Five seats exist; the sixth person simply has none, rather than crashing.
    expect(out.filter((s) => s.role).length).toBe(5);
    expect(out).toHaveLength(6);
  });
});

describe("whether a claim can even be attempted", () => {
  const room = [seat("a", "ceo"), seat("b"), seat("c")];

  it("lets somebody in the room take a free seat", () => {
    expect(canClaim(room, "b", "cmo", "claiming").ok).toBe(true);
  });

  it("lets somebody swap the seat they already hold", () => {
    expect(canClaim(room, "a", "cto", "claiming").ok).toBe(true);
  });

  it("refuses a seat somebody else holds, and says which problem it is", () => {
    /*
     * The reason this returns a reason rather than a boolean: the loser of a
     * race needs to be told "Dana got there first", which is information, not
     * an error.
     */
    const out = canClaim(room, "b", "ceo", "claiming");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("role_taken");
  });

  it("refuses a stranger, an invented seat, and the wrong moment", () => {
    expect((canClaim(room, "zz", "cmo", "claiming") as any).reason).toBe("not_in_room");
    expect((canClaim(room, "b", "chief_vibes", "claiming") as any).reason).toBe("unknown_role");
    expect((canClaim(room, "b", "cmo", "filling") as any).reason).toBe("wrong_phase");
  });
});

describe("what the room does next", () => {
  const five = Array.from({ length: LOBBY_SIZE }, (_, i) => seat(`p${i}`));

  it("starts claiming the moment it is full", () => {
    expect(nextPhase({ phase: "filling", seats: five, secondsLeft: 600, named: false })?.phase).toBe("claiming");
  });

  it("waits while there is still room and time", () => {
    expect(nextPhase({ phase: "filling", seats: [seat("a")], secondsLeft: 600, named: false })).toBeNull();
  });

  it("starts with three when the clock runs out, and closes with two", () => {
    /*
     * Three is enough to run a company. Below that there is no company, and
     * the people waiting are better served by being told so.
     */
    const three = [seat("a"), seat("b"), seat("c")];
    expect(nextPhase({ phase: "filling", seats: three, secondsLeft: -1, named: false })?.phase).toBe("claiming");
    expect(nextPhase({ phase: "filling", seats: three.slice(0, 2), secondsLeft: -1, named: false })?.phase).toBe("retired");
  });

  it("moves on as soon as everybody is seated", () => {
    const seated = ROLES.map((role, i) => seat(`p${i}`, role));
    const move = nextPhase({ phase: "claiming", seats: seated, secondsLeft: 60, named: false });
    expect(move?.phase).toBe("naming");
    expect(move?.assign, "nothing to deal out").toBe(false);
  });

  it("deals out the rest when the argument runs out of time", () => {
    const move = nextPhase({ phase: "claiming", seats: [seat("a", "ceo"), seat("b")], secondsLeft: -1, named: false });
    expect(move?.phase).toBe("naming");
    expect(move?.assign).toBe(true);
  });

  it("will not let an absent chief executive hold the season", () => {
    expect(nextPhase({ phase: "naming", seats: five, secondsLeft: -1, named: false })?.phase).toBe("running");
    expect(nextPhase({ phase: "naming", seats: five, secondsLeft: 30, named: true })?.phase).toBe("running");
    // Still time, still unnamed: wait.
    expect(nextPhase({ phase: "naming", seats: five, secondsLeft: 30, named: false })).toBeNull();
  });

  it("does nothing once a season is running or a room is closed", () => {
    expect(nextPhase({ phase: "running", seats: five, secondsLeft: -1, named: true })).toBeNull();
    expect(nextPhase({ phase: "retired", seats: [], secondsLeft: -1, named: false })).toBeNull();
  });

  it("gives every phase a deadline worth having", () => {
    // A lobby with no clock is one where an absent person holds four others.
    for (const [phase, seconds] of Object.entries(PHASE_SECONDS)) {
      expect(seconds, `${phase} has no deadline`).toBeGreaterThan(0);
    }
  });
});

describe("the seats still going", () => {
  it("lists what nobody has taken", () => {
    expect(openRoles([seat("a", "ceo"), seat("b", "cmo")]).sort()).toEqual(["cfo", "coo", "cto"]);
    expect(allSeated([seat("a", "ceo"), seat("b")])).toBe(false);
    expect(allSeated(ROLES.map((r, i) => seat(`p${i}`, r)))).toBe(true);
    // An empty room is not a seated one.
    expect(allSeated([])).toBe(false);
  });
});

describe("a name for a company nobody named", () => {
  it("is stable, and is never blank", () => {
    expect(placeholderName("abc")).toBe(placeholderName("abc"));
    expect(placeholderName("abc").length).toBeGreaterThan(3);
  });

  it("is not the same for everybody", () => {
    const names = new Set(Array.from({ length: 40 }, (_, i) => placeholderName(`venture-${i}`)));
    expect(names.size).toBeGreaterThan(5);
  });
});

describe("the dice", () => {
  it("gives the same answer to the same question, for ever", () => {
    /*
     * Everything here rests on this. A tick can be re-run — it is built to be,
     * because a process can die halfway through writing one — and if the
     * market's contents or a challenge were drawn from real randomness the
     * retry would deal a different hand than the one a player had already read.
     */
    expect(hash("season-a")).toBe(hash("season-a"));
    expect(rng("season-a")()).toBe(rng("season-a")());
    expect(pick("seed", [1, 2, 3, 4, 5])).toBe(pick("seed", [1, 2, 3, 4, 5]));
    expect(sample("seed", [1, 2, 3, 4, 5], 3)).toEqual(sample("seed", [1, 2, 3, 4, 5], 3));
    expect(between("seed", 0, 100)).toBe(between("seed", 0, 100));
  });

  it("gives different answers to different questions", () => {
    expect(hash("a")).not.toBe(hash("b"));
    expect(rng("a")()).not.toBe(rng("b")());
    const spread = new Set(Array.from({ length: 50 }, (_, i) => pick(`s${i}`, ["a", "b", "c", "d"])));
    expect(spread.size).toBeGreaterThan(1);
  });

  it("stays inside its bounds", () => {
    const next = rng("bounds");
    for (let i = 0; i < 500; i++) {
      const n = next();
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
    }
    for (let i = 0; i < 50; i++) {
      const n = between(`b${i}`, 5, 9);
      expect(n).toBeGreaterThanOrEqual(5);
      expect(n).toBeLessThanOrEqual(9);
    }
  });

  it("never draws the same thing twice in one sample", () => {
    // A marketplace that listed the same patent alongside itself.
    for (let i = 0; i < 30; i++) {
      const drawn = sample(`m${i}`, ["a", "b", "c", "d", "e", "f"], 3);
      expect(new Set(drawn).size).toBe(3);
    }
  });

  it("asks for more than there is without complaint", () => {
    expect(sample("s", ["a", "b"], 5)).toHaveLength(2);
    expect(sample("s", [], 3)).toHaveLength(0);
    expect(() => pick("s", [])).toThrow();
  });

  it("does not care where in a long stream it is asked", () => {
    // Mulberry32 has a long period; a season asks it a few hundred times.
    const next = rng("stream");
    const seen = new Set<number>();
    for (let i = 0; i < 2_000; i++) seen.add(next());
    expect(seen.size, "the stream repeated itself almost immediately").toBeGreaterThan(1_900);
  });
});
