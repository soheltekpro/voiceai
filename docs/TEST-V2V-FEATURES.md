# How to Test V2V Features (RAG, Transcript, Recording, Handoff)

Follow these steps to validate each feature. Use a single workspace (register/login in the admin dashboard) and the same auth for API calls.

---

## Prerequisites

- Backend running: `cd backend && npm run dev`
- Frontend running: `cd frontend && npm run dev`
- (For V2V) LiveKit server + Python agent running (see [TEST-V2V.md](./TEST-V2V.md))
- Redis running (for queues)
- Optional: voice-worker, embedding-worker, tool-worker, webhook-worker if you use queues

---

## 1. Apply DB changes

```bash
cd backend
npx prisma migrate deploy
```

If you prefer to sync schema without migration history (e.g. dev):

```bash
npx prisma db push
```

Then regenerate the client if needed:

```bash
npx prisma generate
```

---

## 2. Test V2V + RAG

**Goal:** V2V agent uses knowledge base context when answering.

**Steps:**

1. **Create a knowledge base and upload content**
   - Admin → **Knowledge Bases** → Create a knowledge base (e.g. "Support KB").
   - Upload a PDF or paste text that contains facts the agent should use (e.g. "Our support hours are 9am–5pm EST. Refunds are allowed within 30 days.").
   - Wait for embeddings to be generated (embedding-worker must run if you use the queue).

2. **Create a V2V agent linked to that KB**
   - Admin → **Agents** → Create agent.
   - Set **Agent type** to **Realtime Voice (V2V)**.
   - In the agent config (or Agent Settings in DB), set **Knowledge base** to the KB you created.
   - Save.

3. **Start a V2V call**
   - Admin → **Web Call** → Choose the V2V agent → Start call.
   - Join the LiveKit room from the browser (existing flow).

4. **Python agent: call RAG and inject into prompt**
   - In your Python LiveKit agent, when you have a **final user transcript**:
     - Call your backend:  
       `POST /api/v1/rag/retrieve`  
       Headers: `Authorization: Bearer <your_jwt_or_api_key>`  
       Body: `{ "knowledgeBaseId": "<kb_uuid>", "query": "<user_transcript>", "limit": 5 }`
     - Use the returned `chunks` (e.g. concatenate `content`) and prepend to the system prompt or add as context before calling the LLM.
   - Ask the user something that only the KB can answer (e.g. "What are your support hours?").
   - **Pass:** The agent’s answer reflects the knowledge base (e.g. "9am–5pm EST").

**Quick API check (no Python):**

```bash
# Replace WORKSPACE_TOKEN and KB_ID
curl -X POST http://localhost:3000/api/v1/rag/retrieve \
  -H "Authorization: Bearer WORKSPACE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"knowledgeBaseId":"<KB_ID>","query":"support hours","limit":3}'
```

You should get `{ "chunks": [ { "content": "...", "documentId": "...", "score": ... } ] }`.

---

## 3. Test realtime transcript streaming

**Goal:** Live Monitoring shows transcript and agent status events in real time.

**Steps:**

1. **Start a V2V call** (Web Call with a V2V agent).
2. **Open Live Monitoring** in another tab: Admin → **Live Events** (`/admin/live-events`).
   - Confirm the WebSocket connects (e.g. "Stream connected").
3. **Python agent: send transcript events**
   - When your STT gives a **partial** result, call:  
     `POST /api/v1/calls/<callSessionId>/events`  
     Body: `{ "event": "transcript.partial", "payload": { "text": "Hello wo...", "timestamp": 1234567890 } }`
   - When the transcript is **final**:  
     `{ "event": "transcript.final", "payload": { "text": "Hello world", "timestamp": 1234567890 } }`
   - When the agent **starts** speaking:  
     `{ "event": "agent.speaking" }`
   - When the agent **stops**:  
     `{ "event": "agent.finished" }`
   - Use the **call session ID** from the room metadata (same one the backend created when starting the call).
4. **In Live Monitoring**
   - **Transcript updates** section should show `transcript.partial` and `transcript.final` with the text.
   - **Streaming events timeline** should show `agent.speaking` and `agent.finished` (and any other events you send).

**Quick API check:**

```bash
# Replace TOKEN and CALL_SESSION_ID
curl -X POST "http://localhost:3000/api/v1/calls/CALL_SESSION_ID/events" \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"event":"transcript.final","payload":{"text":"Test message","timestamp":1234567890}}'
```

Then refresh or watch the Live Events timeline; you should see the event.

---

## 4. Test recording

**Goal:** After a recording is available, Call Detail shows an audio player.

**Steps:**

1. **Record the call**  
   Use your own pipeline (e.g. LiveKit Egress, or any recorder that produces a URL). You need a public URL to the recording file (e.g. MP3/WAV in S3 or your server).

2. **Notify the backend when recording is ready**
   - Call:  
     `POST /api/v1/call-sessions/<callSessionId>/recording`  
     Body: `{ "recordingUrl": "https://your-storage.example.com/recording.mp3", "durationSeconds": 120 }`  
     Headers: `Authorization: Bearer <token>`
   - Use the **call session ID** of the V2V call (from room metadata or from the call start response).

3. **Open Call Detail in the UI**
   - Admin → **Call History** → find the call (linked to that session) → open it.
   - **Pass:** A **Recording** section appears with an **audio** player and duration (e.g. "Duration: 120s").

**Quick API check:**

```bash
curl -X POST "http://localhost:3000/api/v1/call-sessions/CALL_SESSION_ID/recording" \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"recordingUrl":"https://example.com/sample.mp3","durationSeconds":60}'
```

Then open the corresponding call in Call History and confirm the recording block and player.

---

## 5. Test human handoff

**Goal:** Operator can join the LiveKit room when handoff is requested.

**Steps:**

1. **Create a HUMAN_HANDOFF tool (optional for UI)**
   - Admin → **Tools** → Create tool: type **Human handoff**, name e.g. "Hand off to human", config e.g. `{ "dashboardUrl": "https://your-dashboard/admin/live-events", "notifyChannel": "slack#support" }`.
   - Attach this tool to your V2V agent (Agent → edit → Tools).

2. **Start a V2V call** and **trigger handoff from the agent**
   - Either: in the Python agent, when the user says "I want a human", call the backend events API to simulate handoff, or implement the HUMAN_HANDOFF tool in the agent so the LLM can request handoff.
   - When the backend runs the HUMAN_HANDOFF tool (pipeline or tool-worker), it publishes `call.handoff_requested`; you can subscribe to that in Live Monitoring or via webhooks.

3. **Join as operator**
   - Admin → **Live Events**.
   - In **Active calls**, find the session for that call.
   - Click **Join call**.
   - You are sent to **Operator call** (`/admin/operator-call?callSessionId=...`). The page will request a LiveKit token and connect to the same room.
   - **Pass:** You are in the call (mute/unmute and leave work). The user (or browser tab) and the operator are in the same LiveKit room.

**Notes:**

- The Python agent should detect when an "Operator" (or human) participant joins and mute or hand off the conversation so the human can talk.
- You need to be logged in to the admin (JWT) so the Join Call and Operator Call pages can call the backend with `Authorization: Bearer <token>`.

---

## Getting tokens and IDs

- **JWT:** Log in via Admin → Login; the frontend stores the token (e.g. in `localStorage`). For `curl`, you can copy it from DevTools → Application → Local Storage (key used by your app for the auth token).
- **API key:** Admin → **API Keys** → Create; use that key as `Bearer <key>` in API calls.
- **Call session ID:** Returned when you start a call (in the response of `POST /api/v1/calls/start` as `callSessionId`). For the Python agent, it’s in the room metadata when the backend creates the room.
- **Knowledge base ID:** From the Knowledge Bases list or the agent’s knowledge base field in the UI or API.

---

## Troubleshooting

| Issue | Check |
|-------|--------|
| 401 on `/rag/retrieve` or `/calls/.../events` | Valid JWT or API key in `Authorization: Bearer ...`. |
| 404 on `/call-sessions/.../recording` or `/join` | Correct `callSessionId` and that the call session belongs to your workspace. |
| No events in Live Monitoring | WebSocket connected; backend and event bus publishing; correct `callSessionId` in POST body. |
| Recording not showing in Call Detail | Call row is linked to that `callSessionId`; you opened the **Call** (from Call History), not the session. |
| Join call fails | Session status is ACTIVE; LiveKit env vars set in backend; token generated for the same room name stored in session metadata. |

Using the steps above you can test DB migration, V2V+RAG, realtime transcript, recording, and human handoff end to end.
