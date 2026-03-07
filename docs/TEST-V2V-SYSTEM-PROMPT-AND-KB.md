# How to Test V2V with System Prompt and Knowledge Base

This guide walks you through testing that the **V2V agent** uses:
1. The **system prompt** you set when creating the agent (from the dashboard).
2. The **knowledge base (KB)** you attach to the agent (RAG).

---

## Prerequisites

- **Backend** running: `cd backend && npm run dev`
- **Frontend** running: `cd frontend && npm run dev`
- **Voice worker** running: `cd backend && npm run worker:voice`
- **LiveKit server** running (e.g. `livekit-server --dev` on `ws://127.0.0.1:7880`)
- **Python V2V agent** running: `python agent.py dev` (see below)
- **Redis** (for the call queue)
- Optional: **embedding-worker** running if you upload new documents so embeddings are generated

---

## Step 1: Configure backend and LiveKit

In **`backend/.env`**:

```env
LIVEKIT_URL=ws://127.0.0.1:7880
LIVEKIT_PUBLIC_URL=ws://127.0.0.1:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
```

Restart the backend and voice worker after changing.

---

## Step 2: Run the Python V2V agent with RAG support

From the repo root:

```bash
source .venv/bin/activate   # or: python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python agent.py download-files   # one-time, for Silero VAD
```

Set environment variables for the agent:

```bash
# Required for the realtime model (OpenAI or Gemini)
export OPENAI_API_KEY=YOUR_OPENAI_API_KEY
# Or for Gemini: export GOOGLE_API_KEY=your-google-key
# And: export AI_PROVIDER=GEMINI

# LiveKit (must match backend)
export LIVEKIT_URL=ws://127.0.0.1:7880
export LIVEKIT_API_KEY=devkey
export LIVEKIT_API_SECRET=secret

# Required for RAG (so the agent can call your backend)
export VOICEAI_API_URL=http://127.0.0.1:3000
export VOICEAI_API_KEY=vai_5Bmyj-AYbUr0nMrdHCr6Qr0RCGD2dqF1
```

- **VOICEAI_API_URL** – backend base URL (default `http://127.0.0.1:3000`).
- **VOICEAI_API_KEY** – a **workspace API key** from the dashboard (Admin → **API Keys** → Create). The agent uses this to call `POST /api/v1/rag/retrieve`.

Then start the agent:

```bash
python agent.py dev
```

Leave this terminal open. You should see logs like “Loaded system prompt: …” when a call starts (system prompt is passed from the backend).

---

## Step 3: Create a knowledge base and add content

1. Open the admin UI: **http://localhost:5173/admin** (log in if needed).
2. Go to **Knowledge Bases** → **Create** (e.g. name: “Support KB”).
3. Select that KB in the dropdown, then add content:
   - **PDF**: upload a file with clear facts (e.g. “Our support hours are 9am–5pm EST. Refunds within 30 days.”).
   - **Paste**: paste the same kind of text.
4. If you use the queue, run the **embedding-worker** so chunks get embeddings:  
   `cd backend && npm run worker:embedding`  
   Otherwise wait for embeddings to be generated if your app does it on upload.

---

## Step 4: Create a V2V agent with system prompt and KB

1. Go to **Agents** → **Create agent** (or edit an existing one).
2. Set **Agent type** to **Realtime Voice (V2V)**.
3. Set **System prompt** to something specific so you can tell it’s used, e.g.  
   `You are the support assistant for Acme Corp. Be concise and professional. Always mention you are from Acme support.`
4. Set **Knowledge base** to the one you created (e.g. “Support KB”).
5. Save.

---

## Step 5: Start a V2V call and test

1. Go to **Web Call**.
2. Select the V2V agent you just created.
3. Click **Start call** and allow microphone access. Wait for the agent to join and say the greeting.
4. **Test system prompt:**  
   Say: “Who are you?” or “What’s your role?”  
   - **Pass:** The agent answers in line with your system prompt (e.g. “Acme support”, “concise and professional”).
5. **Test knowledge base (RAG):**  
   Ask something that only the KB can answer, e.g. “What are your support hours?” or “What’s your refund policy?”  
   - **Pass:** The agent’s answer uses the KB (e.g. “9am–5pm EST”, “30 days”).

---

## Step 6: Verify in logs

**Backend / voice worker**

- When the call starts you should see something like:  
  `Dispatching V2V agent with systemPrompt: You are the support assistant for Acme Corp...`

**Python agent terminal**

- When the session starts:  
  `Loaded system prompt: You are the support assistant for Acme Corp...`
- After you ask a question that triggers RAG:  
  `RAG query: What are your support hours?`  
  `Using RAG context` (or “No RAG context found” if the KB has no matching chunks or API key is missing).

---

## Troubleshooting

| Issue | What to check |
|-------|----------------|
| Agent doesn’t follow system prompt | Backend and voice worker restarted after adding systemPrompt to metadata? Agent created/edited with a custom system prompt and you selected that agent in Web Call? |
| Agent doesn’t use KB facts | `VOICEAI_API_KEY` set in the Python agent env? API key has access to the workspace that owns the KB? Embedding-worker ran so the KB has embeddings? Agent has the correct **Knowledge base** selected? |
| “No RAG context found” | Same as above; also check backend logs for 401/404 on `/api/v1/rag/retrieve`. |
| Agent doesn’t join the room | LiveKit server running? `LIVEKIT_*` same in backend and Python agent? Python agent running **before** you start the call? |

---

## Quick checklist

- [ ] Backend `.env` has LiveKit vars; backend and voice worker restarted.
- [ ] Python agent has `OPENAI_API_KEY` (or Gemini keys), `LIVEKIT_*`, and **VOICEAI_API_URL** + **VOICEAI_API_KEY**.
- [ ] Knowledge base created and has content; embeddings generated (embedding-worker if needed).
- [ ] Agent is **V2V**, has a **system prompt** and **knowledge base** set, and is saved.
- [ ] Web Call uses that agent; you test both “who are you?” (system prompt) and a KB-only question (RAG).
