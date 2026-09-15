import { describe, it, expect } from "vitest";
import { projectVisual, projectVisualSource, isProjectVisualHidden, isProjectVisualSlot } from "@shared/project-visuals";

describe("project visual lookups", () => {
  const visuals = { oneLiner: "/objects/a", about: "/objects/b", hidden: ["about"] };

  it("keep a hidden image for the owner but not for the page", () => {
    expect(projectVisual(visuals, "oneLiner")).toBe("/objects/a");
    expect(projectVisual(visuals, "about")).toBeNull();
    expect(projectVisualSource(visuals, "about")).toBe("/objects/b");
    expect(isProjectVisualHidden(visuals, "about")).toBe(true);
  });

  it("tolerate an empty or malformed column", () => {
    for (const v of [null, undefined, {}, "x", { hidden: "about" }]) {
      expect(projectVisual(v, "about")).toBeNull();
      expect(isProjectVisualHidden(v, "about")).toBe(false);
    }
    expect(isProjectVisualSlot("hidden")).toBe(false);
    expect(isProjectVisualSlot("railTop")).toBe(true);
  });
});
