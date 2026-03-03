# Deployment configs

Example systemd and web server configs for deploying Voice AI on Ubuntu under `/var/www`.

- **livekit-voiceai.service** – LiveKit server (with `--bind 0.0.0.0` for IP access)
- **voiceai-token.service** – Token API (FastAPI)
- **voiceai-agent.service** – Voice agent worker
- **apache-voiceai.conf.example** – Apache VirtualHost (frontend + `/api` proxy) — use this if your server runs Apache
- **nginx-voiceai.conf.example** – Nginx server block (if you use Nginx instead)
- **SYSTEMD-SETUP.md** – Step-by-step systemd + web server setup (IP-only, no domain)

See [DEPLOYMENT.md](../DEPLOYMENT.md) for the full guide, or [SYSTEMD-SETUP.md](SYSTEMD-SETUP.md) for the focused walkthrough (Step 7 uses Apache when your server runs Apache).
