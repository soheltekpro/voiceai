import type { FastifyInstance } from 'fastify';
import client from 'prom-client';

export const metrics = {
  activeCalls: new client.Gauge({
    name: 'voiceai_active_calls',
    help: 'Active calls currently handled by this instance',
    labelNames: ['type'] as const,
  }),
  wsConnectionsTotal: new client.Counter({
    name: 'voiceai_ws_connections_total',
    help: 'Total websocket connections',
    labelNames: ['path'] as const,
  }),
  eventsEmittedTotal: new client.Counter({
    name: 'voiceai_events_emitted_total',
    help: 'Total call events emitted',
    labelNames: ['name'] as const,
  }),
};

export async function registerMetrics(app: FastifyInstance): Promise<void> {
  client.collectDefaultMetrics();
  app.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', client.register.contentType);
    return client.register.metrics();
  });
}

