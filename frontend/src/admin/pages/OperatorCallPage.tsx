/**
 * Human handoff: operator joins an active V2V LiveKit room.
 * Reads callSessionId from query, fetches join token, connects to LiveKit.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Room } from 'livekit-client';
import { apiPost } from '../../api/client';
import { Mic, MicOff, PhoneOff } from 'lucide-react';

export function OperatorCallPage() {
  const [searchParams] = useSearchParams();
  const callSessionId = searchParams.get('callSessionId') ?? '';
  const [status, setStatus] = useState<'idle' | 'loading' | 'connected' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [micEnabled, setMicEnabled] = useState(false);
  const [room, setRoom] = useState<Room | null>(null);

  const connect = useCallback(async () => {
    if (!callSessionId.trim()) {
      setError('Missing callSessionId');
      setStatus('error');
      return;
    }
    setStatus('loading');
    setError(null);
    try {
      const res = await apiPost<{ livekitUrl: string; token: string; roomName: string }>(
        `/api/v1/call-sessions/${callSessionId}/join`,
        {}
      );
      const r = new Room();
      setRoom(r);
      await r.connect(res.livekitUrl, res.token);
      setStatus('connected');
      setMicEnabled(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join call');
      setStatus('error');
    }
  }, [callSessionId]);

  useEffect(() => {
    if (callSessionId && status === 'idle') connect();
  }, [callSessionId, status, connect]);

  const disconnect = useCallback(() => {
    if (room) {
      room.disconnect();
      setRoom(null);
    }
    setStatus('idle');
  }, [room]);

  const toggleMic = useCallback(async () => {
    if (!room) return;
    await room.localParticipant.setMicrophoneEnabled(!micEnabled);
    setMicEnabled(!micEnabled);
  }, [room, micEnabled]);

  useEffect(() => {
    return () => {
      room?.disconnect();
    };
  }, [room]);

  if (!callSessionId) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 text-center max-w-md">
          <p className="text-slate-400">Missing call session. Use &quot;Join call&quot; from Live Monitoring.</p>
          <Link to="/admin/live-events" className="mt-4 inline-block text-emerald-400 hover:underline text-sm">
            ← Live Monitoring
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 w-full max-w-md space-y-4">
        <h1 className="text-lg font-semibold text-white">Operator — Join call</h1>
        <p className="text-xs text-slate-500 font-mono truncate">{callSessionId}</p>

        {status === 'loading' && <p className="text-slate-400 text-sm">Getting token and connecting…</p>}
        {status === 'error' && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            {error}
            <button
              type="button"
              onClick={() => { setStatus('idle'); setError(null); }}
              className="mt-2 block text-amber-300 hover:underline"
            >
              Retry
            </button>
          </div>
        )}
        {status === 'connected' && (
          <div className="flex flex-col gap-3">
            <p className="text-emerald-400 text-sm font-medium">You are in the call</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={toggleMic}
                className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium ${
                  micEnabled ? 'bg-slate-700 text-slate-200' : 'bg-amber-600 text-white'
                }`}
              >
                {micEnabled ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                {micEnabled ? 'Mute' : 'Unmute'}
              </button>
              <button
                type="button"
                onClick={disconnect}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600/80 px-4 py-2 text-sm font-medium text-white hover:bg-red-600"
              >
                <PhoneOff className="h-4 w-4" />
                Leave
              </button>
            </div>
          </div>
        )}

        <Link to="/admin/live-events" className="inline-block text-sm text-slate-400 hover:text-slate-200">
          ← Live Monitoring
        </Link>
      </div>
    </div>
  );
}
