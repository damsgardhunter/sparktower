/**
 * Three things the phone was missing: money out, joining a company, and being told.
 *
 * **Earnings.** The web has a screen that says what you have earned and where
 * the next of it goes; the phone had nothing, so somebody paid on their phone
 * could neither see it nor send it to their bank. The trap here is that
 * `balanceCents` and `toBalanceCents` are different numbers — the first includes
 * money the person topped up themselves — and showing the wrong one tells
 * somebody they earned money they put in.
 *
 * **Company invites.** A company invite is a *signed* token, not a stored row,
 * which is why it cannot go through the phone's existing `/invite/[token]`
 * screen: that one calls `/api/invites/:token`, a different mechanism for
 * project invites. The company route takes the token in a POST body.
 *
 * **Notifications.** There are two separate things under that word. The in-app
 * inbox exists and is complete. Push — a notification arriving when the app is
 * shut — does not exist at all, and this file records that rather than letting
 * "notifications work" stand for both.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { readSource, interfaceFields, withoutComments, withoutInterfaces } from "../helpers/source-parity";

const earnings = readSource("mobile/app/earnings.tsx");
const companies = readSource("mobile/app/companies.tsx");
const more = readSource("mobile/app/(tabs)/more.tsx");

describe("earnings, on the phone", () => {
  it("is reachable from the More tab", () => {
    /* A screen file nobody can navigate to is not a feature. */
    const code = withoutComments(more);
    expect(code).toContain('go("/earnings")');
  });

  it("reads and writes the two routes the server has", () => {
    const code = withoutComments(earnings);
    expect(code).toContain('"/api/earnings"');
    expect(code).toContain('"/api/earnings/target"');
    /* The target is a PATCH; a POST would 404 and the screen would look broken. */
    expect(code).toMatch(/\/api\/earnings\/target"[^)]*method:\s*"PATCH"/s);
  });

  it("describes the same response the server sends", () => {
    const server = readSource("server/earnings.ts");
    expect(interfaceFields(earnings, "Earnings")).toEqual(interfaceFields(server, "EarningsRead"));
    expect(interfaceFields(earnings, "EarningLine")).toEqual(interfaceFields(server, "EarningLine"));
  });

  it("only offers the two payout targets the route accepts", () => {
    /*
     * The route rejects anything else with a 400, which the person reads as the
     * button not working. The guard in the route is the authority, so take the
     * allowed words from the guard itself rather than from a type.
     */
    const guard = withoutComments(readSource("server/routes.ts"))
      .match(/\/api\/earnings\/target[\s\S]{0,600}?if \(([^)]*target !== [^)]*)\)/);
    expect(guard, "the target route's guard has moved").not.toBeNull();
    const allowed = [...guard![1].matchAll(/"(\w+)"/g)].map((m) => m[1]).sort();
    expect(allowed).toEqual(["balance", "bank"]);

    /* The phone's own union has to be those same two words, and no others. */
    const union = withoutComments(earnings).match(/\(target:\s*([^)]*)\)/);
    expect(union, "the phone no longer types the target it sends").not.toBeNull();
    expect([...union![1].matchAll(/"(\w+)"/g)].map((m) => m[1]).sort()).toEqual(allowed);
  });

  it("shows the server's reason when a bank payout can't be switched on", () => {
    /*
     * Switching to `bank` without a connected, payouts-enabled Stripe account
     * is a 422 whose body says which of the three things is missing. A generic
     * "Couldn't change that" would leave the person with no idea what to do, so
     * the screen has to pass the server's message through.
     */
    expect(readSource("server/earnings.ts")).toContain("Connect a bank account first.");
    expect(withoutComments(earnings)).toMatch(/onError:[^\n]*errText\(/);
  });

  it("keeps earned money and topped-up money apart", () => {
    /*
     * The two fields differ by exactly the top-ups. Rendering `balanceCents`
     * under a heading about earnings credits the person for their own deposit,
     * so both names have to appear: one as the balance, one as the earnings.
     */
    const code = withoutComments(earnings);
    expect(code).toContain("toBalanceCents");
    expect(code).toContain("balanceCents");
  });
});

describe("accepting a company invite, on the phone", () => {
  it("posts the token to the company route, not the project one", () => {
    const code = withoutComments(companies);
    expect(code).toContain('"/api/company-invites/accept"');
    expect(code).toMatch(/company-invites\/accept"[^)]*body:\s*\{\s*token\s*\}/s);
    /* The project-invite routes take the token in the path and would 404 here. */
    expect(code).not.toMatch(/\/api\/invites\//);
  });

  it("uses the same link shape the web does, so one link serves both", () => {
    /*
     * The web's URL is `/companies?invite=<token>`. If the phone read a
     * differently named param, a link a company sent would open the screen and
     * silently show no invitation.
     */
    const web = withoutComments(readSource("client/src/pages/companies.tsx"));
    expect(web).toMatch(/invite/);
    const code = withoutComments(companies);
    expect(code).toMatch(/useLocalSearchParams<\{\s*invite\?:\s*string\s*\}>/);
  });

  it("accepts a whole pasted link, not only a bare token", () => {
    /* People paste what they were sent, which is a URL. */
    const code = withoutComments(companies);
    expect(code).toContain('split("invite=")');
  });

  it("tells the truth when they were already a member", () => {
    /*
     * The server answers an already-a-member accept with 200 and
     * `alreadyMember: true`. Treating that as a fresh join tells somebody they
     * joined a company they have been in for months.
     */
    const server = readSource("server/company-routes.ts");
    expect(server).toContain("alreadyMember: true");
    /*
     * Past the interface that declares it — a declaration is not a use, and a
     * test that accepts one passes while the screen ignores the field.
     */
    expect(withoutInterfaces(withoutComments(companies))).toContain("alreadyMember");
  });
});

describe("notifications, on the phone", () => {
  it("has the in-app inbox wired to every route the server offers", () => {
    const server = readSource("server/notifications.ts");
    const routes = [...server.matchAll(/app\.\w+\("(\/api\/notifications[^"]*)"/g)].map((m) => m[1]);
    expect(routes.length).toBeGreaterThan(0);
    /*
     * Read the phone's whole tree, not one screen: the unread count is polled
     * from a badge somewhere else entirely, so a per-file list would go stale
     * the first time a call moved.
     */
    const all = withoutComments(
      execFileSync("grep", ["-rh", "--include=*.ts", "--include=*.tsx", "--exclude-dir=node_modules", "api/notifications", "mobile"], {
        cwd: resolve(import.meta.dirname, "../.."),
        encoding: "utf8",
      }),
    );
    for (const route of routes) expect(all, `the phone never calls ${route}`).toContain(route);
  });

  it("records that push notifications do not exist yet", () => {
    /*
     * This is the honest half. Nothing in either package depends on
     * `expo-notifications`, nothing stores a device token, and the server sends
     * no push — so a notification only exists while the app is open. When push
     * is built, this test fails and should be replaced by real ones, which is
     * the point of writing it: it stops "the phone has notifications" from
     * quietly meaning only the inbox.
     */
    const pkgs = ["package.json", "mobile/package.json"].map(readSource).join("\n");
    expect(pkgs).not.toContain("expo-notifications");
    expect(pkgs).not.toContain("expo-server-sdk");
  });
});
