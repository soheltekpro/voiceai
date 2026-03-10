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
  providerFailoversTotal: new client.Counter({
    name: 'voiceai_provider_failovers_total',
    help: 'Total provider failovers (STT, LLM, TTS)',
    labelNames: ['type'] as const,
  }),
  callsByRegion: new client.Counter({
    name: 'voiceai_calls_by_region_total',
    help: 'Total voice calls per region (multi-region routing)',
    labelNames: ['region'] as const,
  }),
  callDurationByRegion: new client.Histogram({
    name: 'voiceai_call_duration_seconds_by_region',
    help: 'Call duration in seconds by region',
    labelNames: ['region'] as const,
    buckets: [5, 15, 30, 60, 120, 300],
  }),
  providerLatencyMs: new client.Histogram({
    name: 'voiceai_provider_latency_ms',
    help: 'STT, LLM, TTS provider latency in milliseconds',
    labelNames: ['provider', 'type'] as const,
    buckets: [50, 100, 200, 400, 800, 1600],
  }),
  providerSwitchCount: new client.Counter({
    name: 'voiceai_provider_switch_count_total',
    help: 'Number of provider switches due to latency threshold exceeded',
    labelNames: ['type'] as const,
  }),
};

export async function registerMetrics(app: FastifyInstance): Promise<void> {
  client.collectDefaultMetrics();
  app.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', client.register.contentType);
    return client.register.metrics();
  });
}

