import { useCallback, useRef, useState } from 'react';
import { StreamingAudioPlayer } from '../lib/StreamingAudioPlayer';

/**
 * React hook for gapless streaming TTS playback (exact-timing queue).
 * Resumes AudioContext on first interaction to satisfy autoplay policy.
 */
export function useStreamingAudioPlayer() {
  const playerRef = useRef<StreamingAudioPlayer | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const [resumed, setResumed] = useState(false);

  const ensureContext = useCallback((): AudioContext => {
    if (contextRef.current?.state !== 'closed') {
      return contextRef.current!;
    }
    const ctx = new AudioContext();
    contextRef.current = ctx;
    playerRef.current = new StreamingAudioPlayer(ctx);
    return ctx;
  }, []);

  const playChunk = useCallback((base64: string) => {
    const ctx = ensureContext();
    if (ctx.state === 'suspended') {
      ctx.resume().then(() => {
        setResumed(true);
        playerRef.current ??= new StreamingAudioPlayer(ctx);
        playerRef.current.playChunk(base64);
      });
    } else {
      playerRef.current ??= new StreamingAudioPlayer(ctx);
      playerRef.current.playChunk(base64);
    }
  }, [ensureContext]);

  const stop = useCallback(() => {
    playerRef.current?.stop();
  }, []);

  const reset = useCallback(() => {
    const ctx = contextRef.current;
    if (ctx?.state !== 'closed') {
      if (ctx?.state === 'suspended') {
        ctx.resume().then(() => setResumed(true));
      }
      playerRef.current ??= ctx ? new StreamingAudioPlayer(ctx) : null;
      playerRef.current?.reset();
    } else {
      const newCtx = new AudioContext();
      contextRef.current = newCtx;
      playerRef.current = new StreamingAudioPlayer(newCtx);
    }
  }, []);

  const getContext = useCallback((): AudioContext | null => {
    return contextRef.current?.state !== 'closed' ? contextRef.current : null;
  }, []);

  return { playChunk, stop, reset, getContext, resumed };
}
