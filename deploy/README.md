# Deployment configs

Example systemd and Nginx configs for deploying Voice AI on Ubuntu under `/var/www`.

- **livekit-voiceai.service** – LiveKit server (with `--bind 0.0.0.0` for IP access)
- **voiceai-token.service** – Token API (FastAPI)
- **voiceai-agent.service** – Voice agent worker
- **nginx-voiceai.conf.example** – Nginx server block (frontend + `/api` proxy)
- **SYSTEMD-SETUP.md** – Step-by-step systemd + Nginx setup (including IP-only, no domain)

See [DEPLOYMENT.md](../DEPLOYMENT.md) for the full guide, or [SYSTEMD-SETUP.md](SYSTEMD-SETUP.md) for a focused systemd + IP-only walkthrough.
