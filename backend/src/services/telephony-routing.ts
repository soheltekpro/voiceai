/**
 * Telephony routing: resolve agent for inbound calls, trunk/from for outbound.
 */

import { prisma } from '../db/prisma.js';

/** Normalize E.164 for lookup (strip + and spaces). */
function normalizeNumber(n: string): string {
  return n.replace(/\D/g, '');
}

/**
 * Inbound: find agent assigned to the dialed phone number.
 * Returns agentId or null if number not found or unassigned.
 */
export async function getAgentForInboundNumber(dialedNumber: string): Promise<string | null> {
  const normalized = normalizeNumber(dialedNumber);
  if (!normalized) return null;
  const record = await prisma.phoneNumber.findFirst({
    where: {
      number: { contains: normalized },
      agentId: { not: null },
    },
    select: { agentId: true },
  });
  return record?.agentId ?? null;
}

/**
 * Inbound: lookup by dialed number (DID). Tries exact match then normalized match.
 */
export async function getAgentForInboundNumberExact(dialedNumber: string): Promise<string | null> {
  const normalized = normalizeNumber(dialedNumber);
  if (!normalized) return null;
  const all = await prisma.phoneNumber.findMany({
    where: { agentId: { not: null } },
    select: { number: true, agentId: true },
  });
  for (const row of all) {
    if (normalizeNumber(row.number) === normalized || row.number === dialedNumber || row.number === normalized) {
      return row.agentId;
    }
  }
  return null;
}

export type OutboundTrunkFrom = {
  trunk: { id: string; provider: string; name: string; config: Record<string, unknown> };
  fromNumber: string; // E.164 or provider format to use as caller ID
};

/**
 * Outbound: pick a SIP trunk and a from number (for caller ID).
 * Scoped by workspaceId when provided.
 */
export async function getTrunkAndFromForOutbound(workspaceId: string, sipTrunkId?: string): Promise<OutboundTrunkFrom | null> {
  const trunk = sipTrunkId
    ? await prisma.sipTrunk.findFirst({ where: { id: sipTrunkId, workspaceId } })
    : await prisma.sipTrunk.findFirst({ where: { workspaceId }, orderBy: { createdAt: 'asc' } });
  if (!trunk) return null;
  const phone = await prisma.phoneNumber.findFirst({
    where: { sipTrunkId: trunk.id, workspaceId },
    orderBy: { createdAt: 'asc' },
  });
  if (!phone) return null;
  return {
    trunk: {
      id: trunk.id,
      provider: trunk.provider,
      name: trunk.name,
      config: (trunk.config as Record<string, unknown>) ?? {},
    },
    fromNumber: phone.number,
  };
}
