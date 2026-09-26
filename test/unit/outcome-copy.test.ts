/**
 * The payment dialog must not white-screen over a missing label.
 *
 * `OUTCOME_COPY` is keyed by `PricedOutcomeId`. Three places reached into it
 * with something wider — `priceOf` returns a `kind` of "free" or "small" as
 * well as a priced id, and the 402's `outcome` is whatever the server sent —
 * and two of them cast with `as PricedOutcomeId`, which satisfies the compiler
 * without making the value one. On a miss, `OUTCOME_COPY[kind].name` throws
 * "Cannot read properties of undefined (reading 'name')" and takes the whole
 * dialog down. Someone hit that while creating a project.
 *
 * Two properties, then. The map covers every priced outcome, so the common
 * path never falls back; and the lookup survives everything else, so the day
 * it does fall back the person still sees a button instead of a blank screen.
 */
import { describe, expect, it } from "vitest";
import {
  OUTCOME_COPY, OUTCOME_PRICE_CENTS, outcomeCopy, priceOf, CHARGE_FOR,
  type NovaActionId, type PricedOutcomeId,
} from "@shared/plans";

describe("the copy behind a price", () => {
  it("has a name and a blurb for every outcome that carries a price", () => {
    const missing = Object.keys(OUTCOME_PRICE_CENTS).filter((id) => !(id in OUTCOME_COPY));
    expect(missing, `priced with nothing to call them: ${missing.join(", ")}`).toEqual([]);
    for (const [id, copy] of Object.entries(OUTCOME_COPY)) {
      expect(copy.name, id).toBeTruthy();
      expect(copy.blurb, id).toBeTruthy();
    }
  });

  /* The other direction: copy for something nobody can buy is dead text. */
  it("has no copy for something that carries no price", () => {
    const orphans = Object.keys(OUTCOME_COPY).filter((id) => !(id in OUTCOME_PRICE_CENTS));
    expect(orphans, `copy for unpriced outcomes: ${orphans.join(", ")}`).toEqual([]);
  });

  it("answers for every priced outcome", () => {
    for (const id of Object.keys(OUTCOME_PRICE_CENTS) as PricedOutcomeId[]) {
      expect(outcomeCopy(id)?.name, id).toBeTruthy();
    }
  });

  /*
   * The values that actually caused it. `priceOf(action).kind` is "free" or
   * "small" for most actions, and both were being cast straight into the map.
   */
  it("returns nothing, rather than throwing, for a kind that is not an outcome", () => {
    for (const kind of ["free", "small", "", "dayPass", "somethingNobodyAdded"]) {
      expect(() => outcomeCopy(kind), kind).not.toThrow();
      expect(outcomeCopy(kind), kind).toBeNull();
    }
    expect(outcomeCopy(null)).toBeNull();
    expect(outcomeCopy(undefined)).toBeNull();
  });

  /*
   * Walked over every action the product has, because that is the set the
   * dialog is actually handed — not a sample somebody chose.
   */
  it("survives the kind of every Nova action there is", () => {
    for (const action of Object.keys(CHARGE_FOR) as NovaActionId[]) {
      const price = priceOf(action);
      expect(() => outcomeCopy(price.kind), action).not.toThrow();
      /* Whatever comes back, the dialog has something to print. */
      const title = outcomeCopy(price.kind)?.name ?? price.action;
      expect(title, action).toBeTruthy();
    }
  });
});
