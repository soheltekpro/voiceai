# Phase 10: Unified Call Monitoring

Unified call monitoring for **pipeline** and **v2v** agents: central event bus, live events, call history, and usage tracking.

## Central event bus

All engines emit to the same system:

- **Backend**: `persistAndPublish(callSessionId, eventName, payload)` writes to the DB and publishes to `callEventBus`.
- **Pipeline**: voice WS handler and pipeline engine call `persistAndPublish` for lifecycle and transcript/agent events.
- **V2V**: frontend reports `call.connected`, `call.ended`, and optionally `usage.updated` via **POST /api/v1/calls/:callSessionId/events**; backend publishes to the same bus.

Events are persisted (call_events) and broadcast to WebSocket subscribers.

## Live events WebSocket

- **Endpoint**: `GET /events` (WebSocket).
- **Subscribe to one call**: send `{ "type": "subscribe", "callSessionId": "<uuid>" }`.
- **Subscribe to all events** (monitoring dashboard): send `{ "type": "subscribe", "callSessionId": "*" }`.
- **Messages**: `{ "type": "event", "evt": { "id", "callSessionId", "name", "ts", "payload" } }`.

## Event types (both agent types)

- `call.started` – call/session created  
- `call.connected` – client connected to room/WS  
- `speech.detected` – user speech (partial/final)  
- `transcription.completed` – final transcript  
- `ai.response.generated` / `agent.reply` – agent reply  
- `audio.played` – audio chunk sent (pipeline)  
- `call.ended` – call ended  
- `usage.updated` – token/usage update (payload: `inputTokens`, `outputTokens`, `durationSeconds`, `estimatedCostUsd`)

## Usage tracking

- **CallSession** fields: `durationSeconds`, `estimatedCostUsd`, `inputTokens`, `outputTokens`.
- **Pipeline**: duration and cost are set in `finalizeCallSession` and by `recordAssistantMessage`.
- **V2V**: frontend can POST **usage.updated** with token/cost when the LiveKit agent sends room data (e.g. topic `voice-usage`). The voice client listens for that and reports to the backend.

## APIs

- **POST /api/v1/calls/:callSessionId/events**  
  Body: `{ "event": "call.connected" | "speech.detected" | "agent.reply" | "call.ended" | "usage.updated", "payload": { ... } }`.  
  For `usage.updated`, payload may include `inputTokens`, `outputTokens`, `durationSeconds`, `estimatedCostUsd`.  
  For `call.ended`, session is set to ENDED and analytics finalized.

- **GET /api/v1/analytics/summary**  
  Query: `from`, `to`, `agentId` (optional).  
  Returns: `calls`, `ended`, `active`, `error`, `totalDurationSeconds`, `totalEstimatedCostUsd`, `totalInputTokens`, `totalOutputTokens`.

## Frontend dashboard

**Admin → Monitoring** (`/admin/monitoring`):

1. **Usage analytics** – cards for calls, duration, cost, input/output tokens, ended/error.
2. **Live events timeline** – stream of all events (subscribe with `callSessionId: '*'`), last 150 events.
3. **Call history table** – recent sessions with link to **View · Transcript** (session detail with timeline + transcript).

Call session detail (`/admin/calls/:id`) already shows timeline (historical + live for that call) and transcript.

## Database

- **call_sessions**: added `inputTokens`, `outputTokens` (nullable int).
- **call_events**: added type `USAGE_UPDATED` for usage.updated.

Run migrations (or `prisma db push`) after pulling Phase 10.
