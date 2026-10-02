/**
 * The admin consoles the phone has, and the shapes they expect back.
 *
 * Five of the web's admin screens had no phone counterpart — `ai-spend`,
 * `console`, `revenue`, `problems`, `security` — each confirmed by the phone
 * never calling the route behind it. They are being added one at a time, and
 * this file is what keeps each one honest as it lands.
 *
 * Two things are checked, and the second is the one that has already bitten.
 *
 * **Reachable.** A screen file nobody can navigate to is not a feature. The
 * phone's admin screens are reached from one place — the Admin group in
 * `(tabs)/more.tsx` — so a screen with no row there is dead code that
 * typechecks.
 *
 * **The response shape.** `mobile/app/security.tsx` once declared a
 * `recoveryCodesLeft` the server has never sent, and rendered the literal words
 * "undefined recovery codes left" to anybody with 2FA on. The phone cannot
 * import the server's types — Metro will not resolve `@shared` — so an
 * interface on the phone is a copy, and a copy drifts. Comparing the two is the
 * only thing that notices.
 */
import { describe, it, expect } from "vitest";
/* Both live in test/helpers/source-parity.ts — several suites read sources this way. */
import { readSource as read, interfaceFields as fieldsOf, withoutComments } from "../helpers/source-parity";

const more = read("mobile/app/(tabs)/more.tsx");

describe("the admin consoles on the phone", () => {
  /*
   * One row per screen. Adding a screen without adding its row is the mistake
   * this catches, and it is an easy one: the screen works when you navigate to
   * it by hand during development.
   */
  const screens = ["safety", "reports", "backing", "surfaces", "analytics", "revenue", "ai-spend", "console", "problems", "security"];

  for (const screen of screens) {
    it(`${screen} is reachable from the More tab`, () => {
      expect(more, `nothing in (tabs)/more.tsx navigates to /admin/${screen}`).toContain(`"/admin/${screen}"`);
    });
  }

  /*
   * Owner-only on the server means owner-only in the menu, or the row is a door
   * onto "not found". `/api/admin/revenue` is `requireOwner`.
   */
  /*
   * Owner-only on the server means owner-only in the menu, or the row is a door
   * onto "not found". Both of these routes are `requireOwner`.
   */
  it.each([["revenue"], ["ai-spend"]])("hides the owner-only %s row from a reviewer", (screen) => {
    const row = more.split("\n").find((l) => l.includes(`"/admin/${screen}"`));
    expect(row, `the ${screen} row is gone`).toBeTruthy();
    expect(row, `${screen} is owner-only on the server; the row has to be too`).toMatch(/access\?\.owner/);
  });
});

describe("what the phone expects back from the revenue route", () => {
  it("names the same fields the server sends, and no others", () => {
    const server = fieldsOf(read("server/platform-revenue.ts"), "PlatformRevenue");
    const phone = fieldsOf(read("mobile/app/admin/revenue.tsx"), "PlatformRevenue");
    expect(phone, "the phone's revenue shape has drifted from the server's").toEqual(server);
  });

  /*
   * The identity the screen is built on, and the reason the liabilities are as
   * prominent as the takings: held pledges are refundable and user balances are
   * credit somebody can spend tomorrow, so an owner reading only the top line is
   * planning around other people's money.
   */
  it("shows what is owed, not just what was taken", () => {
    const screen = read("mobile/app/admin/revenue.tsx");
    /*
     * The group totals get their testID from a template literal, so the rendered
     * `text-owed` is not in the source and matching it finds nothing — which an
     * earlier version of this test did, and reported as a missing section.
     * These are the props the source actually carries.
     */
    expect(screen, "the top line is there").toMatch(/testID="text-ours"/);
    expect(screen, "so is what is owed").toMatch(/testID="owed"/);
    expect(screen, "and the escrow that makes it refundable").toMatch(/testID: "escrow"/);
  });
});

/**
 * What the phone expects back from the AI spend routes.
 *
 * These responses are built inline in `res.json({...})` rather than declared as
 * interfaces, so the comparison reads the keys out of the route itself. `today`
 * is the one that matters most: it is the screen's headline and the brake, so a
 * renamed field there is a launch-day number silently reading `undefined`.
 */
describe("what the phone expects back from the AI spend routes", () => {
  const routes = read("server/ai-spend-routes.ts");
  const screen = read("mobile/app/admin/ai-spend.tsx");

  /** The top-level keys of the `res.json({...})` inside a named GET route. */
  function sentBy(path: string): string[] {
    const at = routes.indexOf(`app.get("${path}"`);
    expect(at, `${path} is no longer registered here`).toBeGreaterThanOrEqual(0);
    const jsonAt = routes.indexOf("res.json({", at);
    expect(jsonAt, `${path} no longer answers with a literal object`).toBeGreaterThan(at);
    let depth = 0;
    let end = -1;
    for (let i = routes.indexOf("{", jsonAt); i < routes.length; i++) {
      if (routes[i] === "{") depth++;
      else if (routes[i] === "}" && --depth === 0) { end = i; break; }
    }
    let body = routes.slice(routes.indexOf("{", jsonAt) + 1, end);
    let previous: string;
    do { previous = body; body = body.replace(/\{[^{}]*\}/g, "OBJ"); } while (body !== previous);
    /* Keys at this level, ignoring comments. */
    return [...body.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(?:^|\n|,)\s*(\w+)\s*:/g)].map((m) => m[1]).sort();
  }

  function fieldsOfInterface(source: string, name: string): string[] {
    const at = source.indexOf(`interface ${name} {`);
    expect(at, `interface ${name} is gone from the phone's screen`).toBeGreaterThanOrEqual(0);
    const end = source.indexOf("}", at);
    return [...source.slice(source.indexOf("{", at) + 1, end).matchAll(/(\w+)\s*:/g)].map((m) => m[1]).sort();
  }

  it("reads the same fields the brake route sends", () => {
    expect(
      fieldsOfInterface(screen, "Today"),
      "the phone's Today has drifted from what /api/admin/ai-spend/today sends",
    ).toEqual(sentBy("/api/admin/ai-spend/today"));
  });

  /*
   * The four questions the server file says a launch day asks. The screen is
   * built on them in that order, and this is what stops it drifting back into
   * being a port of the web's charts.
   */
  it("answers the four questions the routes exist for", () => {
    expect(screen, "today, against the brake").toMatch(/against the brake/i);
    expect(screen, "which parts are dear").toMatch(/Dearest parts/);
    expect(screen, "who is spending it, and had they paid").toMatch(/Biggest spenders/);
    expect(screen, "whether the caching is working").toMatch(/cacheRate/);
  });

  it("says what it leaves on the web rather than being quietly short of it", () => {
    expect(screen, "changing the cap is a desk job; the screen should say so").toMatch(/web\s*\n?\s*\*?\s*console|web console/);
  });
});

/**
 * The support console's lookup half.
 *
 * The web console both looks people up and acts on them. Only the lookup is on
 * the phone, and that is a decision rather than an omission:
 * `/api/admin/console/actions` reports `maxGrantCents`,
 * `maxGrantPerDayCents` and `grantedTodayCents`, so acting includes putting
 * money on somebody's balance, capped per operator per day. A mis-tap on a
 * phone is a different kind of accident from a mis-click at a desk, and a grant
 * is recoverable only in the sense that money can be taken back off a balance
 * after somebody has seen it.
 *
 * The test is here so that stays a decision: if the actions arrive, the line
 * saying they are elsewhere has to go with them.
 */
describe("the support console on the phone", () => {
  const screen = read("mobile/app/admin/console.tsx");

  it("looks people up, which is the part a phone is for", () => {
    expect(screen).toMatch(/\/api\/admin\/console\/search/);
    expect(screen, "and opens one of them").toMatch(/\/api\/admin\/console\/users\//);
  });

  it("shows what has already been done to an account", () => {
    expect(screen, "the history is the half a phone is good for").toMatch(/history/);
  });

  /*
   * Either it does not act, or it stops claiming it does not. Both halves fail
   * together on purpose, so the screen and its explanation cannot disagree.
   */
  it("does not act, and says where acting happens", () => {
    /*
     * The boundary matters: `/api/admin/console/act` is a prefix of
     * `.../actions`, which the screen's own comment names when it explains why
     * acting is elsewhere — so without it this test matched the explanation and
     * reported that the screen acts.
     */
    const acts = /\/api\/admin\/console\/(act|undo)(?![A-Za-z])/.test(screen);
    const saysSo = /on the web console/.test(screen);
    expect(
      acts,
      acts && saysSo
        ? "the screen acts now — remove the line telling people acting is on the web"
        : "the screen should not grant credit or suspend accounts yet",
    ).toBe(false);
    expect(saysSo, "if it cannot act it has to say where to").toBe(true);
  });

  it("is open to a reviewer, because the route is requireAdmin rather than requireOwner", () => {
    const row = more.split("\n").find((l) => l.includes('"/admin/console"'));
    expect(row, "the console row is gone").toBeTruthy();
    expect(row, "gating it on owner would lock out the reviewers it is for").not.toMatch(/access\?\.owner/);
  });
});

/**
 * The last two consoles.
 *
 * Both are read-and-triage on the phone and leave their heavier actions on the
 * web, and both say so on the screen. The pairing is tested, as it is for the
 * support console: if an action arrives, the sentence telling people it is
 * elsewhere has to go with it.
 */
describe("the problem queue on the phone", () => {
  const screen = read("mobile/app/admin/problems.tsx");

  /*
   * The shape caught me writing this one. I assumed `{ rows }` and the route
   * sends `{ reports, counts }` — so the list would have been permanently
   * empty and the "N new" badge permanently absent, with nothing failing.
   */
  it("reads the fields the route actually sends", () => {
    const routes = read("server/problem-report-routes.ts");
    const at = routes.indexOf('app.get("/api/admin/problem-reports"');
    const jsonAt = routes.indexOf("res.json({", at);
    const keys = [...routes.slice(jsonAt, routes.indexOf("});", jsonAt)).matchAll(/\n\s*(\w+):/g)].map((m) => m[1]);
    /*
     * Read as a property, not found as a substring. The first version of this
     * asserted `toContain(key)` and passed with the bug still in, because
     * "reports" appears in the screen's title, in the URL and in a comment —
     * so it proved only that the word exists somewhere on the page.
     */
    for (const key of keys) {
      expect(
        new RegExp(`\\.${key}\\b`).test(screen),
        `the route sends \`${key}\` and the screen never reads \`.${key}\``,
      ).toBe(true);
    }
  });

  it("triages, because that is the whole point of the queue", () => {
    expect(screen, "it should PATCH a status").toMatch(/problem-reports\/\$\{[^}]*\}/);
    expect(screen).toMatch(/PATCH/);
  });

  it("says where writing a note happens, since it does not", () => {
    expect(screen).toMatch(/note is on the web/i);
  });
});

describe("the security overview on the phone", () => {
  const screen = read("mobile/app/admin/security.tsx");

  /*
   * The route's own comment calls this "the thing worth seeing at a glance:
   * power without a second factor". It is the one fact on the screen that
   * cannot wait for somebody to reach a desk, so it has to be impossible to
   * miss — not a column in a table.
   */
  it("leads with power that has no second factor", () => {
    expect(screen, 'it must single out twoFactor === "OFF"').toMatch(/twoFactor === "OFF"/);
    expect(screen, "and say it as a sentence rather than a column").toMatch(/without a second factor/);
  });

  it("does not reset a second factor or sign anybody out", () => {
    const acts = /security\/users\/[^"'`]*\/(reset-mfa|sign-out)/.test(screen);
    expect(acts, "those are recovery operations on privileged accounts; they are a desk job").toBe(false);
    expect(screen, "and the screen has to say where they are").toMatch(/on the web console/);
  });
});

/**
 * The first slice of the Companies surface.
 *
 * Fifty-five routes across seven files had no phone caller at all: company
 * accounts, private training seasons, sponsored challenges, scouting, domain
 * verification. The slice that landed first is the one that stands alone —
 * being scouted — because it needs no company page to exist and it is the half
 * that is actually phone-shaped: a company decides to recruit somebody at a
 * desk, and the person being recruited answers from wherever they are.
 */
describe("being scouted, on the phone", () => {
  const screen = read("mobile/app/talent.tsx");
  const routes = read("server/talent-routes.ts");

  it("reads the profile and the invitations", () => {
    expect(screen).toMatch(/\/api\/talent\/me/);
    expect(screen).toMatch(/\/api\/talent\/invites/);
  });

  /*
   * The point of the screen. An invitation that cannot be answered from the
   * phone is the state this was built to end.
   */
  it("can answer one", () => {
    expect(screen, "it should POST an answer").toMatch(/invites\/\$\{[^}]*\}\/answer/);
    expect(screen, "the route takes a boolean and nothing else").toMatch(/accept/);
  });

  /*
   * `profileShape` defaults `open` to false, so nobody is in a recruiting pool
   * they did not opt into. The screen has to read as a privacy control rather
   * than as a setting, and it has to be the server's value rather than a local
   * default that could disagree with it.
   */
  it("treats being findable as a privacy control", () => {
    expect(routes, "the server defaults it off").toMatch(/open:\s*row\?\.open\s*\?\?\s*false/);
    expect(screen, "and the switch reflects the server's value").toMatch(/value=\{p\.open\}/);
    expect(screen, "and says what off means").toMatch(/Nobody can find you/);
  });

  /*
   * Accepting opens a direct conversation, which is a different thing from
   * being on a list. Said before the tap rather than discovered after it.
   */
  it("says what accepting does before the tap", () => {
    expect(screen).toMatch(/message you directly/);
  });

  it("is reachable, and behind the companies switch", () => {
    const row = more.split("\n").find((l) => l.includes('go("/talent")'));
    expect(row, "nothing in the More tab opens /talent").toBeTruthy();
    expect(more, "the row should sit behind the companies surface").toMatch(/on\("companies"\)/);
  });
});

/**
 * Companies on the phone: the list, and one company.
 *
 * `GET /api/companies/:id` carries a comment calling its shape the one "every
 * tab relies on", and the part that matters most is `me.powers` — what this
 * person may do, worked out on the server "so every tab reads one answer
 * instead of restating the rule". The phone has to read that answer rather than
 * derive its own, because two implementations of a permission rule is one
 * implementation and one bug.
 */
describe("companies on the phone", () => {
  const list = read("mobile/app/companies.tsx");
  const detail = read("mobile/app/company/[id].tsx");
  const routes = read("server/company-routes.ts");

  it("reads the list and one company", () => {
    expect(list).toMatch(/"\/api\/companies"/);
    expect(detail).toMatch(/\/api\/companies\/\$\{[^}]*\}/);
  });

  /*
   * `publicCompany` is what both screens are given. Every field it puts on the
   * wire should be read by one of them or the shape is bigger than the need —
   * and `verifiedDomain`/`verifiedAt` especially, since the server's comment
   * says they are there so a screen can explain why a company cannot post
   * challenges.
   */
  it("reads the verification the server deliberately puts on the wire", () => {
    const shape = /const publicCompany[\s\S]*?\n\}\);/.exec(routes);
    expect(shape, "publicCompany changed shape").toBeTruthy();
    for (const field of ["verifiedDomain", "verifiedAt", "verifiedMethod"]) {
      expect(shape![0], `${field} should still be on the wire`).toContain(field);
      expect(
        new RegExp(`\\.${field}\\b`).test(list + detail),
        `the server sends ${field} so a screen can explain what is missing; neither screen reads it`,
      ).toBe(true);
    }
  });

  /*
   * The permission rule, read rather than reimplemented. A phone that worked
   * out its own answer would be a second rule to keep in step.
   */
  it("asks the server what the viewer may do", () => {
    expect(detail, "it should read me.powers").toMatch(/me\.powers/);
    expect(detail, "and say that is where the answer comes from").toMatch(/one answer instead of restating/);
  });

  /*
   * The phone reads companies and does not run them: members, seasons and
   * challenges are forms with consequences, and they stayed on the web. The one
   * exception is accepting an invitation, which is not administering a company
   * but joining one — the same thing the sim's join-by-code does, and the point
   * at which somebody has nothing to read yet.
   *
   * Written as a list of the routes allowed rather than as "no writes", because
   * the ban is on particular powers and a bare verb check cannot tell the
   * difference. A new write here fails this until it is argued for by name.
   */
  it("does not run a company from the phone", () => {
    const JOINING = ["/api/company-invites/accept"];
    const code = withoutComments(list + detail);
    /* `api<Shape>("/url", { method })` — the generic is optional and easy to forget. */
    const writes = [...code.matchAll(/api(?:<[^>]*>)?\(\s*`?"?([^"`]+)"?`?[^)]*method:\s*"(?:POST|PATCH|PUT|DELETE)"/g)]
      .map((m) => m[1]);
    /*
     * Anchor on the allowed one. Without this the test passes when the pattern
     * stops matching anything at all, which is how a check like this rots.
     */
    expect(writes, "the pattern no longer finds the writes it is filtering").toContain(JOINING[0]);
    expect(writes.filter((r) => !JOINING.includes(r))).toEqual([]);
    expect(code, "and the screens have to say the rest is on the web").toMatch(/on the web/);
  });

  it("is reachable, behind the companies switch", () => {
    expect(more, "nothing in the More tab opens /companies").toMatch(/go\("\/companies"\)/);
    expect(more).toMatch(/on\("companies"\)/);
  });
});

/**
 * The week, on a Run project.
 *
 * The piece of the Companies surface that most wanted to be on a phone: a
 * weekly check-in is three numbers and two sentences, done on a Sunday evening
 * or between two other things, and it was only possible at a desk.
 */
describe("the weekly rhythm on the phone", () => {
  const screen = read("mobile/app/rhythm/[id].tsx");
  const project = read("mobile/app/project/[id].tsx");
  const shared = read("shared/company-rhythm.ts");

  it("reads the week and files it", () => {
    expect(screen).toMatch(/\/rhythm`/);
    expect(screen, "it should PUT the week's check-in").toMatch(/rhythm\/checkins\/\$\{[^}]*\}/);
    expect(screen).toMatch(/method:\s*"PUT"/);
  });

  /*
   * The server distinguishes "nobody counted" from zero — `cleanNumbers`
   * accepts null — and a form that sent 0 for an empty box would file a bad
   * week as a counted one.
   */
  it("keeps an empty box different from a zero", () => {
    expect(shared, "the server still accepts null").toMatch(/finite numbers or null/);
    expect(screen, "an empty box has to become null, not 0").toMatch(/\?\s*null\s*:\s*Number\(/);
    expect(screen, "and the screen should say so").toMatch(/not the same as zero/);
  });

  /*
   * `metricsForProject` decides which numbers a project tracks, and sorts them
   * deliberately because jsonb does not keep key order. The phone must render
   * what it is given rather than deciding for itself — a restaurant tracks
   * covers, an agency does not.
   */
  it("renders the project's own metrics rather than a list of its own", () => {
    expect(screen, "it should map over what the server sent").toMatch(/d\.metrics\.map/);
    expect(screen, "and show which way is good, since a bare number has to be remembered").toMatch(/better === "up"/);
    expect(screen, "no hardcoded metric ids").not.toMatch(/"covers"|"foodCost"/);
  });

  it("is reachable from the project it belongs to, and only on the Run path", () => {
    expect(project, "nothing opens the rhythm").toMatch(/\/rhythm\/\$\{id\}/);
    expect(project, "a ship_mvp project has no week to file").toMatch(/goal === "run_company"/);
  });

  it("leaves the configuration on the web", () => {
    const writesConfig = /rhythm\/(settings|goals)/.test(screen);
    expect(writesConfig, "choosing metrics and goals is a desk job").toBe(false);
    expect(screen).toMatch(/are on the web/);
  });
});

/**
 * Sponsored challenges — the builder's side.
 *
 * A company posts a brief with a prize and builders enter. The company's half
 * (create, close entries, judge, announce) is seven routes and a desk job; this
 * is the other five.
 */
describe("challenges on the phone", () => {
  const list = read("mobile/app/challenges.tsx");
  const detail = read("mobile/app/challenge/[id].tsx");
  const shared = read("shared/challenges.ts");
  const routes = read("server/challenge-routes.ts");

  it("browses, reads one, and enters it", () => {
    expect(list).toMatch(/\/api\/challenges\?status=/);
    expect(detail).toMatch(/\/api\/challenges\/\$\{[^}]*\}`/);
    expect(detail, "it should POST an entry").toMatch(/\/enter`/);
  });

  /*
   * The limits are restated on the phone because Metro will not resolve
   * `@shared` — the same bargain `mobile-restatements.test.ts` strikes for the
   * moderation codes. This one matters because a pitch one character under the
   * floor is a 400 the entrant reads as "couldn't send that", so the form has
   * to enforce the same number and say so before the tap.
   */
  it("enforces the server's own entry limits", () => {
    const serverLimits = /ENTRY_LIMITS = \{([\s\S]*?)\} as const;/.exec(shared);
    const phoneLimits = /ENTRY_LIMITS = \{([\s\S]*?)\} as const;/.exec(detail);
    expect(serverLimits, "ENTRY_LIMITS moved in shared/challenges.ts").toBeTruthy();
    expect(phoneLimits, "the phone no longer restates ENTRY_LIMITS").toBeTruthy();

    const numbers = (block: string, key: string) => {
      const m = new RegExp(`${key}:\\s*\\{([^}]*)\\}`).exec(block);
      return m ? [...m[1].matchAll(/(\w+):\s*(\d+)/g)].map((x) => `${x[1]}=${x[2]}`).sort() : null;
    };
    for (const key of ["title", "pitch"]) {
      expect(
        numbers(phoneLimits![1], key),
        `the phone's ${key} limit has drifted from the server's`,
      ).toEqual(numbers(serverLimits![1], key));
    }
  });

  it("says how many characters are missing rather than refusing after the tap", () => {
    expect(detail).toMatch(/more characters needed/);
  });

  /*
   * The server refuses an entry that has not accepted the terms. Showing the
   * terms rather than linking to them is the point: accepting something you
   * were not given is not accepting.
   */
  it("shows the company's terms and requires accepting them", () => {
    expect(routes, "the server still demands it").toMatch(/acceptTerms !== true/);
    expect(detail, "the terms are rendered, not linked").toMatch(/\{c\.terms\}/);
    expect(detail, "and the switch gates the button").toMatch(/accepted/);
  });

  /*
   * `prizeHeld` is the row's real state rather than the company's description
   * of it — "the claim the whole escrow exists to let the page make". A screen
   * that showed `prize` alone would be repeating a promise instead of a fact.
   */
  it("shows what is actually held in escrow, not just what was promised", () => {
    expect(detail).toMatch(/prizeHeld/);
    expect(detail, "and says plainly when nothing is held").toMatch(/No prize is held/);
  });

  it("is reachable, behind the companies switch", () => {
    expect(more).toMatch(/go\("\/challenges"\)/);
  });
});

/**
 * Taking a seat in a company's private season.
 *
 * Measured before building, and the measurement is the interesting part: the
 * phone already calls eleven `/api/sim/*` routes — the desk, the market,
 * offers, standings, recovery, decisions, bids — so somebody seated in a
 * company's training season could play the whole thing. What it never called
 * was `/api/sim/join-code`, which is how you get seated. A company could run a
 * season, send its members the code, and anyone holding a phone could not take
 * their seat.
 *
 * So this was a door, not a feature: one route, and every screen behind it
 * already built.
 */
describe("joining a company season on the phone", () => {
  const screen = read("mobile/app/sim/index.tsx");
  const routes = read("server/simulation-routes.ts");

  it("can take a seat by code", () => {
    expect(screen, "the phone should post a join code").toMatch(/\/api\/sim\/join-code/);
    expect(screen, "and ask for one").toMatch(/input-join-code/);
  });

  /*
   * The route answers a wrong code and a code for a company you are not in
   * identically, because "a forwarded code must not confirm it works". A phone
   * that said "you're not in that company" would undo that on the one screen
   * where the code gets pasted.
   */
  it("keeps the refusal as vague as the server's", () => {
    expect(routes, "the server still answers 404 for both").toMatch(/a forwarded code must not confirm it works/);
    expect(screen, "so the phone says the same bland thing").toMatch(/isn't valid/);
    expect(screen, "and must not name the company rule").not.toMatch(/not a member|not in that company/i);
  });

  /*
   * The point of measuring first: the playing half was never missing. If these
   * stop being called the gap is a different one and this slice's reasoning no
   * longer holds.
   */
  it("still plays through the routes it already had", () => {
    for (const path of ["/desk", "/market", "/offers", "/standings"]) {
      expect(
        new RegExp(`/api/sim/ventures/\\$\\{[^}]*\\}${path}`).test(read("mobile/src/components/sim/useSim.ts")),
        `the phone stopped calling ventures${path}`,
      ).toBe(true);
    }
  });
});
