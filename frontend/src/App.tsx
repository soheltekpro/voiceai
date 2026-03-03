'use client';

import { useEffect, useState } from 'react';
import {
  ControlBar,
  RoomAudioRenderer,
  useSession,
  SessionProvider,
  useAgent,
  useSessionContext,
  BarVisualizer,
} from '@livekit/components-react';
import { TokenSource, RoomEvent } from 'livekit-client';
import '@livekit/components-styles';

const TOKEN_ENDPOINT = '/api/token';
const USAGE_TOPIC = 'voice-usage';

const tokenSource = TokenSource.endpoint(TOKEN_ENDPOINT);

export type VoiceUsage = {
  input_audio_tokens: number;
  output_audio_tokens: number;
  total_tokens: number;
};

function VoiceAgentView({ onRetry }: { onRetry: () => void }) {
  const agent = useAgent();
  const session = useSessionContext();
  const [usage, setUsage] = useState<VoiceUsage | null>(null);
  const isFailed = agent.state === 'failed';
  const failureReasons = isFailed && agent.failureReasons?.length ? agent.failureReasons : [];

  useEffect(() => {
    if (!session.isConnected || !session.room) return;
    const room = session.room;
    const handler = (
      payload: Uint8Array,
      _participant?: unknown,
      _kind?: unknown,
      topic?: string
    ) => {
      if (topic !== USAGE_TOPIC) return;
      try {
        const text = new TextDecoder().decode(payload);
        const data = JSON.parse(text) as VoiceUsage;
        setUsage(data);
      } catch {
        // ignore parse errors
      }
    };
    room.on(RoomEvent.DataReceived, handler);
    return () => {
      room.off(RoomEvent.DataReceived, handler);
    };
  }, [session.isConnected, session.room]);

  return (
    <div className="agent-view">
      <div className="agent-card">
        <h2>Voice Assistant</h2>
        <p className="state">Status: {agent.state}</p>
        {usage !== null && (
          <div className="usage-box">
            <strong>Usage this session</strong>
            <p>Audio in: {usage.input_audio_tokens.toLocaleString()} tokens</p>
            <p>Audio out: {usage.output_audio_tokens.toLocaleString()} tokens</p>
            <p>Total: {usage.total_tokens.toLocaleString()} tokens</p>
          </div>
        )}
        {isFailed && failureReasons.length > 0 && (
          <div className="error-box">
            <strong>Why it failed:</strong>
            <ul>
              {failureReasons.map((reason, i) => (
                <li key={i}>{reason}</li>
              ))}
            </ul>
            <p className="hint">
              Make sure the <strong>LiveKit server</strong>, <strong>agent</strong>, and <strong>token server</strong> are all running (see README). Then tap Retry.
            </p>
            <button type="button" className="retry-btn" onClick={onRetry}>
              Retry
            </button>
          </div>
        )}
        {agent.canListen && (
          <BarVisualizer
            track={agent.microphoneTrack}
            state={agent.state}
            barCount={8}
          />
        )}
        {!isFailed && (
          <p className="hint">
            Use the mic button below to talk. The agent will respond with voice.
          </p>
        )}
      </div>
    </div>
  );
}

const isSecureContext = typeof window !== 'undefined' && window.isSecureContext;

function AppContent() {
  const session = useSession(tokenSource);

  useEffect(() => {
    session.start();
    return () => {
      session.end();
    };
  }, []);

  const handleRetry = async () => {
    await session.end();
    await session.start();
  };

  return (
    <SessionProvider session={session}>
      <div data-lk-theme="default" className="app">
        <header className="header">
          <h1>Tittu — Voice Agent</h1>
        </header>
        {!isSecureContext && (
          <div className="secure-context-banner" role="alert">
            <strong>Microphone not available:</strong> This page is not served over HTTPS.
            Browsers only allow microphone access on <code>https://</code> or <code>localhost</code>.
            <ul>
              <li><strong>Production:</strong> Serve this app over HTTPS (e.g. with a domain and SSL certificate).</li>
              <li><strong>Chrome testing only:</strong> Open <code>chrome://flags/#unsafely-treat-insecure-origin-as-secure</code>, add this page&apos;s URL (e.g. <code>http://YOUR_IP</code>), enable, then relaunch Chrome.</li>
            </ul>
          </div>
        )}
        <VoiceAgentView onRetry={handleRetry} />
        <ControlBar
          controls={{
            microphone: true,
            camera: false,
            screenShare: false,
          }}
        />
        <RoomAudioRenderer />
      </div>
    </SessionProvider>
  );
}

export default function App() {
  return <AppContent />;
}
