/**
 * Voice AI Platform - Phase 1
 * HTTP + WebSocket server for real-time voice streaming and STT → LLM → TTS pipeline.
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import { config, validateConfig } from './config.js';
import { handleVoiceConnection } from './ws/voice-ws-handler.js';
import { registerApi } from './api/index.js';
import { AsteriskController } from './telephony/asterisk/controller.js';
import { TelephonySessionManager } from './telephony/session/session-manager.js';
import { registerEventWebsocket } from './events/ws.js';
import { addStreamClient } from './services/event-bus.js';
import { createRedis } from './infra/redis.js';
import { registerRateLimiting } from './infra/rate-limit.js';
import { registerMetrics } from './infra/metrics.js';

async function main() {
  validateConfig();

  const fastify = Fastify({
    logger: {
      level: config.nodeEnv === 'development' ? 'info' : 'info',
      transport:
        config.nodeEnv === 'development'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
  });

  await fastify.register(cors, {
    origin: true,
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  await fastify.register(fastifyWebsocket, {
    options: { maxPayload: 1024 * 1024 }, // 1MB for audio chunks
  });

  // Phase 7: Redis-backed rate limiting + shared primitives
  const redis = createRedis();
  await registerRateLimiting(fastify, redis);

  fastify.get('/health', async () => ({ status: 'ok', service: 'voice-ai-backend' }));
  await registerMetrics(fastify);
  await registerEventWebsocket(fastify);

  // Phase 4: optional Asterisk ARI controller (only used if env configured)
  const asteriskUrl = process.env['ASTERISK_ARI_URL'];
  const asteriskUser = process.env['ASTERISK_ARI_USERNAME'];
  const asteriskPass = process.env['ASTERISK_ARI_PASSWORD'];
  const asteriskApp = process.env['ASTERISK_ARI_APP'];
  const rtpHost = process.env['ASTERISK_RTP_HOST'];
  const rtpBind = process.env['TELEPHONY_RTP_BIND'] ?? '0.0.0.0';
  const rtpStart = process.env['TELEPHONY_RTP_PORT_START']
    ? parseInt(process.env['TELEPHONY_RTP_PORT_START'], 10)
    : 40000;
  const rtpEnd = process.env['TELEPHONY_RTP_PORT_END']
    ? parseInt(process.env['TELEPHONY_RTP_PORT_END'], 10)
    : 40100;

  let asterisk: AsteriskController | undefined;
  if (asteriskUrl && asteriskUser && asteriskPass && asteriskApp && rtpHost) {
    const telephonySessions = new TelephonySessionManager(
      { bindAddress: rtpBind, portStart: rtpStart, portEnd: rtpEnd },
      fastify.log
    );
    asterisk = new AsteriskController(
      { ari: { url: asteriskUrl, username: asteriskUser, password: asteriskPass, appName: asteriskApp }, rtpHost },
      telephonySessions,
      fastify.log
    );
    asterisk.start().catch((err) => fastify.log.error(err, 'Failed to start Asterisk controller'));
  }

  await registerApi(fastify, { asterisk });

  // Real-time events stream for live monitoring (WebSocket on main app for @fastify/websocket)
  fastify.get('/api/v1/events/stream', { websocket: true }, (socket) => {
    addStreamClient(socket);
  });

  fastify.get('/voice', { websocket: true }, (socket) => {
    handleVoiceConnection(socket);
  });

  try {
    await fastify.listen({ port: config.port, host: config.host });
    fastify.log.info(`Voice AI backend listening on http://${config.host}:${config.port}`);
    fastify.log.info(`WebSocket voice endpoint: ws://${config.host}:${config.port}/voice`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main();
