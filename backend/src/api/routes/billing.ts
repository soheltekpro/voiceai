import type { FastifyInstance } from 'fastify';
import { getWorkspaceId } from '../auth-context.js';
import { getWorkspacePlan, getUsageForPeriod, getCurrentPeriod } from '../../services/usage.js';
import {
  createSubscription,
  cancelSubscription,
  getUpcomingInvoice,
  getSubscription,
} from '../../billing/stripe.js';
import { prisma } from '../../db/prisma.js';
import { getVoiceQuota } from '../../usage/voice-usage.js';

export async function registerBillingRoutes(app: FastifyInstance): Promise<void> {
  /** GET /billing – current plan and usage for the workspace (current period). */
  app.get('/billing', async (req) => {
    const workspaceId = getWorkspaceId(req);
    const plan = await getWorkspacePlan(workspaceId);
    const { periodStart, periodEnd } = getCurrentPeriod();
    const usage = await getUsageForPeriod(workspaceId, periodStart, periodEnd);
    return {
      plan: plan
        ? {
            id: plan.planId,
            name: plan.planName,
            price: plan.price,
            callMinutesLimit: plan.callMinutesLimit,
            tokenLimit: plan.tokenLimit,
            toolCallsLimit: plan.toolCallsLimit,
            sttSecondsLimit: plan.sttSecondsLimit,
            ttsSecondsLimit: plan.ttsSecondsLimit,
          }
        : null,
      usage: {
        call_minutes: usage.call_minutes,
        llm_tokens: usage.llm_tokens,
        stt_seconds: usage.stt_seconds,
        tts_seconds: usage.tts_seconds,
        tool_calls: usage.tool_calls,
      },
      period: { start: periodStart.toISOString(), end: periodEnd.toISOString() },
    };
  });

  /** GET /billing/status – Stripe billing status: plan, next invoice, usage, upgrade/cancel state. */
  app.get('/billing/status', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const billing = await prisma.workspaceBilling.findUnique({
      where: { workspaceId },
    });
    const voiceQuota = await getVoiceQuota(workspaceId);
    const { periodStart, periodEnd } = getCurrentPeriod();
    const usage = await getUsageForPeriod(workspaceId, periodStart, periodEnd);

    let nextInvoice: { amountDue?: number; currency?: string; periodEnd?: string } | null = null;
    let subscription: { status?: string; cancelAtPeriodEnd?: boolean; currentPeriodEnd?: number } | null = null;
    try {
      const inv = await getUpcomingInvoice(workspaceId);
      if (inv) {
        nextInvoice = {
          amountDue: inv.amount_due ? inv.amount_due / 100 : undefined,
          currency: inv.currency ?? undefined,
          periodEnd: inv.period_end ? new Date(inv.period_end * 1000).toISOString() : undefined,
        };
      }
      const sub = await getSubscription(workspaceId);
      if (sub) {
        subscription = {
          status: sub.status ?? undefined,
          cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
          currentPeriodEnd: (sub as { current_period_end?: number }).current_period_end ?? undefined,
        };
      }
    } catch {
      // Stripe not configured or error
    }

    return {
      plan: billing
        ? {
            name: billing.planName,
            status: billing.status,
            stripeCustomerId: billing.stripeCustomerId ?? undefined,
            stripeSubscriptionId: billing.stripeSubscriptionId ?? undefined,
          }
        : null,
      nextInvoice,
      subscription,
      usage: {
        call_minutes: usage.call_minutes,
        llm_tokens: usage.llm_tokens,
        stt_seconds: usage.stt_seconds,
        tts_seconds: usage.tts_seconds,
        tool_calls: usage.tool_calls,
        callMinutesUsed: voiceQuota.callMinutesUsed,
        llmTokensUsed: voiceQuota.llmTokensUsed,
        ttsCharsUsed: voiceQuota.ttsCharsUsed,
      },
      period: { start: periodStart.toISOString(), end: periodEnd.toISOString() },
    };
  });

  /** POST /billing/subscribe – create or update Stripe subscription. Body: { plan: string }. */
  app.post<{ Body: { plan?: string } }>('/billing/subscribe', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const plan = (req.body?.plan ?? 'pro').toString().trim() || 'pro';
    const existing = await prisma.workspaceBilling.findUnique({
      where: { workspaceId },
      select: { stripeSubscriptionId: true, status: true, planName: true },
    });
    if (existing?.stripeSubscriptionId && existing.status === 'ACTIVE') {
      return reply.code(409).send({
        message: 'Workspace already has an active subscription. Cancel first to change plan.',
        plan: existing.planName,
      });
    }
    try {
      const { subscriptionId, itemIds } = await createSubscription(workspaceId, plan);
      return {
        subscriptionId,
        plan,
        itemIds,
        message: 'Subscription created. Complete payment in Stripe Checkout or with the provided client_secret.',
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create subscription';
      return reply.code(400).send({ message });
    }
  });

  /** POST /billing/cancel – cancel Stripe subscription. Body: { immediately?: boolean }. */
  app.post<{ Body: { immediately?: boolean } }>('/billing/cancel', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const immediately = Boolean(req.body?.immediately);
    try {
      await cancelSubscription(workspaceId, immediately);
      return { ok: true, message: immediately ? 'Subscription canceled.' : 'Subscription will cancel at period end.' };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to cancel subscription';
      return reply.code(400).send({ message });
    }
  });
}
