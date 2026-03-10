/**
 * Live voice monitoring: broadcast call lifecycle events to dashboard WebSocket clients.
 */

import type { WebSocket } from 'ws';

export type VoiceMonitorEvent =
  | { type: 'call_started'; callId: string; agentId: string; workspaceId?: string; ts: number }
  | { type: 'call_ended'; callId: string; agentId: string; durationMs?: number; ts: number }
  | { type: 'agent_speaking'; callId: string; ts: number }
  | { type: 'agent_interrupted'; callId: string; ts: number };

const clients = new Set<WebSocket>();

function safeSend(ws: WebSocket, data: unknown): void {
  if (ws.readyState !== 1) return;
  try {
    ws.send(JSON.stringify(data));
  } catch {
    clients.delete(ws);
  }
}

export function addVoiceMonitorClient(ws: WebSocket): void {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
}

export function broadcastVoiceMonitorEvent(evt: VoiceMonitorEvent): void {
  const message = { type: 'voice_monitor', evt };
  for (const ws of clients) {
    safeSend(ws, message);
  }
}

export function getVoiceMonitorClientCount(): number {
  return clients.size;
}
