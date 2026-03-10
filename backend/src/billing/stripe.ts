/**
 * Stripe billing integration: customers, subscriptions, usage reporting.
 * Requires STRIPE_SECRET_KEY. Optional: STRIPE_PRICE_ID (base plan), metered price IDs for usage.
 */

import Stripe from 'stripe';
import { prisma } from '../db/prisma.js';

const secretKey = process.env.STRIPE_SECRET_KEY;
const stripe = secretKey ? new Stripe(secretKey, { apiVersion: '2026-02-25.clover' }) : null;

/** Price IDs for subscription (env). Base plan + optional metered. */
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID;
const STRIPE_PRICE_CALL_MINUTES = process.env.STRIPE_PRICE_ID_CALL_MINUTES;
const STRIPE_PRICE_LLM_TOKENS = process.env.STRIPE_PRICE_ID_LLM_TOKENS;
const STRIPE_PRICE_TTS_CHARACTERS = process.env.STRIPE_PRICE_ID_TTS_CHARACTERS;

export type SubscriptionItemIds = {
  callMinutes?: string;
  llmTokens?: string;
  ttsCharacters?: string;
};

function assertStripe(): Stripe {
  if (!stripe) throw new Error('Stripe is not configured (STRIPE_SECRET_KEY missing)');
  return stripe;
}

/** Create or return existing Stripe customer for workspace. */
export async function createCustomer(workspaceId: string): Promise<string> {
  const s = assertStripe();
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } });
  const name = workspace?.name ?? `Workspace ${workspaceId.slice(0, 8)}`;
  const existing = await prisma.workspaceBilling.findUnique({
    where: { workspaceId },
    select: { stripeCustomerId: true },
  });
  if (existing?.stripeCustomerId) return existing.stripeCustomerId;
  const customer = await s.customers.create({
    name,
    metadata: { workspaceId },
  });
  await prisma.workspaceBilling.upsert({
    where: { workspaceId },
    create: {
      workspaceId,
      stripeCustomerId: customer.id,
      planName: 'free',
      status: 'ACTIVE',
    },
    update: { stripeCustomerId: customer.id, updatedAt: new Date() },
  });
  return customer.id;
}

/** Get Stripe customer ID for workspace (create if missing). */
async function getOrCreateCustomerId(workspaceId: string): Promise<string> {
  return createCustomer(workspaceId);
}

/**
 * Create a subscription for the workspace.
 * plan: plan name (e.g. "pro", "enterprise"); used for display and to pick price if multiple env prices.
 * Uses STRIPE_PRICE_ID for base; optional metered price IDs for usage reporting.
 */
export async function createSubscription(workspaceId: string, plan: string): Promise<{ subscriptionId: string; itemIds: SubscriptionItemIds }> {
  const s = assertStripe();
  if (!STRIPE_PRICE_ID) throw new Error('STRIPE_PRICE_ID is required to create a subscription');
  const customerId = await getOrCreateCustomerId(workspaceId);

  const priceIds: string[] = [STRIPE_PRICE_ID];
  if (STRIPE_PRICE_CALL_MINUTES) priceIds.push(STRIPE_PRICE_CALL_MINUTES);
  if (STRIPE_PRICE_LLM_TOKENS) priceIds.push(STRIPE_PRICE_LLM_TOKENS);
  if (STRIPE_PRICE_TTS_CHARACTERS) priceIds.push(STRIPE_PRICE_TTS_CHARACTERS);

  const items = priceIds.map((priceId) => ({ price: priceId }));
  const subscription = await s.subscriptions.create({
    customer: customerId,
    items,
    payment_behavior: 'default_incomplete',
    payment_settings: { save_default_payment_method: 'on_subscription' },
    expand: ['latest_invoice.payment_intent'],
    metadata: { workspaceId, planName: plan },
  });

  const itemIds: SubscriptionItemIds = {};
  for (const item of subscription.items.data) {
    const priceId = item.price.id;
    if (priceId === STRIPE_PRICE_CALL_MINUTES) itemIds.callMinutes = item.id;
    else if (priceId === STRIPE_PRICE_LLM_TOKENS) itemIds.llmTokens = item.id;
    else if (priceId === STRIPE_PRICE_TTS_CHARACTERS) itemIds.ttsCharacters = item.id;
  }

  await prisma.workspaceBilling.upsert({
    where: { workspaceId },
    create: {
      workspaceId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      planName: plan,
      status: subscription.status === 'active' ? 'ACTIVE' : subscription.status === 'trialing' ? 'TRIALING' : 'ACTIVE',
      subscriptionItemIds: itemIds as object,
    },
    update: {
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      planName: plan,
      status: subscription.status === 'active' ? 'ACTIVE' : subscription.status === 'trialing' ? 'TRIALING' : 'ACTIVE',
      subscriptionItemIds: itemIds as object,
      updatedAt: new Date(),
    },
  });

  return { subscriptionId: subscription.id, itemIds };
}

/** Cancel subscription at period end (recommended) or immediately. */
export async function cancelSubscription(workspaceId: string, immediately = false): Promise<void> {
  const s = assertStripe();
  const billing = await prisma.workspaceBilling.findUnique({
    where: { workspaceId },
    select: { stripeSubscriptionId: true },
  });
  if (!billing?.stripeSubscriptionId) {
    throw new Error('No active subscription found for this workspace');
  }
  if (immediately) {
    await s.subscriptions.cancel(billing.stripeSubscriptionId);
  } else {
    await s.subscriptions.update(billing.stripeSubscriptionId, { cancel_at_period_end: true });
  }
  await prisma.workspaceBilling.update({
    where: { workspaceId },
    data: { status: 'CANCELED', updatedAt: new Date() },
  });
}

/** Report usage to Stripe for the current period (call at period end or periodically). */
export async function reportUsageToStripe(
  workspaceId: string,
  usage: { callMinutes: number; llmTokens: number; ttsCharacters: number },
  timestamp?: Date
): Promise<void> {
  const s = assertStripe();
  const billing = await prisma.workspaceBilling.findUnique({
    where: { workspaceId },
    select: { subscriptionItemIds: true },
  });
  const itemIds = billing?.subscriptionItemIds as SubscriptionItemIds | null | undefined;
  if (!itemIds) return;
  const ts = Math.floor((timestamp ?? new Date()).getTime() / 1000);
  const promises: Promise<unknown>[] = [];
  const createUsageRecord = (s.subscriptionItems as { createUsageRecord?: (id: string, params: { quantity: number; timestamp?: number }) => Promise<unknown> }).createUsageRecord;
  if (createUsageRecord) {
    if (itemIds.callMinutes && usage.callMinutes > 0) {
      promises.push(createUsageRecord.call(s.subscriptionItems, itemIds.callMinutes, { quantity: Math.round(usage.callMinutes), timestamp: ts }).catch(() => {}));
    }
    if (itemIds.llmTokens && usage.llmTokens > 0) {
      promises.push(createUsageRecord.call(s.subscriptionItems, itemIds.llmTokens, { quantity: usage.llmTokens, timestamp: ts }).catch(() => {}));
    }
    if (itemIds.ttsCharacters && usage.ttsCharacters > 0) {
      promises.push(createUsageRecord.call(s.subscriptionItems, itemIds.ttsCharacters, { quantity: usage.ttsCharacters, timestamp: ts }).catch(() => {}));
    }
  }
  await Promise.all(promises);
}

/** Get upcoming invoice for workspace (if subscribed). */
export async function getUpcomingInvoice(workspaceId: string): Promise<Stripe.Invoice | null> {
  const s = assertStripe();
  const billing = await prisma.workspaceBilling.findUnique({
    where: { workspaceId },
    select: { stripeCustomerId: true, stripeSubscriptionId: true },
  });
  if (!billing?.stripeCustomerId) return null;
  try {
    const inv = await s.invoices.createPreview({
      customer: billing.stripeCustomerId,
      subscription: billing.stripeSubscriptionId ?? undefined,
    });
    return inv as unknown as Stripe.Invoice;
  } catch {
    return null;
  }
}

/** Get subscription with next billing date. */
export async function getSubscription(workspaceId: string): Promise<Stripe.Subscription | null> {
  const s = assertStripe();
  const billing = await prisma.workspaceBilling.findUnique({
    where: { workspaceId },
    select: { stripeSubscriptionId: true },
  });
  if (!billing?.stripeSubscriptionId) return null;
  try {
    return await s.subscriptions.retrieve(billing.stripeSubscriptionId);
  } catch {
    return null;
  }
}

/**
 * Report voice usage for a billing period to Stripe (call at period end).
 * Aggregates callMinutes, llmTokens, ttsCharacters from voice_usage and sends to Stripe metered items.
 */
export async function reportUsageForPeriod(
  workspaceId: string,
  periodStart: Date,
  periodEnd: Date
): Promise<void> {
  const { getVoiceUsageFromDb, aggregateVoiceUsage } = await import('../usage/voice-usage.js');
  const rows = await getVoiceUsageFromDb(workspaceId, periodStart, periodEnd);
  const agg = aggregateVoiceUsage(rows);
  await reportUsageToStripe(workspaceId, {
    callMinutes: agg.totalCallMinutes,
    llmTokens: agg.totalLLMTokens,
    ttsCharacters: agg.totalTTSCharacters,
  }, periodEnd);
}
