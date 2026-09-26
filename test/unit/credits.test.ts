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

  it("marks a top-up as its own thing, so it isn't mistaken for a subscription", () => {
    /*
     * The two returns do different work: a subscription re-syncs the plan and
     * says "you're upgraded"; a top-up has money waiting and an action that
     * was interrupted to buy it, and has to offer to finish that. One marker
     * for both sent every top-up down the subscription's path.
     */
    expect(checkoutReturnUrls("https://st.test", "/projects/abc/manage", "topup").success)
      .toBe("https://st.test/projects/abc/manage?checkout=topup");
    expect(checkoutReturnUrls("https://st.test", "/x?tab=1", "topup").success).toBe("https://st.test/x?tab=1&checkout=topup");
    // …including when there is no page to go back to and it lands on pricing.
    expect(checkoutReturnUrls("https://st.test", "//evil.test", "topup").success).toBe("https://st.test/pricing?checkout=topup");
    // A cancel is a cancel either way.
    expect(checkoutReturnUrls("https://st.test", "/x", "topup").cancel).toBe("https://st.test/x?checkout=canceled");
  });
});

describe("upgrades", () => {
  it("offers the plans above yours, and refills only on a first paid plan or a paid invoice", () => {
    const plans = ["free", "starter", "builder", "pro"].map((tier) => ({ tier }));
    expect(upgradeOptions(plans, "starter").map((p) => p.tier)).toEqual(["builder", "pro"]);
    expect(upgradeOptions(plans, "pro")).toEqual([]);
    expect(refillsOnTierChange("free", "builder")).toBe(true);
    expect(refillsOnTierChange("builder", "builder")).toBe(false);
    expect(refillsOnTierChange("pro", "starter")).toBe(false);
    // A paid-to-paid switch is prorated onto the next invoice — nothing is paid now, so nothing refills.
    expect(refillsOnTierChange("builder", "pro")).toBe(false);
    expect(refillsOnTierChange("starter", "builder")).toBe(false);
    expect(REFILLING_INVOICE_REASONS.has("subscription_cycle")).toBe(true);
    expect(REFILLING_INVOICE_REASONS.has("manual")).toBe(false);
  });
});
