import type { VoiceAIClient } from './client.js';

export type CallStartResultPipeline = {
  agentType: 'PIPELINE';
  engine: 'pipeline';
  callSessionId: string;
  wsUrl: string;
  wsSessionId: string;
  callId?: string;
};

export type CallStartResultV2V = {
  agentType: 'V2V';
  engine: 'v2v';
  callSessionId: string;
  roomName: string;
  livekitToken: string;
  livekitUrl: string;
  callId?: string;
};

export type CallStartQueued = {
  message: string;
  callId: string;
  jobId: string;
};

export type CallStartResult = CallStartResultPipeline | CallStartResultV2V | CallStartQueued;

export type CallStartInput = {
  agentId: string;
  clientType?: 'BROWSER' | 'PHONE' | 'UNKNOWN';
};

export type CallRecord = {
  id: string;
  agentId: string;
  agentType: string;
  status: 'ACTIVE' | 'ENDED' | 'ERROR' | string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  tokensUsed: number | null;
  transcript: string | null;
  recordingUrl?: string | null;
  callSessionId?: string | null;
};

export class CallsResource {
  constructor(private client: VoiceAIClient) {}

  /** Start a call (may return queued jobId when workers are not available). */
  start(input: CallStartInput): Promise<CallStartResult> {
    return this.client.request('POST', '/api/v1/calls/start', {
      agentId: input.agentId,
      clientType: input.clientType ?? 'BROWSER',
    });
  }

  /** Fetch a call record by id. */
  get(callId: string): Promise<CallRecord> {
    return this.client.request('GET', `/api/v1/calls/${encodeURIComponent(callId)}`);
  }
}

