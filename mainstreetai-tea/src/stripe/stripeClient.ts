import Stripe from "stripe";

let stripeClient: Stripe | null = null;

function requiredEnv(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export function getStripeClient(): Stripe {
  if (stripeClient) {
    return stripeClient;
  }

  stripeClient = new Stripe(requiredEnv("STRIPE_SECRET_KEY"));
  return stripeClient;
}
