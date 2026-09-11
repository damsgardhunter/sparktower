/**
 * The boundary on what a browser can put into the Explore loop's rows.
 *
 * `/api/track` is open to anyone, so these five properties are all that may
 * reach the table — anything else is dropped, not stored and not rejected.
 */
import { describe, it, expect } from "vitest";
import { EXPLORE_EVENTS, EXPLORE_FUNNEL, isExploreEvent, sanitizeExploreProps, exploreLabel } from "@shared/explore-events";

describe("sanitizeExploreProps", () => {
  it("keeps the five properties when they're well-formed", () => {
    expect(sanitizeExploreProps({
      matchType: "builder", targetId: "0b7c1e4a-9f7f-4b8e-9c55-2a6a1c7d3e10", rankPosition: 3, source: "matches", timeToActionMs: 4200.6,
    })).toEqual({
      matchType: "builder", targetId: "0b7c1e4a-9f7f-4b8e-9c55-2a6a1c7d3e10", rankPosition: 3, source: "matches", timeToActionMs: 4201,
    });
  });

  it("drops everything else, and anything out of range", () => {
    expect(sanitizeExploreProps({
      matchType: "alien", targetId: "<script>", rankPosition: 0, source: "twitter", timeToActionMs: -5,
      email: "someone@example.com", content: "the message itself",
    })).toEqual({});
    expect(sanitizeExploreProps({ rankPosition: 2.5, timeToActionMs: 7 * 60 * 60 * 1000 })).toEqual({});
    expect(sanitizeExploreProps({ rankPosition: "3", timeToActionMs: null })).toEqual({});
  });

  it("treats anything that isn't an object as nothing", () => {
    for (const raw of [null, undefined, "x", 5, ["builder"]]) expect(sanitizeExploreProps(raw)).toEqual({});
  });
});

describe("the event list", () => {
  it("recognises its own names and no others", () => {
    expect(isExploreEvent(EXPLORE_EVENTS.follow)).toBe(true);
    expect(isExploreEvent("page.view")).toBe(false);
    expect(isExploreEvent("explore.follows")).toBe(false);
    expect(exploreLabel("explore.message_sent")).toBe("Sent a message");
    expect(exploreLabel("api.write")).toBeNull();
  });

  it("puts every event but the last in the funnel, in loop order", () => {
    const counted = EXPLORE_FUNNEL.flatMap((step) => step.events as readonly string[]);
    expect(counted).not.toContain(EXPLORE_EVENTS.sessionEnd);
    expect(new Set(counted).size).toBe(counted.length);
    expect(EXPLORE_FUNNEL[0].events).toEqual([EXPLORE_EVENTS.openDiscover]);
  });
});
