/**
 * Route gating for the kill switches.
 *
 * This decides whether the client renders a page or a 404. Getting it wrong in
 * one direction hides a working feature; in the other it shows a feature that
 * was switched off during an incident, and the server then refuses every
 * request the page makes — which reads as "the site is broken" rather than
 * "this is off".
 */
import { describe, it, expect } from "vitest";
import {
  isPathDisabled, defaultSurfaceMap, SURFACE_ROUTES, SURFACES,
} from "@shared/surfaces";

describe("isPathDisabled", () => {
  it("blocks the surface's own path and everything under it", () => {
    const off = { sprints: false };
    expect(isPathDisabled("/sprints", off)).toBe(true);
    expect(isPathDisabled("/sprints/practice", off)).toBe(true);
    expect(isPathDisabled("/sprints/abc-123/review", off)).toBe(true);
  });

  it("leaves an enabled surface alone", () => {
    expect(isPathDisabled("/sprints/practice", { sprints: true })).toBe(false);
  });

  it("treats a surface missing from the map as on", () => {
    /*
     * Fails open, deliberately, and the check is `=== false` rather than
     * falsy for exactly this reason. The map arrives from an API call that can
     * be slow or fail; if an absent key read as "off", every gated page would
     * flash a 404 on load before the flags arrived.
     */
    expect(isPathDisabled("/sprints", {})).toBe(false);
    expect(isPathDisabled("/sprints", { sprints: undefined as any })).toBe(false);
  });

  it("does not block an unrelated path", () => {
    const allOff = Object.fromEntries(Object.keys(SURFACE_ROUTES).map((k) => [k, false]));
    expect(isPathDisabled("/projects/abc", allOff)).toBe(false);
    expect(isPathDisabled("/", allOff)).toBe(false);
    expect(isPathDisabled("/profile", allOff)).toBe(false);
  });

  it("does not let a prefix swallow a different top-level route", () => {
    // "/a/" for shared artifacts must not catch "/admin/..." — the trailing
    // slash in the prefix is what keeps them apart, and it is easy to remove.
    expect(isPathDisabled("/admin/reports", { feed: false })).toBe(false);
    expect(isPathDisabled("/a/abc123", { feed: false })).toBe(true);
  });

  it("gates every prefix a surface claims", () => {
    // feed owns two unrelated paths; a partial implementation that only
    // handled the first would leave shared artifacts reachable.
    expect(isPathDisabled("/posts/abc", { feed: false })).toBe(true);
    expect(isPathDisabled("/a/abc", { feed: false })).toBe(true);
  });

  it("gates the contests page with the contests switch", () => {
    expect(isPathDisabled("/contests", { contests: false })).toBe(true);
    expect(isPathDisabled("/contests", { contests: true })).toBe(false);
  });
});

describe("the surface registry", () => {
  it("gives every route group a surface that exists", () => {
    const known = new Set(SURFACES.map((s) => s.id));
    for (const id of Object.keys(SURFACE_ROUTES)) {
      // A typo here silently un-gates a whole area: the flag would be toggled
      // in the admin console and the routes would keep working.
      expect(known).toContain(id);
    }
  });

  it("defaults every registered surface to a real boolean", () => {
    const defaults = defaultSurfaceMap();
    for (const s of SURFACES) {
      expect(typeof defaults[s.id]).toBe("boolean");
      expect(defaults[s.id]).toBe(s.defaultEnabled);
    }
  });

  it("ships backing and contests on, and keeps live chat off by default", () => {
    const defaults = defaultSurfaceMap();
    // Backing holds real money in escrow; pledges stay held until a reviewer
    // approves, and the switch turns the whole area off at runtime.
    expect(defaults.backing).toBe(true);
    // Contests took the retired Needs feedback page's place in the nav.
    expect(defaults.contests).toBe(true);
    expect(defaults.liveChat).toBe(false);
  });

  it("no longer registers the retired surfaces", () => {
    for (const id of ["checkIns", "games"]) {
      expect(SURFACES.some((s) => s.id === id)).toBe(false);
      expect(id in SURFACE_ROUTES).toBe(false);
    }
  });
});
