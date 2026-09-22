/**
 * The Explore mirror, against the shared file it mirrors.
 *
 * A gap here is invisible in every other way: the server's boundary
 * (sanitizeExploreProps) drops a `source` it doesn't recognise and stores the
 * event anyway, and an event this app never sends simply reads as zero. That
 * is exactly how the app came to be missing four of the eight sources and the
 * "saw a match" event — nothing failed, the funnel just quietly lied.
 *
 * So these read shared/explore-events.ts directly, as text, and hold the two
 * lists to each other. Importing it isn't an option: the mobile package has no
 * @shared alias and adding one would put the server's dependencies inside the
 * app bundle, which is the reason the mirror exists in the first place.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const sharedSource = readFileSync(
  fileURLToPath(new URL("../../shared/explore-events.ts", import.meta.url)),
  "utf8",
);

/** The right-hand sides of a `const X = [...] as const` array of string literals. */
function sharedList(name: string): string[] {
  const match = sharedSource.match(new RegExp(`export const ${name} = \\[([^\\]]*)\\]`));
  if (!match) throw new Error(`${name} is gone from shared/explore-events.ts`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** Every event name shared declares, from the EXPLORE_EVENTS object. */
function sharedEventNames(): string[] {
  const body = sharedSource.slice(sharedSource.indexOf("export const EXPLORE_EVENTS"));
  return [...body.slice(0, body.indexOf("} as const")).matchAll(/"(explore\.[a-z_]+)"/g)].map((m) => m[1]);
}

/** A fresh copy: the impression set and the open timestamps are module state. */
async function explore() {
  vi.resetModules();
  return import("./explore");
}

let tracked: { name: string; path: string; props: any }[] = [];

/**
 * Let the send finish. `trackExplore` is fire-and-forget through the api
 * client, which reads the stored token and the visitor id before it ever
 * touches fetch — several microtasks, not one.
 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  tracked = [];
  vi.stubGlobal("fetch", async (url: string, init: any) => {
    const body = JSON.parse(init.body);
    for (const e of body.events) tracked.push(e);
    return { ok: true, status: 200, text: async () => "{}", json: async () => ({}) };
  });
});

describe("the mirror", () => {
  it("restates every source the server accepts", async () => {
    const { EXPLORE_SOURCES } = await explore();
    expect([...EXPLORE_SOURCES]).toEqual(sharedList("EXPLORE_SOURCES"));
  });

  it("names every event a client is allowed to send", async () => {
    const { EXPLORE } = await explore();
    // The actions (follow, connect, message, comment) are the server's to
    // record — a client only ever sends the rest.
    const clientSendable = sharedEventNames().filter(
      (n) => !["explore.follow", "explore.connect_request", "explore.message_sent", "explore.comment"].includes(n),
    );
    expect(Object.values(EXPLORE).sort()).toEqual(clientSendable.sort());
  });
});

describe("viewMatchCard", () => {
  it("sends the funnel's second step, which the app used to skip entirely", async () => {
    const { viewMatchCard } = await explore();
    viewMatchCard({ matchType: "project", targetId: "p1", source: "feed", rankPosition: 3 }, "/feed");
    await flush();

    expect(tracked).toHaveLength(1);
    expect(tracked[0].name).toBe("explore.view_match_card");
    expect(tracked[0].path).toBe("/feed");
    expect(tracked[0].props).toEqual({ matchType: "project", targetId: "p1", source: "feed", rankPosition: 3 });
  });

  it("counts a card once, however many times it wobbles into view", async () => {
    const { viewMatchCard } = await explore();
    viewMatchCard({ matchType: "builder", targetId: "u1", source: "feed" }, "/feed");
    viewMatchCard({ matchType: "builder", targetId: "u1", source: "feed" }, "/feed");
    viewMatchCard({ matchType: "builder", targetId: "u1", source: "feed", rankPosition: 9 }, "/feed");
    await flush();

    expect(tracked).toHaveLength(1);
  });

  it("separates the same card on two surfaces", async () => {
    const { viewMatchCard } = await explore();
    viewMatchCard({ matchType: "project", targetId: "p1", source: "feed" }, "/feed");
    viewMatchCard({ matchType: "project", targetId: "p1", source: "projects" }, "/projects");
    await flush();

    expect(tracked.map((e) => e.props.source)).toEqual(["feed", "projects"]);
  });

  it("starts counting again when Discover reopens: 'saw it' means on this visit", async () => {
    const { openDiscover, viewMatchCard } = await explore();
    viewMatchCard({ matchType: "project", targetId: "p1", source: "discover" });
    openDiscover();
    viewMatchCard({ matchType: "project", targetId: "p1", source: "discover" });
    await flush();

    expect(tracked.filter((e) => e.name === "explore.view_match_card")).toHaveLength(2);
  });
});
