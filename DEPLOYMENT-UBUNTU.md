# Deploy Voice AI on Ubuntu Server

This guide deploys the full Voice AI platform on Ubuntu: **Node API**, **all BullMQ workers**, **LiveKit server**, **Python V2V agent**, and **frontend** behind Nginx. No backend or worker logic is changed—only how to run and configure them on the server.

---

## 1. What runs on the server

| Service | Purpose |
|--------|---------|
| **voiceai-api** | Node.js backend (Fastify) – REST API, WebSocket `/voice`, event stream. Port **3000**. |
| **voiceai-worker-voice** | Starts call sessions (pipeline or V2V) when jobs are enqueued. |
| **voiceai-worker-embedding** | Generates embeddings for knowledge base uploads. |
| **voiceai-worker-tools** | Runs tool executions (webhook, HTTP, etc.) from the queue. |
| **voiceai-worker-webhooks** | Delivers webhook POSTs to configured URLs. |
| **voiceai-worker-postcall** | Post-call tasks (e.g. transcript). |
| **livekit-voiceai** | LiveKit server – WebRTC for V2V agents. Port **7880**. |
| **voiceai-agent** | Python LiveKit agent – joins rooms and handles realtime voice. |
| **Nginx** | Serves frontend `dist/` and proxies `/api` and `/voice` to port 3000. |

**PostgreSQL** and **Redis** must be installed and running (local or remote). The API and all workers use the same `.env` (database, Redis, OpenAI, LiveKit, etc.).

---

## 2. Server preparation

### 2.1 Install Node.js 18+

```bash
# Option A: NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Option B: n (after installing node)
# sudo n 20
```

Check: `node -v` and `npm -v`.

### 2.2 Install Python 3.10+

```bash
sudo apt update
sudo apt install -y python3.10 python3.10-venv python3-pip build-essential
```

### 2.3 Install PostgreSQL and Redis

```bash
sudo apt install -y postgresql postgresql-contrib redis-server
sudo systemctl enable postgresql redis-server
sudo systemctl start postgresql redis-server
```

Create a database and user for the app (replace `voiceai`, `voiceai_user`, `your_password`):

```bash
sudo -u postgres psql -c "CREATE USER voiceai_user WITH PASSWORD 'your_password';"
sudo -u postgres psql -c "CREATE DATABASE voiceai OWNER voiceai_user;"
```

### 2.4 Install LiveKit server

```bash
# Install script (if available for your arch)
curl -sSL https://get.livekit.io | bash

# Or download from https://github.com/livekit/livekit/releases
# e.g. extract and: sudo mv livekit-server /usr/local/bin/
```

Check: `livekit-server --version`.

---

## 3. Deploy the project

### 3.1 Clone and permissions

```bash
sudo mkdir -p /var/www
cd /var/www
sudo git clone https://github.com/your-org/voiceai.git
sudo chown -R www-data:www-data /var/www/voiceai
```

(Replace the repo URL with yours.)

### 3.2 Root .env (used by API, workers, and Python agent)

All systemd units use `EnvironmentFile=/var/www/voiceai/.env`. Create this file once at project root:

```bash
sudo nano /var/www/voiceai/.env
```

Set at least:

```env
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://voiceai_user:your_password@127.0.0.1:5432/voiceai
REDIS_URL=redis://127.0.0.1:6379
OPENAI_API_KEY=sk-...
JWT_SECRET=your-long-random-secret

# For V2V agents
LIVEKIT_URL=wss://YOUR_DOMAIN_OR_IP
LIVEKIT_PUBLIC_URL=wss://YOUR_DOMAIN_OR_IP
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret

# Python agent (same file)
AI_PROVIDER=OPENAI
VOICEAI_API_URL=http://127.0.0.1:3000
VOICEAI_API_KEY=
```

If you use a **domain** with Nginx and HTTPS, set `LIVEKIT_URL` / `LIVEKIT_PUBLIC_URL` to e.g. `wss://voiceai.example.com`. For a quick test with IP only, use `ws://YOUR_SERVER_IP:7880`.  
Optional: set `VOICEAI_API_KEY` to a workspace API key so the Python agent can call RAG and send events.

```bash
sudo chown www-data:www-data /var/www/voiceai/.env
sudo chmod 600 /var/www/voiceai/.env
```

### 3.3 Backend: install, build, migrate

```bash
cd /var/www/voiceai/backend
sudo -u www-data npm ci
sudo -u www-data npx prisma generate
sudo -u www-data npx prisma migrate deploy
sudo -u www-data npm run build
```

Keep ownership: `sudo chown -R www-data:www-data /var/www/voiceai`.

### 3.4 Python agent: venv and deps

```bash
cd /var/www/voiceai
sudo -u www-data python3.10 -m venv .venv
sudo -u www-data .venv/bin/pip install -r requirements.txt
sudo -u www-data .venv/bin/python agent.py download-files
```

### 3.5 Frontend: build (optional env)

If the frontend is served from a different host/port than the API, set `VITE_API_URL` when building so the client hits the right backend, e.g.:

```bash
cd /var/www/voiceai/frontend
VITE_API_URL=https://voiceai.example.com sudo -u www-data npm run build
```

```bash
cd /var/www/voiceai/frontend
sudo -u www-data npm ci
sudo -u www-data npm run build
```

Static output is in `frontend/dist/`. Nginx will serve it.

---

## 4. Systemd: API, workers, LiveKit, agent

Copy the unit files and reload systemd:

```bash
sudo cp /var/www/voiceai/deploy/voiceai-api.service /etc/systemd/system/
sudo cp /var/www/voiceai/deploy/voiceai-worker-voice.service /etc/systemd/system/
sudo cp /var/www/voiceai/deploy/voiceai-worker-embedding.service /etc/systemd/system/
sudo cp /var/www/voiceai/deploy/voiceai-worker-tools.service /etc/systemd/system/
sudo cp /var/www/voiceai/deploy/voiceai-worker-webhooks.service /etc/systemd/system/
sudo cp /var/www/voiceai/deploy/voiceai-worker-postcall.service /etc/systemd/system/
sudo cp /var/www/voiceai/deploy/livekit-voiceai.service /etc/systemd/system/
sudo cp /var/www/voiceai/deploy/voiceai-agent.service /etc/systemd/system/

sudo systemctl daemon-reload
```

**Important:** The unit files assume:

- Project path: `/var/www/voiceai`
- Root `.env`: `/var/www/voiceai/.env` (used by `EnvironmentFile` in every service)
- Backend runs from `/var/www/voiceai/backend` (API uses `node dist/index.js`; workers use `tsx` from `backend/node_modules/.bin/tsx`)
- Node: `node` must be in the default `PATH` for the service (e.g. `/usr/bin/node`). If you installed Node via nvm, either use a system-wide Node or set `PATH` in the service (e.g. `Environment="PATH=/home/youruser/.nvm/versions/node/v20.x.x/bin:/usr/bin"`).

Enable and start (order: LiveKit first, then API, then workers and agent):

```bash
sudo systemctl enable livekit-voiceai voiceai-api voiceai-worker-voice voiceai-worker-embedding voiceai-worker-tools voiceai-worker-webhooks voiceai-worker-postcall voiceai-agent

sudo systemctl start livekit-voiceai
sudo systemctl start voiceai-api
sudo systemctl start voiceai-worker-voice voiceai-worker-embedding voiceai-worker-tools voiceai-worker-webhooks voiceai-worker-postcall
sudo systemctl start voiceai-agent
```

Check:

```bash
sudo systemctl status voiceai-api voiceai-worker-voice livekit-voiceai voiceai-agent
```

---

## 5. Web server: frontend + proxy to backend

The Node API runs on port **3000**. The web server must serve the frontend (`frontend/dist/`) and proxy `/api` and `/voice` (WebSocket) to the backend.

### Option A: Apache (e.g. for https://voiceai.tittu.in)

If Apache is already in use on your server:

```bash
# Enable proxy and WebSocket support
sudo a2enmod proxy proxy_http proxy_wstunnel rewrite

# Copy and edit the example (set ServerName to your domain, e.g. voiceai.tittu.in)
sudo cp /var/www/voiceai/deploy/apache-voiceai.conf.example /etc/apache2/sites-available/voiceai.conf
sudo nano /etc/apache2/sites-available/voiceai.conf
```

Set `ServerName` to your domain (e.g. `voiceai.tittu.in`). Then enable the site and reload:

```bash
sudo a2ensite voiceai.conf
sudo apache2ctl configtest
sudo systemctl reload apache2
```

For **HTTPS**, use Certbot and then enable the SSL VirtualHost block in the same file (or run `sudo certbot --apache -d voiceai.tittu.in` and Certbot will add SSL to the existing site).

### Option B: Nginx

If you prefer Nginx:

```bash
sudo cp /var/www/voiceai/deploy/nginx-voiceai.conf.example /etc/nginx/sites-available/voiceai
sudo nano /etc/nginx/sites-available/voiceai
```

Set `server_name` to your domain or IP (or keep `_` for default). Then:

```bash
sudo ln -s /etc/nginx/sites-available/voiceai /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

If the frontend is served from a **different host** than the API, set `VITE_API_URL` when building the frontend (e.g. `VITE_API_URL=https://voiceai.tittu.in npm run build`) so the client calls the correct API base URL.

---

## 6. Firewall

If using ufw:

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
# If LiveKit is reached directly on 7880 (not via Nginx):
# sudo ufw allow 7880/tcp
sudo ufw reload
```

---

## 7. Quick checklist

Run these commands on your Ubuntu server to verify each part of the deployment. Replace `voiceai_user`, `voiceai`, and `voiceai.tittu.in` if you use different names.

### 1. Database (PostgreSQL)

```bash
# Should print a row with "1" and no error
sudo -u postgres psql -U voiceai_user -d voiceai -c 'SELECT 1'
```

If you get a password prompt, use the password you set for `voiceai_user`. If the database or user doesn't exist, create them (see section 2).

### 2. Redis

```bash
# Should print PONG
redis-cli ping
```

If `redis-cli` is not found, install Redis: `sudo apt install redis-server`.

### 3. Root .env exists and has required vars

```bash
# File should exist and be readable by www-data
sudo ls -la /var/www/voiceai/.env

# Optional: show var names (values are hidden). Must include DATABASE_URL, REDIS_URL, OPENAI_API_KEY, JWT_SECRET, LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET
grep -E '^[A-Z_]+=' /var/www/voiceai/.env | cut -d= -f1 | sort
```

### 4. Backend build

```bash
# Should list the compiled API entry file
ls -la /var/www/voiceai/backend/dist/index.js
```

If missing, run: `cd /var/www/voiceai/backend && sudo -u www-data npm run build`.

### 5. Frontend build

```bash
# Should list the built SPA entry
ls -la /var/www/voiceai/frontend/dist/index.html
```

If missing, run: `cd /var/www/voiceai/frontend && sudo -u www-data npm run build`.

### 6. API (Node backend) responding

```bash
# Backend must be running (voiceai-api service). This may return 401 Unauthorized (no token), which is OK — it means the API is up
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api/v1/agents
```

A response code of **200** (with a token) or **401** (without) means the API is reachable. **000** or connection refused means the backend is not running on 3000.

**If you get 000:** The Node API (voiceai-api) is not running or not listening. Run:

```bash
# Is the service running?
sudo systemctl status voiceai-api --no-pager

# If inactive or failed, see why (e.g. "node: not found" → set PATH or use full path to node in the unit file)
sudo journalctl -u voiceai-api -n 30 --no-pager

# Start (and enable so it starts on boot)
sudo systemctl start voiceai-api
sudo systemctl enable voiceai-api
```

Then run the curl command again. If the service fails to start, fix the error from `journalctl` (e.g. install Node so `/usr/bin/node` exists, or edit `/etc/systemd/system/voiceai-api.service` and set `ExecStart` to the full path of your `node` binary).

### 7. Voice worker

```bash
# Last 20 log lines; should show no crash loop
sudo journalctl -u voiceai-worker-voice -n 20 --no-pager
```

### 8. LiveKit server

```bash
# Should show "active (running)"
sudo systemctl status livekit-voiceai --no-pager
```

### 9. Python agent (voiceai-agent)

```bash
# Service status — should show "active (running)"
sudo systemctl status voiceai-agent --no-pager

# Last 20 log lines (no errors = healthy)
sudo journalctl -u voiceai-agent -n 20 --no-pager
```

**If the service is inactive or failed:** Check that the Python environment exists and the agent can start:

```bash
# Venv and agent script must exist
ls -la /var/www/voiceai/.venv/bin/python /var/www/voiceai/agent.py

# Optional: run agent in foreground once to see errors (Ctrl+C to stop)
sudo -u www-data /var/www/voiceai/.venv/bin/python /var/www/voiceai/agent.py start
```

**Restart the Python agent:**

```bash
sudo systemctl restart voiceai-agent
```

### 10. Web server (Apache)

```bash
# Config must be valid
sudo apache2ctl configtest

# Site should return 200 (or 301/302 to HTTPS)
curl -sI https://voiceai.tittu.in/ | head -1
```

For HTTP: `curl -sI http://voiceai.tittu.in/ | head -1`.

### 11. All services at a glance

```bash
# List status of API, workers, LiveKit, and agent
sudo systemctl is-active voiceai-api voiceai-worker-voice voiceai-worker-embedding voiceai-worker-tools voiceai-worker-webhooks voiceai-worker-postcall livekit-voiceai voiceai-agent
```

Each line should print **active** for the corresponding service.

---

## 8. Logs and restart

### How to check live server logs to find the problem

Use these commands on the Ubuntu server to see what is happening in real time.

**1. Backend API (Node) — e.g. login, agents, calls**

```bash
# Follow API logs live (Ctrl+C to stop)
sudo journalctl -u voiceai-api -f

# Last 100 lines (e.g. after a failed login)
sudo journalctl -u voiceai-api -n 100 --no-pager
```

If a request reaches the backend, you should see log lines when you hit the API. If you try to log in and **nothing** appears here, the request is not reaching Node (check Apache proxy and URL).

**2. Apache (proxy and static files)**

```bash
# Follow Apache error log
sudo tail -f /var/log/apache2/voiceai-error.log

# Follow Apache access log (see every request URL and status)
sudo tail -f /var/log/apache2/voiceai-access.log
```

If you use the SSL vhost, use the log names you defined (e.g. `voiceai-ssl-error.log`, `voiceai-ssl-access.log`).

**3. Workers and LiveKit**

```bash
# Voice pipeline worker
sudo journalctl -u voiceai-worker-voice -f

# Python V2V agent
sudo journalctl -u voiceai-agent -f

# LiveKit server
sudo journalctl -u livekit-voiceai -f
```

**Python agent (voiceai-agent) — check and restart**

| What to do | Command |
|------------|---------|
| Is it running? | `sudo systemctl status voiceai-agent` |
| Live logs | `sudo journalctl -u voiceai-agent -f` |
| Restart | `sudo systemctl restart voiceai-agent` |
| Verify Python env | `ls -la /var/www/voiceai/.venv/bin/python` and `sudo -u www-data /var/www/voiceai/.venv/bin/python -c "import livekit; print('OK')"` |

If the service fails to start, check `journalctl -u voiceai-agent -n 50` for import errors or missing env vars (`VOICEAI_API_URL`, `LIVEKIT_*`, `OPENAI_API_KEY` or `AI_PROVIDER`).

**4. Quick health check**

```bash
# Is the API process running and listening?
sudo systemctl status voiceai-api

# Health endpoint (GET)
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/health
# Expect 200

# Login route is POST-only; GET returns 404. To confirm the route exists, use POST:
curl -X POST http://127.0.0.1:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"x@y.com","password":"12345678"}' -s -w "\n%{http_code}"
# Expect 401 (invalid credentials) or 200 — not 404. If 404, rebuild backend and restart.
```

If `curl` to health returns **000**, the API is not running. If POST to login returns **404**, the route is not registered (rebuild dist and restart). If POST returns **401** but the browser still gets 404 on login, the HTTPS VirtualHost is not proxying `/api` (see Troubleshooting).

---

```bash
# Restart after code or .env changes
sudo systemctl restart voiceai-api voiceai-worker-voice voiceai-worker-embedding voiceai-worker-tools voiceai-worker-webhooks voiceai-worker-postcall voiceai-agent
# After frontend change: rebuild (npm run build) then reload Apache or Nginx (no service restart).
```

---

## 9. HTTPS (required for login/register if you use https://)

If you use **https://voiceai.tittu.in**, the **port 443** VirtualHost must proxy `/api` to the backend. Otherwise login and register return 404 in the browser (while `curl -X POST http://127.0.0.1:3000/api/v1/auth/login` works on the server).

**Step 1 — Find the 443 config file**

```bash
grep -l "443\|voiceai.tittu.in" /etc/apache2/sites-enabled/* 2>/dev/null
# Or list and open the SSL site (often voiceai-le-ssl.conf after Certbot):
ls -la /etc/apache2/sites-enabled/
```

**Step 2 — Edit the HTTPS VirtualHost**

Open the file that contains `<VirtualHost *:443>` for your domain (e.g. `sudo nano /etc/apache2/sites-available/voiceai-le-ssl.conf`). Inside that block, add these lines **before** the closing `</VirtualHost>` (and before any `</VirtualHost>` of a nested block):

```apache
    # API (Node backend) — required for login/register over HTTPS
    ProxyPreserveHost On
    ProxyPass /api http://127.0.0.1:3000/api
    ProxyPassReverse /api http://127.0.0.1:3000/api
```

**Step 3 — Reload Apache**

```bash
sudo apache2ctl configtest && sudo systemctl reload apache2
```

Then try **Register** or **Sign in** again in the browser.

---

Optional: to proxy LiveKit over the same host (e.g. `wss://voiceai.example.com/livekit`), add the corresponding `ProxyPass` for LiveKit and set `LIVEKIT_URL` / `LIVEKIT_PUBLIC_URL` accordingly. Otherwise keep LiveKit on port 7880.

---

## 10. Troubleshooting

- **API or workers fail to start:** Check `journalctl -u voiceai-api -n 50`. Ensure `DATABASE_URL` and `REDIS_URL` are correct and that PostgreSQL/Redis are running. Ensure `node` is on the PATH for the service user (or set `PATH` in the unit file).
- **Workers not processing jobs:** Ensure Redis is running and `REDIS_URL` in `.env` matches. Ensure all worker services are started.
- **V2V call never connects:** Ensure LiveKit and the Python agent are running and that `LIVEKIT_URL` / `LIVEKIT_PUBLIC_URL` are reachable from the browser (same domain or opened port 7880). Check agent logs: `journalctl -u voiceai-agent -f`.

- **Python agent (voiceai-agent) fails to start or crash-loops:** (1) Check logs: `sudo journalctl -u voiceai-agent -n 50 --no-pager`. (2) Verify Python env: venv at `/var/www/voiceai/.venv`, and run `sudo -u www-data /var/www/voiceai/.venv/bin/python -c "import livekit; print('OK')"` — if it errors, re-run section 3.4 (venv + `pip install -r requirements.txt`). (3) Ensure `.env` has `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, and either `OPENAI_API_KEY` or the keys for your `AI_PROVIDER`. (4) Restart: `sudo systemctl restart voiceai-agent`.

- **Web call: agent replies with generic content; my system prompt and knowledge base are not used:**

  1. **Select the right agent:** On the Web Call page, ensure the **Agent** dropdown shows the agent you edited (the one with your prompt and KB). If you opened Web Call from an agent’s “Place Call” button, that agent is now auto-selected. If you opened Web Call from the menu, pick the agent from the dropdown before starting the call.

  2. **Check backend logs when the call starts:** The API logs what it sends to the Python agent. Run `sudo journalctl -u voiceai-api -f`, start a V2V call, and look for a line like:
     - `V2V dispatch: agentId=... systemPrompt(N chars)=... knowledgeBaseId=...`
     - If `agentId` is missing or wrong, the backend is not getting the selected agent (e.g. frontend not sending it).
     - If `systemPrompt(N chars)` is short or generic, that agent’s **Agent settings** (system prompt) in the dashboard may be empty or not saved — edit the agent and save again.
     - If `knowledgeBaseId=none` but you linked a KB to the agent, the agent’s **Knowledge Base** setting was not saved — set it on the agent and save.

  3. **Check Python agent logs when the agent joins:** Run `sudo journalctl -u voiceai-agent -f`, start a call, and when the agent joins look for:
     - `Metadata received: keys= [...] systemPrompt length= N knowledgeBaseId= set|not set`
     - If `systemPrompt length= 0`, the backend is not passing the prompt (see step 2) or LiveKit is not forwarding metadata.
     - If `knowledgeBaseId= not set` but you linked a KB, see step 2 (backend) or ensure the same agent is selected.
     - If you see `RAG skipped: VOICEAI_API_KEY not set`, the Python agent cannot call the RAG API. In `/var/www/voiceai/.env` set `VOICEAI_API_KEY` to a **workspace API key** from the dashboard (Manage → API Keys). Restart the agent: `sudo systemctl restart voiceai-agent`.

  4. **RAG only runs after the user speaks:** Knowledge base context is fetched when the user says something (final transcript). So the first reply might not use KB until there is a user utterance. If the first greeting is wrong, that’s the **opening line** (from the system prompt); check that the agent’s system prompt starts with the greeting you want and that backend logs show a non-empty `openingLine` when the call starts.

- **Pipeline agent not responding (Web Call, no transcript / no agent reply):**

  1. **Microphone:** The pipeline only receives audio after the mic is on. The Web Call UI now auto-starts the mic when you connect; if you muted it, click **Unmute** and speak again.

  2. **Enable debug logs:** In the backend `.env` set `VOICE_DEBUG=1` (or `LOG_LEVEL=debug`), restart the API, then start a pipeline call. In the API process (or `journalctl -u voiceai-api -f`) you should see:
     - `[voice] config` — client sent config (agentId, callSessionId). If missing, the frontend may not be sending config after connect.
     - `[voice] first audio chunk received` — client is sending microphone audio. If this never appears, the browser mic is not streaming (check permissions, Unmute, or try another browser).
     - `[voice] pipeline running (batch STT)` or `[voice] streaming STT final` — backend is running STT and/or LLM. If you see config and audio but never this, either:
       - **Streaming STT (Deepgram):** Set `DEEPGRAM_API_KEY` in backend `.env` so the pipeline uses streaming STT; then you should see `streaming STT final` when you finish a phrase.
       - **Batch STT (Whisper):** Without Deepgram, the pipeline uses buffered audio and needs **at least ~1.8 seconds** of speech (configurable via `MIN_AUDIO_MS`) before it runs. Speak for 2+ seconds in one go and check for `pipeline running (batch STT)`.

  3. **Agent settings:** The pipeline needs agent settings (system prompt, voice, etc.). Ensure the selected agent has **Agent settings** saved (edit agent → Save changes). If `agentId` is missing in config, the dropdown may not be sending the selected agent.

  4. **Backend errors:** If you see `[voice] config` and `first audio chunk` but then an error, check the next log line for STT/LLM/TTS or network errors (e.g. missing `OPENAI_API_KEY`).

- **502 Bad Gateway:** Backend not listening on 3000 or proxy config wrong. Check `systemctl status voiceai-api` and Apache/Nginx error log.

- **Login returns 404:** Two common causes:

  1. **HTTPS vhost not proxying /api** (most likely if you use https://voiceai.tittu.in): The site is served over **port 443**. The VirtualHost that handles `*:443` must have the same API proxy as port 80. If it doesn’t, requests to `https://voiceai.tittu.in/api/v1/auth/login` never reach Node and Apache returns 404. **Fix:** Edit the **443** site config (e.g. in `sites-available` after Certbot) and add inside `<VirtualHost *:443>`:
     ```apache
     ProxyPreserveHost On
     ProxyPass /api http://127.0.0.1:3000/api
     ProxyPassReverse /api http://127.0.0.1:3000/api
     ```
     Then `sudo systemctl reload apache2`.

  2. **Backend route missing:** Confirm the backend has the route. From the server run:
     ```bash
     curl -X POST http://127.0.0.1:3000/api/v1/auth/login \
       -H "Content-Type: application/json" \
       -d '{"email":"a@b.com","password":"12345678"}' -w "\n%{http_code}"
     ```
     - **401** = route exists; the 404 in the browser is from Apache (fix the 443 proxy above).
     - **404** = route not registered; rebuild backend (`cd /var/www/voiceai/backend && sudo -u www-data npm run build`) and restart `voiceai-api`.

  The `curl` in the doc uses GET; the login route is **POST** only, so a GET request correctly returns 404.

- **ERR_MODULE_NOT_FOUND: Cannot find module '.../dist/generated/prisma/index.js':** The Prisma client is generated into `src/generated/prisma` but the app runs from `dist/`. Rebuild so that the generated client is copied into `dist`:

  ```bash
  cd /var/www/voiceai/backend
  sudo -u www-data npx prisma generate
  sudo -u www-data npm run build
  # If the build script does not copy generated client, run manually:
  # sudo cp -r src/generated dist/
  sudo systemctl restart voiceai-api
  ```

  The backend `package.json` build script should run `prisma generate`, `tsc`, and `cp -r src/generated dist`. If you pulled an older version, run the copy manually once and then pull the updated build script.
