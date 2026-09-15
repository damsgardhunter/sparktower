/** The revenue loop's pure rules: when credits are low, where checkout returns to, what's offered, what refills. */
import { describe, it, expect } from "vitest";
import { creditState, lowCreditsAt, safeReturnPath, checkoutReturnUrls, upgradeOptions, refillsOnTierChange, REFILLING_INVOICE_REASONS } from "@shared/credits";

describe("credit state", () => {
  it("is low near the end of the allowance, out at zero, never for unlimited", () => {
    expect(lowCreditsAt(20)).toBe(4);
    expect(lowCreditsAt(750)).toBe(150);
    expect(creditState({ creditsRemaining: 20, creditsLimit: 20 })).toBe("ok");
    expect(creditState({ creditsRemaining: 4, creditsLimit: 20 })).toBe("low");
    expect(creditState({ creditsRemaining: 0, creditsLimit: 20 })).toBe("out");
    expect(creditState({ creditsRemaining: -1, creditsLimit: -1, unlimited: true })).toBe("ok");
  });
});

describe("checkout return", () => {
  it("only returns to a page on this site", () => {
    expect(safeReturnPath("/projects/abc/manage?tab=path")).toBe("/projects/abc/manage?tab=path");
    expect(safeReturnPath("/projects/abc?checkout=success")).toBe("/projects/abc");
    for (const bad of ["//evil.test/x", "https://evil.test", "/\\evil.test", "projects", "/a b", 42, null]) expect(safeReturnPath(bad)).toBeNull();
  });
  it("flags the page left, and keeps the pricing page's old flags when there's none", () => {
    expect(checkoutReturnUrls("https://st.test", "/projects/abc/manage")).toEqual({
      success: "https://st.test/projects/abc/manage?checkout=success", cancel: "https://st.test/projects/abc/manage?checkout=canceled",
    });
    expect(checkoutReturnUrls("https://st.test", "/x?tab=1").success).toBe("https://st.test/x?tab=1&checkout=success");
    expect(checkoutReturnUrls("https://st.test", "//evil.test")).toEqual({ success: "https://st.test/pricing?success=true", cancel: "https://st.test/pricing?canceled=true" });
  });
});

describe("upgrades", () => {
  it("offers the plans above yours, and refills only on a step up or a paid renewal", () => {
    const plans = ["free", "starter", "builder", "pro"].map((tier) => ({ tier }));
    expect(upgradeOptions(plans, "starter").map((p) => p.tier)).toEqual(["builder", "pro"]);
    expect(upgradeOptions(plans, "pro")).toEqual([]);
    expect(refillsOnTierChange("free", "builder")).toBe(true);
    expect(refillsOnTierChange("builder", "builder")).toBe(false);
    expect(refillsOnTierChange("pro", "starter")).toBe(false);
    expect(REFILLING_INVOICE_REASONS.has("subscription_cycle")).toBe(true);
    expect(REFILLING_INVOICE_REASONS.has("manual")).toBe(false);
  });
});
