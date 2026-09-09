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
    const off = { games: false };
    expect(isPathDisabled("/games", off)).toBe(true);
    expect(isPathDisabled("/games/typing", off)).toBe(true);
    expect(isPathDisabled("/games/typing/abc-123", off)).toBe(true);
  });

  it("leaves an enabled surface alone", () => {
    expect(isPathDisabled("/games/typing", { games: true })).toBe(false);
  });

  it("treats a surface missing from the map as on", () => {
    /*
     * Fails open, deliberately, and the check is `=== false` rather than
     * falsy for exactly this reason. The map arrives from an API call that can
     * be slow or fail; if an absent key read as "off", every gated page would
     * flash a 404 on load before the flags arrived.
     */
    expect(isPathDisabled("/games", {})).toBe(false);
    expect(isPathDisabled("/games", { games: undefined as any })).toBe(false);
  });

  it("does not block an unrelated path", () => {
    const allOff = Object.fromEntries(Object.keys(SURFACE_ROUTES).map((k) => [k, false]));
    expect(isPathDisabled("/projects/abc", allOff)).toBe(false);
    expect(isPathDisabled("/", allOff)).toBe(false);
    expect(isPathDisabled("/profile", allOff)).toBe(false);
  });

  it("does not let a prefix swallow a different top-level route", () => {
    // "/c/" for check-ins must not catch "/contests" — the trailing slash in
    // the prefix is what keeps them apart, and it is easy to remove.
    expect(isPathDisabled("/contests", { checkIns: false, contests: true })).toBe(false);
    expect(isPathDisabled("/c/abc123", { checkIns: false })).toBe(true);
  });

  it("gates every prefix a surface claims", () => {
    // checkIns owns two unrelated paths; a partial implementation that only
    // handled the first would leave the feedback queue reachable.
    expect(isPathDisabled("/feedback", { checkIns: false })).toBe(true);
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

  it("keeps the surfaces that handle money or need a crowd off by default", () => {
    const defaults = defaultSurfaceMap();
    // Backing holds real money in escrow and has never had a pledge walked
    // end to end; the rest need people the site does not have yet.
    expect(defaults.backing).toBe(false);
    expect(defaults.games).toBe(false);
  });
});
