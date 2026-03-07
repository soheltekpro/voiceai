export type CallEventName =
  | 'call.started'
  | 'call.connected'
  | 'speech.detected'
  | 'transcript.partial'
  | 'transcript.final'
  | 'transcription.completed'
  | 'ai.response.generated'
  | 'agent.reply'
  | 'assistant.reply'
  | 'agent.speaking'
  | 'agent.finished'
  | 'audio.played'
  | 'tool.called'
  | 'tool.result'
  | 'call.ended'
  | 'usage.updated'
  | 'call.recording.available'
  | 'call.handoff_requested';

export type CallEventMessage = {
  id: string;
  callSessionId: string;
  name: CallEventName;
  ts: number;
  payload?: Record<string, unknown>;
};

