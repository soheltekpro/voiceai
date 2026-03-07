# How to Test V2V (Realtime Voice-to-Voice)

V2V agents use **LiveKit** for real-time voice: the browser connects to a LiveKit room and talks to a **Python voice agent** (OpenAI or Gemini). Follow these steps to test locally.

## 1. Prerequisites

- **Node.js** backend and **voice worker** (you already use these for Pipeline).
- **Python 3.10+** for the LiveKit voice agent.
- **LiveKit server** running (local or cloud).
- **OpenAI** and/or **Google** API key (for the Python agent).

## 2. Run a LiveKit server

**Option A – Local (recommended for dev)**

```bash
# Install (macOS)
brew install livekit

# Run in dev mode (API key: devkey, secret: secret, URL: ws://127.0.0.1:7880)
livekit-server --dev
```

Leave this terminal open.

**Option B – LiveKit Cloud**

Create a project at [livekit.cloud](https://cloud.livekit.io), then use the project’s WebSocket URL, API key, and secret in the steps below.

## 3. Configure the backend for V2V

In **`backend/.env`** add (for local LiveKit dev):

```env
# V2V / LiveKit
LIVEKIT_URL=ws://127.0.0.1:7880
LIVEKIT_PUBLIC_URL=ws://127.0.0.1:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
```

- **`LIVEKIT_URL`** – used by the backend (and agent dispatch) to talk to LiveKit.
- **`LIVEKIT_PUBLIC_URL`** – URL the **browser** uses to connect (same as above for local; for production use your public wss URL).
- **`LIVEKIT_API_KEY`** / **`LIVEKIT_API_SECRET`** – from LiveKit server or cloud.

Restart the **backend** and the **voice worker** after changing `.env`.

## 4. Run the Python voice agent

The agent joins LiveKit rooms when users start a V2V call.

```bash
# From repo root
cd /path/to/voiceai
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Download Silero VAD assets (one-time)
python agent.py download-files

# Set API key for the agent (OpenAI or Gemini)
export OPENAI_API_KEY=YOUR_OPENAI_API_KEY
# Or for Gemini: export GOOGLE_API_KEY=your-google-key
# And: export AI_PROVIDER=GEMINI

# Point agent at your LiveKit server (same as backend)
export LIVEKIT_URL=ws://127.0.0.1:7880
export LIVEKIT_API_KEY=devkey
export LIVEKIT_API_SECRET=secret

# Run the agent (connects to LiveKit and waits for rooms)
python agent.py dev
```

Leave this terminal open. The agent must be running **before** you start a V2V call.

## 5. Create a V2V agent in the dashboard

1. Log in to the admin UI (e.g. `http://localhost:5173/admin`).
2. Go to **Agents** and click **New Agent** (or **Create Agent**).
3. In the agent builder:
   - Choose **V2V** (Realtime Voice).
   - Set **Name** (e.g. “Realtime assistant”) and optionally **Description**.
   - Save. (STT/TTS fields are hidden for V2V; the Python agent handles voice.)

## 6. Start a V2V call from the UI

**Option A – Web Call page**

1. Go to **Web Call** (`/admin/web-call`).
2. Select your **V2V agent** from the dropdown.
3. Click **Start call**.
4. When the call starts, the app will connect to LiveKit using the token from the backend.
5. Allow the microphone when prompted, then speak; the Python agent should reply in real time.

**Option B – Home page (Voice AI Agent)**

1. Open the main app (e.g. `http://localhost:5173/`).
2. In the **AGENT** dropdown, select the agent that shows **(V2V)**.
3. Click **Start call**.
4. After the connection is established, speak; the agent should respond with voice.

## 7. Troubleshooting

| Issue | What to check |
|-------|----------------|
| “LIVEKIT_URL or LIVEKIT_PUBLIC_URL must be set” | Add `LIVEKIT_URL` and `LIVEKIT_PUBLIC_URL` to `backend/.env` and restart backend + voice worker. |
| “LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set” | Add both to `backend/.env` and restart. |
| Start call returns 202 / never connects | Voice worker must be running (`npm run worker:voice` in `backend/`). |
| Connection fails in browser | Ensure **LIVEKIT_PUBLIC_URL** is the URL the browser can reach (e.g. `ws://127.0.0.1:7880` for local). For LiveKit Cloud use the project’s `wss://…` URL. |
| No agent in the room / one-way audio | Python agent must be running (`python agent.py dev`) and use the **same** LiveKit URL and credentials as the backend. |
| “OPENAI_API_KEY not set” (agent) | Set `OPENAI_API_KEY` (and optionally `AI_PROVIDER=OPENAI`) in the environment where you run `agent.py`. |
| Gemini: “timed out during opening handshake” | Set `GOOGLE_API_KEY` and `AI_PROVIDER=GEMINI`; ensure the key has Live API access in your region. |

## Summary

1. **LiveKit server** running (`livekit-server --dev` or cloud).
2. **Backend** and **voice worker** with `LIVEKIT_*` in `backend/.env`.
3. **Python agent** running with same LiveKit URL/keys and `OPENAI_API_KEY` or `GOOGLE_API_KEY`.
4. **V2V agent** created in the dashboard.
5. **Start call** from Web Call or home page with that V2V agent selected.

After that, the browser connects to LiveKit and the Python agent joins the room and handles real-time voice.
