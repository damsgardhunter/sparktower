import { describe, it, expect } from "vitest";
import { validateAsks, feedbackStateOf, isNewFeedback, taskTitleFromComment, creditLine, MAX_ASKS } from "@shared/feedback-loop";

describe("the build loop's rules", () => {
  it("takes up to four specific asks, trimmed and without repeats", () => {
    expect(validateAsks(undefined)).toEqual({ asks: [] });
    expect(validateAsks(["  Which headline is clearer, A or B? ", "", "which headline is clearer, a or b?"])).toEqual({ asks: ["Which headline is clearer, A or B?"] });
    expect(validateAsks(["ok?"])).toMatchObject({ error: expect.stringMatching(/too short/) });
    expect(validateAsks(Array.from({ length: MAX_ASKS + 1 }, (_, i) => `Question number ${i}?`))).toMatchObject({ error: expect.stringMatching(/Up to 4/) });
    expect(validateAsks("one question")).toMatchObject({ error: expect.any(String) });
  });

  it("moves feedback from open to applied to closed", () => {
    expect(feedbackStateOf({ appliedAt: null, closedByPostId: null })).toBe("open");
    expect(feedbackStateOf({ appliedAt: new Date(), closedByPostId: null })).toBe("applied");
    expect(feedbackStateOf({ appliedAt: new Date(), closedByPostId: "p2" })).toBe("closed");
  });

  it("counts feedback as new until the team has looked", () => {
    const at = new Date("2026-09-14T10:00:00Z");
    expect(isNewFeedback({ createdAt: at }, { feedbackSeenAt: null })).toBe(true);
    expect(isNewFeedback({ createdAt: at }, { feedbackSeenAt: new Date("2026-09-14T11:00:00Z") })).toBe(false);
    expect(isNewFeedback({ createdAt: at }, { feedbackSeenAt: new Date("2026-09-14T09:00:00Z") })).toBe(true);
  });

  it("writes the task title and the credit line people will read", () => {
    expect(taskTitleFromComment("The pricing page\nlost me at step 2", "Ada")).toBe("Feedback from Ada: The pricing page lost me at step 2");
    expect(taskTitleFromComment("x".repeat(200), "Ada").length).toBeLessThan(110);
    expect(creditLine(["Ada"])).toBe("Acts on feedback from Ada.");
    expect(creditLine(["Ada", "Ben", "Ada"])).toBe("Acts on feedback from Ada and Ben.");
    expect(creditLine(["Ada", "Ben", "Cy"])).toBe("Acts on feedback from Ada, Ben and Cy.");
  });
});
