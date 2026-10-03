/**
 * The company's team, on a phone.
 *
 * The phone had one read-only company screen whose own comment said members
 * "are forms with consequences and they are on the web". Eight of
 * `server/company-routes.ts`'s fourteen routes had no phone caller at all, so
 * somebody who added a colleague from a train could not.
 *
 * Read against the source, like the rest of the mobile parity suite: Metro will
 * not resolve `@shared`, so the phone's copies drift and the test's job is to
 * notice. Every assertion is about *usage* — a route named in a comment is not
 * a route anybody calls.
 */
import { describe, it, expect } from "vitest";
import { readSource, withoutComments } from "../helpers/source-parity";

const team = withoutComments(readSource("mobile/src/components/company/TeamTab.tsx"));
const admin = withoutComments(readSource("mobile/src/components/company/AdminTab.tsx"));
const screen = withoutComments(readSource("mobile/app/company/[id].tsx"));
const all = `${team}\n${admin}\n${screen}`;

describe("the routes that had no phone caller", () => {
  /*
   * Named individually rather than counted, so a failure says which one went.
   * These are the eight from company-routes.ts that nothing on the phone
   * reached before this.
   */
  const MUST_CALL: [string, RegExp][] = [
    ["the invite link", /\/invite-link`/],
    ["resetting the invite links", /\/invite-link\/reset`/],
    ["adding a member", /\/members`, \{ method: "POST"/],
    ["setting a member's powers", /\/members\/\$\{member\.userId\}\/permissions`, \{ method: "PUT"/],
    ["changing a role", /\/members\/\$\{member\.userId\}`, \{ method: "PATCH"/],
    ["removing a member", /\/members\/\$\{member\.userId\}`, \{ method: "DELETE"/],
    ["leaving", /\/members\/\$\{userId\}`, \{ method: "DELETE"/],
    ["the audit log", /\/audit\?limit=/],
  ];

  for (const [what, pattern] of MUST_CALL) {
    it(`calls ${what}`, () => {
      expect(all).toMatch(pattern);
    });
  }

  it("still reads the company itself through one shared key", () => {
    /* Three tabs reading three keys would show three different answers after a change. */
    expect(screen).toMatch(/queryKey: companyKey\(/);
    expect(team).toMatch(/queryKey: companyKey\(companyId\)/);
    expect(admin).toMatch(/queryKey: companyKey\(companyId\)/);
  });
});

describe("the permission rules are the server's, not the phone's", () => {
  it("reads me.powers rather than deciding from the role", () => {
    expect(screen).toMatch(/me\.powers/);
  });

  it("greys controls out through the shared rule, not a local guess", () => {
    /*
     * `blockedOn`, `canActOn` and `hasPower` all come from src/companies.ts,
     * which company-rules-parity.test.ts holds to shared/companies.ts. A local
     * `role === "owner"` test in a tab is the drift this is guarding against.
     */
    expect(admin).toMatch(/blockedOn\(me, member\)/);
    expect(admin).toMatch(/canActOn\(me, member, "role"\)/);
    expect(admin).toMatch(/canActOn\(me, null, "grant_manage_team"\)/);
    expect(team).toMatch(/hasPower\(me, "manage_team"\)/);
  });

  it("never decides a power from a hardcoded role comparison", () => {
    /*
     * `isLeader(m.role)` is fine — that is the shared helper. What must not
     * appear is a tab working out whether somebody *may do something* from a
     * role by itself, because that is the rule living in two places.
     *
     * Comparing a role to pick a colour or to word a sentence is not that, so
     * two kinds of line are allowed: one that feeds a Pill's tone or label, and
     * one inside a template string. The audit log's "joined as an admin" is the
     * second kind — it is describing what happened, not deciding anything.
     */
    const isWording = (l: string) => /tone|Pill|label/.test(l) || l.includes("`");
    for (const [name, src] of [["TeamTab", team], ["AdminTab", admin]] as const) {
      const handRolled = src.split("\n").filter((l) => /role === "(owner|admin)"/.test(l) && !isWording(l));
      expect(handRolled, `${name} decides a power from a role by hand:\n  ${handRolled.join("\n  ")}`).toEqual([]);
    }
  });

  it("routes every gate through the shared helpers", () => {
    /*
     * The other half of the rule above: it is not enough that no gate is
     * hand-rolled, the gates have to exist. Counted so that deleting them all
     * and shipping an always-enabled console fails here.
     */
    const gates = (src: string) => (src.match(/\b(hasPower|canActOn|blockedOn|isLeader)\(/g) ?? []).length;
    expect(gates(admin), "AdminTab should gate through src/companies.ts").toBeGreaterThanOrEqual(5);
    expect(gates(team), "TeamTab should gate through src/companies.ts").toBeGreaterThanOrEqual(2);
  });

  it("sends the whole power list, not a change to it", () => {
    /* The server's reason: two leaders editing at once end with what the last one saw and chose. */
    expect(admin).toMatch(/body: \{ permissions: perms \}/);
  });
});

describe("what the screen says when somebody cannot act", () => {
  it("shows the Admin tab to everybody and names who to ask", () => {
    expect(screen).toMatch(/value: "admin"/);
    /* Not filtered by a power — hiding it answers "where do I change this" with silence. */
    expect(screen).not.toMatch(/TABS\.filter/);
    expect(admin).toMatch(/Ask one of them/);
  });

  it("keeps the server's own refusals rather than replacing them", () => {
    /*
     * "Every company needs an owner. Make someone else an owner first." says
     * what to do instead; a generic "Couldn't change that role" does not. The
     * fallback is only reached when the server sent nothing usable.
     */
    expect(admin).toMatch(/errText\(e, "Couldn't change that role\."\)/);
    expect(team).toMatch(/errText\(e, "Couldn't leave\."\)/);
  });

  it("confirms every destructive action before doing it", () => {
    /* A mis-tap on a phone is a different accident from a mis-click at a desk. */
    for (const [what, src] of [["leaving", team], ["stopping the links", team], ["removing somebody", admin]] as const) {
      expect(src, `${what} should be confirmed`).toContain("Alert.alert");
    }
    expect((team.match(/Alert\.alert/g) ?? []).length, "leaving and resetting links both confirm").toBeGreaterThanOrEqual(2);
  });

  it("drops the company from the cache on leaving rather than leaving it stale", () => {
    /* Back would otherwise show the company as it was, with tabs that now refuse you. */
    expect(team).toMatch(/removeQueries\(\{ queryKey: companyKey\(companyId\) \}\)/);
  });
});

describe("the audit log reads the same as the web's", () => {
  const web = withoutComments(readSource("client/src/components/company/admin-tab.tsx"));

  it("describes every action the web describes, with the same words", () => {
    /*
     * Compared case by case rather than by eye. Two devices wording one event
     * differently is the kind of difference somebody notices and cannot explain.
     */
    const cases = (src: string) => (src.match(/case "([a-z_]+)":/g) ?? []).map((m) => m.slice(6, -2));
    const phoneCases = cases(admin).sort();
    const webCases = cases(web).sort();
    expect(phoneCases).toEqual(webCases);
    expect(phoneCases.length).toBeGreaterThan(10);
  });

  it("prints an unfamiliar action rather than hiding it", () => {
    expect(admin).toMatch(/default: return e\.action\.replace\(\/_\/g, " "\)/);
  });
});
