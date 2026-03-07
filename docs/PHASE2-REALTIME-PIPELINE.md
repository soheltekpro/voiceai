# Phase 2: Real-Time Voice Pipeline

## Overview

Phase 2 implements a **streaming** voice pipeline: audio is streamed to speech-to-text, end-of-speech is detected (VAD), the transcript is sent to the LLM with streaming response, and the reply is converted to speech and streamed back. **Barge-in** (interruption) is supported so the user can interrupt the agent.

---

## Streaming Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  CLIENT (Browser)                                                                │
│  Mic → PCM chunks (e.g. 20ms) ──WebSocket──▶ Backend                             │
│  ◀──WebSocket── TTS audio chunks + transcript + agent text                       │
│  On interrupt: send "interrupt" → client stops playback on "agent_stopped"        │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  BACKEND                                                                          │
│                                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────────────┐ │
│  │  Session state: IDLE | LISTENING | PROCESSING                              │ │
│  │  • IDLE: ready for audio                                                    │ │
│  │  • LISTENING: streaming audio → STT, collecting transcript                  │ │
│  │  • PROCESSING: LLM + TTS running (can be aborted on interrupt)                │ │
│  └─────────────────────────────────────────────────────────────────────────────┘ │
│                                        │                                         │
│  ┌─────────────────────────────────────▼───────────────────────────────────────┐ │
│  │  Audio In → [Streaming STT] → partial + final transcripts                    │ │
│  │                    │                                                        │ │
│  │                    │ (on speech_final / utterance end)                       │ │
│  │                    ▼                                                        │ │
│  │  [Streaming LLM] → text deltas → [Streaming TTS] (sentence-by-sentence)     │ │
│  │                    │                    │                                     │ │
│  │                    │                    ▼                                     │ │
│  │                    │             Audio chunks ──▶ Client                       │ │
│  └─────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                   │
│  Interrupt: client sends "interrupt" or new speech → abort PROCESSING,           │
│             send agent_stopped, transition to LISTENING/IDLE                      │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## WebSocket Event Schema (Phase 2)

### Client → Server

| Type        | Payload                    | Description                                      |
|------------|----------------------------|--------------------------------------------------|
| `audio`    | `{ base64: string }`       | PCM chunk (16-bit mono); send every ~20–100 ms  |
| `audio_binary` | (binary frame)          | Raw PCM; alternative to `audio` base64            |
| `config`   | `{ sampleRate?, language? }` | Session config; send once after connect       |
| `interrupt`| `{}`                      | User barge-in: stop agent, cancel current reply  |
| `ping`     | `{}`                      | Keepalive; server responds `pong`                |

### Server → Client

| Type                 | Payload                         | Description                                  |
|----------------------|----------------------------------|----------------------------------------------|
| `session`            | `{ sessionId: string }`         | Sent once after connect                      |
| `transcript_partial` | `{ text: string }`              | Streaming STT partial (interim)              |
| `transcript_final`   | `{ text: string }`              | Final transcript for current utterance        |
| `agent_text_delta`   | `{ text: string }`              | Streaming LLM token chunk                     |
| `agent_audio_start`  | `{}`                            | Agent reply audio is starting                 |
| `agent_audio_chunk`  | `{ base64: string }`            | TTS audio chunk (play in order)               |
| `agent_audio_end`    | `{}`                            | Agent reply audio finished                    |
| `agent_stopped`      | `{}`                            | Barge-in: stop playback, discard remaining    |
| `error`              | `{ message: string }`           | Error message                                 |
| `pong`               | `{}`                            | Response to ping                             |

---

## Latency Optimization

| Layer        | Approach                                                                 |
|-------------|----------------------------------------------------------------------------|
| **Network** | Binary WebSocket frames for audio when possible; small chunks (20–40 ms). |
| **STT**     | Streaming STT (Deepgram) so we get partials immediately; no wait for EOU.   |
| **VAD**     | Use provider’s `speech_final` / utterance end; avoid extra round-trips.    |
| **LLM**     | Stream tokens; client can show “agent is typing” and TTS can start early. |
| **TTS**     | Sentence-by-sentence: split LLM stream on `.` `!` `?`, synthesize each, stream so first audio plays before full reply is ready. |
| **Playback**| Client plays chunks as they arrive; no need to buffer full reply.         |

---

## Interruption Handling (Barge-In)

1. **Client**  
   - When the user starts speaking (or presses a “stop” button), send `interrupt`.  
   - On `agent_stopped`, stop playback, clear any queued TTS, and optionally show “Interrupted”.

2. **Server**  
   - On `interrupt` (or when starting a new utterance while in PROCESSING):  
     - Set session state to LISTENING/IDLE.  
     - Abort in-flight LLM stream and TTS (e.g. AbortController).  
     - Send `agent_stopped` to the client.  
     - Optionally ignore or reuse any in-flight STT for the new utterance.

3. **Concurrency**  
   - Only one PROCESSING run per session; new audio during PROCESSING either triggers interrupt (barge-in) or is buffered for the next turn, depending on product behavior.

---

## Implementation Notes

- **Streaming STT**: Deepgram live API; forward client PCM (resampled to 16 kHz if needed) to Deepgram; map `is_final` / `speech_final` to `transcript_final`.
- **VAD**: Use Deepgram’s `speech_final` (or equivalent) as “user stopped speaking” to start LLM.
- **Streaming TTS**: Accumulate LLM stream, split on sentence boundaries, call TTS per sentence, send `agent_audio_chunk` for each; support abort on interrupt.
- **Abort**: Use `AbortController` for LLM fetch and custom abort signal for pipeline; on `interrupt`, abort and send `agent_stopped`.

## Enabling Phase 2 (real-time pipeline)

Set `DEEPGRAM_API_KEY` in `backend/.env`. The server will use streaming STT and the real-time pipeline. Without it, the server falls back to Phase 1 (buffered Whisper + batch pipeline).
