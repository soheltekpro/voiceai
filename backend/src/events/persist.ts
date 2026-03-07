import type { CallEventName } from './types.js';
import { publish } from '../services/event-bus.js';

/** Persist event to call_events and publish to in-memory bus + WebSocket stream. Delegates to event-bus. */
export async function persistAndPublish(
  callSessionId: string,
  name: CallEventName,
  payload?: Record<string, unknown>
): Promise<void> {
  await publish(callSessionId, name, payload);
}

