/** The sidebar holds the sequencing decision (docs/decisions/0001-path-loops-first.md): the path loops are primary, everything that waits is secondary and flagged. */
import { describe, it, expect } from "vitest";
import { PRIMARY_NAV, SECONDARY_NAV } from "../../client/src/lib/navigation";
import { SURFACES, SURFACE_ROUTES } from "@shared/surfaces";

const sequenceOf = (id?: string) => SURFACES.find((s) => s.id === id)?.sequence;

/**
 * After-wedge surfaces that Discover absorbed: they still have routes, but the routes
 * redirect and the sections live inside /discover, so they have no nav entry of their own.
 * Listed rather than skipped, so bringing one back as a destination is a deliberate edit here.
 */
const ABSORBED_INTO_DISCOVER = ["matches", "leaderboard"];

describe("navigation", () => {
  it("keeps the primary group to the path loops: nothing that waits for the wedge", () => {
    // Home, the path waiting across every project, and Discover — the one outward destination.
    // /path earns its place by the same decision: it is where the retention loop returns to,
    // not something waiting on the wedge. Discover is "supports" for the same reason: a
    // published step has to land somewhere, so it isn't waiting on the wedge either.
    expect(PRIMARY_NAV.map((i) => i.url)).toEqual(["/", "/path", "/discover"]);
    for (const item of PRIMARY_NAV) expect(sequenceOf(item.surface), item.title).not.toBe("after-wedge");
  });

  it("names the owning surface on every nav item that sits on one, in both groups", () => {
    // Primary or not, an item on a surface's route has to carry its flag, or switching
    // the surface off leaves a link to a page that now answers 404.
    for (const item of [...PRIMARY_NAV, ...SECONDARY_NAV]) {
      const owner = Object.entries(SURFACE_ROUTES).find(([, prefixes]) => prefixes.some((p) => item.url === p || item.url.startsWith(`${p}/`)))?.[0];
      if (owner) expect(item.surface, `${item.title} is on the ${owner} surface's route — hide it with that flag`).toBe(owner);
    }
  });

  it("keeps after-wedge surfaces out of the primary group and reachable from somewhere", () => {
    // Every after-wedge surface with a page of its own is reachable only from the secondary
    // group — or from inside Discover, which is the only place a page is allowed to be absorbed.
    const afterWedgeWithPages = SURFACES.filter((s) => s.sequence === "after-wedge" && SURFACE_ROUTES[s.id]?.some((p) => !p.startsWith("/admin")));
    for (const s of afterWedgeWithPages) {
      expect(PRIMARY_NAV.some((i) => i.surface === s.id), s.id).toBe(false);
      if (ABSORBED_INTO_DISCOVER.includes(s.id)) {
        expect(SECONDARY_NAV.some((i) => i.surface === s.id), `${s.id} lives inside Discover — it should not also be a nav destination`).toBe(false);
        expect(PRIMARY_NAV.some((i) => i.surface === "discover"), `${s.id} is only reachable through Discover, so Discover has to be in the nav`).toBe(true);
      } else {
        expect(SECONDARY_NAV.some((i) => i.surface === s.id), `${s.id} has a page but no nav entry`).toBe(true);
      }
    }
  });
});
