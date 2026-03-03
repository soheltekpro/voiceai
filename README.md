# Realtime Voice AI Agent (LiveKit)

Standalone realtime speech-to-speech agent using the LiveKit Python Agents Framework with optional **OpenAI** or **Gemini** backends.

## Requirements

- Python 3.10+
- LiveKit Cloud account (or self-hosted LiveKit server)
- API key for the chosen provider: `OPENAI_API_KEY` and/or `GOOGLE_API_KEY`

## Setup

### 1. Create virtual environment and install dependencies

```bash
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Or with `uv`:

```bash
uv venv && source .venv/bin/activate
uv pip install -r requirements.txt
```

### 2. Download plugin assets (Silero VAD)

```bash
python agent.py download-files
```

### 3. Environment variables

Create a `.env` (or `.env.local`) file:

```bash
# LiveKit (required)
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_api_key
LIVEKIT_API_SECRET=your_api_secret

# Provider switch: OPENAI or GEMINI (default: OPENAI)
AI_PROVIDER=OPENAI

# For OpenAI
OPENAI_API_KEY=your_openai_key

# For Gemini (when AI_PROVIDER=GEMINI) — must be GOOGLE_API_KEY, not GEMINI_API_KEY
GOOGLE_API_KEY=your_google_key
```

**Gemini:** The LiveKit Google plugin expects **`GOOGLE_API_KEY`**. Get a key from [Google AI Studio](https://aistudio.google.com/apikey) and ensure it has access to the Gemini API (and Live API if required for your region). If you see "timed out during opening handshake", check that the key is valid and that `GOOGLE_API_KEY` is set in `.env` (no spaces around `=`).

To pull LiveKit keys from LiveKit Cloud:

```bash
lk app env -w
```

Then add `AI_PROVIDER` and the relevant API key(s).

## Run

- **Development (connects to LiveKit, hot reload):**
  ```bash
  python agent.py dev
  ```

- **Production:**
  ```bash
  python agent.py start
  ```

- **Local console (no LiveKit, terminal only):**
  ```bash
  python agent.py console
  ```

## Configuration

| Variable       | Values    | Description                          |
|----------------|-----------|--------------------------------------|
| `AI_PROVIDER`  | `OPENAI`  | Use OpenAI Realtime (gpt-4o-realtime-preview) |
|                | `GEMINI`  | Use Gemini Live (gemini-2.5-flash)   |

The agent uses **Silero VAD** for voice activity detection and interruption handling, and a fixed system instruction for Devanshu's SaaS business assistant.

---

## Self-hosted deployment (your own server)

You can run the entire system on your own infrastructure **without LiveKit Cloud**:

1. **Run a LiveKit server** (open-source) on your machine or VM.
2. **Run the Python agent** so it connects to that server.
3. **Run the token server** so the frontend can get connection tokens.
4. **Run or serve the frontend** so users get a browser UI.

### 1. Run LiveKit server (self-hosted)

**Local dev (quick):**

```bash
# macOS with Homebrew
brew install livekit
livekit-server --dev
```

This uses API key `devkey`, secret `secret`, and URL `ws://127.0.0.1:7880`. For production, use the [official self-hosted deployment guide](https://docs.livekit.io/transport/self-hosting/deployment/) (Docker, config, TLS, etc.).

### 2. Point the agent at your LiveKit server

In `.env` set your **own** LiveKit URL and keys (e.g. for `--dev`):

```bash
LIVEKIT_URL=ws://127.0.0.1:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
```

Then start the agent (same as above):

```bash
source .venv/bin/activate
python agent.py dev
# or: python agent.py start
```

### 3. Run the token server

The token server issues tokens so the frontend can join rooms and the agent is dispatched. From the project root, with the same `.env`:

```bash
source .venv/bin/activate
python -m uvicorn server.token_server:app --reload --port 8000
```

### 4. Run the frontend (UI)

The frontend is a React app that connects to your LiveKit server via the token server.

**First time:**

```bash
cd frontend
npm install
```

**Development (with proxy to token server):**

```bash
cd frontend
npm run dev
```

Open `http://localhost:5173`. The Vite dev server proxies `/api` to `http://localhost:8000`, so the app gets tokens from your token server.

**Production build:**

```bash
cd frontend
npm run build
```

Serve the `frontend/dist` folder with any static server (e.g. nginx, or the same backend). Ensure the production app can reach your token API (e.g. set `VITE_TOKEN_ENDPOINT` or configure your reverse proxy so `/api/token` hits the token server).

---

## Frontend overview

| Part | Role |
|------|------|
| **Token server** (`server/token_server.py`) | POST/GET `/api/token` → returns LiveKit `server_url` + `participant_token` and dispatches the voice agent into the room. |
| **Frontend** (`frontend/`) | React + LiveKit React components: connects to LiveKit using the token, shows agent status and a mic control bar. |

The UI lets users join a room, enable the microphone, and talk to the voice agent. All traffic goes to **your** LiveKit server and **your** token server; nothing is sent to LiveKit Cloud unless you choose to use it.
