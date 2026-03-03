# Step-by-step: Systemd services (no domain, IP only)

You will create **3 systemd services** so that LiveKit, the token server, and the voice agent start automatically and keep running. You will access the app in the browser using your server IP (e.g. `http://YOUR_SERVER_IP`).

Replace **YOUR_SERVER_IP** everywhere with your server’s actual IP (e.g. `172.17.20.207` or your public IP).

---

## What is systemd?

- **systemd** is the service manager on Ubuntu. It starts and monitors programs.
- A **unit file** (e.g. `voiceai-token.service`) describes one service: which command to run, as which user, and whether to restart it if it crashes.
- **Enable** = start the service at boot. **Start** = start it now.

---

## Step 1: Copy the service files

On the server, from the project directory:

```bash
cd /var/www/voiceai

# Copy the 3 service files into systemd’s directory (only root can write here)
sudo cp deploy/livekit-voiceai.service /etc/systemd/system/
sudo cp deploy/voiceai-token.service /etc/systemd/system/
sudo cp deploy/voiceai-agent.service /etc/systemd/system/
```

Nothing will start yet. You only installed the “recipes.”

---

## Step 2: Tell systemd to load the new units

```bash
sudo systemctl daemon-reload
```

This makes systemd notice the new or changed service files.

---

## Step 3: Set LIVEKIT_URL for IP access

The browser must connect to LiveKit using your server IP. Edit `.env`:

```bash
sudo nano /var/www/voiceai/.env
```

Set (or fix) this line so it uses **your server IP** and port **7880**:

```env
LIVEKIT_URL=ws://47.237.8.24:7880
```

Example: if your server IP is `172.17.20.207`:

```env
LIVEKIT_URL=ws://172.17.20.207:7880
```

Keep the rest as before (`LIVEKIT_API_KEY=devkey`, `LIVEKIT_API_SECRET=secret`, `AI_PROVIDER`, `GOOGLE_API_KEY`, etc.). Save and exit (Ctrl+O, Enter, Ctrl+X).

---

## Step 4: Start and enable the three services

Start each service and set it to start on boot:

```bash
# 1) LiveKit server (must run first; agent depends on it)
sudo systemctl start livekit-voiceai
sudo systemctl enable livekit-voiceai

# 2) Token server (API for the frontend)
sudo systemctl start voiceai-token
sudo systemctl enable voiceai-token

# 3) Voice agent (connects to LiveKit)
sudo systemctl start voiceai-agent
sudo systemctl enable voiceai-agent
```

---

## Step 5: Check that all three are running

```bash
sudo systemctl status livekit-voiceai
sudo systemctl status voiceai-token
sudo systemctl status voiceai-agent
```

For each, you want to see **active (running)** in green. Press `q` to exit the status view.

Quick check that the token API works:

```bash
curl -s http://127.0.0.1:8000/api/token
```

You should get JSON with `token` and `url` (the url should be `ws://YOUR_SERVER_IP:7880`).

---

## Step 6: Open the firewall for web and LiveKit

If you use `ufw`, open HTTP (for Nginx) and port 7880 (for LiveKit in the browser):

```bash
sudo ufw allow 80/tcp
sudo ufw allow 7880/tcp
sudo ufw reload
```

(If you don’t use ufw or use a cloud firewall, open ports 80 and 7880 there.)

---

## Step 7: Apache for IP-only access (serve frontend + proxy /api)

Your server uses **Apache** on port 80. You need to add a VirtualHost that serves the Voice AI frontend and proxies `/api` to the token server.

### 7.1 Enable required Apache modules

```bash
sudo a2enmod proxy proxy_http rewrite
```

### 7.2 Create the Voice AI site config

```bash
sudo cp /var/www/voiceai/deploy/apache-voiceai.conf.example /etc/apache2/sites-available/voiceai.conf
sudo nano /etc/apache2/sites-available/voiceai.conf
```

Replace `YOUR_SERVER_IP` with your server’s IP (e.g. `172.17.20.207`) so this site is used when someone opens `http://YOUR_SERVER_IP`:

```apache
ServerName 172.17.20.207
```

If you already have a default site and want Voice AI only when the request has no other matching host, you can use:

```apache
ServerName _
```

Save and exit (Ctrl+O, Enter, Ctrl+X).

### 7.3 Enable the site and reload Apache

```bash
sudo a2ensite voiceai.conf
sudo apache2ctl configtest
sudo systemctl reload apache2
```

If `configtest` reports any error, fix the config before reloading.

**Note:** If you have other sites (e.g. by domain name), Apache will choose the VirtualHost by `ServerName`. Using your server IP as `ServerName` makes this Voice AI site respond when users open `http://YOUR_SERVER_IP`. If you prefer to serve Voice AI on a different path or port, the config can be adjusted.

---

## Step 8: Open the app in the browser

On your laptop or phone, open:

```text
http://YOUR_SERVER_IP
```

Example: `http://172.17.20.207`

You should see the Voice Agent UI. Allow the microphone when asked. The app will get a token from `/api/token` and connect to LiveKit at `ws://YOUR_SERVER_IP:7880`.

---

## Useful commands (reference)

| What you want              | Command |
|----------------------------|--------|
| See if a service is running | `sudo systemctl status livekit-voiceai` (or `voiceai-token` / `voiceai-agent`) |
| Stop a service             | `sudo systemctl stop voiceai-agent` |
| Start a service            | `sudo systemctl start voiceai-agent` |
| Restart after code/.env change | `sudo systemctl restart voiceai-agent` and/or `voiceai-token` |
| View last 50 log lines     | `sudo journalctl -u voiceai-agent -n 50` |
| Follow logs live           | `sudo journalctl -u voiceai-agent -f` |

---

## If something fails

1. **LiveKit not running**  
   `sudo journalctl -u livekit-voiceai -n 30`  
   Ensure port 7880 is free and the binary is at `/usr/local/bin/livekit-server`.

2. **Token server not running**  
   `sudo journalctl -u voiceai-token -n 30`  
   Ensure `.venv` exists and `pip install -r requirements.txt` was done.

3. **Agent not running**  
   `sudo journalctl -u voiceai-agent -n 30`  
   Check `.env` (especially `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `GOOGLE_API_KEY`). LiveKit must be running first.

4. **Page loads but “Status: failed”**  
   - Check that `LIVEKIT_URL` in `.env` is `ws://YOUR_SERVER_IP:7880` (the IP the browser uses).  
   - Ensure port 7880 is open (firewall and cloud security group).  
   - Ensure the LiveKit service was started with `--bind 0.0.0.0` (the deploy service file includes this).
