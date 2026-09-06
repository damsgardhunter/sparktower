/**
 * Creates or updates the Stripe products and prices for every paid tier.
 *
 * Idempotent: re-running reconciles names, descriptions, and metadata, and
 * creates a new price only when the amount actually changed (Stripe prices are
 * immutable). Old prices are deactivated rather than deleted so existing
 * subscriptions keep working until customers migrate.
 *
 *   npm run stripe:seed
 */
import { getUncachableStripeClient } from "./stripeClient";
import { STRIPE_PLANS } from "@shared/plans";

async function seed() {
  const stripe = await getUncachableStripeClient();

  for (const plan of STRIPE_PLANS) {
    // Look products up by tier metadata, not name — names are editable copy.
    const search = await stripe.products.search({
      query: `metadata['tier']:'${plan.tier}' AND active:'true'`,
    });

    let product = search.data[0];

    if (product) {
      product = await stripe.products.update(product.id, {
        name: plan.name,
        description: plan.description,
        metadata: plan.metadata,
      });
      console.log(`updated product  ${plan.tier.padEnd(8)} ${product.id}`);
    } else {
      product = await stripe.products.create({
        name: plan.name,
        description: plan.description,
        metadata: plan.metadata,
      });
      console.log(`created product  ${plan.tier.padEnd(8)} ${product.id}`);
    }

    const prices = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
    const monthly = prices.data.filter((p) => p.recurring?.interval === "month");
    const current = monthly.find((p) => p.unit_amount === plan.unitAmount);

    if (current) {
      // Metadata on the price is what the webhook reads to map subscription → tier.
      await stripe.prices.update(current.id, { metadata: plan.metadata });
      console.log(`  price ok       $${(plan.unitAmount / 100).toFixed(2).padEnd(6)} ${current.id}`);
    } else {
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: plan.unitAmount,
        currency: "usd",
        recurring: { interval: "month" },
        metadata: plan.metadata,
      });
      console.log(`  price created  $${(plan.unitAmount / 100).toFixed(2).padEnd(6)} ${price.id}`);

      // Retire stale amounts so /api/plans only ever shows the current price.
      for (const stale of monthly) {
        await stripe.prices.update(stale.id, { active: false });
        console.log(`  price retired  $${((stale.unit_amount || 0) / 100).toFixed(2).padEnd(6)} ${stale.id}`);
      }
    }
  }

  // Deactivate products from the previous pricing structure so they stop
  // appearing in /api/plans. Existing subscriptions on them are unaffected;
  // normalizeTier() maps their metadata forward.
  for (const legacyTier of ["spark_pro", "spark_business", "spark_unlimited"]) {
    const stale = await stripe.products.search({
      query: `metadata['tier']:'${legacyTier}' AND active:'true'`,
    });
    for (const product of stale.data) {
      await stripe.products.update(product.id, { active: false });
      console.log(`archived legacy  ${legacyTier.padEnd(16)} ${product.id}`);
    }
  }

  console.log("\nDone. Run the app and check /pricing.");
}

seed().catch((err) => {
  console.error("Stripe seed failed:", err.message || err);
  process.exit(1);
});
