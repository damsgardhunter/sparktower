/**
 * The number an owner glances at has to mean people.
 *
 * It read 1,121 "people this week" against seven accounts. The count itself
 * was right — `count(DISTINCT coalesce(user_id, visitor_id))` — and 1,103 of
 * the events behind it came from `curl/8.7.1`. A tool keeps no cookies, so
 * every request mints a fresh visitor id and arrives as somebody new: one
 * request, one person. On the same data the honest figure was 28.
 *
 * It matters past a development tree. A public site is crawled, and uptime
 * checks and link previewers hit it all day, so on a launched product that
 * number measures robot traffic and nothing else.
 *
 * ## What this holds
 *
 * The predicate, in both directions, because both directions cost something
 * and they are not the same cost. A robot counted as a person overstates a
 * number. A person dismissed as a robot deletes somebody from the record, and
 * only one of those is recoverable — so the browser cases are the ones written
 * out at length.
 */
import { describe, it, expect } from "vitest";
import { isRobotAgent, ROBOT_AGENT_PATTERN } from "@shared/analytics";

/** Real strings, as they arrive. */
const BROWSERS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
];

const TOOLS = [
  "curl/8.7.1",
  "Wget/1.21.4",
  "node",
  "node-fetch/2.6.7",
  "python-requests/2.32.3",
  "Go-http-client/2.0",
  "axios/1.7.2",
  "okhttp/4.12.0",
  "PostmanRuntime/7.39.0",
  "Googlebot/2.1 (+http://www.google.com/bot.html)",
  "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
  "Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)",
  "facebookexternalhit/1.1",
  "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
];

describe("who counts as a person", () => {
  it("counts every real browser, which is the half that must not be wrong", () => {
    for (const agent of BROWSERS) {
      expect(isRobotAgent(agent), `a browser was dismissed as a robot: ${agent}`).toBe(false);
    }
  });

  it("does not count the tools and crawlers that keep no cookies", () => {
    for (const agent of TOOLS) {
      expect(isRobotAgent(agent), `counted as a person: ${agent}`).toBe(true);
    }
  });

  it("treats a missing agent as a script, because every browser sends one", () => {
    for (const agent of [undefined, null, "", "   "]) {
      expect(isRobotAgent(agent as string | null | undefined)).toBe(true);
    }
  });

  /*
   * A headless browser is how the browser tests drive this product, and a
   * person automating their own use of a site is still a person. They are also
   * the case most likely to be swept up by a careless pattern, so it is
   * written down.
   */
  it("still counts a headless browser", () => {
    expect(isRobotAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/129.0.0.0 Safari/537.36",
    )).toBe(false);
  });

  /*
   * The database asks the same question with the same words. If these ever
   * part, the tile and the feed under it disagree about who was there, which
   * is the failure the whole module comment in server/analytics-routes.ts is
   * written against.
   */
  it("uses one pattern, shaped so Postgres and JavaScript read it the same way", () => {
    expect(ROBOT_AGENT_PATTERN, "no anchors, groups or classes that only one engine understands")
      .toMatch(/^\([a-z0-9|-]+\)$/);
    const named = ROBOT_AGENT_PATTERN.slice(1, -1).split("|");
    expect(named).toContain("curl");
    expect(named).toContain("bot");
    for (const word of named) {
      expect(word.length, `"${word}" is short enough to match a real browser by accident`).toBeGreaterThan(2);
    }
  });
});
