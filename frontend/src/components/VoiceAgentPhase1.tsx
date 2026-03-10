/**
 * Unified Voice Agent client: Pipeline (WebSocket) or V2V (LiveKit).
 * POST /calls/start → connect by agentType; lifecycle events: call.started, call.connected, speech.detected, agent.reply, call.ended.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Phone, PhoneOff } from 'lucide-react';
import { Room, RoomEvent } from 'livekit-client';
import { apiGet, apiPost } from '../api/client';
import type { Agent } from '../admin/types';
import { useStreamingAudioPlayer } from '../hooks/useStreamingAudioPlayer';

type CallStartResultPipeline = {
  agentType: 'PIPELINE';
  engine: 'pipeline';
  callSessionId: string;
  wsUrl: string;
  wsSessionId: string;
};

type CallStartResultV2V = {
  agentType: 'V2V';
  engine: 'v2v';
  callSessionId: string;
  roomName: string;
  livekitToken: string;
  livekitUrl: string;
};

type CallStartResult = CallStartResultPipeline | CallStartResultV2V;

type JobStatusResponse = {
  jobId: string;
  status: 'waiting' | 'active' | 'completed' | 'failed';
  result: unknown;
};

type CallStartQueued = {
  message: string;
  callId: string;
  jobId: string;
};

type CallStartResponse = CallStartResult | CallStartQueued;

type LifecycleEvent = {
  name: string;
  ts: number;
  payload?: Record<string, unknown>;
};

function buildWsFullUrl(wsPath: string): string {
  if (!wsPath || typeof wsPath !== 'string') return `ws://localhost:3000/api/v1/voice?sessionId=`;
  const trimmed = wsPath.trim();
  // Defensive: if backend sent a concatenated URL (e.g. ws://127.0.0.1:3000wss://voice-us.example.com/...), use the last absolute URL
  const idxWss = trimmed.lastIndexOf('wss://');
  const idxWs = trimmed.lastIndexOf('ws://');
  const lastIdx = idxWss >= 0 && idxWs >= 0 ? Math.max(idxWss, idxWs) : idxWss >= 0 ? idxWss : idxWs;
  if (lastIdx >= 0) {
    let extracted = trimmed.slice(lastIdx).replace(/^wsss:\/\//i, 'wss://').replace(/^https:\/\//i, 'wss://').replace(/^http:\/\//i, 'ws://');
    if (extracted.includes('/api/v1/voice')) return extracted;
  }
  if (import.meta.env.VITE_WS_VOICE_URL) {
    const base = import.meta.env.VITE_WS_VOICE_URL as string;
    return base.startsWith('ws') ? `${base.replace(/\/voice.*$/, '')}${trimmed}` : `ws://localhost:3000${trimmed}`;
  }
  if (typeof window === 'undefined') return `ws://localhost:3000${trimmed}`;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${trimmed}`;
}

export function VoiceAgentPhase1() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [connectionState, setConnectionState] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [micEnabled, setMicEnabled] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState('');
  const [agentText, setAgentText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lifecycleEvents, setLifecycleEvents] = useState<LifecycleEvent[]>([]);
  const [callSessionId, setCallSessionId] = useState<string | null>(null);
  const [agentType, setAgentType] = useState<'PIPELINE' | 'V2V' | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const roomRef = useRef<Room | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const agentTextAccumRef = useRef('');
  const [partialTranscript, setPartialTranscript] = useState('');
  const { playChunk, stop: stopAudio, reset: resetAudio } = useStreamingAudioPlayer();

  const addEvent = useCallback((name: string, payload?: Record<string, unknown>) => {
    setLifecycleEvents((prev) => [...prev, { name, ts: Date.now(), payload }]);
  }, []);

  const reportCallEvent = useCallback(
    async (event: string, payload?: Record<string, unknown>) => {
      if (!callSessionId) return;
      try {
        await apiPost(`/api/v1/calls/${callSessionId}/events`, { event, payload });
      } catch {
        // best-effort
      }
    },
    [callSessionId]
  );

  useEffect(() => {
    apiGet<{ items: Agent[] }>('/api/v1/agents?limit=100&offset=0')
      .then((r) => setAgents(r.items || []))
      .catch(() => setAgents([]));
  }, []);

  const send = useCallback((data: object) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  }, []);

  const connectPipeline = useCallback(
    async (result: CallStartResultPipeline) => {
      setCallSessionId(result.callSessionId);
      setAgentType('PIPELINE');
      addEvent('call.started', { engine: 'pipeline' });
      const fullUrl = buildWsFullUrl(result.wsUrl);
      const ws = new WebSocket(fullUrl);
      wsRef.current = ws;
      setConnectionState('connecting');

      ws.onopen = () => {
        setConnectionState('connected');
        agentTextAccumRef.current = '';
        setAgentText('');
        setTranscript('');
        setPartialTranscript('');
        send({
          type: 'config',
          payload: {
            callSessionId: result.callSessionId,
            agentId: selectedAgentId,
            clientType: 'BROWSER',
            sampleRate: audioContextRef.current?.sampleRate ?? 48000,
          },
        });
        addEvent('call.connected');
      };

      ws.onmessage = (event: MessageEvent) => {
        if (typeof event.data !== 'string') return;
        try {
          const msg = JSON.parse(event.data) as { type: string; payload: Record<string, unknown> & { base64?: string; text?: string; message?: string } };
          switch (msg.type) {
            case 'session':
              setSessionId((msg.payload.sessionId as string) ?? null);
              break;
            case 'transcript':
            case 'transcript_final':
              setTranscript((msg.payload.text as string) ?? '');
              setPartialTranscript('');
              break;
            case 'user_transcript_final':
              setTranscript((msg.payload.text as string) ?? '');
              setPartialTranscript('');
              addEvent('speech.detected', { text: msg.payload.text });
              break;
            case 'transcript_partial':
              setPartialTranscript((msg.payload.text as string) ?? '');
              break;
            case 'agent_text':
            case 'agent_text_delta':
              agentTextAccumRef.current += (msg.payload.text as string) ?? '';
              setAgentText(agentTextAccumRef.current);
              break;
            case 'agent_audio_start':
              agentTextAccumRef.current = '';
              setAgentText('');
              resetAudio();
              addEvent('agent.reply');
              break;
            case 'agent_audio':
            case 'agent_audio_chunk': {
              const b64 = msg.payload.base64 as string;
              if (b64) playChunk(b64);
              break;
            }
            case 'agent_audio_end':
              break;
            case 'agent_stopped':
              stopAudio();
              break;
            case 'error':
              setError((msg.payload.message as string) ?? 'Unknown error');
              break;
            default:
              break;
          }
        } catch {
          // ignore
        }
      };

      ws.onclose = () => {
        setConnectionState('disconnected');
        setSessionId(null);
        setCallSessionId(null);
        setAgentType(null);
        wsRef.current = null;
        addEvent('call.ended');
      };

      ws.onerror = () => setError('WebSocket error');
    },
    [selectedAgentId, addEvent, send, playChunk, stopAudio, resetAudio]
  );

  const connectV2V = useCallback(
    async (result: CallStartResultV2V) => {
      setCallSessionId(result.callSessionId);
      setAgentType('V2V');
      addEvent('call.started', { engine: 'v2v', roomName: result.roomName });
      const room = new Room();
      roomRef.current = room;

      room.on('trackSubscribed', (track) => {
        if (track.kind === 'audio') {
          addEvent('agent.reply');
          const el = document.createElement('audio');
          el.autoplay = true;
          track.attach(el);
        }
      });

      room.on(RoomEvent.DataReceived, (payload: Uint8Array, _participant?, _kind?, topic?: string) => {
        if (topic === 'voice-usage' && result.callSessionId) {
          try {
            const text = new TextDecoder().decode(payload);
            const data = JSON.parse(text) as { input_audio_tokens?: number; output_audio_tokens?: number; total_tokens?: number };
            const inputTokens = data.input_audio_tokens ?? data.total_tokens;
            const outputTokens = data.output_audio_tokens;
            if (inputTokens != null || outputTokens != null) {
              apiPost(`/api/v1/calls/${result.callSessionId}/events`, {
                event: 'usage.updated',
                payload: {
                  inputTokens: inputTokens ?? 0,
                  outputTokens: outputTokens ?? 0,
                },
              }).catch(() => {});
            }
          } catch {
            // ignore
          }
        }
      });

      room.on('disconnected', () => {
        setConnectionState('disconnected');
        setCallSessionId(null);
        setAgentType(null);
        roomRef.current = null;
        reportCallEvent('call.ended').then(() => addEvent('call.ended'));
      });

      setConnectionState('connecting');
      setError(null);
      try {
        await room.connect(result.livekitUrl, result.livekitToken);
        setConnectionState('connected');
        addEvent('call.connected');
        await reportCallEvent('call.connected');
        await room.localParticipant.setMicrophoneEnabled(true);
        setMicEnabled(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'LiveKit connect failed');
        setConnectionState('disconnected');
        setCallSessionId(null);
        setAgentType(null);
        roomRef.current = null;
      }
    },
    [addEvent, reportCallEvent]
  );

  const startCall = useCallback(async () => {
    if (!selectedAgentId) {
      setError('Select an agent first');
      return;
    }
    setError(null);
    setLifecycleEvents([]);
    try {
      const result = await apiPost<CallStartResponse>('/api/v1/calls/start', {
        agentId: selectedAgentId,
        clientType: 'BROWSER',
      });

      const isQueued = (r: CallStartResponse): r is CallStartQueued =>
        typeof (r as any)?.jobId === 'string' && typeof (r as any)?.callId === 'string' && (r as any)?.agentType == null;

      let finalResult: CallStartResult | null = null;
      if (isQueued(result)) {
        setConnectionState('connecting');
        addEvent('call.started', { queued: true, jobId: result.jobId });
        const pollOnce = async () => apiGet<JobStatusResponse>(`/api/v1/jobs/${encodeURIComponent(result.jobId)}`);
        const started = Date.now();
        while (Date.now() - started < 30000) {
          const s = await pollOnce();
          if (s.status === 'completed') {
            finalResult = s.result as CallStartResult;
            break;
          }
          if (s.status === 'failed') {
            throw new Error('Call start job failed');
          }
          await new Promise((r) => setTimeout(r, 1500));
        }
        if (!finalResult) throw new Error('Timed out waiting for call start');
      } else {
        finalResult = result;
      }

      if (finalResult.agentType === 'V2V' && finalResult.engine === 'v2v') {
        await connectV2V(finalResult);
      } else {
        await connectPipeline(finalResult as CallStartResultPipeline);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start call');
    }
  }, [selectedAgentId, connectPipeline, connectV2V, addEvent]);

  const disconnect = useCallback(() => {
    const cid = callSessionId;
    setMicEnabled(false);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (processorRef.current && sourceRef.current) {
      try {
        sourceRef.current.disconnect();
        processorRef.current.disconnect();
      } catch {}
      sourceRef.current = null;
      processorRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
    }
    setConnectionState('disconnected');
    setSessionId(null);
    setCallSessionId(null);
    setAgentType(null);
    if (cid && agentType === 'V2V') {
      apiPost(`/api/v1/calls/${cid}/events`, { event: 'call.ended' }).catch(() => {});
    }
    addEvent('call.ended');
  }, [callSessionId, agentType, reportCallEvent, addEvent]);

  const sendInterrupt = useCallback(() => {
    send({ type: 'interrupt', payload: {} });
  }, [send]);

  const startMic = useCallback(async () => {
    if (agentType === 'V2V' && roomRef.current) {
      await roomRef.current.localParticipant.setMicrophoneEnabled(true);
      setMicEnabled(true);
      return;
    }
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ctx = audioContextRef.current ?? new AudioContext();
      if (!audioContextRef.current) audioContextRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      processor.onaudioprocess = (e: AudioProcessingEvent) => {
        const input = e.inputBuffer.getChannelData(0);
        const int16 = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        const u8 = new Uint8Array(int16.buffer);
        let binary = '';
        const chunk = 8192;
        for (let i = 0; i < u8.length; i += chunk) {
          binary += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + chunk)));
        }
        send({ type: 'audio', payload: { base64: btoa(binary) } });
      };
      source.connect(processor);
      processor.connect(ctx.destination);
      send({ type: 'config', payload: { sampleRate: ctx.sampleRate } });
      setMicEnabled(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Microphone access denied');
    }
  }, [send, agentType]);

  const toggleMic = useCallback(() => {
    if (micEnabled) {
      if (agentType === 'V2V' && roomRef.current) {
        roomRef.current.localParticipant.setMicrophoneEnabled(false);
      } else if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      setMicEnabled(false);
    } else {
      startMic();
    }
  }, [micEnabled, agentType, startMic]);

  const disconnectRef = useRef(disconnect);
  disconnectRef.current = disconnect;
  useEffect(() => {
    return () => {
      disconnectRef.current();
      audioContextRef.current?.close();
    };
  }, []); // run cleanup only on unmount so we don't close the socket when state updates during connect

  return (
    <div className="space-y-6">
      {/* Page header */}
      <header>
        <h1 className="text-2xl font-bold text-white">Test Voice Agent</h1>
        <p className="mt-1 text-sm text-slate-400">
          Pipeline (STT→LLM→TTS) or Realtime V2V — connect and talk to your agent.
        </p>
      </header>

      {/* Two column grid: call widget (left) + transcript (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Call widget — phone-like card */}
        <div className="rounded-xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-900 p-6 shadow-lg">
          <label className="text-xs font-medium text-slate-500 uppercase tracking-wide block mb-2">Agent</label>
          <select
            value={selectedAgentId}
            onChange={(e) => setSelectedAgentId(e.target.value)}
            disabled={connectionState !== 'disconnected'}
            className="w-full rounded-lg bg-slate-700/80 border border-slate-600 text-slate-200 px-3 py-2 text-sm mb-6"
          >
            <option value="">— Select agent —</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} {a.agentType === 'V2V' ? '(V2V)' : '(Pipeline)'}
              </option>
            ))}
          </select>

          <div className="flex flex-col items-center justify-center py-8">
            {connectionState === 'connected' ? (
              <PhoneOff className="h-16 w-16 text-emerald-400/80 mb-4" />
            ) : (
              <Phone className="h-16 w-16 text-slate-500 mb-4" />
            )}
            <p className="text-sm font-medium text-slate-300 mb-1">
              {connectionState === 'connected'
                ? 'On call'
                : connectionState === 'connecting'
                  ? 'Connecting…'
                  : 'Ready to call'}
            </p>
            <p className="text-xs text-slate-500 mb-6">
              {connectionState === 'connected'
                ? `${agentType ?? ''} ${sessionId ? `· ${sessionId.slice(0, 8)}…` : ''}`
                : 'Select an agent and start a call'}
            </p>

            {error && (
              <div className="w-full mb-4 p-3 rounded-lg bg-red-500/15 border border-red-500/30 text-red-200 text-sm">
                {error}
              </div>
            )}

            {connectionState !== 'connected' ? (
              <button
                type="button"
                onClick={startCall}
                disabled={connectionState === 'connecting' || !selectedAgentId}
                className="w-full max-w-xs py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 font-medium text-white transition"
              >
                Start call
              </button>
            ) : (
              <div className="flex flex-wrap items-center justify-center gap-2 w-full">
                <button
                  type="button"
                  onClick={toggleMic}
                  className={`py-2.5 px-4 rounded-lg font-medium transition ${
                    micEnabled ? 'bg-rose-600 hover:bg-rose-500 text-white' : 'bg-slate-600 hover:bg-slate-500 text-slate-200'
                  }`}
                >
                  {micEnabled ? 'Mute' : 'Unmute'}
                </button>
                {agentType === 'PIPELINE' && (
                  <button
                    type="button"
                    onClick={sendInterrupt}
                    className="py-2.5 px-4 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium"
                    title="Interrupt (barge-in)"
                  >
                    Interrupt
                  </button>
                )}
                <button
                  type="button"
                  onClick={disconnect}
                  className="py-2.5 px-4 rounded-lg bg-slate-600 hover:bg-slate-500 text-slate-200 font-medium"
                >
                  End call
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right: Live transcript panel */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 flex flex-col">
          <h2 className="text-lg font-semibold text-white">Live Transcript</h2>
          <p className="text-sm text-slate-500 mt-0.5">Real-time conversation transcription</p>
          <div className="mt-4 flex-1 min-h-0 overflow-y-auto rounded-lg bg-slate-800/50 border border-slate-700/50 p-4 space-y-4">
            {lifecycleEvents.length > 0 && (
              <ul className="text-xs space-y-1.5">
                {lifecycleEvents.map((e, i) => (
                  <li key={i} className="text-slate-400">
                    <span className="text-slate-500">{new Date(e.ts).toLocaleTimeString()}</span> {e.name}
                    {e.payload?.text != null && ` "${String(e.payload.text).slice(0, 40)}…"`}
                  </li>
                ))}
              </ul>
            )}
            {(agentType === 'PIPELINE' || !agentType) && (
              <>
                <div>
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">You said</p>
                  <p className="text-sm text-slate-300 rounded bg-slate-700/50 p-2">
                    {transcript || (partialTranscript ? <span className="text-slate-500 italic">{partialTranscript}</span> : '—')}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Agent</p>
                  <p className="text-sm text-slate-300 rounded bg-slate-700/50 p-2 whitespace-pre-wrap">
                    {agentText || '—'}
                  </p>
                </div>
              </>
            )}
            {agentType === 'V2V' && (
              <p className="text-sm text-slate-500">Realtime V2V — speak and listen via LiveKit. Events appear above.</p>
            )}
            {lifecycleEvents.length === 0 && !transcript && !agentText && !agentType && (
              <p className="text-sm text-slate-500">Start a call to see events and transcript here.</p>
            )}
          </div>
        </div>
      </div>

      {/* Bottom: Tips for better calls */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/30 p-4">
        <h3 className="text-sm font-semibold text-slate-300 mb-2">Tips for better calls</h3>
        <ul className="text-sm text-slate-500 space-y-1 list-disc list-inside">
          <li>Use a quiet environment and a clear microphone.</li>
          <li>Speak in full sentences so the agent can respond accurately.</li>
          <li>For Pipeline agents, wait for the agent to finish before speaking again, or use Interrupt to barge in.</li>
          <li>For V2V agents, conversation is real-time — speak naturally and allow a short pause for the agent to reply.</li>
        </ul>
      </section>
    </div>
  );
}
