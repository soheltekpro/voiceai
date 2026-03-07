/**
 * Real-time event bus: publish events, persist to call_events, broadcast via WebSocket.
 * Single entry point for all call lifecycle and pipeline events.
 */

import type { WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { prisma } from '../db/prisma.js';
import { callEventBus } from '../events/bus.js';
import type { CallEventName, CallEventMessage } from '../events/types.js';
import { metrics } from '../infra/metrics.js';
import { getWebhookQueue } from '../infra/queues.js';

type DbEventType =
  | 'SESSION_STARTED'
  | 'SESSION_CONNECTED'
  | 'SESSION_ENDED'
  | 'TRANSCRIPT_PARTIAL'
  | 'TRANSCRIPT_FINAL'
  | 'AGENT_TEXT_DELTA'
  | 'AGENT_REPLY'
  | 'AGENT_AUDIO_CHUNK'
  | 'AGENT_SPEAKING'
  | 'AGENT_FINISHED'
  | 'USAGE_UPDATED'
  | 'TOOL_CALLED'
  | 'TOOL_RESULT'
  | 'RECORDING_AVAILABLE'
  | 'HANDOFF_REQUESTED';

function toDbType(name: CallEventName): DbEventType {
  switch (name) {
    case 'call.started':
      return 'SESSION_STARTED';
    case 'call.connected':
      return 'SESSION_CONNECTED';
    case 'speech.detected':
    case 'transcript.partial':
      return 'TRANSCRIPT_PARTIAL';
    case 'transcription.completed':
    case 'transcript.final':
      return 'TRANSCRIPT_FINAL';
    case 'ai.response.generated':
      return 'AGENT_TEXT_DELTA';
    case 'agent.reply':
    case 'assistant.reply':
      return 'AGENT_REPLY';
    case 'agent.speaking':
      return 'AGENT_SPEAKING';
    case 'agent.finished':
      return 'AGENT_FINISHED';
    case 'audio.played':
      return 'AGENT_AUDIO_CHUNK';
    case 'call.ended':
      return 'SESSION_ENDED';
    case 'usage.updated':
      return 'USAGE_UPDATED';
    case 'tool.called':
      return 'TOOL_CALLED';
    case 'tool.result':
      return 'TOOL_RESULT';
    case 'call.recording.available':
      return 'RECORDING_AVAILABLE';
    case 'call.handoff_requested':
      return 'HANDOFF_REQUESTED';
    default:
      return 'SESSION_ENDED';
  }
}

const streamClients = new Set<WebSocket>();

function safeSend(ws: WebSocket, data: unknown): void {
  if (ws.readyState !== 1) return;
  try {
    ws.send(JSON.stringify(data));
  } catch {
    streamClients.delete(ws);
  }
}

/**
 * Publish an event: persist to call_events, notify in-memory subscribers, broadcast to stream clients.
 */
export async function publish(
  callSessionId: string,
  name: CallEventName,
  payload?: Record<string, unknown>
): Promise<CallEventMessage> {
  const evt: CallEventMessage = {
    id: randomUUID(),
    callSessionId,
    name,
    ts: Date.now(),
    payload,
  };

  // Enqueue webhook deliveries (best-effort).
  void enqueueWebhooks(callSessionId, evt).catch(() => {});

  try {
    await prisma.callEvent.create({
      data: {
        sessionId: callSessionId,
        type: toDbType(name) as any,
        payload: { name, ...payload },
      },
    });
  } catch {
    // best-effort persist
  }

  metrics.eventsEmittedTotal.inc({ name });
  callEventBus.publish(callSessionId, name, payload);

  const message = { type: 'event' as const, evt };
  for (const ws of streamClients) {
    safeSend(ws, message);
  }

  return evt;
}

async function enqueueWebhooks(callSessionId: string, evt: CallEventMessage): Promise<void> {
  // Resolve workspaceId from callSession -> agent.workspaceId
  const session = await prisma.callSession.findUnique({
    where: { id: callSessionId },
    select: { agent: { select: { workspaceId: true } } },
  });
  const workspaceId = session?.agent?.workspaceId;
  if (!workspaceId) return;

  // Find matching webhooks by event name
  const hooks = await prisma.webhook.findMany({
    where: { workspaceId, events: { has: evt.name } },
    select: { id: true, url: true, secret: true },
  });
  if (hooks.length === 0) return;

  const q = getWebhookQueue();
  await Promise.all(
    hooks.map((h) =>
      q.add('webhook.deliver', {
        type: 'webhook.deliver',
        webhookId: h.id,
        url: h.url,
        secret: h.secret,
        event: {
          id: evt.id,
          callSessionId: evt.callSessionId,
          name: evt.name,
          ts: evt.ts,
          payload: evt.payload,
        },
      })
    )
  );
}

/** Fire-and-forget publish (no await). Use when you don't need to wait for persist. */
export function publishAsync(
  callSessionId: string,
  name: CallEventName,
  payload?: Record<string, unknown>
): void {
  void publish(callSessionId, name, payload);
}

export function addStreamClient(ws: WebSocket): void {
  streamClients.add(ws);
  ws.on('close', () => streamClients.delete(ws));
  ws.on('error', () => streamClients.delete(ws));
}

export function removeStreamClient(ws: WebSocket): void {
  streamClients.delete(ws);
}

export function getStreamClientCount(): number {
  return streamClients.size;
}
