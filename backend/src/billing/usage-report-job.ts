/**
 * Job to report voice usage to Stripe at end of billing period.
 * Run daily (e.g. via cron); reports previous period usage for workspaces with Stripe billing.
 */

import { prisma } from '../db/prisma.js';
import { reportUsageForPeriod } from './stripe.js';

/** Current calendar month period. */
function getCurrentMonthPeriod(): { periodStart: Date; periodEnd: Date } {
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  return { periodStart, periodEnd };
}

/** Report usage for the given period for all workspaces that have Stripe subscription with metered items. */
export async function reportUsageForAllWorkspaces(periodStart: Date, periodEnd: Date): Promise<void> {
  const billings = await prisma.workspaceBilling.findMany({
    where: {
      stripeSubscriptionId: { not: null },
      status: 'ACTIVE',
    },
    select: { workspaceId: true, subscriptionItemIds: true },
  });
  const withMetered = billings.filter((b) => b.subscriptionItemIds != null);
  for (const b of withMetered) {
    try {
      await reportUsageForPeriod(b.workspaceId, periodStart, periodEnd);
    } catch (err) {
      console.error(`[billing] reportUsage for workspace ${b.workspaceId} failed:`, err);
    }
  }
}

/** Run for the current month (e.g. call at end of month or daily to report to-date usage). */
export async function runUsageReportForCurrentPeriod(): Promise<void> {
  const { periodStart, periodEnd } = getCurrentMonthPeriod();
  await reportUsageForAllWorkspaces(periodStart, periodEnd);
}
