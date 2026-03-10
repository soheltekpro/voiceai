/**
 * In-memory agent session manager.
 * One session per WebSocket connection; Phase 2 will add Redis.
 */

import type { SessionState } from '../types.js';
import { randomUUID } from 'crypto';

const DEFAULT_SAMPLE_RATE = 16000;
const DEFAULT_LANGUAGE = 'en';

const sessions = new Map<string, SessionState>();

export function createSession(): SessionState {
  const sessionId = randomUUID();
  const state: SessionState = {
    sessionId,
    createdAt: Date.now(),
    pipelineBusy: false,
    phase: 'idle',
    audioBuffer: Buffer.alloc(0),
    sampleRate: DEFAULT_SAMPLE_RATE,
    language: DEFAULT_LANGUAGE,
    clientType: 'UNKNOWN',
    agentId: null,
    systemPrompt: 'You are a helpful voice assistant.',
    voiceName: 'alloy',
    sttProvider: null,
    sttModel: null,
    llmProvider: null,
    llmModel: null,
    temperature: null,
    ttsProvider: null,
    ttsVoice: null,
    knowledgeBaseId: null,
    maxCallDurationSeconds: 15 * 60,
    interruptionBehavior: 'BARGE_IN_STOP_AGENT',
    callSessionId: null,
    maxDurationTimer: null,
    isAgentSpeaking: false,
  };
  sessions.set(sessionId, state);
  return state;
}

export function getSession(sessionId: string): SessionState | undefined {
  return sessions.get(sessionId);
}

export function updateSession(
  sessionId: string,
  update: Partial<
    Pick<
      SessionState,
      | 'pipelineBusy'
      | 'phase'
      | 'audioBuffer'
      | 'sampleRate'
      | 'language'
      | 'clientType'
      | 'streamingSTT'
      | 'replyAbort'
      | 'agentId'
      | 'systemPrompt'
      | 'voiceName'
      | 'sttProvider'
      | 'sttModel'
      | 'llmProvider'
      | 'llmModel'
      | 'temperature'
      | 'ttsProvider'
      | 'ttsVoice'
      | 'knowledgeBaseId'
      | 'maxCallDurationSeconds'
      | 'interruptionBehavior'
      | 'callSessionId'
      | 'promptVersionId'
      | 'maxDurationTimer'
      | 'guidanceIntervalId'
      | 'workspaceId'
      | 'callerPhoneNumber'
      | 'isAgentSpeaking'
      | 'ttsCancel'
      | 'partialTranscript'
      | 'prefillAbort'
      | 'prefillPromise'
      | 'prefillBuffer'
      | 'prefillPartial'
      | 'pendingUserTranscript'
      | 'lastProcessedTranscript'
      | 'lastProcessedAt'
    >
  >
): void {
  const s = sessions.get(sessionId);
  if (!s) return;
  if (update.pipelineBusy !== undefined) s.pipelineBusy = update.pipelineBusy;
  if (update.phase !== undefined) s.phase = update.phase;
  if (update.isAgentSpeaking !== undefined) s.isAgentSpeaking = update.isAgentSpeaking;
  if (update.ttsCancel !== undefined) s.ttsCancel = update.ttsCancel;
  if (update.partialTranscript !== undefined) s.partialTranscript = update.partialTranscript;
  if (update.prefillAbort !== undefined) s.prefillAbort = update.prefillAbort;
  if (update.prefillPromise !== undefined) s.prefillPromise = update.prefillPromise;
  if (update.prefillBuffer !== undefined) s.prefillBuffer = update.prefillBuffer;
  if (update.prefillPartial !== undefined) s.prefillPartial = update.prefillPartial;
  if (update.pendingUserTranscript !== undefined) s.pendingUserTranscript = update.pendingUserTranscript;
  if (update.lastProcessedTranscript !== undefined) s.lastProcessedTranscript = update.lastProcessedTranscript;
  if (update.lastProcessedAt !== undefined) s.lastProcessedAt = update.lastProcessedAt;
  if (update.audioBuffer !== undefined) s.audioBuffer = update.audioBuffer;
  if (update.sampleRate !== undefined) s.sampleRate = update.sampleRate;
  if (update.language !== undefined) s.language = update.language;
  if (update.clientType !== undefined) s.clientType = update.clientType;
  if (update.streamingSTT !== undefined) s.streamingSTT = update.streamingSTT;
  if (update.replyAbort !== undefined) s.replyAbort = update.replyAbort;
  if (update.agentId !== undefined) s.agentId = update.agentId;
  if (update.systemPrompt !== undefined) s.systemPrompt = update.systemPrompt;
  if (update.voiceName !== undefined) s.voiceName = update.voiceName;
  if (update.sttProvider !== undefined) s.sttProvider = update.sttProvider;
  if (update.sttModel !== undefined) s.sttModel = update.sttModel;
  if (update.llmProvider !== undefined) s.llmProvider = update.llmProvider;
  if (update.llmModel !== undefined) s.llmModel = update.llmModel;
  if (update.temperature !== undefined) s.temperature = update.temperature;
  if (update.ttsProvider !== undefined) s.ttsProvider = update.ttsProvider;
  if (update.ttsVoice !== undefined) s.ttsVoice = update.ttsVoice;
  if (update.knowledgeBaseId !== undefined) s.knowledgeBaseId = update.knowledgeBaseId;
  if (update.maxCallDurationSeconds !== undefined) s.maxCallDurationSeconds = update.maxCallDurationSeconds;
  if (update.interruptionBehavior !== undefined) s.interruptionBehavior = update.interruptionBehavior;
  if (update.callSessionId !== undefined) s.callSessionId = update.callSessionId;
  if (update.promptVersionId !== undefined) s.promptVersionId = update.promptVersionId;
  if (update.maxDurationTimer !== undefined) s.maxDurationTimer = update.maxDurationTimer;
  if (update.guidanceIntervalId !== undefined) s.guidanceIntervalId = update.guidanceIntervalId;
  if (update.workspaceId !== undefined) s.workspaceId = update.workspaceId;
  if (update.callerPhoneNumber !== undefined) s.callerPhoneNumber = update.callerPhoneNumber;
}

export function deleteSession(sessionId: string): void {
  sessions.delete(sessionId);
}

export function getSessionCount(): number {
  return sessions.size;
}
