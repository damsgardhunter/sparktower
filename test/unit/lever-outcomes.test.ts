/**
 * Every lever says what it costs you.
 *
 * The panel is only worth reading if it is complete: a decision screen where
 * six levers show a trade and the seventh shows nothing teaches people that
 * the seventh is free, which is the opposite of what this game is about. So
 * the test walks the actual lever definitions rather than the outcome map —
 * adding a lever and forgetting its consequences fails here, which is the
 * point.
 *
 * It also holds the rule that makes the panel honest: a trade has two sides.
 * An outcome with an empty `down` is either a lever nobody has to think about
 * or, far more likely, one whose cost the writer could not be bothered to
 * find.
 */
import { describe, expect, it } from "vitest";
import { LEVER_FIELDS } from "@shared/simulation/levers";
import { LEVER_OUTCOMES, LEVERS_WITHOUT_TRADES, outcomeFor } from "@shared/simulation/lever-outcomes";
import type { Role } from "@shared/simulation/types";

const ROLES: Role[] = ["ceo", "cmo", "cfo", "cto", "coo"];

describe("what each decision costs you", () => {
  it("has an answer for every lever on every desk", () => {
    const missing: string[] = [];
    for (const role of ROLES) {
      for (const lever of LEVER_FIELDS[role]) {
        const key = `${role}.${lever.id}`;
        if (LEVERS_WITHOUT_TRADES.has(key)) continue;
        /*
         * A choice may answer per option instead of once for the lever — the
         * pace and the payment terms each trade differently — so either shape
         * counts, as long as something is there. `options` and `choices` are
         * both real: a "levels" lever puts its answers in `choices`, which is
         * how `ceo.targets` slipped past an earlier version of this test.
         */
        const perLever = LEVER_OUTCOMES[key];
        const answers = [...(lever.options ?? []), ...(lever.choices ?? [])];
        const perAnswer = answers.some((o) => LEVER_OUTCOMES[`${key}.${o.value}`]);
        if (!perLever && !perAnswer) missing.push(key);
      }
    }
    expect(missing, `levers with nothing said about their consequences: ${missing.join(", ")}`).toEqual([]);
  });

  /* Every option of a choice that answers per option must answer — not just the first. */
  it("leaves no option of a per-option choice unexplained", () => {
    const missing: string[] = [];
    for (const role of ROLES) {
      for (const lever of LEVER_FIELDS[role]) {
        const key = `${role}.${lever.id}`;
        const options = [...(lever.options ?? []), ...(lever.choices ?? [])];
        if (!options.length) continue;
        const answered = options.filter((o) => LEVER_OUTCOMES[`${key}.${o.value}`]);
        if (answered.length === 0) continue;
        for (const o of options) {
          if (!LEVER_OUTCOMES[`${key}.${o.value}`]) missing.push(`${key}.${o.value}`);
        }
      }
    }
    expect(missing, `options left unexplained beside ones that are: ${missing.join(", ")}`).toEqual([]);
  });

  it("says what everything costs, not only what it gives", () => {
    const freeLunches = Object.entries(LEVER_OUTCOMES)
      .filter(([, o]) => o.down.length === 0)
      .map(([key]) => key);
    expect(freeLunches, `levers claiming no downside: ${freeLunches.join(", ")}`).toEqual([]);
  });

  it("says what everything gives, not only what it costs", () => {
    const allPain = Object.entries(LEVER_OUTCOMES)
      .filter(([, o]) => o.up.length === 0)
      .map(([key]) => key);
    expect(allPain).toEqual([]);
  });

  /* Chips, not paragraphs. The whole point was to stop it reading like prose. */
  it("keeps every line short enough to scan", () => {
    const tooLong: string[] = [];
    for (const [key, o] of Object.entries(LEVER_OUTCOMES)) {
      for (const line of [...o.up, ...o.down]) {
        if (line.length > 120) tooLong.push(`${key}: ${line.slice(0, 40)}…`);
      }
    }
    expect(tooLong).toEqual([]);
  });

  it("prefers the option's own trade over the lever's", () => {
    const shipped = outcomeFor("ceo", "pace", "ship");
    const general = outcomeFor("ceo", "pace");
    expect(shipped).not.toBeNull();
    expect(shipped).not.toEqual(general);
    expect(shipped!.down.join(" ")).toMatch(/debt/i);
  });

  it("falls back to the lever when the option has nothing of its own", () => {
    expect(outcomeFor("cmo", "price", "whatever")).toEqual(LEVER_OUTCOMES["cmo.price"]);
  });

  it("has nothing to say about a lever that genuinely has no trade", () => {
    expect(outcomeFor("cmo", "dealVotes")).toBeNull();
  });

  /* A key for a lever that no longer exists is dead copy nobody will ever see. */
  it("has no consequences written for a lever that isn't there", () => {
    const real = new Set<string>();
    for (const role of ROLES) {
      for (const lever of LEVER_FIELDS[role]) {
        real.add(`${role}.${lever.id}`);
        for (const o of lever.options ?? []) real.add(`${role}.${lever.id}.${o.value}`);
        for (const c of lever.choices ?? []) real.add(`${role}.${lever.id}.${c.value}`);
      }
    }
    const orphans = Object.keys(LEVER_OUTCOMES).filter((k) => !real.has(k));
    expect(orphans, `written for levers that do not exist: ${orphans.join(", ")}`).toEqual([]);
  });
});
