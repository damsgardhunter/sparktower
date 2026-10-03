/**
 * The "From year N" notes on the decision types, against the schedule the engine
 * actually reads.
 *
 * ## Why this is a test and not a style rule
 *
 * `UNLOCKS` in `shared/simulation/responsibilities.ts` is the only schedule
 * anything runs on: `isUnlocked` reads it, the desk builds a seat's form from it,
 * and the bots skip a lever because of it. The notes on `decisions.ts` are prose
 * beside a type, and prose cannot be wrong in a way that fails — so when the ramp
 * was compressed (see the comment on `UNLOCKS`: "the ramp is short… by year five
 * it has all of it") the schedule moved and thirty-six of the forty-nine notes
 * stayed where they were.
 *
 * Every one of them named a *later* year than the truth: `tiers` said three and
 * arrives in two, `segmentFocus` said eight and arrives in four, `regionFocus`
 * said seven and arrives in four. Nothing was broken by it. The levers all
 * worked, every test passed, and the only cost was that the most authoritative
 * place to read what a seat gets and when had been quietly lying for months —
 * to whoever reads the type to answer a player's question, and to whoever is
 * deciding what a new lever's year should be by looking at its neighbours.
 *
 * That is the kind of rot nobody finds by reading, because the two facts are in
 * different files and neither looks wrong on its own. So they are compared here.
 *
 * ## Adding a lever
 *
 * Put it in `UNLOCKS` and, if its doc comment names a year, name the same one.
 * A comment with no year in it is fine and common — this only checks the ones
 * that make a claim.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { UNLOCKS } from "@shared/simulation/responsibilities";

/** The words the comments are written in. They spell the year out; `UNLOCKS` numbers it. */
const WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

const SOURCE = "shared/simulation/decisions.ts";

interface Claim {
  line: number;
  field: string;
  said: number;
}

/**
 * Every "From year N" note, with the field it sits on.
 *
 * The field is the next one declared within a few lines — these notes are either
 * a trailing comment on the field's own line or a block directly above it, and
 * both resolve the same way. A note that cannot be tied to a field is counted
 * rather than ignored, because "found nothing" and "nothing to find" have to be
 * distinguishable or this file passes for the wrong reason for ever.
 */
function claimsIn(source: string): { claims: Claim[]; unmatched: number } {
  const lines = source.split("\n");
  const claims: Claim[] = [];
  let unmatched = 0;

  for (let i = 0; i < lines.length; i++) {
    const found = lines[i].match(/From year (\w+)/);
    if (!found) continue;
    const said = WORDS[found[1].toLowerCase()] ?? Number(found[1]);
    if (!Number.isFinite(said)) { unmatched++; continue; }

    let field: string | null = null;
    for (let j = i; j < Math.min(i + 4, lines.length); j++) {
      const declared = lines[j].match(/^\s{2}(\w+)\??:/);
      if (declared) { field = declared[1]; break; }
    }
    if (!field) { unmatched++; continue; }
    claims.push({ line: i + 1, field, said });
  }
  return { claims, unmatched };
}

describe("the years the decision types promise", () => {
  const source = readFileSync(resolve(__dirname, "../..", SOURCE), "utf8");
  const { claims, unmatched } = claimsIn(source);
  const scheduled = new Map(UNLOCKS.map((u) => [u.field, u.year]));

  it("is reading both halves, so a pass means something", () => {
    /*
     * The failure this file would otherwise have: an extraction that quietly
     * stops matching passes every assertion below it for ever. Thirty-six wrong
     * notes were found on the first run, so a few dozen claims is the right order
     * of magnitude — a handful would mean the regex has drifted.
     */
    expect(claims.length, `no "From year" notes found in ${SOURCE} — the extraction broke, not the comments`)
      .toBeGreaterThan(20);
    expect(UNLOCKS.length, "UNLOCKS came back empty — it has changed shape").toBeGreaterThan(20);
    expect(unmatched, `${unmatched} notes could not be tied to a field; the shape of the file has changed`).toBe(0);
  });

  it("names the year the engine will actually give it", () => {
    /*
     * The whole point. Listed in full rather than failing on the first, because
     * the last time these drifted it was thirty-six of them and finding them one
     * test run at a time would be its own small punishment.
     */
    const wrong = claims
      .filter((c) => scheduled.has(c.field) && scheduled.get(c.field) !== c.said)
      .map((c) => `${SOURCE}:${c.line} ${c.field} says year ${c.said}, UNLOCKS says ${scheduled.get(c.field)}`);
    expect(wrong, `these notes disagree with UNLOCKS:\n  ${wrong.join("\n  ")}`).toEqual([]);
  });

  it("does not promise a year for a lever that is never gated", () => {
    /*
     * The other direction, and a real mistake available: a note saying a lever
     * arrives in year three when nothing gates it means it was there from the
     * start, and a player told to wait for it waits for ever.
     */
    const ungated = claims
      .filter((c) => !scheduled.has(c.field))
      .map((c) => `${SOURCE}:${c.line} ${c.field} says it arrives in year ${c.said}, but UNLOCKS does not gate it`);
    expect(ungated, `these notes promise a wait that does not exist:\n  ${ungated.join("\n  ")}`).toEqual([]);
  });

  it("covers the same field consistently wherever it is repeated", () => {
    /*
     * Several of these notes appear once per seat — `dealVotes` and `expandVote`
     * are on all five decision types — and the copies drifted apart before:
     * four `dealVotes` notes all said year five against a real year of three.
     * Two copies disagreeing is worse than both being wrong, because then the
     * file contradicts itself and a reader cannot tell which to trust.
     */
    const byField = new Map<string, Set<number>>();
    for (const c of claims) {
      if (!byField.has(c.field)) byField.set(c.field, new Set());
      byField.get(c.field)!.add(c.said);
    }
    const inconsistent = [...byField.entries()]
      .filter(([, years]) => years.size > 1)
      .map(([field, years]) => `${field} is described as arriving in years ${[...years].sort().join(" and ")}`);
    expect(inconsistent, `the same lever is given two different years:\n  ${inconsistent.join("\n  ")}`).toEqual([]);
  });
});
