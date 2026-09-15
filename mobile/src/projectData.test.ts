/** The project and backing rules the app shows money and choices by. */
import { describe, it, expect } from "vitest";
import { badgeLevelForAmount, formatBelieverNumber, isValidSubcategory, money, projectGoal, projectVisual, tierForAmount } from "./projectData";
import { isSectionEnabled, isSectionVisible, sectionHasContent } from "./projectSections";

describe("backing", () => {
  it("gives a pledge the highest tier it clears, and a badge by amount", () => {
    const tiers = [{ id: "a", amountCents: 500 }, { id: "c", amountCents: 5000 }, { id: "b", amountCents: 2000 }];
    expect(tierForAmount(tiers, 2500)?.id).toBe("b");
    expect(tierForAmount(tiers, 5000)?.id).toBe("c");
    expect(tierForAmount(tiers, 100)).toBeNull();
    expect(badgeLevelForAmount(1499).key).toBe("bronze");
    expect(badgeLevelForAmount(7500).key).toBe("platinum");
    expect(badgeLevelForAmount(0).key).toBe("bronze");
  });

  it("formats money and believer numbers", () => {
    expect(money(2500)).toBe("$25");
    expect(money(2550)).toBe("$25.50");
    expect(money(123456789)).toBe("$1,234,567.89");
    expect(formatBelieverNumber(7)).toBe("#0007");
    expect(formatBelieverNumber(12345)).toBe("#12345");
  });
});

describe("projects", () => {
  it("checks a subcategory against its own goal, and falls back to the first goal", () => {
    expect(isValidSubcategory("ship_mvp", "other")).toBe(true);
    expect(isValidSubcategory(null, "other")).toBe(false);
    expect(isValidSubcategory("ship_mvp", "not-a-kind")).toBe(false);
    expect(projectGoal("nonsense").id).toBe("ship_mvp");
  });

  it("shows a visual only when it's set and not hidden", () => {
    expect(projectVisual({ about: "https://x/a.png" }, "about")).toBe("https://x/a.png");
    expect(projectVisual({ about: "https://x/a.png", hidden: ["about"] }, "about")).toBeNull();
    expect(projectVisual(null, "about")).toBeNull();
  });

  it("shows a public section only when it's switched on and has something in it", () => {
    const project = { techStack: ["React"], rolesNeeded: ["Designer"], soloMode: true, publicSections: { techStack: false } };
    expect(sectionHasContent(project, "techStack")).toBe(true);
    expect(isSectionEnabled(project, "techStack")).toBe(false);
    expect(isSectionVisible(project, "techStack")).toBe(false);
    // A solo project never recruits, whatever list survived.
    expect(sectionHasContent(project, "rolesNeeded")).toBe(false);
    expect(sectionHasContent({ repoUrl: "https://github.com/x" }, "links")).toBe(true);
  });
});
