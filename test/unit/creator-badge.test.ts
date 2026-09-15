import { describe, it, expect, vi } from "vitest";
vi.mock("../../server/db", () => ({ db: {}, pool: {} }));
vi.mock("../../server/replit_integrations/image/client", () => ({ openai: {} }));
import { badgePrompt } from "../../server/backer-badges";
import { FOUNDER_LEVEL, NOVA_GRADIENT, NOVA_GRADIENT_CSS, badgeLevel, badgeRingStyle, isCreatorBadge, BADGE_LEVELS } from "@shared/backing";

describe("the creator badge", () => {
  it("is drawn in Nova's gradient, green to emerald to purple, in that order", () => {
    const prompt = badgePrompt({ projectTitle: "SparkTower", metal: FOUNDER_LEVEL.metal, hex: FOUNDER_LEVEL.hex, withLogo: true, creator: true });
    const at = NOVA_GRADIENT.map((hex) => prompt.indexOf(hex));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(prompt).toMatch(/creator's medallion/);
    expect(prompt).toMatch(/No text, no lettering/);
    // A backer's badge keeps its metal.
    expect(badgePrompt({ projectTitle: "X", metal: BADGE_LEVELS[2].metal, hex: BADGE_LEVELS[2].hex, withLogo: false })).toMatch(/18-carat gold/);
  });

  it("wears the gradient ring, and is never mistaken for a backer level", () => {
    expect(NOVA_GRADIENT_CSS).toBe("linear-gradient(135deg, #4ade80, #10b981, #a855f7)");
    expect(badgeRingStyle("founder")).toEqual({ background: NOVA_GRADIENT_CSS });
    expect(badgeRingStyle("gold")).toEqual({ borderColor: BADGE_LEVELS[2].hex });
    expect(badgeLevel("founder")?.label).toBe("Creator");
    expect(isCreatorBadge("founder")).toBe(true);
    expect(isCreatorBadge("platinum")).toBe(false);
  });
});
