# Voice AI Platform — Summary & Testing Guide

## Direction: V2V First, Pipeline Maintained

- **V2V (LiveKit)** is the primary path for new development. LiveKit provides real-time media, rooms, and a rich agent ecosystem; we will invest in V2V features, UX, and integrations.
- **Pipeline (STT → LLM → TTS over WebSocket)** remains supported and stable but is not planned for major new features. Use it where you need a simple, self-contained pipeline without LiveKit.

New capabilities (e.g. better turn-taking, multi-party, recording, analytics) will target V2V first. Pipeline stays as-is for backward compatibility and lightweight deployments.

---

## What We’ve Implemented (Overview)

### Core voice pipeline
- **WebSocket voice server** (`/voice`) — browser clients send PCM audio, receive TTS audio.
- **STT → LLM → TTS pipeline** — batch or streaming (Deepgram optional) STT, OpenAI LLM, OpenAI/ElevenLabs TTS.
- **Interruption (barge-in)** — stop agent playback when user speaks.
- **Two agent types**:
  - **Pipeline** — WebSocket; STT → LLM → TTS.
  - **V2V (Realtime)** — LiveKit room; realtime voice model (separate Python agent).

### Multi-tenant workspaces & auth
- **Workspaces** — each workspace has agents, knowledge bases, tools, calls, etc.
- **Users** — `email`, `passwordHash`, `workspaceId`, `role` (OWNER, ADMIN, MEMBER).
- **Auth** — `POST /api/v1/auth/register`, `POST /api/v1/auth/login`; JWT in `Authorization: Bearer`.
- **API keys** — workspace-scoped; same header for server-to-server.
- **All APIs** — scoped by `workspaceId` from JWT or API key.

### Agent & call management
- **Agents** — CRUD; config: system prompt, voice, STT/LLM/TTS providers, agent type (Pipeline vs V2V).
- **Calls** — start via `POST /api/v1/calls/start` (agentId, clientType); records in `calls` table linked to `call_sessions`.
- **Call history** — `GET /api/v1/calls`, `GET /api/v1/calls/:id`, events, messages.
- **Lifecycle events** — `call.started`, `call.connected`, `speech.detected`, `agent.reply`, `call.ended`, `usage.updated`; persisted and broadcast via WebSocket for live monitoring.

### Knowledge bases & RAG
- **Knowledge bases** — create, list; **documents** — upload PDF / text / URL.
- **Chunking + embeddings** — text chunked, embedded (OpenAI), stored in `document_chunks` (pgvector).
- **RAG at runtime** — if agent has a knowledge base, relevant chunks are retrieved and injected into the LLM context.

### Tools
- **Tools** — CRUD; types: WEBHOOK, HTTP_REQUEST, DATABASE_LOOKUP.
- **Agent–tool linking** — agents can have multiple tools.
- **Runtime** — LLM tool calls executed in pipeline (sync or async via queue).

### Telephony (optional)
- **SIP trunks** — provider config (e.g. Twilio, Plivo, Telnyx).
- **Phone numbers** — link to trunk and optional agent for inbound.
- **Inbound/outbound** — route inbound by number; outbound via `POST /api/v1/calls/outbound`.
- **Asterisk ARI** — optional for SIP/RTP (env-driven).

### Billing & usage
- **Plans** — `callMinutesLimit`, `tokenLimit`, `toolCallsLimit`, etc.
- **Workspace plans** — one active plan per workspace (e.g. Free tier).
- **Usage** — `workspace_usage` tracks `call_minutes`, `llm_tokens`, `stt_seconds`, `tts_seconds`, `tool_calls` per period.
- **Call start** — blocked if over plan limits (403).
- **Recording** — usage recorded when calls end (orchestrator + WebSocket handler).

### Analytics
- **GET /api/v1/analytics** — `totalCalls`, `successfulCalls`, `failedCalls`, `averageCallDuration`, `toolUsageCounts`, `tokenUsage`, `callsPerDay`.
- **Admin analytics page** — Recharts: calls per day, avg duration, tool usage, token trend.

### Production scaling (Redis + BullMQ)
- **Queues** — `voiceai:calls`, `voiceai:embeddings`, `voiceai:tools`, `voiceai:webhooks`, `voiceai:postcall`.
- **POST /api/v1/calls/start** — enqueues a job; worker starts pipeline or V2V session; API waits for result (or returns 202 + `jobId`).
- **Workers** (separate processes):
  - **voice-worker** — consumes call queue; starts session.
  - **embedding-worker** — generates embeddings for uploaded documents.
  - **tool-worker** — async tool execution.
  - **webhook-worker** — delivers webhook POSTs with HMAC signature.
- **Job status** — `GET /api/v1/jobs/:jobId` for polling when call start returns 202.

### Webhooks
- **Webhooks** — store `url`, `events[]`, `secret` per workspace.
- **Event bus** — on publish (e.g. `call.started`, `call.ended`, `tool.called`), matching webhooks get a job; worker POSTs body + `X-VoiceAI-Signature` (HMAC-SHA256).
- **APIs** — `POST/GET/DELETE /api/v1/webhooks`.
- **Admin** — `/admin/webhooks` to create/list/delete.

### Admin dashboard (React + Vite)
- **Auth** — `/login`, `/register`; protected `/admin/*` with redirect when no token.
- **Sections** — Dashboard, Agents, Knowledge Bases, Tools, Web Call, Call History, Live Events, SIP Trunks, Phone Numbers, Outbound Calls, Billing, Usage, Analytics, Workspace, Team, API Keys, Webhooks, Settings.
- **Web Call** — select agent, start call; connects via WebSocket (pipeline) or LiveKit (V2V); job polling if 202.

### Node.js SDK (`voiceai-sdk`)
- **Package** — `voiceai-sdk` in repo; `new VoiceAI({ apiKey, baseUrl })`.
- **Methods** — `calls.start()`, `calls.get()`, `agents.list()`, `agents.create()`, `knowledge.upload()`, `webhooks.verifySignature()`.
- **Auth** — `Authorization: Bearer <apiKey>`.
- **Publish-ready** — TypeScript, typings in `dist/`.

---

## How to Run the Platform

### 1. Prerequisites
- **Node.js** ≥ 18  
- **PostgreSQL** (e.g. 15+)  
- **Redis** (for rate limiting, queues, workers)  
- **OpenAI API key** (required for STT/LLM/TTS/embeddings)  
- **(Optional)** Deepgram API key for streaming STT  
- **(Optional)** LiveKit URL + API key + secret for V2V agents  
- **(Optional)** Asterisk + ARI for SIP telephony  

### 2. Backend
```bash
cd backend
cp .env.example .env
# Edit .env: DATABASE_URL, OPENAI_API_KEY, REDIS_URL (e.g. redis://127.0.0.1:6379)
npm install
npx prisma generate
npx prisma migrate deploy   # or migrate dev for new migrations
npm run dev                 # HTTP + WebSocket on PORT (default 3000)
```

### 3. Frontend
```bash
cd frontend
npm install
npm run dev                 # Vite dev server (e.g. http://localhost:5173)
```

### 4. Workers (for queue-based call start, embeddings, webhooks)
Run in **separate terminals** (same machine or different):

```bash
cd backend
# Required for call start via queue (POST /calls/start enqueues; worker starts session)
npm run worker:voice

# Optional: for KB uploads to generate embeddings in background
npm run worker:embedding

# Optional: async tool execution
npm run worker:tools

# Optional: webhook delivery
npm run worker:webhooks

# Optional: post-call tasks (e.g. transcript compact)
npm run worker:postcall
```

If **no workers** are running, `POST /api/v1/calls/start` may return **202** with `jobId`; the frontend then polls `GET /api/v1/jobs/:jobId` until the job completes (or you can run the voice worker so the API gets a result within the wait window).

### 5. Environment variables (backend `.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `OPENAI_API_KEY` | Yes | OpenAI API key |
| `REDIS_URL` | Yes (for queues/workers) | e.g. `redis://127.0.0.1:6379` |
| `JWT_SECRET` | Yes (production) | Secret for signing JWTs |
| `PORT` | No | Default 3000 |
| `DEEPGRAM_API_KEY` | No | Enables streaming STT |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | For V2V | LiveKit server and credentials |
| `LIVEKIT_PUBLIC_URL` | No | Public URL for browser (e.g. behind proxy) |

---

## How to Test the Platform

### A. Full stack (browser)
1. Start **PostgreSQL** and **Redis**.
2. Start **backend**: `cd backend && npm run dev`.
3. Start **voice worker**: `cd backend && npm run worker:voice` (so call start succeeds without 202).
4. Start **frontend**: `cd frontend && npm run dev`.
5. Open **http://localhost:5173**.
6. **Register** at `/register` (workspace name + email + password).
7. **Log in** at `/login` if needed.
8. Go to **Agents** → create a Pipeline agent (name, prompt, voice).
9. Go to **Web Call** → select the agent → **Start call** → allow mic → speak; you should hear the TTS reply.
10. **Call History** and **Live Events** should show the call and events.

### B. API with curl (after registering)
1. Get a JWT:  
   `curl -X POST http://localhost:3000/api/v1/auth/login -H "Content-Type: application/json" -d '{"email":"you@example.com","password":"yourpassword"}'`
2. Use the returned `token` in further requests:  
   `curl -H "Authorization: Bearer <token>" http://localhost:3000/api/v1/agents?limit=10`
3. Start a call:  
   `curl -X POST http://localhost:3000/api/v1/calls/start -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d '{"agentId":"<agent-uuid>","clientType":"BROWSER"}'`  
   You get either a session payload (wsUrl, callSessionId, etc.) or 202 with `jobId` for polling.

### C. Job polling (when call start returns 202)
1. `POST /api/v1/calls/start` returns `{ "message": "Call start queued", "callId": "...", "jobId": "..." }`.
2. Poll `GET /api/v1/jobs/:jobId` every 1–2 seconds.
3. When `status === "completed"`, use `result` as the call session (same shape as 201 response); connect frontend to WebSocket or LiveKit using that payload.

### D. SDK
```bash
cd voiceai-sdk
npm run build
# In your app or a small script:
node -e "
const { VoiceAI } = require('./dist/index.js');
const v = new VoiceAI({ apiKey: 'your-api-key', baseUrl: 'http://localhost:3000' });
v.agents.list().then(r => console.log(r.items.length));
v.calls.start({ agentId: '...' }).then(r => console.log(r));
"
```
Use **API key** from **Admin → API Keys** (create one in the UI).

### E. Webhooks
1. In **Admin → Webhooks**, add a URL (e.g. https://webhook.site/…) and select events (`call.started`, `call.ended`, etc.).
2. Copy the **secret** (shown once).
3. Run the **webhook worker**: `npm run worker:webhooks` in `backend`.
4. Trigger a call; your URL should receive POSTs with `X-VoiceAI-Signature`.
5. Verify in code: `voiceai.webhooks.verifySignature({ secret, payload: rawBody, signature })`.

### F. Billing & usage
- **Admin → Billing** — current plan and usage vs limits.
- **Admin → Usage** — metrics for the period.
- Exceed plan limits (e.g. use up Free tier call minutes) and try starting a call; you should get **403** with a message.

### G. Analytics
- **Admin → Analytics** — choose 7/14/30 days; see calls per day, average duration, tool usage, token trend (data appears after calls and usage are recorded).

---

## Quick reference: main URLs & scripts

| What | URL / command |
|------|----------------|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:3000 |
| Register | http://localhost:5173/register |
| Login | http://localhost:5173/login |
| Admin dashboard | http://localhost:5173/admin |
| Web Call | http://localhost:5173/admin/web-call |
| Backend dev | `cd backend && npm run dev` |
| Voice worker | `cd backend && npm run worker:voice` |
| Embedding worker | `cd backend && npm run worker:embedding` |
| Webhook worker | `cd backend && npm run worker:webhooks` |
| SDK build | `cd voiceai-sdk && npm run build` |

---

## Minimal test (no workers)
- Start backend + frontend only (Redis + DB required).
- Register and log in.
- Create an agent.
- **Without** the voice worker, **Start call** may return 202; the UI will poll `GET /api/v1/jobs/:jobId`. For a real connection you still need the **voice worker** so the job completes and the client gets `wsUrl` / LiveKit credentials.

This document is the single place to see what’s implemented and how to run and test the Voice AI platform end-to-end.
