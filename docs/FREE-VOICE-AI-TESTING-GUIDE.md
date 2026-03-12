# Free Voice AI Testing — Step-by-Step (No Provider)

Test the full **phone → Asterisk → Voice AI** pipeline with **no paid provider and no signup**. Everything runs locally: Asterisk, your Voice AI backend, and a free SIP softphone on your computer or phone.

---

## What You Need (All Free)

| Item | What to use |
|------|-------------|
| **Machine for Asterisk + Backend** | Your laptop, a PC, or a free-tier cloud VM (e.g. Oracle Free Tier, Google Cloud free tier). Can be the same machine where you develop. |
| **Asterisk** | Open source, free. |
| **Voice AI app** | This repo (backend + frontend). |
| **Softphone** | Zoiper or Linphone (free). |
| **No Twilio/Telnyx/Plivo** | Not needed for this test. |

---

## Overview

1. Install and configure **Asterisk** with a **local SIP user** (so a softphone can register).
2. Configure Asterisk **dialplan** so dialing **1000** sends the call to your Voice AI app.
3. Enable **ARI** in Asterisk so your Node backend can control calls.
4. Configure and run your **Voice AI backend** (with ARI env vars).
5. Install a **free softphone**, register to Asterisk, then **dial 1000** to talk to the AI.

---

## Step 1: Install Asterisk

**Where:** On the machine that will run Asterisk (can be the same as your dev machine).

**Ubuntu/Debian:**

```bash
sudo apt update
sudo apt install -y asterisk
sudo systemctl start asterisk
sudo systemctl enable asterisk
```

**macOS (Homebrew):**

```bash
brew install asterisk
# Start manually: asterisk -f (foreground) or use a service.
```

**Check:** `sudo asterisk -rx "core show version"` should print the Asterisk version.

---

## Step 2: Add a Local SIP User (Softphone)

This lets a softphone register to Asterisk **without any external provider**.

**Edit PJSIP config:**

```bash
sudo nano /etc/asterisk/pjsip.conf
```

**Add at the end** (or merge with existing `[transport-udp]` if you already have it):

```ini
; --- UDP transport ---
[transport-udp]
type=transport
protocol=udp
bind=0.0.0.0

; --- Local user for softphone (free testing) ---
[softphone]
type=endpoint
transport=transport-udp
context=default
disallow=all
allow=ulaw
auth=softphone-auth
aors=softphone-aor

[softphone-auth]
type=auth
auth_type=userpass
username=test
password=test123

[softphone-aor]
type=aor
max_contacts=1
```

**Reload PJSIP:**

```bash
sudo asterisk -rx "pjsip reload"
```

---

## Step 3: Dialplan — Dial 1000 → Voice AI

When you dial **1000** from the softphone, Asterisk will send the call into your Voice AI app.

**Edit dialplan:**

```bash
sudo nano /etc/asterisk/extensions.conf
```

**Add** (or replace) the `[default]` context so that extension **1000** goes to Stasis:

```ini
[default]
; Dial 1000 to talk to the Voice AI agent.
; Replace YOUR_AGENT_UUID with the real agent ID from your dashboard (see Step 6).
exten => 1000,1,NoOp(Call to Voice AI)
 same => n,Stasis(voiceai,YOUR_AGENT_UUID)
 same => n,Hangup()

; Reject any other extension (optional)
exten => _X.,1,Hangup()
```

**Important:** Leave `YOUR_AGENT_UUID` as-is for now. You’ll replace it in **Step 6** after you have an agent ID from the dashboard.

**Reload dialplan:**

```bash
sudo asterisk -rx "dialplan reload"
```

---

## Step 4: Enable ARI (So the Backend Can Control Calls)

Your Node backend talks to Asterisk via **ARI** (Asterisk REST Interface). Turn on HTTP and ARI.

**4.1 — HTTP**

```bash
sudo nano /etc/asterisk/http.conf
```

Ensure you have (create the file if it doesn’t exist):

```ini
[general]
enabled=yes
tlsenable=no
tlsbindaddr=0.0.0.0:8089
bindaddr=0.0.0.0:8088
```

**4.2 — ARI user**

```bash
sudo nano /etc/asterisk/ari.conf
```

Ensure you have:

```ini
[general]
enabled=yes
pretty=yes

[asterisk]
type=user
read_only=no
password=asterisk
```

**Restart Asterisk:**

```bash
sudo systemctl restart asterisk
```

---

## Step 5: Configure and Run the Voice AI Backend

Your backend must connect to Asterisk’s ARI and bind to the Stasis app name `voiceai`.

**5.1 — Backend .env**

In your project, edit `backend/.env` (or the env file your backend uses). Add or set:

```env
# Asterisk ARI (required for this test)
ASTERISK_ARI_URL=http://127.0.0.1:8088
ASTERISK_ARI_USERNAME=asterisk
ASTERISK_ARI_PASSWORD=asterisk
ASTERISK_ARI_APP=voiceai

# Where Asterisk sends RTP (same machine = 127.0.0.1)
ASTERISK_RTP_HOST=127.0.0.1
```

If Asterisk runs on **another machine**, use that machine’s IP instead of `127.0.0.1` for `ASTERISK_ARI_URL` and `ASTERISK_RTP_HOST`.

**5.2 — Other required env (for the pipeline)**

You still need at least:

- `DATABASE_URL` (PostgreSQL)
- `OPENAI_API_KEY` (or your chosen LLM/STT/TTS keys for the pipeline)

**5.3 — Start the backend**

```bash
cd backend
npm run dev
```

Or, if you use a built version: `node dist/index.js`. Leave it running.

---

## Step 6: Get an Agent ID and Put It in the Dialplan

The dialplan needs a **real agent UUID** from your app.

**6.1 — Start the frontend (if you use the dashboard)**

```bash
cd frontend
npm run dev
```

Open the app in the browser (e.g. `http://localhost:5173`). Log in if required.

**6.2 — Create or open an agent**

- Go to **Agents**.
- Create a new agent or open an existing one.
- In the browser address bar you’ll see something like:  
  `http://localhost:5173/admin/agents/a1b2c3d4-e5f6-7890-abcd-ef1234567890`  
  The part after `/agents/` is the **agent UUID**. Copy it.

**6.3 — Update the dialplan**

On the Asterisk server:

```bash
sudo nano /etc/asterisk/extensions.conf
```

Replace `YOUR_AGENT_UUID` with the UUID you copied. Example:

```ini
 same => n,Stasis(voiceai,a1b2c3d4-e5f6-7890-abcd-ef1234567890)
```

Save, then:

```bash
sudo asterisk -rx "dialplan reload"
```

---

## Step 7: Install a Free Softphone

On your **computer or phone** (can be the same machine as Asterisk or another device on the same network):

- **Zoiper:** [zoiper.com](https://www.zoiper.com) — free for basic use (Windows, macOS, Linux, Android, iOS).
- **Linphone:** [linphone.org](https://www.linphone.org) — free (Windows, macOS, Linux, Android, iOS).

Install and open the app.

---

## Step 8: Configure the Softphone to Register to Asterisk

Use these settings (they match the user you added in Step 2):

| Setting | Value |
|--------|--------|
| **Account type / Protocol** | SIP |
| **Domain / Server / Host** | IP or hostname of the machine where Asterisk runs (e.g. `192.168.1.10` or `localhost` if on the same machine) |
| **Username** | `test` |
| **Password** | `test123` |
| **Port** | `5060` |

Save the account. The softphone should show **Registered** or **Online**.

**Zoiper 5 — "Username and password" screen:** On the first login screen, use **Username:** `test` (or `test@localhost` / `test@YOUR_ASTERISK_IP` if it asks for a SIP URI). **Password:** `test123`. If Zoiper then shows Manual/Advanced settings, set Domain/Server to your Asterisk IP (or `localhost`), Port `5060`.

**If the softphone is on another device:** Use the **Asterisk machine’s IP** (e.g. your laptop’s IP on the LAN), not `localhost`. Ensure the firewall on the Asterisk machine allows **UDP 5060**.

---

## Step 9: Call the AI

1. In the softphone, dial **1000**.
2. The call should connect; your Voice AI backend (via ARI) will answer and bridge the call to the AI (STT → LLM → TTS).
3. You should hear the agent and be able to talk. No provider or real phone number involved.

---

## Troubleshooting

| Problem | What to check |
|--------|----------------|
| Softphone won’t register | Asterisk running? Correct IP, port 5060, username `test`, password `test123`? Firewall allows UDP 5060? |
| **408 Request Timeout** when calling 1000 | Asterisk got the call but did not answer in time. **Most likely:** the Voice AI backend is not running or not connected to ARI, so `Stasis(voiceai,...)` is never handled. Start the backend on the same machine as Asterisk; set `ASTERISK_ARI_URL=http://127.0.0.1:8088` (or Asterisk IP if backend is remote); ensure no firewall blocks it. Confirm dialplan has the correct agent UUID and you ran `dialplan reload`. |
| Dial 1000 but nothing happens | Dialplan reloaded? Agent UUID in `extensions.conf` correct? Backend running and ARI vars set? |
| Call connects but no AI voice | Backend logs for errors. ARI URL/password correct? `ASTERISK_ARI_APP=voiceai`? Agent has valid LLM/STT/TTS config? |
| “Connection refused” to ARI | Asterisk `http.conf` and `ari.conf` enabled? Asterisk restarted? Backend using same host/port (e.g. `127.0.0.1:8088`)? |

**Quick checks:**

```bash
# Asterisk PJSIP endpoint
sudo asterisk -rx "pjsip show endpoint softphone"

# Dialplan
sudo asterisk -rx "dialplan show default"

# ARI (from the machine running the backend)
curl -u asterisk:asterisk http://127.0.0.1:8088/ari/api-docs/resources.json
```

---

## Summary Checklist

| Step | Action |
|------|--------|
| 1 | Install Asterisk, start it |
| 2 | Add `[softphone]`, `[softphone-auth]`, `[softphone-aor]` to `pjsip.conf`, `pjsip reload` |
| 3 | Add `[default]` with `exten => 1000` → `Stasis(voiceai,YOUR_AGENT_UUID)` in `extensions.conf`, `dialplan reload` |
| 4 | Enable `http.conf` and `ari.conf`, restart Asterisk |
| 5 | Set ARI and RTP env vars in `backend/.env`, start backend |
| 6 | Get agent UUID from dashboard, put it in dialplan, `dialplan reload` |
| 7 | Install Zoiper or Linphone |
| 8 | Configure softphone: server = Asterisk IP, user `test`, password `test123`, port 5060 |
| 9 | Dial **1000** and talk to the AI |

Everything in this guide is **free**: Asterisk, your app, and the softphone. No Twilio, Telnyx, or Plivo signup required.
