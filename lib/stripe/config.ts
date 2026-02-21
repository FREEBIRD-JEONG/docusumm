import type { CreditPackageId } from "@/lib/stripe/packages";

interface StripeApiConfig {
  secretKey: string;
  webhookSecret: string;
  prices: Record<CreditPackageId, string>;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`[STRIPE_CONFIG_INVALID] ${name} is required.`);
  }
  return value;
}

export function getStripeApiConfig(): StripeApiConfig {
  return {
    secretKey: requireEnv("STRIPE_SECRET_KEY"),
    webhookSecret: requireEnv("STRIPE_WEBHOOK_SECRET"),
    prices: {
      starter: requireEnv("STRIPE_PRICE_STARTER"),
      pro: requireEnv("STRIPE_PRICE_PRO"),
      max: requireEnv("STRIPE_PRICE_MAX"),
    },
  };
}
