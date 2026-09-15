/** The sidebar holds the sequencing decision (docs/decisions/0001-path-loops-first.md): the path loops are primary, everything that waits is secondary and flagged. */
import { describe, it, expect } from "vitest";
import { PRIMARY_NAV, SECONDARY_NAV } from "../../client/src/lib/navigation";
import { SURFACES, SURFACE_ROUTES } from "@shared/surfaces";

const sequenceOf = (id?: string) => SURFACES.find((s) => s.id === id)?.sequence;

describe("navigation", () => {
  it("keeps the primary group to the path loops: nothing that waits for the wedge", () => {
    expect(PRIMARY_NAV.map((i) => i.url)).toEqual(["/", "/projects"]);
    for (const item of PRIMARY_NAV) expect(sequenceOf(item.surface), item.title).not.toBe("after-wedge");
  });

  it("puts every surface-owned page in the secondary group, under its flag", () => {
    for (const item of SECONDARY_NAV) {
      const owner = Object.entries(SURFACE_ROUTES).find(([, prefixes]) => prefixes.some((p) => item.url === p || item.url.startsWith(`${p}/`)))?.[0];
      if (owner) expect(item.surface, `${item.title} is on the ${owner} surface's route — hide it with that flag`).toBe(owner);
    }
    // Every after-wedge surface with a page of its own is reachable only from the secondary group.
    const afterWedgeWithPages = SURFACES.filter((s) => s.sequence === "after-wedge" && SURFACE_ROUTES[s.id]?.some((p) => !p.startsWith("/admin")));
    for (const s of afterWedgeWithPages) {
      expect(PRIMARY_NAV.some((i) => i.surface === s.id), s.id).toBe(false);
      expect(SECONDARY_NAV.some((i) => i.surface === s.id), `${s.id} has a page but no nav entry`).toBe(true);
    }
  });
});
