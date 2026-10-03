/**
 * The company rules, on the server and on the phone.
 *
 * The phone cannot import `@shared`, so `mobile/src/companies.ts` is a copy of
 * `shared/companies.ts` — and a copy of a permission table is the kind of thing
 * that drifts silently and then greys out the wrong button. A power added on
 * the server and missed here does not fail a build; it makes a phone quietly
 * disagree with the server about who may do what.
 *
 * This imports both and compares the values, rather than reading the source as
 * text: these are plain data and functions with no React or Metro in them, so
 * they can be executed, and executing them catches a reordered table or a
 * changed rule that a string match would not.
 */
import { describe, it, expect } from "vitest";
import * as web from "@shared/companies";
import * as phone from "../../mobile/src/companies";

describe("the tables", () => {
  it("has the same roles, in the same order", () => {
    /* Order matters: the phone renders a role picker from this. */
    expect(phone.COMPANY_ROLES).toEqual(web.COMPANY_ROLES);
  });

  it("has the same sizes", () => {
    expect(phone.COMPANY_SIZES).toEqual(web.COMPANY_SIZES);
  });

  it("has every power, with the same ids, labels and help", () => {
    expect(phone.COMPANY_PERMISSIONS).toEqual(web.COMPANY_PERMISSIONS);
  });

  it("derives the id list from the table rather than restating it", () => {
    expect(phone.COMPANY_PERMISSION_IDS).toEqual(web.COMPANY_PERMISSION_IDS);
    expect(phone.COMPANY_PERMISSION_IDS).toEqual(phone.COMPANY_PERMISSIONS.map((p) => p.id));
  });

  it("ranks the roles the same way", () => {
    expect(phone.ROLE_RANK).toEqual(web.ROLE_RANK);
  });

  it("is not empty, so an accidental `[]` fails here rather than passing quietly", () => {
    expect(phone.COMPANY_PERMISSIONS.length).toBeGreaterThan(5);
    expect(Object.keys(phone.ROLE_RANK)).toHaveLength(3);
  });
});

/**
 * The rules themselves, over every input that exists.
 *
 * Exhaustive rather than sampled: the whole table is three roles by seven
 * powers, which is twenty-one cases, so there is no reason to guess which ones
 * matter.
 */
describe("hasPower agrees for every role and power", () => {
  it("matches the web on all twenty-one combinations, with and without a grant", () => {
    for (const role of web.COMPANY_ROLES) {
      for (const power of web.COMPANY_PERMISSION_IDS) {
        for (const permissions of [[], [power], web.COMPANY_PERMISSION_IDS]) {
          const member = { role, permissions };
          expect(
            phone.hasPower(member, power),
            `hasPower(${role} with [${permissions.join(",")}], ${power})`,
          ).toBe(web.hasPower(member, power));
        }
      }
    }
  });

  it("agrees that nobody is nobody", () => {
    for (const power of web.COMPANY_PERMISSION_IDS) {
      expect(phone.hasPower(null, power)).toBe(web.hasPower(null, power));
      expect(phone.hasPower(undefined, power)).toBe(web.hasPower(undefined, power));
    }
  });
});

describe("canActOn agrees for every actor, target and action", () => {
  const ACTIONS = ["add", "remove", "powers", "role", "grant_manage_team"] as const;

  it("matches the web on every combination", () => {
    for (const actorRole of web.COMPANY_ROLES) {
      for (const permissions of [[], ["manage_team"], web.COMPANY_PERMISSION_IDS]) {
        const actor = { role: actorRole, permissions };
        for (const target of [null, ...web.COMPANY_ROLES.map((role) => ({ role }))]) {
          for (const what of ACTIONS) {
            expect(
              phone.canActOn(actor, target, what),
              `canActOn(${actorRole}/[${permissions.join(",")}], ${target?.role ?? "nobody"}, ${what})`,
            ).toBe(web.canActOn(actor, target, what));
          }
        }
      }
    }
  });

  /*
   * The one rule worth naming on its own, because getting it backwards hands
   * the company away: a member who manages the team still cannot change roles
   * or grant that power, or they could make a friend an admin.
   */
  it("keeps roles and the manage-team grant to leaders", () => {
    const managingMember = { role: "member" as const, permissions: ["manage_team"] };
    expect(phone.canActOn(managingMember, { role: "member" }, "role")).toBe(false);
    expect(phone.canActOn(managingMember, { role: "member" }, "grant_manage_team")).toBe(false);
    expect(phone.canActOn(managingMember, { role: "admin" }, "remove")).toBe(false);
    /* May add somebody, which needs no target to outrank. */
    expect(phone.canActOn(managingMember, null, "add")).toBe(true);
  });

  /*
   * Worth stating on its own because I got it wrong writing this test, and the
   * phone greys out controls from it: the comparison is *strictly* greater, so
   * a member who manages the team cannot remove a fellow member. Only a leader
   * can. Whether that is the intended rule is the server's call and this only
   * records it — but a phone that offered the button would be promising
   * something the server refuses.
   */
  it("needs a leader to remove anybody, because rank must be strictly greater", () => {
    const managingMember = { role: "member" as const, permissions: ["manage_team"] };
    expect(phone.canActOn(managingMember, { role: "member" }, "remove")).toBe(false);
    expect(web.canActOn(managingMember, { role: "member" }, "remove")).toBe(false);
    expect(phone.canActOn({ role: "admin", permissions: [] }, { role: "member" }, "remove")).toBe(true);
  });
});

/**
 * `blockedOn` has no server counterpart to compare against — it is the web's
 * own wording for a rule the server states as a refusal. So this holds it to
 * the web's copy instead, which is where it came from.
 */
describe("blockedOn, the sentence under a disabled control", () => {
  const webSource = () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { resolve } = require("node:path") as typeof import("node:path");
    return readFileSync(resolve(import.meta.dirname, "../../client/src/components/company/admin-tab.tsx"), "utf8");
  };

  it("gives the same four answers the web gives", () => {
    const me = { userId: "me", role: "admin" as const, permissions: [] };
    expect(phone.blockedOn({ ...me, role: "member", permissions: [] }, { userId: "x", role: "member" }))
      .toBe("You don't manage the team.");
    expect(phone.blockedOn(me, { userId: "me", role: "admin" }))
      .toBe("Ask another leader to change your own access.");
    expect(phone.blockedOn(me, { userId: "x", role: "owner" }))
      .toBe("Only an owner can change an owner.");
    expect(phone.blockedOn({ ...me, role: "owner" }, { userId: "x", role: "owner" })).toBeNull();
  });

  it("uses the web's exact wording, so two devices do not explain one rule differently", () => {
    const source = webSource();
    for (const sentence of [
      "You don't manage the team.",
      "Ask another leader to change your own access.",
      "Only an owner can change an owner.",
      "Only an owner or admin can change a leader.",
    ]) {
      expect(source, `the web should still say: ${sentence}`).toContain(sentence);
    }
  });
});
