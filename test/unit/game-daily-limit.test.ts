/**
 * One game a day: the rule, without a database.
 *
 * The arithmetic is small and the edges are where it matters — a rolling
 * window means "when does it open again" has a right answer to the minute, and
 * the words around it have to stay honest as that number shrinks.
 */
import { describe, it, expect } from "vitest";
import {
  GAMES_PER_DAY, GAME_COOLDOWN_MS, gameUnlocksAt, playAgainIn,
} from "@shared/sprints/game";

const at = (iso: string) => new Date(iso);

describe("the allowance", () => {
  it("is one a day, over a rolling twenty-four hours", () => {
    expect(GAMES_PER_DAY).toBe(1);
    expect(GAME_COOLDOWN_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("opens exactly a day after the game started, not after it finished", () => {
    const started = at("2026-09-23T14:30:00.000Z");
    expect(gameUnlocksAt(started)?.toISOString()).toBe("2026-09-24T14:30:00.000Z");
  });

  it("has nothing to say about somebody who has not played", () => {
    expect(gameUnlocksAt(null)).toBeNull();
    expect(gameUnlocksAt(undefined)).toBeNull();
    // A stored value that isn't a date must not become an Invalid Date on screen.
    expect(gameUnlocksAt("not a date" as any)).toBeNull();
  });
});

describe("saying when it opens", () => {
  const now = at("2026-09-23T12:00:00.000Z");

  it("counts in minutes when it is nearly time, because rounding that would be a lie they'd catch", () => {
    expect(playAgainIn(at("2026-09-23T12:04:00.000Z"), now)).toBe("in 4 minutes");
    expect(playAgainIn(at("2026-09-23T12:00:30.000Z"), now)).toBe("in 1 minute");
  });

  it("rounds to hours further out, because nobody wants 'in 538 minutes' at breakfast", () => {
    expect(playAgainIn(at("2026-09-23T21:00:00.000Z"), now)).toBe("in about 9 hours");
    expect(playAgainIn(at("2026-09-23T13:00:00.000Z"), now)).toBe("in about 1 hour");
  });

  it("says nothing at all once it has opened, so the screen can't offer a countdown to the past", () => {
    expect(playAgainIn(at("2026-09-23T11:59:00.000Z"), now)).toBeNull();
    expect(playAgainIn(now, now)).toBeNull();
    expect(playAgainIn(null, now)).toBeNull();
  });
});
