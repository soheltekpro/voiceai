/**
 * Stripe webhook event handling: verify signature, update WorkspaceBilling, log events, reset quota.
 */

import Stripe from 'stripe';
import { prisma } from '../db/prisma.js';
import { getCurrentPeriod } from '../services/usage.js';

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const secretKey = process.env.STRIPE_SECRET_KEY;
const stripe = secretKey ? new Stripe(secretKey, { apiVersion: '2026-02-25.clover' }) : null;

export function isWebhookConfigured(): boolean {
  return Boolean(webhookSecret && stripe);
}

/** Verify signature and construct event. Returns event or throws. */
export function verifyWebhookSignature(payload: string | Buffer, signature: string): Stripe.Event {
  if (!webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET is not set');
  if (!stripe) throw new Error('Stripe is not configured');
  return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
}

/** Find workspaceId from Stripe customer or subscription id. */
async function getWorkspaceIdFromStripe(
  customerId?: string | null,
  subscriptionId?: string | null
): Promise<string | null> {
  if (subscriptionId) {
    const bySub = await prisma.workspaceBilling.findFirst({
      where: { stripeSubscriptionId: subscriptionId },
      select: { workspaceId: true },
    });
    if (bySub) return bySub.workspaceId;
  }
  if (customerId) {
    const byCustomer = await prisma.workspaceBilling.findFirst({
      where: { stripeCustomerId: customerId },
      select: { workspaceId: true },
    });
    if (byCustomer) return byCustomer.workspaceId;
  }
  return null;
}

/** Reset monthly usage counters for a workspace (current period). */
export async function resetMonthlyUsageForWorkspace(workspaceId: string): Promise<void> {
  const { periodStart, periodEnd } = getCurrentPeriod();
  await prisma.workspaceUsage.updateMany({
    where: { workspaceId, periodStart, periodEnd },
    data: { value: 0, updatedAt: new Date() },
  });
}

/** Store webhook event in billing_events (includes stripeEventId for idempotency). */
export async function logBillingEvent(
  stripeEventId: string,
  workspaceId: string | null,
  eventType: string,
  payload: unknown
): Promise<void> {
  await prisma.billingEvent.create({
    data: {
      stripeEventId,
      workspaceId,
      eventType,
      payload: payload as object,
    },
  });
}

/** Check if we have already processed this Stripe event (idempotency). */
export async function hasProcessedStripeEvent(stripeEventId: string): Promise<boolean> {
  const existing = await prisma.billingEvent.findUnique({
    where: { stripeEventId },
    select: { id: true },
  });
  return existing != null;
}

type InvoiceWithSubscription = Stripe.Invoice & { subscription?: string | null };

/** Handle invoice.paid: set status ACTIVE, reset monthly usage. */
async function handleInvoicePaid(invoice: InvoiceWithSubscription): Promise<void> {
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
  const subscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription;
  const workspaceId = await getWorkspaceIdFromStripe(customerId, subscriptionId ?? null);
  if (!workspaceId) return;
  await prisma.workspaceBilling.updateMany({
    where: { workspaceId },
    data: { status: 'ACTIVE', updatedAt: new Date() },
  });
  await resetMonthlyUsageForWorkspace(workspaceId);
}

/** Handle invoice.payment_failed: set status PAST_DUE. */
async function handleInvoicePaymentFailed(invoice: InvoiceWithSubscription): Promise<void> {
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
  const subscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription;
  const workspaceId = await getWorkspaceIdFromStripe(customerId, subscriptionId ?? null);
  if (!workspaceId) return;
  await prisma.workspaceBilling.updateMany({
    where: { workspaceId },
    data: { status: 'PAST_DUE', updatedAt: new Date() },
  });
}

/** Handle customer.subscription.updated: update planName and status. */
async function handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
  const workspaceId = await getWorkspaceIdFromStripe(undefined, subscription.id);
  if (!workspaceId) return;
  const planName =
    (subscription.metadata?.planName as string) ||
    (subscription.items?.data?.[0]?.price?.nickname as string) ||
    'pro';
  const status =
    subscription.status === 'active'
      ? 'ACTIVE'
      : subscription.status === 'past_due'
        ? 'PAST_DUE'
        : subscription.status === 'trialing'
          ? 'TRIALING'
          : subscription.status === 'canceled' || subscription.status === 'unpaid'
            ? 'CANCELED'
            : 'ACTIVE';
  await prisma.workspaceBilling.updateMany({
    where: { workspaceId },
    data: { planName, status, updatedAt: new Date() },
  });
}

/** Handle customer.subscription.deleted: set status CANCELED. */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  const workspaceId = await getWorkspaceIdFromStripe(undefined, subscription.id);
  if (!workspaceId) return;
  await prisma.workspaceBilling.updateMany({
    where: { workspaceId },
    data: { status: 'CANCELED', updatedAt: new Date() },
  });
}

/** Run only the business logic for a Stripe event (no logging). Used by worker after idempotent log. */
export async function runStripeEventActions(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'invoice.paid':
      await handleInvoicePaid(event.data.object as InvoiceWithSubscription);
      break;
    case 'invoice.payment_failed':
      await handleInvoicePaymentFailed(event.data.object as InvoiceWithSubscription);
      break;
    case 'customer.subscription.updated':
      await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
      break;
    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
      break;
    default:
      break;
  }
}

/** Resolve workspaceId for an event (for logging). */
export async function getWorkspaceIdForEvent(event: Stripe.Event): Promise<string | null> {
  switch (event.type) {
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const invoice = event.data.object as InvoiceWithSubscription;
      const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
      const subscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription;
      return getWorkspaceIdFromStripe(customerId, subscriptionId ?? null);
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      return getWorkspaceIdFromStripe(undefined, sub.id);
    }
    default:
      return null;
  }
}

/** Process a Stripe event: log then run actions. Used by worker after idempotency check. */
export async function processStripeEvent(event: Stripe.Event): Promise<void> {
  const workspaceId = await getWorkspaceIdForEvent(event);
  await logBillingEvent(event.id, workspaceId, event.type, event as unknown as object);
  await runStripeEventActions(event);
}
