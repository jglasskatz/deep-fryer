/**
 * Where the Stripe SDK sends requests. Normally Stripe itself (no override).
 * Tests and CI set STRIPE_API_BASE to stripe-mock, which validates every
 * request our code makes against Stripe's OpenAPI spec — the real protocol,
 * without a Stripe account. Production refuses the setting
 * (apps/web/lib/env.ts), and a live key is never sent anywhere but Stripe.
 */
export interface StripeEndpoint {
  host: string;
  port: number;
  protocol: 'http' | 'https';
}

export function stripeEndpoint(base: string | undefined, secretKey: string): StripeEndpoint | null {
  if (!base) return null;
  if (secretKey.startsWith('sk_live_') || secretKey.startsWith('rk_live_')) {
    throw new Error('STRIPE_API_BASE is for stripe-mock; refusing to send a live Stripe key to it');
  }
  const url = new URL(base);
  const protocol = url.protocol === 'http:' ? 'http' : 'https';
  return { host: url.hostname, port: Number(url.port) || (protocol === 'http' ? 80 : 443), protocol };
}
