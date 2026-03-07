# Phase 3: Agent Management System

## What you get in Phase 3

- **Database schema (PostgreSQL via Prisma)**:
  - `agents`
  - `agent_settings`
  - `call_sessions`
  - `call_events`
- **REST APIs** (`/api/v1/*` on the Node backend)
  - CRUD for voice agents
  - Upsert for agent settings
  - Call session list + per-session events
- **Admin dashboard UI** (`/admin`)
  - Create/edit agents and settings (system prompt, voice, language, max duration, interruption)
  - View call sessions and event timelines
- **Live session wiring**
  - WebSocket `config` can include `agentId` and `clientType`
  - Server loads `agent_settings` and applies: system prompt, voice name, language, max duration, interruption behavior
  - Server persists `call_sessions` + `call_events`

---

## DB schema

Defined in `backend/prisma/schema.prisma`.

### Tables

- **`agents`**
  - `id` (uuid)
  - `name`, `description`
  - timestamps
- **`agent_settings`** (1:1 with agent)
  - `agentId` (unique FK)
  - `systemPrompt`
  - `voiceProvider`, `voiceName`
  - `language`
  - `maxCallDurationSeconds`
  - `interruptionBehavior`
- **`call_sessions`**
  - optional `agentId` FK
  - `clientType`, `status`, `startedAt`, `endedAt`, `metadata`
- **`call_events`**
  - `sessionId` FK
  - `type`, `timestamp`, `payload`

---

## REST APIs (Node backend)

Base URL: `/api/v1`

### Agents

- `GET /api/v1/agents`
- `POST /api/v1/agents`
- `GET /api/v1/agents/:id`
- `PATCH /api/v1/agents/:id`
- `DELETE /api/v1/agents/:id`

### Agent settings

- `GET /api/v1/agents/:id/settings`
- `PUT /api/v1/agents/:id/settings`

### Call history

- `GET /api/v1/call-sessions`
- `GET /api/v1/call-sessions/:id`
- `GET /api/v1/call-sessions/:id/events`

---

## WebSocket config (how the voice session picks an agent)

Client sends (after connect):

```json
{
  "type": "config",
  "payload": {
    "sampleRate": 48000,
    "agentId": "uuid-of-agent",
    "clientType": "BROWSER"
  }
}
```

If `agentId` is set, the backend loads `agent_settings` and applies:
- **system prompt** → LLM
- **voiceName** → TTS
- **language** → streaming STT language
- **maxCallDurationSeconds** → server closes WS after this duration
- **interruptionBehavior** → whether `interrupt` stops the agent

---

## Environment variables

Backend (`backend/.env`):

```bash
PORT=3000
HOST=0.0.0.0
NODE_ENV=development

DATABASE_URL=postgresql://postgres:postgres@localhost:5432/voiceai?schema=public

OPENAI_API_KEY=sk-...

# Optional (Phase 2+3 real-time)
DEEPGRAM_API_KEY=...
DEEPGRAM_MODEL=nova-2
DEEPGRAM_LANGUAGE=en
```

---

## How to run Phase 3

### 1) Start Postgres

Run PostgreSQL locally (Docker or native). Example Docker command:

```bash
docker run --name voiceai-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=voiceai -p 5432:5432 -d postgres:16
```

Then set `DATABASE_URL` in `backend/.env`.

### 2) Run migrations + generate client

```bash
cd backend
npm run db:generate
npm run db:migrate
```

### 3) Run backend + frontend

```bash
cd backend
npm run dev

cd ../frontend
npm run dev
```

- Voice test UI: `http://localhost:5173/`
- Admin dashboard: `http://localhost:5173/admin`

