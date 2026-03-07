import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import type { CallEventMessage, CallEventName } from './types.js';
import { metrics } from '../infra/metrics.js';

type Listener = (evt: CallEventMessage) => void;

export class CallEventBus {
  private emitter = new EventEmitter();

  publish(callSessionId: string, name: CallEventName, payload?: Record<string, unknown>): CallEventMessage {
    const evt: CallEventMessage = {
      id: randomUUID(),
      callSessionId,
      name,
      ts: Date.now(),
      payload,
    };
    metrics.eventsEmittedTotal.inc({ name });
    this.emitter.emit(callSessionId, evt);
    this.emitter.emit('*', evt);
    return evt;
  }

  subscribe(callSessionId: string, fn: Listener): () => void {
    this.emitter.on(callSessionId, fn);
    return () => this.emitter.off(callSessionId, fn);
  }
}

export const callEventBus = new CallEventBus();

