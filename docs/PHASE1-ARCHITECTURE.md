# Phase 1: Core Voice AI Platform Architecture

## Overview

Phase 1 establishes the core architecture for real-time voice interactions with a target of **&lt;500ms response time** from user speech to agent reply. The system uses a WebSocket-based voice streaming server, in-memory session management, and a discrete STT → LLM → TTS pipeline.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           BROWSER CLIENT                                     │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                   │
│  │ Microphone   │───▶│ AudioWorklet │───▶│ WebSocket    │───▶ Backend       │
│  │ (getUserMedia)│   │ 16kHz mono   │    │ (binary/JSON)│                   │
│  └──────────────┘    └──────────────┘    └──────────────┘                   │
│                                                      ▲                       │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    │              │
│  │ Speaker      │◀───│ AudioContext │◀───│ WebSocket    │◀───┘              │
│  │ (playback)   │    │ decode + play│    │ TTS audio    │                   │
│  └──────────────┘    └──────────────┘    └──────────────┘                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           BACKEND (Node.js + Fastify)                         │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    WebSocket Server (ws)                              │   │
│  │  • Upgrade HTTP → WS on /voice                                        │   │
│  │  • One connection = one agent session                                 │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                        │                                     │
│                                        ▼                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    Agent Session Manager                              │   │
│  │  • sessionId (UUID) per connection                                   │   │
│  │  • In-memory Map<sessionId, SessionState>                            │   │
│  │  • Concurrency control: one STT→LLM→TTS run per session at a time     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                        │                                     │
│                                        ▼                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    Audio Stream Handler                               │   │
│  │  • Receives PCM chunks (16kHz mono, base64 or binary)                 │   │
│  │  • Buffers until minimum duration (e.g. 400ms) or silence            │   │
│  │  • Triggers pipeline when ready                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                        │                                     │
│                                        ▼                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    STT → LLM → TTS Pipeline                           │   │
│  │                                                                       │   │
│  │   [PCM buffer] ──▶ STT (OpenAI Whisper) ──▶ transcript               │   │
│  │                        │                                              │   │
│  │                        ▼                                              │   │
│  │   transcript ──▶ LLM (OpenAI GPT) ──▶ reply text (streaming)         │   │
│  │                        │                                              │   │
│  │                        ▼                                              │   │
│  │   reply text ──▶ TTS (OpenAI) ──▶ MP3/audio chunks                    │   │
│  │                        │                                              │   │
│  │                        ▼                                              │   │
│  │   [audio] ──▶ WebSocket ──▶ client playback                          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Low-Latency Design (<500ms target)

| Concern | Approach |
|--------|----------|
| **Network** | WebSocket keeps one persistent connection; binary frames for audio to avoid base64 overhead when possible. |
| **Audio chunk size** | Client sends small chunks (e.g. 100–200ms). Server buffers and runs pipeline on ~400–800ms of speech to balance latency vs. accuracy. |
| **STT** | Phase 1 uses OpenAI Whisper on buffered chunks. Later phases can add Deepgram streaming for lower latency (start transcription before user stops speaking). |
| **LLM** | OpenAI Chat Completions with streaming; first token can drive “agent is speaking” and TTS can start on first sentence. |
| **TTS** | OpenAI TTS returns full audio; we stream the response to the client as soon as it’s available. Future: ElevenLabs streaming for sentence-by-sentence playback. |
| **Concurrency** | One active pipeline per session; new audio is queued or buffered until the current reply finishes, avoiding overlap and race conditions. |

---

## Message Protocol (WebSocket)

### Client → Server

| Type | Payload | Description |
|------|--------|-------------|
| `audio` | `{ base64: string }` or binary | PCM 16kHz mono 16-bit; client sends chunks every ~100ms. |
| `config` | `{ sampleRate?, language? }` | Optional; server may use for STT/TTS. |
| `ping` | — | Keepalive; server responds with `pong`. |

### Server → Client

| Type | Payload | Description |
|------|--------|-------------|
| `session` | `{ sessionId: string }` | Sent once after connection. |
| `transcript` | `{ text: string, isFinal?: boolean }` | STT result. |
| `agent_text` | `{ text: string }` | LLM reply (streaming). |
| `agent_audio` | `{ base64: string }` or binary | TTS audio chunk. |
| `error` | `{ message: string }` | Error message. |
| `pong` | — | Response to client `ping`. |

---

## Folder Structure (Phase 1)

```
voiceai/
├── docs/
│   └── PHASE1-ARCHITECTURE.md          # This file
├── backend/                             # Node.js voice backend
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env.example
│   └── src/
│       ├── index.ts                    # Fastify app + WebSocket upgrade
│       ├── config.ts                   # Env and config
│       ├── types.ts                    # Shared types
│       ├── ws/
│       │   ├── voice-ws-handler.ts     # WebSocket connection handler
│       │   ├── session-manager.ts      # In-memory session store
│       │   └── audio-stream-handler.ts # Buffer + trigger pipeline
│       └── pipeline/
│           ├── index.ts                # runPipeline(sessionId, pcmBuffer)
│           ├── stt.ts                  # OpenAI Whisper
│           ├── llm.ts                  # OpenAI Chat (streaming)
│           └── tts.ts                  # OpenAI TTS
├── frontend/                            # React + Vite (existing)
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   └── VoiceAgentPhase1.tsx    # WebSocket voice client for Phase 1
│   │   └── ...
│   └── ...
└── ...
```

---

## Technology Choices

- **Fastify**: Low-overhead HTTP server; easy WebSocket upgrade via `@fastify/websocket`.
- **ws**: Mature WebSocket library; works with Fastify.
- **OpenAI**: Single provider for STT (Whisper), LLM (GPT), and TTS to simplify keys and wiring.
- **In-memory sessions**: Phase 1 only; Phase 2+ will introduce Redis for horizontal scaling and persistence.

---

## Running Phase 1

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env
# Set OPENAI_API_KEY in .env
npm run dev
```

Server listens on `http://localhost:3000`; WebSocket endpoint: `ws://localhost:3000/voice`.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. The Vite dev server proxies `/voice` to the backend, so the client connects to the same origin and talks to the Node server.

To point the client at a different backend (e.g. production), set:

```bash
VITE_WS_VOICE_URL=wss://your-backend.example.com/voice
```

### 3. Test

1. Open the app in the browser (allow microphone when prompted).
2. Click **Connect** to open the WebSocket.
3. Click **Start mic** and speak.
4. After ~400 ms of speech, the backend runs STT → LLM → TTS; you see the transcript and agent text and hear the reply.

See `backend/README.md` for environment variables and options.
