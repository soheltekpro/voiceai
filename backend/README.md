# Voice AI Backend (Phase 1)

Node.js WebSocket voice streaming server and STT → LLM → TTS pipeline.

## Requirements

- Node.js 18+
- OpenAI API key

## Setup

```bash
cd backend
npm install
cp .env.example .env
# Edit .env and set OPENAI_API_KEY=sk-...
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP and WebSocket server port |
| `HOST` | `0.0.0.0` | Bind address |
| `NODE_ENV` | `development` | Environment |
| `OPENAI_API_KEY` | (required) | OpenAI API key for Whisper, GPT, TTS |
| `STT_MODEL` | `whisper-1` | Whisper model (batch mode) |
| `LLM_MODEL` | `gpt-4o-mini` | Chat model |
| `TTS_MODEL` | `tts-1` | TTS model |
| `TTS_VOICE` | `alloy` | TTS voice |
| `MIN_AUDIO_MS` | `1800` | Min buffered audio (ms) before STT; use 1500–2500 for full phrases |
| `MAX_BUFFER_MS` | `4000` | Max buffer size (ms) |
| **Phase 2 (real-time)** | | |
| `DEEPGRAM_API_KEY` | — | If set, streaming STT is used (Deepgram live) |
| `DEEPGRAM_MODEL` | `nova-2` | Deepgram model |
| `DEEPGRAM_LANGUAGE` | `en` | Language code |

## Run

**Development (watch):**

```bash
npm run dev
```

**Production:**

```bash
npm run build
npm start
```

- HTTP: `http://localhost:3000`
- Health: `GET /health`
- WebSocket voice: `ws://localhost:3000/voice`

## Architecture

- **Phase 1**: [docs/PHASE1-ARCHITECTURE.md](../docs/PHASE1-ARCHITECTURE.md) — batch STT → LLM → TTS.
- **Phase 2**: [docs/PHASE2-REALTIME-PIPELINE.md](../docs/PHASE2-REALTIME-PIPELINE.md) — streaming STT (Deepgram), VAD, streaming LLM/TTS, barge-in. Set `DEEPGRAM_API_KEY` to enable.
