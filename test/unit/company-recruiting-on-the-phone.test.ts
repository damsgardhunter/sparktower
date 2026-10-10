/**
 * Recruiting and scouting, from the company's side, on a phone.
 *
 * The person being recruited already had their half (`app/talent.tsx`): they
 * could open their profile to companies and answer. The company's half was
 * web-only, and scouting had no phone caller at all — all four of
 * `server/scouting-routes.ts` and the four company-side routes in
 * `server/talent-routes.ts`.
 *
 * Read against the source, like the rest of the mobile parity suite, and every
 * assertion is about usage rather than presence.
 */
import { describe, it, expect } from "vitest";
import { readSource, withoutComments } from "../helpers/source-parity";

const talent = withoutComments(readSource("mobile/src/components/company/TalentTab.tsx"));
const scouting = withoutComments(readSource("mobile/src/components/company/ScoutingTab.tsx"));
const screen = withoutComments(readSource("mobile/app/company/[id].tsx"));

describe("the eight routes that had no phone caller", () => {
  const MUST_CALL: [string, string, RegExp][] = [
    ["searching the pool", "talent", /\/talent\$\{q\.trim\(\) \? `\?q=/],
    ["one candidate, whole", "talent", /\/talent\/\$\{userId\}`\)/],
    ["asking somebody to talk", "talent", /\/talent\/\$\{userId\}\/invite`, \{\s*method: "POST"/],
    ["who has been asked", "talent", /\/talent-invites`\)/],
    ["the scouting view", "scouting", /\/scouting`\)/],
    ["setting the watched industries", "scouting", /\/watches`, \{ method: "PUT"/],
    ["following a project", "scouting", /\/follows\/\$\{projectId\}`, \{ method: "POST"/],
    ["unfollowing", "scouting", /\/follows\/\$\{projectId\}`, \{ method: "DELETE"/],
  ];

  for (const [what, where, pattern] of MUST_CALL) {
    it(`calls ${what}`, () => {
      expect(where === "talent" ? talent : scouting).toMatch(pattern);
    });
  }

  it("puts both tabs on the screen, not just in a file", () => {
    /* A component nothing renders is a component nobody can reach. */
    for (const [tab, component] of [["talent", "TalentTab"], ["scouting", "ScoutingTab"]] as const) {
      expect(screen).toMatch(new RegExp(`value: "${tab}"`));
      expect(screen).toMatch(new RegExp(`tab === "${tab}" \\? <${component} `));
    }
  });
});

describe("the powers these two need are the server's", () => {
  it("gates recruiting on the recruit power, not on a role", () => {
    expect(talent).toMatch(/hasPower\(view\.me, "recruit"\)/);
  });

  it("gates changing what is scouted on the scouting power", () => {
    expect(scouting).toMatch(/hasPower\(view\.me, "scouting"\)/);
  });

  it("still lets anybody read both, because reading needs only view", () => {
    /*
     * The server asks for "view" on the search and the scouting read, and
     * "recruit"/"scouting" only on the writes. Hiding the whole tab would be
     * stricter than the server and would hide the company's own candidate list
     * from the person who was told to look at it.
     */
    expect(talent).toMatch(/You can read the pool/);
    expect(scouting).toMatch(/You can see what the company watches and follows/);
  });

  it("says a company must be verified before it approaches anybody", () => {
    expect(talent).toMatch(/verifiedAt/);
    expect(talent).toMatch(/before it can approach anybody/);
  });
});

describe("the limits the server enforces are stated before the tap, not after", () => {
  it("holds the message length to the server's own MESSAGE_MIN and MESSAGE_MAX", () => {
    /* server/talent-routes.ts: 20 and 800. A phone that let somebody write
     * nineteen characters would collect a refusal after the writing. */
    expect(talent).toMatch(/const MESSAGE_MIN = 20;/);
    expect(talent).toMatch(/const MESSAGE_MAX = 800;/);
    expect(talent).toMatch(/message\.trim\(\)\.length < MESSAGE_MIN/);
    expect(talent).toMatch(/disabled=\{tooShort\}/);
  });

  it("holds a scouting note to the server's NOTE_MAX", () => {
    expect(scouting).toMatch(/const NOTE_MAX = 280;/);
    expect(scouting).toMatch(/maxLength=\{NOTE_MAX\}/);
  });

  it("sends the industries as a whole set, which is what the route replaces", () => {
    expect(scouting).toMatch(/body: \{ industries: picked \}/);
  });
});

describe("what it says instead of guessing", () => {
  it("keeps the server's answer when somebody has already been asked", () => {
    /* "Your company has already asked them." — once per company per person, ever. */
    expect(talent).toMatch(/errText\(e, "Couldn't ask them\."\)/);
    expect(talent).toMatch(/already asked them/);
  });

  it("shows an existing invite's state rather than offering to ask again", () => {
    expect(talent).toMatch(/c\.invite \?/);
  });

  it("confirms before it stops following something, because the note goes with it", () => {
    expect(scouting).toContain("Alert.alert");
    expect(scouting).toMatch(/The note goes with it/);
  });

  it("explains an empty suggestions list two different ways", () => {
    /*
     * "watch an industry" and "nothing new in those industries" are different
     * facts, and one message for both would send somebody to change a setting
     * that is already right.
     */
    expect(scouting).toMatch(/Watch an industry to see suggestions here/);
    expect(scouting).toMatch(/Nothing new in those industries/);
  });
});

describe("the industry list is the one the server validates against", () => {
  it("comes from the phone's restated categories, not a list typed here", () => {
    /*
     * INDUSTRIES is PROJECT_CATEGORIES on the server, deliberately — "a second
     * list that drifted from the first would make scouting quietly miss
     * things". The phone has to borrow the same list for the same reason, and
     * mobile-mirror.test.ts already holds that copy to the web's.
     */
    expect(scouting).toMatch(/import \{ PROJECT_CATEGORIES \} from "\.\.\/\.\.\/projectData"/);
    expect(scouting).toMatch(/PROJECT_CATEGORIES\.map\(/);
  });
});
