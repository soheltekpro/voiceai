import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { getWorkspaceId } from '../auth-context.js';
import { getTrunkAndFromForOutbound } from '../../services/telephony-routing.js';
import type { AsteriskController } from '../../telephony/asterisk/controller.js';

const OutboundSchema = z.object({
  phoneNumber: z.string().min(1).max(32),
  agentId: z.string().uuid(),
});

export async function registerOutboundCallRoutes(
  app: FastifyInstance,
  deps: { asterisk?: AsteriskController }
): Promise<void> {
  app.post('/calls/outbound', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const body = OutboundSchema.parse(req.body);
    const agent = await prisma.agent.findFirst({ where: { id: body.agentId, workspaceId } });
    if (!agent) return reply.code(404).send({ message: 'Agent not found' });

    const trunkFrom = await getTrunkAndFromForOutbound(workspaceId);
    if (!trunkFrom) {
      return reply.code(503).send({
        message: 'No SIP trunk or phone number configured. Add a trunk and at least one phone number.',
      });
    }

    if (!deps.asterisk) {
      return reply.code(503).send({
        message: 'Telephony (Asterisk) is not configured. Outbound calls require a SIP trunk and Asterisk.',
      });
    }

    const to = body.phoneNumber.replace(/\s/g, '');
    const endpoint = `PJSIP/${to}@${trunkFrom.trunk.name}`;
    try {
      const result = await deps.asterisk.originate({
        endpoint,
        callerId: trunkFrom.fromNumber,
        agentId: body.agentId,
      });
      return reply.code(201).send({
        channelId: result.channelId,
        phoneNumber: body.phoneNumber,
        agentId: body.agentId,
      });
    } catch (err) {
      app.log.error({ err, phoneNumber: body.phoneNumber }, 'Outbound originate failed');
      return reply.code(502).send({ message: (err as Error).message });
    }
  });
}
