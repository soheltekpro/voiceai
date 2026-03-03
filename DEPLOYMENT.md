# Deploy Voice AI on Ubuntu Server (/var/www)

This guide deploys the Voice AI project on an Ubuntu server under `/var/www` alongside your other projects (e.g. `bcp`, `chatdev.tittu.in`). You will run:

1. **LiveKit server** – realtime media
2. **Python agent** – voice AI worker
3. **Token server** (FastAPI) – issues tokens for the frontend
4. **Frontend** – built React app served by Nginx

---

## 1. Put the project on the server

From your **local machine** (or clone on server):

```bash
# On server: clone into /var/www (adjust if you use a different repo URL)
sudo mkdir -p /var/www
cd /var/www
sudo git clone https://github.com/soheltekpro/voiceai.git
sudo chown -R www-data:www-data /var/www/voiceai
```

If you upload via SFTP/FTP, upload the project into `/var/www/voiceai` (no `.git`/`.venv`/`node_modules` needed if you build on server).

---

## 2. Install dependencies on the server

### 2.1 System packages

```bash
sudo apt update
sudo apt install -y python3.10 python3.10-venv python3-pip nodejs npm build-essential
```

(Use `python3.12` if available: `sudo apt install -y python3.12 python3.12-venv`.)

### 2.2 LiveKit server (runs on your server)

This is the **same** LiveKit server you already ran locally (e.g. `livekit-server --dev` on your Mac). On the Ubuntu server you install and run that same binary so everything stays self-hosted—no LiveKit Cloud. One of the four pieces on the server is this **LiveKit server**: the open-source realtime media server that handles WebRTC.

**Option A – Official install script (if available on your architecture):**

```bash
curl -sSL https://get.livekit.io | bash
```

**Option B – Manual install (recommended on Ubuntu):**

1. Open [LiveKit Server releases](https://github.com/livekit/livekit/releases) and download the Linux binary (e.g. `livekit_amd64.deb` or the tar for your arch).
2. Install and put the binary in your PATH, for example:

```bash
# Example: if you downloaded livekit_amd64.deb
sudo dpkg -i livekit_amd64.deb

# Or extract a tar and move the binary
sudo mv livekit-server /usr/local/bin/
sudo chmod +x /usr/local/bin/livekit-server
```

3. Check it runs: `livekit-server --version`

Then run it via the systemd service in section 4 (or for a quick test, run `livekit-server --dev` in a terminal on the server).

---

## 3. Project setup on the server

```bash
cd /var/www/voiceai
```

### 3.1 Python virtualenv and agent

```bash
python3.10 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python agent.py download-files
deactivate
```

### 3.2 Environment file

Create `/var/www/voiceai/.env` (do **not** commit this):

```bash
sudo nano /var/www/voiceai/.env
```

Use the same variables as locally. For **self‑hosted** LiveKit on the same server:

```env
# LiveKit (self-hosted on this server)
LIVEKIT_URL=wss://voiceai.yourdomain.com
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret

# Or if you expose LiveKit on a port:
# LIVEKIT_URL=wss://voiceai.yourdomain.com:7880

# AI provider
AI_PROVIDER=GEMINI
GOOGLE_API_KEY=your_google_api_key
```

Important: `LIVEKIT_URL` must be the **public** URL the **browser** uses to connect (e.g. `wss://voiceai.tekprocloud.com` or `wss://your-server-ip:7880`). The token server returns this to the frontend.

Fix ownership:

```bash
sudo chown www-data:www-data /var/www/voiceai/.env
sudo chmod 600 /var/www/voiceai/.env
```

### 3.3 Build the frontend

```bash
cd /var/www/voiceai/frontend
npm ci
npm run build
```

Static files will be in `frontend/dist/`. Nginx will serve them.

---

## 4. Run services (systemd)

Create these service files so everything starts on boot and runs next to your other projects.

### 4.1 LiveKit server

Copy the example service from the repo (or create it manually):

```bash
sudo cp /var/www/voiceai/deploy/livekit-voiceai.service /etc/systemd/system/
# If livekit-server is not in /usr/local/bin, edit ExecStart path
sudo systemctl daemon-reload
```

### 4.2 Token server (FastAPI)

```bash
sudo cp /var/www/voiceai/deploy/voiceai-token.service /etc/systemd/system/
```

### 4.3 Voice AI agent (worker)

```bash
sudo cp /var/www/voiceai/deploy/voiceai-agent.service /etc/systemd/system/
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable livekit-voiceai voiceai-token voiceai-agent
sudo systemctl start livekit-voiceai voiceai-token voiceai-agent
sudo systemctl status livekit-voiceai voiceai-token voiceai-agent
```

---

## 5. Nginx (serve frontend + proxy API and LiveKit)

Use a **new server block** for this app so it sits next to your other projects (e.g. `bcp.tekprocloud.com`, `chatdev.tittu.in`).

### 5.1 Create config

Copy the example and edit `server_name` if needed:

```bash
sudo cp /var/www/voiceai/deploy/nginx-voiceai.conf.example /etc/nginx/sites-available/voiceai
sudo nano /etc/nginx/sites-available/voiceai
```

Example is for **voiceai.tekprocloud.com** (replace with your domain or IP):

```nginx
# Upstream for token server
upstream voiceai_token {
    server 127.0.0.1:8000;
}

# Optional: upstream for LiveKit if you proxy WebSocket by path
# upstream voiceai_livekit {
#     server 127.0.0.1:7880;
# }

server {
    listen 80;
    server_name voiceai.tekprocloud.com;
    # For HTTPS, add:
    # listen 443 ssl;
    # ssl_certificate /path/to/fullchain.pem;
    # ssl_certificate_key /path/to/privkey.pem;

    root /var/www/voiceai/frontend/dist;
    index index.html;

    # Frontend (SPA)
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Token API (frontend calls /api/token)
    location /api/ {
        proxy_pass http://voiceai_token/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable and reload:

```bash
sudo ln -s /etc/nginx/sites-available/voiceai /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 5.2 LiveKit URL for the browser

- **Option A – Same host, different port**  
  Expose LiveKit on 7880 with TLS (e.g. Nginx stream or LiveKit’s own TLS). Then in `.env` set:
  - `LIVEKIT_URL=wss://voiceai.tekprocloud.com:7880`
  - Open port 7880 in the firewall and configure TLS there.

- **Option B – Proxy WebSocket under same host**  
  If your LiveKit build supports a path, you can add a `location` that proxies to `127.0.0.1:7880` and set:
  - `LIVEKIT_URL=wss://voiceai.tekprocloud.com/livekit`  
  (path depends on LiveKit’s config.)

- **Option C – Dev / internal**  
  For testing, you can use `ws://YOUR_SERVER_IP:7880` (no TLS). Browsers may require HTTPS for microphone; use at your own risk.

---

## 6. Firewall

If you use ufw:

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
# Only if LiveKit is on 7880:
# sudo ufw allow 7880/tcp
sudo ufw reload
```

---

## 7. Quick checklist

| Step | Command / check |
|------|-------------------|
| Project on server | `ls /var/www/voiceai` |
| Python + venv | `source /var/www/voiceai/.venv/bin/activate && python agent.py download-files` |
| .env | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `AI_PROVIDER`, API key |
| Frontend build | `cd /var/www/voiceai/frontend && npm run build` |
| LiveKit running | `sudo systemctl status livekit-voiceai` |
| Token server | `curl -s http://127.0.0.1:8000/api/token` (or similar) |
| Agent | `sudo systemctl status voiceai-agent` |
| Nginx | `sudo nginx -t && sudo systemctl reload nginx` |
| Browser | Open `https://voiceai.tekprocloud.com` (or your URL) |

---

## 8. Will it run as fast as on local?

- **Server CPU/RAM:** On a decent VPS, the agent and LiveKit often run **as fast or faster** than on a laptop (no power saving, dedicated resources).
- **Latency:** Voice latency is dominated by **network round-trip** between the user’s browser and your server:
  - **Users close to the server:** Similar or better than local.
  - **Users far away:** Extra tens to hundreds of ms per direction (speech → server → AI → server → playback). Use a server in the same region as your users when possible.
- **Tips:** Keep the agent and LiveKit on the same machine so agent↔LiveKit is localhost; put the token server and frontend on the same host so `/api` is fast; use HTTPS and a CDN for the static frontend if you have global users.

---

## 9. Logs and restart

```bash
# Logs
sudo journalctl -u livekit-voiceai -f
sudo journalctl -u voiceai-token -f
sudo journalctl -u voiceai-agent -f

# Restart after code or .env changes
sudo systemctl restart voiceai-agent voiceai-token
# After frontend rebuild, no restart needed if Nginx serves dist/
```

After deployment, open your Voice AI URL in the browser; the app will load the frontend, get a token from `/api/token`, and connect to LiveKit on the `LIVEKIT_URL` you configured.
