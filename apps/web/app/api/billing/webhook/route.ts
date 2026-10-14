import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { billingEvents, getDb } from '@deep-fryer/db';
import { stripeConfigured } from '@/lib/env';
import { stripe, subscriptionIdOf, syncSubscription } from '@/lib/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/billing/webhook — Stripe events (SPEC-v4 §3).
 *
 * 1. The signature is verified against the raw body; anything unsigned is 400.
 * 2. The event id is inserted into billing_events and the subscription is
 *    synced in the *same transaction*: a duplicate delivery hits the primary
 *    key and is acknowledged without effect, and a failure rolls back the
 *    ledger row so Stripe's retry processes it again. No event is applied
 *    twice and none is lost to a crash between "recorded" and "applied".
 * 3. The subscription is re-retrieved from Stripe rather than read from the
 *    payload, so out-of-order deliveries still converge on current state.
 */
export async function POST(request: Request) {
  if (!stripeConfigured()) {
    return NextResponse.json({ error: 'billing not configured' }, { status: 404 });
  }
  const signature = request.headers.get('stripe-signature');
  if (!signature) return NextResponse.json({ error: 'missing signature' }, { status: 400 });
  const raw = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(raw, signature, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }

  try {
    const outcome = await getDb().transaction(async (tx) => {
      const recorded = await tx
        .insert(billingEvents)
        .values({ id: event.id, type: event.type, payload: event as unknown as Record<string, unknown> })
        .onConflictDoNothing()
        .returning({ id: billingEvents.id });
      if (recorded.length === 0) return 'duplicate';

      const subscriptionId = subscriptionIdOf(event);
      if (!subscriptionId) return 'ignored';
      const subscription = await stripe().subscriptions.retrieve(subscriptionId);
      const orgId = await syncSubscription(tx, subscription);
      if (orgId) {
        await tx.update(billingEvents).set({ organizationId: orgId }).where(eq(billingEvents.id, event.id));
      }
      return 'applied';
    });
    return NextResponse.json({ received: true, outcome });
  } catch (err) {
    console.error(`[billing webhook] ${event.type} ${event.id} failed`, err);
    return NextResponse.json({ error: 'processing failed' }, { status: 500 });
  }
}
