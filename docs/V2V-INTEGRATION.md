# V2V Agent Integration Guide

This document describes how the **Python LiveKit V2V agent** can integrate with the Node backend for RAG, transcript streaming, recording, and human handoff.

## 1. V2V RAG Integration (implemented)

**Backend:** When starting a V2V call, the backend loads the agent’s `knowledgeBaseId` from `agent_settings` and passes it in the LiveKit dispatch metadata (`callSessionId`, `agentId`, `knowledgeBaseId`). The Python agent reads this and enables RAG for the session.

**Backend API:** `POST /api/v1/rag/retrieve`  
**Auth:** `Authorization: Bearer <api_key>`

**Request:**
```json
{
  "knowledgeBaseId": "uuid",
  "query": "user transcript or question",
  "limit": 5
}
```

**Response:**
```json
{
  "chunks": [
    { "content": "...", "documentId": "uuid", "score": 0.92 }
  ]
}
```

**Python agent (agent.py):**
1. Parses job/room metadata for `knowledgeBaseId`. If missing, RAG is skipped.
2. Subscribes to `user_input_transcribed`. When `is_final` is true, calls `POST /api/v1/rag/retrieve` with the transcript (using `VOICEAI_API_URL` and `VOICEAI_API_KEY`).
3. On success, builds context from `chunks` and calls `session.update_instructions(base_instructions + knowledge_block)` so the next reply uses the KB.
4. On failure or timeout, continues without RAG. Logs "Using RAG context" or "No RAG context found".

**Env (Python agent):**
- `VOICEAI_API_URL` – backend base URL (default `http://127.0.0.1:3000`).
- `VOICEAI_API_KEY` – workspace API key (or JWT) for `Authorization: Bearer`. Required for RAG.

---

## 2. Realtime Transcript Streaming

**Backend API:** `POST /api/v1/calls/:callSessionId/events`  
**Auth:** `Authorization: Bearer <jwt_or_api_key>`

**Body:**
```json
{
  "event": "transcript.partial" | "transcript.final" | "agent.speaking" | "agent.finished",
  "payload": {
    "text": "...",
    "timestamp": 1234567890
  }
}
```

**Python agent (agent.py) — implemented:**
- Subscribes to LiveKit `user_input_transcribed`. For each event sends `transcript.partial` (when `is_final` is false) or `transcript.final` (when `is_final` is true) with `payload: { text, timestamp }` via `send_voiceai_event()`.
- Before the initial `generate_reply()` (greeting), sends `agent.speaking`; when the returned `SpeechHandle` completes, sends `agent.finished`.
- Uses `callSessionId` from job/room metadata (backend includes it in dispatch metadata). Requires `VOICEAI_API_URL` and `VOICEAI_API_KEY` so the agent can POST to `POST /api/v1/calls/{callSessionId}/events`.

The backend persists these to `call_events` and broadcasts to `/api/v1/events/stream`. The Live Monitoring UI and Call Session Detail transcript tab show them.

**Getting `callSessionId`:** The backend puts it in LiveKit dispatch metadata when starting the V2V call. The Python agent reads it via `_parse_job_metadata(ctx)` from `job.metadata` or `room.metadata`.

---

## 3. Call Recording

**Backend API:** `POST /api/v1/call-sessions/:callSessionId/recording`  
**Auth:** `Authorization: Bearer <jwt_or_api_key>`

**Body:**
```json
{
  "recordingUrl": "https://...",
  "durationSeconds": 120
}
```

**Flow:**
1. Start LiveKit Egress (e.g. room composite) when the call starts, or use your own recording pipeline.
2. When the recording is ready (e.g. Egress webhook or callback), call this endpoint with the public URL and duration.
3. The backend updates the `calls` row (recordingUrl, recordingDuration) and publishes `call.recording.available`.
4. Call Detail UI shows the recording audio player when `recordingUrl` is set.

---

## 4. Human Handoff

**Backend:** When the LLM triggers the **HUMAN_HANDOFF** tool, the pipeline already publishes `call.handoff_requested` and webhooks fire. No extra Python call required for the event.

**Tool config (HUMAN_HANDOFF):** `{ "dashboardUrl": "...", "notifyChannel": "..." }`.

**Operator join:** The admin clicks “Join call” on Live Monitoring. The frontend calls `POST /api/v1/call-sessions/:callSessionId/join` and gets `{ livekitUrl, token, roomName }`, then connects to LiveKit. The operator can speak in the same room. The AI agent should mute or step back when a human participant joins (e.g. detect participant identity or role and stop generating replies).

**Python agent:** Detect when a new participant joins with identity/name “Operator” (or similar) and mute the agent or hand off the conversation so the human can talk to the user.

---

## 5. Summary

| Feature            | Backend API / behavior                    | Python agent responsibility                          |
|--------------------|-------------------------------------------|-------------------------------------------------------|
| RAG                | `POST /rag/retrieve`                      | Call API with transcript; inject chunks into context  |
| Transcript stream  | `POST /calls/:id/events`                  | Send transcript.partial, transcript.final, agent.*    |
| Recording          | `POST /call-sessions/:id/recording`       | Start egress; call API when recording URL is ready   |
| Handoff            | Event published by backend on tool use    | Define HUMAN_HANDOFF tool; mute when operator joins   |

All APIs are under `/api/v1` and require workspace auth (JWT or API key in `Authorization: Bearer`).
