/**
 * The tier a Stripe price entitles is read where checkout reads it — the
 * price's metadata, else its product's — and a paid price with neither never
 * reads as "free": that would downgrade someone who is paying.
 */
import { describe, it, expect, vi } from "vitest";

const catalog: Record<string, any> = {
  price_on_price: { id: "price_on_price", metadata: { tier: "builder" }, product: { metadata: {} } },
  price_on_product: { id: "price_on_product", metadata: {}, product: { metadata: { tier: "pro" } } },
  price_legacy: { id: "price_legacy", metadata: { tier: "spark_business" }, product: { metadata: {} } },
  price_missing: { id: "price_missing", metadata: {}, product: { metadata: {} } },
  price_nonsense: { id: "price_nonsense", metadata: { tier: "platinum-plus" }, product: { metadata: {} } },
};
vi.mock("../../server/stripeClient", () => ({
  getUncachableStripeClient: async () => ({ prices: { retrieve: async (id: string) => catalog[id] } }),
  getStripeSync: async () => ({}),
}));

const { tierForPrice, PriceTierMissingError } = await import("../../server/webhookHandlers");

describe("the tier a price entitles", () => {
  it("reads the price's metadata, else its product's, normalizing legacy names", async () => {
    expect(await tierForPrice("price_on_price")).toBe("builder");
    expect(await tierForPrice("price_on_product")).toBe("pro");
    expect(await tierForPrice("price_legacy")).toBe("builder");
  });

  it("refuses to call a paid price with no readable tier 'free'", async () => {
    await expect(tierForPrice("price_missing")).rejects.toBeInstanceOf(PriceTierMissingError);
    await expect(tierForPrice("price_nonsense")).rejects.toBeInstanceOf(PriceTierMissingError);
  });
});
