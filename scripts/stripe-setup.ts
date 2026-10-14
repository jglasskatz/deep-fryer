#!/usr/bin/env tsx
/**
 * Idempotent Stripe setup for deep-fryer billing (SPEC-v4 §3).
 *
 *   STRIPE_SECRET_KEY=sk_... tsx scripts/stripe-setup.ts \
 *     --prices docs/billing/prices.json \
 *     [--webhook-url https://app.example.gov/api/billing/webhook] [--portal]
 *
 * - Products: one per purchasable plan (id `deep_fryer_<plan>`).
 * - Prices: one recurring price per catalog lookup key. Amounts come only
 *   from the price sheet the owner writes — nothing here invents a price. If
 *   the amount changed, a new price takes over the lookup key
 *   (transfer_lookup_key) and existing subscribers keep their old price
 *   until they change plans.
 * - --portal: configures the default customer portal so customers can move
 *   between catalog prices, update payment methods, see invoices, and
 *   cancel at period end.
 * - --webhook-url: registers the endpoint for the events the webhook
 *   handles and prints its signing secret (shown only once — put it in
 *   STRIPE_WEBHOOK_SECRET).
 */
import { readFileSync } from 'node:fs';
import Stripe from 'stripe';
import { PLANS, PURCHASABLE_PLANS, STRIPE_WEBHOOK_EVENTS, type BillingInterval } from '@deep-fryer/core';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface PriceSheet {
  currency: string;
  prices: Record<string, number>;
}

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is required');
  const stripe = new Stripe(key);
  const sheetPath = arg('prices');
  if (!sheetPath) throw new Error('--prices <file> is required (see docs/billing/prices.example.json)');
  const sheet = JSON.parse(readFileSync(sheetPath, 'utf8')) as PriceSheet;

  const priceIds: Record<string, string> = {};
  for (const planId of PURCHASABLE_PLANS) {
    const plan = PLANS[planId];
    const productId = `deep_fryer_${planId}`;
    let product: Stripe.Product;
    try {
      product = await stripe.products.retrieve(productId);
      product = await stripe.products.update(productId, { name: `deep-fryer ${plan.name}`, description: plan.audience, active: true });
    } catch {
      product = await stripe.products.create({
        id: productId,
        name: `deep-fryer ${plan.name}`,
        description: plan.audience,
        metadata: { plan: planId },
      });
      console.log(`created product ${productId}`);
    }

    for (const [interval, lookupKey] of Object.entries(plan.stripeLookupKeys) as [BillingInterval, string][]) {
      const dollars = sheet.prices[lookupKey];
      if (typeof dollars !== 'number' || dollars <= 0) {
        console.warn(`skip ${lookupKey}: no positive amount in the price sheet`);
        continue;
      }
      const unitAmount = Math.round(dollars * 100);
      const existing = (await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 })).data[0];
      if (
        existing &&
        existing.unit_amount === unitAmount &&
        existing.currency === sheet.currency &&
        existing.recurring?.interval === interval &&
        existing.active
      ) {
        priceIds[lookupKey] = existing.id;
        console.log(`ok ${lookupKey} = ${dollars} ${sheet.currency}/${interval}`);
        continue;
      }
      const price = await stripe.prices.create({
        product: product.id,
        currency: sheet.currency,
        unit_amount: unitAmount,
        recurring: { interval },
        lookup_key: lookupKey,
        transfer_lookup_key: true,
        tax_behavior: 'exclusive',
        metadata: { plan: planId },
      });
      priceIds[lookupKey] = price.id;
      console.log(`${existing ? 'replaced' : 'created'} ${lookupKey} = ${dollars} ${sheet.currency}/${interval}`);
    }
  }

  if (process.argv.includes('--portal')) {
    const products = PURCHASABLE_PLANS.map((planId) => ({
      product: `deep_fryer_${planId}`,
      prices: Object.values(PLANS[planId].stripeLookupKeys)
        .map((k) => priceIds[k])
        .filter((id): id is string => Boolean(id)),
    })).filter((p) => p.prices.length > 0);
    const features: Stripe.BillingPortal.ConfigurationUpdateParams.Features = {
      customer_update: { enabled: true, allowed_updates: ['email', 'address', 'tax_id', 'name'] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: 'at_period_end' },
      subscription_update: {
        enabled: products.length > 0,
        default_allowed_updates: ['price'],
        proration_behavior: 'create_prorations',
        products,
      },
    };
    const current = (await stripe.billingPortal.configurations.list({ is_default: true, limit: 1 })).data[0];
    if (current) {
      await stripe.billingPortal.configurations.update(current.id, { features });
      console.log(`updated default portal configuration ${current.id}`);
    } else {
      const created = await stripe.billingPortal.configurations.create({ features });
      console.log(`created portal configuration ${created.id} (set it as default in the Dashboard)`);
    }
  }

  const webhookUrl = arg('webhook-url');
  if (webhookUrl) {
    const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
    const existing = endpoints.data.find((e) => e.url === webhookUrl);
    const enabled = [...STRIPE_WEBHOOK_EVENTS] as Stripe.WebhookEndpointCreateParams.EnabledEvent[];
    if (existing) {
      await stripe.webhookEndpoints.update(existing.id, { enabled_events: enabled });
      console.log(`updated webhook ${existing.id} (signing secret unchanged)`);
    } else {
      const created = await stripe.webhookEndpoints.create({ url: webhookUrl, enabled_events: enabled });
      console.log(`created webhook ${created.id}\nSTRIPE_WEBHOOK_SECRET=${created.secret}`);
    }
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
