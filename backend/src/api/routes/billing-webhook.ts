import type { FastifyInstance } from 'fastify';
import { verifyWebhookSignature, hasProcessedStripeEvent, isWebhookConfigured } from '../../billing/stripe-webhook.js';
import { addBillingWebhookJob } from '../../billing/billing-queue.js';

/** Register Stripe webhook route. Must be registered without requireWorkspaceContext so Stripe can POST. */
export async function registerBillingWebhookRoutes(app: FastifyInstance): Promise<void> {
  // Provide raw body for signature verification: parse JSON as string first, then parse and attach both.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    const raw = typeof body === 'string' ? body : (body as Buffer).toString('utf8');
    if ((req as { url?: string }).url?.includes('billing/webhook')) {
      (req as { rawBody?: string }).rawBody = raw;
    }
    try {
      done(null, JSON.parse(raw));
    } catch (e) {
      done(e as Error, undefined);
    }
  });

  app.post<{ Body: unknown }>('/billing/webhook', async (req, reply) => {
    if (!isWebhookConfigured()) {
      return reply.code(503).send({ error: 'Stripe webhook not configured' });
    }
    const rawBody = (req as { rawBody?: string }).rawBody;
    const signature = req.headers['stripe-signature'];
    if (!rawBody || typeof signature !== 'string') {
      return reply.code(400).send({ error: 'Missing body or stripe-signature header' });
    }
    let event;
    try {
      event = verifyWebhookSignature(rawBody, signature);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid signature';
      req.log.warn({ err }, 'Stripe webhook signature verification failed');
      return reply.code(400).send({ error: message });
    }
    if (await hasProcessedStripeEvent(event.id)) {
      return reply.code(200).send({ received: true });
    }
    try {
      await addBillingWebhookJob(event);
      return reply.code(200).send({ received: true });
    } catch (err) {
      req.log.error({ err, eventId: event.id, eventType: event.type }, 'Failed to queue billing webhook');
      return reply.code(500).send({ error: 'Webhook handler failed' });
    }
  });
}
