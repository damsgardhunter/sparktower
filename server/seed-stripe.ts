import { getUncachableStripeClient } from "./stripeClient";

async function createProducts() {
  const stripe = await getUncachableStripeClient();

  const plans = [
    {
      name: "Spark Pro",
      description: "100 AI credits/month for power users",
      amount: 499,
      metadata: { tier: "spark_pro", credits: "100" },
    },
    {
      name: "Spark Business",
      description: "250 AI credits/month + private projects",
      amount: 999,
      metadata: { tier: "spark_business", credits: "250" },
    },
    {
      name: "Spark Unlimited",
      description: "Unlimited AI credits + private projects + AI roadmap generation",
      amount: 2999,
      metadata: { tier: "spark_unlimited", credits: "unlimited" },
    },
  ];

  for (const plan of plans) {
    const existing = await stripe.products.search({
      query: `name:'${plan.name}'`,
    });

    if (existing.data.length > 0) {
      console.log(`${plan.name} already exists (${existing.data[0].id})`);
      continue;
    }

    const product = await stripe.products.create({
      name: plan.name,
      description: plan.description,
      metadata: plan.metadata,
    });

    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: plan.amount,
      currency: "usd",
      recurring: { interval: "month" },
      metadata: plan.metadata,
    });

    console.log(`Created: ${plan.name} → product: ${product.id}, price: ${price.id}`);
  }

  console.log("Done seeding Stripe products.");
}

createProducts().catch(console.error);
