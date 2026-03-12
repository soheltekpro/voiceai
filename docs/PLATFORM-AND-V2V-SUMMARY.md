# Voice AI Platform & V2V Pipeline Summary

## Platform overview

This repo is a **Voice AI platform** (similar in scope to Vapi / Retell / Bland AI) that supports:

- **V2V (Voice-to-Voice) agents** – real-time speech-to-speech via LiveKit + a single realtime model (OpenAI Realtime or Google Gemini Live). One pipeline handles listening and speaking with low latency.
- **Pipeline agents** – classic STT → LLM → TTS over WebSocket (Node.js). Currently “coming soon” in the UI.
- **Admin dashboard** – agents, knowledge bases, call history, analytics, API keys.
- **Telephony** – optional Asterisk/SIP for phone calls (backend only; UI items can be hidden).

**Main pieces:**

| Component | Role |
|-----------|------|
| **Frontend** (React, Vite) | Admin UI, Web Call (test) page. For V2V: connects to LiveKit via WebRTC, sends lifecycle events to backend. |
| **Backend** (Node.js, Fastify) | REST API, DB (Prisma/PostgreSQL), call orchestration, RAG, event persistence, usage/cost, call history. |
| **LiveKit server** | WebRTC/SIP room server. Routes audio/video and dispatches workers. |
| **Python agent** (`agent.py`) | LiveKit worker: joins rooms, runs the V2V session (realtime model + VAD + RAG + compaction). |
| **Token server** (optional) | Serves LiveKit tokens for the frontend; can be merged with backend in production. |

---

## V2V (Voice-to-Voice) pipeline end-to-end

### 1. Call start (backend → LiveKit → agent)

1. **Frontend** calls `POST /api/v1/calls/start` with `{ agentId, clientType: "BROWSER" }`.
2. **Backend** (call-orchestrator + voice-worker):
   - Loads agent; if `agentType === 'V2V'` uses **RealtimeEngine**.
   - Creates **Call** and **CallSession** in DB.
   - **RealtimeEngine**:
     - Generates `roomName` (`voice-room-<uuid>`), user `identity`.
     - Loads agent config: `systemPrompt`, `knowledgeBaseId`, `v2vProvider`, `v2vModel`, `v2vVoice`, optional `openingLine`.
     - Creates **CallSession** with `metadata` (session config).
     - Builds **dispatch metadata** (JSON): `callSessionId`, `agentId`, `knowledgeBaseId`, `systemPrompt`, `openingLine`, `v2vProvider`, `v2vModel`, `v2vVoice`.
     - Creates **LiveKit AccessToken** for the user (room join).
     - **AgentDispatch**: `createDispatch(roomName, "realtime-voice-agent", { metadata })` so the Python worker is assigned to the room with that metadata.
     - Persists/publishes `call.started` with `roomName`, `engine: 'v2v'`.
   - Returns to frontend: `callSessionId`, `roomName`, `livekitUrl`, `livekitToken`, `agentType: 'V2V'`.

### 2. Frontend connects to LiveKit

1. **Frontend** (e.g. `VoiceAgentPhase1.tsx`):
   - `Room.connect(livekitUrl, livekitToken)`.
   - On connect: `POST /api/v1/calls/:callSessionId/events` with `event: 'call.connected'`.
   - Publishes room data (e.g. usage) when the agent sends it.
2. **LiveKit server** creates the room; the **Python agent** is dispatched (job request with room name and dispatch metadata).

### 3. Python agent: session setup

1. **Worker** receives job; `entrypoint(ctx)` runs.
2. **Job/room metadata** is parsed: `callSessionId`, `systemPrompt`, `knowledgeBaseId`, `v2vProvider`, `v2vModel`, `v2vVoice`, `openingLine`.
3. **Realtime model** is created:
   - **OpenAI**: `openai.realtime.RealtimeModel(model, voice)`.
   - **Google**: `google.realtime.RealtimeModel(model, voice, instructions, language, temperature, conn_options)` (e.g. `gemini-2.5-flash-native-audio-preview-12-2025`).
4. **VAD**: Silero VAD (loaded per process).
5. **AgentSession** is created with:
   - `llm` = realtime model, `vad`, `userdata: { callSessionId }`,
   - `min_interruption_duration=0.3`, `preemptive_generation=True`.
6. **Assistant** agent with `base_instructions` = agent’s system prompt.
7. **RAG**: If `knowledgeBaseId` is set, `retrieve_rag_chunks` calls backend `POST /api/v1/rag/retrieve`; results are stored in `rag_memory` and injected at the start of the next turn via `update_instructions` (never blocks reply).
8. **Session start**: `session.start(room=ctx.room, agent=assistant)`; then one-off `generate_reply()` for the greeting (Gemini doesn’t auto-start).
9. **Conversation compaction** (background): every 15s trim history to last 8 turns; every 60s summarize older turns and keep last 6; sync trimmed context to realtime session so latency stays stable.

### 4. During the call: audio and events

- **User speaks** → LiveKit sends mic audio into the room.
- **AgentSession** (with TranscriptSynchronizer + RoomIO) sends audio to the **realtime model** (OpenAI or Gemini).
- **Realtime model**:
  - Handles **STT + LLM + TTS** in one stream (no separate STT/LLM/TTS services).
  - With `preemptive_generation=True`, the framework triggers `generate_reply()` on partial user speech; we do **not** call `generate_reply()` from our partial trigger to avoid double-trigger and timeouts.
- **Agent** emits:
  - **Transcripts**: on `user_input_transcribed` we send `transcript.partial` / `transcript.final` to backend via `POST /api/v1/calls/:callSessionId/events`.
  - **RAG**: on `transcript.final` we run `run_rag_async` in the background and inject stored RAG at the next turn start.
  - **Usage**: on `metrics_collected` we accumulate tokens and periodically send `usage.updated` (inputTokens, outputTokens, durationSeconds) to the backend.
- **Interruption**: only in `user_state_changed`: if user becomes “speaking” while agent is speaking, we call `session.interrupt()` and reset `early_reply_triggered` and partial timestamp so the next turn can trigger again.
- **Turn state**: when agent state becomes `idle`, we reset `early_reply_triggered` and partial trigger timestamp so we don’t repeat or block the next reply.

### 5. Shutdown and cost

- On **room disconnect** (user leaves), the agent’s shutdown callback runs:
  - Sends final **usage** (room data + `usage.updated` to backend).
- **Frontend** sends `call.ended` to backend.
- **Backend** finalizes **CallSession** (duration, status); **Call** is updated with `callSessionId`, `endedAt`. Cost is derived from **CallSession** (and linked usage/tokens) and shown in call history and analytics.

---

## Data flow (V2V)

```
[Browser]  →  Mic  →  LiveKit (WebRTC)  →  Python agent (RoomIO)
                                                      ↓
                        Realtime model (OpenAI / Gemini Live): audio in → text + reasoning → audio out
                                                      ↓
[Browser]  ←  Speaker  ←  LiveKit  ←  AgentSession (RoomIO)
```

**Backend events (POST /api/v1/calls/:id/events):**

- From **frontend**: `call.connected`, `call.ended`.
- From **agent** (via `send_voiceai_event`): `transcript.partial`, `transcript.final`, `usage.updated` (and any custom events). These are persisted as **CallEvent** and drive transcripts, cost, and monitoring.

---

## Key files (V2V)

| Layer | File(s) | Purpose |
|-------|---------|--------|
| Backend – start | `backend/src/api/routes/call-orchestrator.ts` | POST /calls/start; enqueues job. |
| Backend – worker | `backend/src/workers/voice-worker.ts` | Runs job; calls AgentOrchestrator.startCall. |
| Backend – V2V | `backend/src/services/realtime-engine.ts` | Room + token + dispatch metadata; RealtimeStartResult. |
| Backend – events | `backend/src/api/routes/call-orchestrator.ts` (events), `persistAndPublish` | Receive and persist call events. |
| Backend – RAG | `backend/src/api/routes/rag.ts`, `knowledge-retrieval` | POST /rag/retrieve for agent RAG. |
| Agent | `agent.py` | LiveKit rtc_session; AgentSession; realtime LLM; RAG; compaction; usage; event publishing. |
| Frontend | `frontend/src/components/VoiceAgentPhase1.tsx` | Start call, connect to LiveKit, report call.connected / call.ended. |

---

## Configuration (V2V)

- **Agent (DB)**: `agentType: 'V2V'`, `systemPrompt`, `knowledgeBaseId`, `v2vProvider`, `v2vModel`, `v2vVoice`.
- **Backend env**: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, optional `LIVEKIT_PUBLIC_URL`.
- **Agent env**: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `AI_PROVIDER` (OPENAI/GEMINI), `OPENAI_API_KEY` / `GOOGLE_API_KEY`; optional `VOICEAI_API_URL`, `VOICEAI_API_TOKEN` for RAG and event publishing.

---

## What we do *not* change in the pipeline

- RAG retrieval and injection (backend + agent contract).
- Conversation compaction (trim + summarize + sync to realtime session).
- Metrics collection and usage tracking (UsageCollector, usage.updated).
- Backend event publishing (persistAndPublish, POST /calls/:id/events).
- Realtime model initialization (provider/model/voice from agent config).
- System prompt and assistant instructions handling.
- LiveKit session and VAD configuration (except where explicitly needed for latency/turn fixes).

This document is the single reference for the **platform overview** and the **V2V whole pipeline** from call start to cost and events.
