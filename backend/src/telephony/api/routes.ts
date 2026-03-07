import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AsteriskController } from '../asterisk/controller.js';

const OutboundSchema = z.object({
  provider: z.enum(['TWILIO', 'PLIVO', 'TELNYX']),
  to: z.string().min(3),
  from: z.string().min(3),
  agentId: z.string().uuid().optional(),
});

export function registerTelephonyRoutes(app: FastifyInstance, deps: { asterisk: AsteriskController }) {
  app.post('/telephony/outbound', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = OutboundSchema.parse(req.body);

    // Phase 4 (SIP trunk mode): we always dial via Asterisk trunk endpoint.
    // You configure trunks in Asterisk as:
    // - PJSIP "twilio-trunk", "plivo-trunk", "telnyx-trunk"
    const trunk =
      body.provider === 'TWILIO'
        ? 'twilio-trunk'
        : body.provider === 'PLIVO'
          ? 'plivo-trunk'
          : 'telnyx-trunk';

    const endpoint = `PJSIP/${body.to}@${trunk}`;
    const result = await deps.asterisk.originate({
      endpoint,
      callerId: body.from,
      agentId: body.agentId,
    });

    return reply.code(201).send({ ...result });
  });
}

