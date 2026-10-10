/**
 * Private training seasons, on a phone.
 *
 * All eleven routes in `server/company-season-routes.ts` had no phone caller.
 * The one that mattered most was the facilitator's: who has filed, which table
 * is waiting, which chairs are empty — a screen somebody wants while walking
 * between tables, and it was on a laptop at the front of the room.
 */
import { describe, it, expect } from "vitest";
import {
  SEAT_PRICE_CENTS as webSeatPrices, SEAT_KINDS as webSeatKinds,
  PERIOD_MINUTES_MIN, PERIOD_MINUTES_MAX, BOT_TEAMS_MAX,
} from "../../server/company-season-routes";
import * as phone from "../../mobile/src/components/company/seasons";
import { readSource, withoutComments } from "../helpers/source-parity";

const training = withoutComments(readSource("mobile/src/components/company/TrainingTab.tsx"));
const sheet = withoutComments(readSource("mobile/src/components/company/SeasonSheet.tsx"));
const screen = withoutComments(readSource("mobile/app/company/[id].tsx"));
const routes = readSource("server/company-season-routes.ts");
const all = `${training}\n${sheet}`;

describe("the eleven routes now have a caller", () => {
  const MUST_CALL: [string, RegExp][] = [
    ["the season list", /\/seasons`\)/],
    ["setting one up", /\/seasons`, \{\s*method: "POST"/],
    ["asking Nova to build one", /\/seasons\/nova`, \{\s*method: "POST"/],
    ["seats held", /\/simulation-seats`\)/],
    ["buying seats from the balance", /\/simulation-seats\/buy`, \{\s*method: "POST"/],
    ["the card checkout", /\/simulation-seats\/checkout`, \{\s*method: "POST"/],
    ["offering colleagues a seat", /\$\{base\}\/invite`, \{ method: "POST"/],
    ["starting it", /\$\{base\}\/start`, \{ method: "POST"/],
    ["ending the period now", /\$\{base\}\/resolve-year-now`, \{ method: "POST"/],
    ["watching the tables", /\$\{base\}\/watch`\)/],
    ["the staff report", /\$\{base\}\/report`\)/],
  ];

  for (const [what, pattern] of MUST_CALL) {
    it(`calls ${what}`, () => expect(all).toMatch(pattern));
  }

  it("is on the screen rather than only in a file", () => {
    expect(screen).toMatch(/value: "training"/);
    expect(screen).toMatch(/tab === "training" \? <TrainingTab /);
  });
});

describe("the prices are the server's", () => {
  it("restates SEAT_PRICE_CENTS exactly", () => {
    expect(phone.SEAT_PRICE_CENTS).toEqual(webSeatPrices);
  });

  it("restates the limits the form has to state", () => {
    /* Imported from the server rather than matched out of its text: these are
     * plain numbers, so they can simply be compared. */
    expect(phone.PERIOD_MINUTES_MIN).toBe(PERIOD_MINUTES_MIN);
    expect(phone.PERIOD_MINUTES_MAX).toBe(PERIOD_MINUTES_MAX);
    expect(phone.BOT_TEAMS_MAX).toBe(BOT_TEAMS_MAX);
  });

  it("knows the same seat kinds, in the same order", () => {
    expect(phone.SEAT_KINDS).toEqual(webSeatKinds);
  });

  it("does not restate the cadence vocabulary a second time", () => {
    /*
     * `components/sim/period.ts` already has it, held to
     * shared/simulation/cadence.ts by its own test. A second copy of "quarter"
     * is one copy too many.
     */
    expect(training).toMatch(/from "\.\.\/sim\/period"/);
    expect(readSource("mobile/src/components/company/seasons.ts")).not.toMatch(/one: "quarter"/);
  });
});

describe("iOS is not offered a card", () => {
  /*
   * Selling a digital good for a card inside an iOS app is against Apple's
   * rules. The app already draws that line once, in `topUpRoute`, and this has
   * to follow it rather than invent a second answer — a Stripe sheet for seats
   * on an iPhone is the kind of thing that fails review.
   */
  it("gates the checkout on the same switch the rest of the app uses", () => {
    expect(training).toMatch(/import \{ topUpRoute \} from "\.\.\/Pay"/);
    expect(training).toMatch(/topUpRoute === "stripe" \?/);
  });

  it("still offers the balance everywhere, which is how iOS pays", () => {
    const buy = training.slice(training.indexOf("const buy = useMutation"));
    expect(buy.slice(0, 400)).toMatch(/simulation-seats\/buy/);
    /* Not wrapped in a platform check. */
    expect(training).toMatch(/testID="buy-seats"/);
    const beforeBuyBtn = training.slice(0, training.indexOf('testID="buy-seats"'));
    expect(beforeBuyBtn.slice(-400)).not.toMatch(/topUpRoute/);
  });
});

describe("starting is a decision, not a clock", () => {
  it("says how many tables are ready, so the wait is visible", () => {
    /* The server's reason: a workshop's tables fill with bots after a minute,
     * so "ready" could mean the season starts while half the room is typing in
     * the link. */
    expect(sheet).toMatch(/\$\{season\.roomsReady\}\/\$\{season\.rooms\} ready/);
    expect(sheet).toMatch(/disabled=\{!season\.roomsReady\}/);
  });

  it("confirms, and says seats are charged for who sat down", () => {
    expect(sheet).toMatch(/Start the season\?/);
    expect(sheet).toMatch(/Stand-ins are not charged for/);
  });

  it("keeps the server's refusal, which is the seat count", () => {
    expect(sheet).toMatch(/errText\(e, "Couldn't start it\."\)/);
  });
});

describe("the facilitator's view", () => {
  it("only asks for the watch route when it would not 403", () => {
    /*
     * `watch` needs run_seasons and a running season; asking otherwise is a
     * failed request on every render of the sheet.
     */
    expect(sheet).toMatch(/enabled: mayRun && season\.status === "running"/);
  });

  it("names who is being waited on rather than counting them", () => {
    expect(sheet).toMatch(/Waiting on \{t\.waitingOn\.join\(", "\)\}/);
  });

  it("says when a table cannot start because a chair is empty", () => {
    expect(sheet).toMatch(/t\.empty \?/);
    expect(sheet).toMatch(/this table cannot start/);
  });

  it("polls while a session is happening", () => {
    /* A facilitator leaves this on screen; a stale "3/5 filed" is the one thing it must not show. */
    expect(sheet).toMatch(/refetchInterval: 10_000/);
    expect(training).toMatch(/refetchInterval: 15_000/);
  });

  it("names who did not play in the report, rather than counting them", () => {
    /* "Four people did not play" is a number somebody has to go and work out. */
    expect(sheet).toMatch(/report\.notPlaying\.map\(\(m\) => m\.name\)\.join\(", "\)/);
  });

  it("shows the server's one line of prose rather than writing a second", () => {
    expect(sheet).toMatch(/\{p\.read\}/);
  });
});

describe("what it does not pretend to do", () => {
  it("gates every write on run_seasons, and still lets anybody look", () => {
    expect(training).toMatch(/hasPower\(view\.me, "run_seasons"\)/);
    expect(training).toMatch(/You can see the company's seasons/);
  });

  it("links a player to the room another session built, rather than drawing a second one", () => {
    expect(training).toMatch(/nav\.push\(`\/sim\/\$\{s\.myVentureId\}`\)/);
  });

  it("has no placeholder navigation left in it", () => {
    /* An earlier draft of this file had `const router = () => {}` as a stub. */
    expect(training).not.toMatch(/const router = \(\) => \{\}/);
  });
});
