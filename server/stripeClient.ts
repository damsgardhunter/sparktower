import Stripe from 'stripe';

let connectionSettings: any;

function getEnvCredentials() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return null;

  return {
    secretKey,
    publishableKey:
      process.env.STRIPE_PUBLISHABLE_KEY || process.env.VITE_STRIPE_PUBLIC_KEY || '',
  };
}

/**
 * True when Stripe keys are reachable either from plain env vars (local dev)
 * or from the Replit connector service (repl/deployment).
 */
export function isStripeConfigured() {
  return Boolean(
    getEnvCredentials() || process.env.REPL_IDENTITY || process.env.WEB_REPL_RENEWAL
  );
}

async function getCredentials() {
  // Outside Replit there is no connector service, so fall back to plain env vars.
  const envCredentials = getEnvCredentials();
  if (envCredentials) {
    return envCredentials;
  }

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? 'depl ' + process.env.WEB_REPL_RENEWAL
      : null;

  if (!xReplitToken) {
    throw new Error(
      'Stripe is not configured: set STRIPE_SECRET_KEY (and VITE_STRIPE_PUBLIC_KEY) in .env, ' +
        'or run inside Replit with the Stripe connector enabled.'
    );
  }

  const connectorName = 'stripe';
  const isProduction = process.env.REPLIT_DEPLOYMENT === '1';
  const targetEnvironment = isProduction ? 'production' : 'development';

  const url = new URL(`https://${hostname}/api/v2/connection`);
  url.searchParams.set('include_secrets', 'true');
  url.searchParams.set('connector_names', connectorName);
  url.searchParams.set('environment', targetEnvironment);

  const response = await fetch(url.toString(), {
    headers: {
      'Accept': 'application/json',
      'X-Replit-Token': xReplitToken
    }
  });

  const data = await response.json();
  connectionSettings = data.items?.[0];

  if (!connectionSettings || (!connectionSettings.settings.publishable || !connectionSettings.settings.secret)) {
    throw new Error(`Stripe ${targetEnvironment} connection not found`);
  }

  return {
    publishableKey: connectionSettings.settings.publishable,
    secretKey: connectionSettings.settings.secret,
  };
}

export async function getUncachableStripeClient() {
  const { secretKey } = await getCredentials();
  return new Stripe(secretKey, {
    // The version this SDK's types are built for; the client and its types must agree.
    apiVersion: '2025-11-17.clover',
  });
}

export async function getStripePublishableKey() {
  const { publishableKey } = await getCredentials();
  if (!publishableKey) {
    throw new Error(
      'Stripe publishable key missing: set VITE_STRIPE_PUBLIC_KEY (or STRIPE_PUBLISHABLE_KEY) in .env'
    );
  }
  return publishableKey;
}

export async function getStripeSecretKey() {
  const { secretKey } = await getCredentials();
  return secretKey;
}

let stripeSync: any = null;

export async function getStripeSync() {
  if (!stripeSync) {
    const { StripeSync } = await import('stripe-replit-sync');
    const secretKey = await getStripeSecretKey();
    stripeSync = new StripeSync({
      poolConfig: {
        connectionString: process.env.DATABASE_URL!,
        max: 2,
      },
      stripeSecretKey: secretKey,
    });
  }
  return stripeSync;
}
