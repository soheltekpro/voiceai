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

### 9. Python agent

```bash
# Last 20 log lines
sudo journalctl -u voiceai-agent -n 20 --no-pager
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

```bash
# Logs
sudo journalctl -u voiceai-api -f
sudo journalctl -u voiceai-worker-voice -f
sudo journalctl -u voiceai-agent -f
sudo journalctl -u livekit-voiceai -f

# Restart after code or .env changes
sudo systemctl restart voiceai-api voiceai-worker-voice voiceai-worker-embedding voiceai-worker-tools voiceai-worker-webhooks voiceai-worker-postcall voiceai-agent
# After frontend change: rebuild (npm run build) then reload Apache or Nginx (no service restart).
```

---

## 9. Optional: HTTPS and LiveKit over same host

- Use Certbot to get TLS for your domain and add a `listen 443 ssl` server block.
- If you proxy LiveKit under the same host (e.g. `wss://voiceai.example.com/livekit`), add the `location /livekit` block from the Nginx example and set `LIVEKIT_URL` / `LIVEKIT_PUBLIC_URL` to that URL. Otherwise, keep LiveKit on port 7880 and set `LIVEKIT_URL=wss://voiceai.example.com:7880` (and open 7880 in the firewall).

---

## 10. Troubleshooting

- **API or workers fail to start:** Check `journalctl -u voiceai-api -n 50`. Ensure `DATABASE_URL` and `REDIS_URL` are correct and that PostgreSQL/Redis are running. Ensure `node` is on the PATH for the service user (or set `PATH` in the unit file).
- **Workers not processing jobs:** Ensure Redis is running and `REDIS_URL` in `.env` matches. Ensure all worker services are started.
- **V2V call never connects:** Ensure LiveKit and the Python agent are running and that `LIVEKIT_URL` / `LIVEKIT_PUBLIC_URL` are reachable from the browser (same domain or opened port 7880). Check agent logs: `journalctl -u voiceai-agent -f`.
- **502 Bad Gateway:** Backend not listening on 3000 or proxy config wrong. Check `systemctl status voiceai-api` and Apache/Nginx error log.

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
