/**
 * Shared types for Voice AI platform (Phase 1 + Phase 2).
 */

/** Client → Server WebSocket message types */
export type ClientMessage =
  | { type: 'audio'; payload: { base64: string } }
  | { type: 'audio_binary'; payload: ArrayBuffer }
  | {
      type: 'config';
      payload: {
        sampleRate?: number;
        language?: string;
        agentId?: string;
        clientType?: 'BROWSER' | 'PHONE' | 'UNKNOWN';
        /** When starting via POST /calls/start (orchestrator), link this WS to the existing call session */
        callSessionId?: string;
      };
    }
  | { type: 'interrupt'; payload: Record<string, never> }
  | { type: 'ping'; payload: Record<string, never> };

/** Server → Client WebSocket message types */
export type ServerMessage =
  | { type: 'session'; payload: { sessionId: string } }
  | { type: 'transcript'; payload: { text: string; isFinal?: boolean } }
  | { type: 'transcript_partial'; payload: { text: string } }
  | { type: 'transcript_final'; payload: { text: string } }
  | { type: 'agent_text'; payload: { text: string } }
  | { type: 'agent_text_delta'; payload: { text: string } }
  | { type: 'agent_audio'; payload: { base64: string } }
  | { type: 'agent_audio_start'; payload: Record<string, never> }
  | { type: 'agent_audio_chunk'; payload: { base64: string } }
  | { type: 'agent_audio_end'; payload: Record<string, never> }
  | { type: 'agent_stopped'; payload: Record<string, never> }
  | { type: 'error'; payload: { message: string } }
  | { type: 'pong'; payload: Record<string, never> };

/** Pipeline state for real-time flow (Phase 2) */
export type PipelinePhase = 'idle' | 'listening' | 'processing';

/** Streaming STT controller (Phase 2) - pushPcm, close */
export type StreamingSTTController = {
  pushPcm: (pcm: Buffer, sourceSampleRate: number) => void;
  close: () => void;
};

/** Session state held by SessionManager */
export interface SessionState {
  sessionId: string;
  createdAt: number;
  /** Whether pipeline is currently running (STT/LLM/TTS) - Phase 1 compat */
  pipelineBusy: boolean;
  /** Real-time pipeline phase - Phase 2 */
  phase: PipelinePhase;
  /** Buffered PCM chunks (16-bit mono) for next STT run */
  audioBuffer: Buffer;
  /** Config from client */
  sampleRate: number;
  language: string;
  clientType?: 'BROWSER' | 'PHONE' | 'UNKNOWN';
  /** Phase 3: optional agent settings */
  agentId?: string | null;
  systemPrompt?: string;
  voiceName?: string;
  /** RAG: knowledge base id for context retrieval */
  knowledgeBaseId?: string | null;
  maxCallDurationSeconds?: number;
  interruptionBehavior?: 'BARGE_IN_STOP_AGENT' | 'IGNORE_WHILE_SPEAKING';
  /** Phase 3: call session id for persistence */
  callSessionId?: string | null;
  /** Phase 3: call end timer */
  maxDurationTimer?: NodeJS.Timeout | null;
  /** Phase 2: streaming STT (when Deepgram enabled) */
  streamingSTT?: StreamingSTTController | null;
  /** Phase 2: abort for current agent reply (barge-in) */
  replyAbort?: { abort: () => void; onAbort: (fn: () => void) => void; aborted: boolean };
}

/** Pipeline result for one turn */
export interface PipelineResult {
  transcript: string;
  replyText: string;
  audioBase64: string;
}
