/**
 * The setup form's rules with Nova: what the builder typed stays theirs, and a
 * renamed project loses Nova's old name from the text Nova wrote.
 */
import { describe, it, expect } from "vitest";
import { withoutEdited, renameInText } from "@shared/project-draft";
import { formatProjectBriefForPrompt } from "@shared/project-sections";

describe("withoutEdited", () => {
  it("drops the fields the builder edited, and keeps the rest", () => {
    expect(withoutEdited({ title: "EdgeGrid", description: "A betting app.", category: "saas" }, ["title"]))
      .toEqual({ description: "A betting app.", category: "saas" });
    expect(withoutEdited(null, ["title"])).toEqual({});
  });
});

describe("renameInText", () => {
  it("replaces the old name, in any case, keeping possessives", () => {
    expect(renameInText("EdgeGrid is a betting app. edgegrid's picks are weekly.", "EdgeGrid", "SaturdaySunday Sharp"))
      .toBe("SaturdaySunday Sharp is a betting app. SaturdaySunday Sharp's picks are weekly.");
  });
  it("leaves the name alone inside other words, and does nothing for an empty or unchanged name", () => {
    expect(renameInText("EdgeGridX and MyEdgeGrid", "EdgeGrid", "Sharp")).toBe("EdgeGridX and MyEdgeGrid");
    expect(renameInText("EdgeGrid rocks", "", "Sharp")).toBe("EdgeGrid rocks");
    expect(renameInText("EdgeGrid rocks", "EdgeGrid", "edgegrid")).toBe("EdgeGrid rocks");
  });
  it("handles names with symbols in them", () => {
    expect(renameInText("C++ Hub helps teams.", "C++ Hub", "Code Circle")).toBe("Code Circle helps teams.");
  });
});

describe("the brief every Nova prompt reads", () => {
  it("names the product by its title, above text that may still use an older name", () => {
    const brief = formatProjectBriefForPrompt({ title: "SaturdaySunday Sharp", description: "EdgeGrid is a betting app." } as any);
    expect(brief.split("\n")[0]).toBe('The product is called "SaturdaySunday Sharp". Use that name, even where older text below calls it something else.');
  });
});
