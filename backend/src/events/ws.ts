import type { WebSocket } from 'ws';
import type { FastifyInstance } from 'fastify';
import { callEventBus } from './bus.js';

/** Subscribe to one call or to all events (callSessionId === '*' for monitoring dashboard). */
type SubscribeMessage = { type: 'subscribe'; callSessionId: string };

export async function registerEventWebsocket(app: FastifyInstance): Promise<void> {
  app.get('/events', { websocket: true }, (socket: WebSocket) => {
    let unsubscribe: (() => void) | null = null;

    const safeSend = (data: unknown) => {
      if (socket.readyState !== 1) return;
      socket.send(JSON.stringify(data));
    };

    socket.on('message', (raw: any) => {
      try {
        const msg = JSON.parse(raw.toString()) as SubscribeMessage;
        if (msg.type !== 'subscribe' || msg.callSessionId == null) return;
        unsubscribe?.();
        const channel = msg.callSessionId.trim() === '*' ? '*' : msg.callSessionId;
        unsubscribe = callEventBus.subscribe(channel, (evt) => safeSend({ type: 'event', evt }));
        safeSend({ type: 'subscribed', callSessionId: msg.callSessionId });
      } catch {
        safeSend({ type: 'error', message: 'Invalid message' });
      }
    });

    socket.on('close', () => unsubscribe?.());
    socket.on('error', () => unsubscribe?.());
  });
}

