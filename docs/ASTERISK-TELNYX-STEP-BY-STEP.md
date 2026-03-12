# Asterisk PJSIP + Telnyx — Step by Step

This guide tells you **where** to do each step and **what** to type. You need: (1) a server or PC where Asterisk will run, (2) your Telnyx SIP username, password, and SIP host from the Telnyx connection.

---

## Step 1: Install Asterisk (if not already installed)

**Where:** On the machine that will receive and place calls (can be the same Ubuntu server as your Voice AI app, or a separate one).

**On Ubuntu/Debian:**

```bash
sudo apt update
sudo apt install -y asterisk
```

Check it’s running:

```bash
sudo systemctl status asterisk
```

If it’s not running:

```bash
sudo systemctl start asterisk
sudo systemctl enable asterisk
```

---

## Step 2: Find Asterisk’s config directory

**Where:** Config files live here:

```text
/etc/asterisk/
```

List them:

```bash
ls -la /etc/asterisk/
```

You should see files like `pjsip.conf`, `extensions.conf`, `ari.conf`, etc. If `pjsip.conf` doesn’t exist, Asterisk may use `pjsip.conf` from a sample; we’ll create or edit the right file in the next step.

---

## Step 3: Create or edit the PJSIP config file

**Where:** Same server, in `/etc/asterisk/`.

**Option A — Add to existing `pjsip.conf`:**

```bash
sudo nano /etc/asterisk/pjsip.conf
```

**Option B — Use a separate file** (e.g. only Telnyx): create a new file and include it from `pjsip.conf` (see Asterisk docs). For simplicity here we assume you edit `pjsip.conf` directly.

Scroll to the **end** of the file (or a clear place) and add the **full blocks** below (not standalone `KEY=value` lines).  
Put your real values only in: `username=`, `password=`, and `contact=sip:HOST`.

- **Username** → e.g. `usersohelshaikh21401` (inside `[telnyx-auth]`, line `username=...`)
- **Password** → the SIP password from Telnyx (inside `[telnyx-auth]`, line `password=...`). If it contains `,` or `#`, wrap in quotes: `password="your,pass"`
- **Host** → For Telnyx **Credential** connections the SIP server is always **`sip.telnyx.com`**. The portal often doesn’t show it on the Authentication page; use `contact=sip:sip.telnyx.com` in `[telnyx-aor]`.

**What to add (paste these blocks and replace the placeholders):**

```ini
; -------- Transport (add only if not already in the file) --------
[transport-udp]
type=transport
protocol=udp
bind=0.0.0.0

; -------- Telnyx trunk (name must be telnyx-trunk for dashboard) --------
[telnyx-trunk]
type=endpoint
transport=transport-udp
context=from-sip-trunk
disallow=all
allow=ulaw
outbound_auth=telnyx-auth
aors=telnyx-aor

[telnyx-auth]
type=auth
auth_type=userpass
username=usersohelshaikh21401
password=_8h9!FK3A&F,

[telnyx-aor]
type=aor
contact=sip:sip.telnyx.com
```

**Example** (fake credentials):

```ini
[telnyx-auth]
type=auth
auth_type=userpass
username=usersohelshaikh21401
password=YourActualPasswordFromTelnyx

[telnyx-aor]
type=aor
contact=sip:sip.telnyx.com
```

Save and exit (`Ctrl+O`, Enter, then `Ctrl+X` in nano).

---

## Step 4: Reload PJSIP in Asterisk

**Where:** Same server, in a terminal.

```bash
sudo asterisk -rx "pjsip reload"
```

You should see no error. If you see “Failed to load” or “reload failed”, fix the typo or missing section in `pjsip.conf` and run the command again.

---

## Step 5: (Optional) Confirm the endpoint exists

**Where:** Same server, in a terminal.

```bash
sudo asterisk -rx "pjsip show endpoint telnyx-trunk"
```

You should see an endpoint named `telnyx-trunk` and its auth/aor. If you see “No such object”, the config wasn’t loaded — recheck Step 3 and 4.

---

## Step 6: Open firewall for SIP (if Asterisk is on a public server)

**Where:** On the server where Asterisk runs (and where you’ll point Telnyx inbound).

Telnyx must reach Asterisk on **UDP 5060** (SIP) and your RTP ports (often 10000–20000). Example with `ufw`:

```bash
sudo ufw allow 5060/udp
sudo ufw allow 10000:20000/udp
sudo ufw reload
```

(Adjust the RTP range if your Asterisk uses something else.)

---

## Step 7: Inbound calls (Credential connection — no IP field)

**Why you don't see an "Inbound IP" or "Send inbound to" field:** For **Credential** (username/password) SIP connections, Telnyx does **not** show a field to enter where to send inbound calls. That is normal. Telnyx sends inbound calls to the **IP and port that Asterisk uses when it registers** to Telnyx.

**Where:** Telnyx → **Voice** or **Messaging** → **SIP Connections** → click your connection (e.g. **voiceai-asterisk**).

**What to do:**

1. **Assign your number to this connection:** Open the **Numbers** tab (on this connection, or **Numbers** in the main menu). Assign your Telnyx number (e.g. +1-206-635-3849) to this SIP connection so inbound calls to that number use this connection.
2. **How Telnyx knows where to send the call:** Telnyx learns the destination from **SIP registration**. When Asterisk registers to Telnyx (using the username/password from Step 3), Telnyx uses that registration to send inbound calls to Asterisk. So you do **not** type an IP in the Telnyx portal. Just ensure Asterisk is running, can reach the internet, and your firewall allows **UDP 5060** (and RTP ports) so Asterisk can register and receive calls (Step 6).
3. **Inbound tab:** The **Inbound** tab may show codecs, timeouts, number format — but **no "IP address" or "Send inbound to" field** for Credential connections. Leave those settings at defaults if you like.

After this, when someone dials your Telnyx number, Telnyx sends the call to the address Asterisk registered from. **You still won't hear the AI yet** — complete Step 8 and Step 9 so Asterisk and your backend answer the call.

---

## From Step 7 onward — what to do next (simple)

After Step 7, the call reaches **Asterisk** but Asterisk doesn’t know what to do with it. You do two more things:

| Step | What it does |
|------|----------------|
| **Step 8** | Tell Asterisk: “When a call comes in from the trunk, send it to the Voice AI app and use this agent.” (You edit a file on the Asterisk server.) |
| **Step 9** | Tell your Voice AI backend how to talk to Asterisk, and start the backend. Then when a call enters the “Voice AI app” in Asterisk, your backend answers and connects the caller to the AI. |

---

## Step 8: Dialplan — tell Asterisk to send calls to Voice AI

**What you’re doing:** Adding a small “recipe” so that any call coming from the Telnyx trunk is sent into the Voice AI app with an agent ID.

**8.1 — Open the dialplan file on the Asterisk server**

SSH into the server where Asterisk runs (same as in Step 1), then run:

```bash
sudo nano /etc/asterisk/extensions.conf
```

**8.2 — Add this block at the end of the file**

Scroll to the very end (or after any existing `[from-sip-trunk]` section). Add:

```ini
[from-sip-trunk]
exten => _X.,1,NoOp(Inbound call to Voice AI)
 same => n,Stasis(voiceai,YOUR_AGENT_UUID)
 same => n,Hangup()
```

**8.3 — Replace YOUR_AGENT_UUID with your real agent ID**

- Open your **Voice AI dashboard** in the browser.
- Go to **Agents** and click one agent (the one you want to answer phone calls).
- Look at the **URL in the address bar**. It will look like:  
  `https://your-site.com/admin/agents/a1b2c3d4-e5f6-7890-abcd-ef1234567890`  
  The part after `/agents/` is the **agent UUID** (e.g. `a1b2c3d4-e5f6-7890-abcd-ef1234567890`). Copy it.
- In `extensions.conf`, replace `YOUR_AGENT_UUID` with that value. The line should look like:  
  `same => n,Stasis(voiceai,a1b2c3d4-e5f6-7890-abcd-ef1234567890)`

**8.4 — Save and reload**

- In nano: **Ctrl+O**, Enter, then **Ctrl+X**.
- In the terminal:

```bash
sudo asterisk -rx "dialplan reload"
```

Now Asterisk will send inbound trunk calls into the Voice AI app. The app won’t “answer” until Step 9 is done.

---

## Step 9: Connect your Voice AI backend to Asterisk (ARI)

**What you’re doing:** Your Node.js backend must connect to Asterisk’s **ARI** (Asterisk REST Interface). When a call enters the `voiceai` app (from Step 8), Asterisk notifies the backend; the backend then bridges the call to your AI (STT → LLM → TTS) and sends audio back.

**9.1 — Turn on HTTP and ARI in Asterisk**

On the Asterisk server, edit (create if missing):

```bash
sudo nano /etc/asterisk/http.conf
```

Ensure you have (or add):

```ini
[general]
enabled=yes
tlsbindaddr=0.0.0.0:8089
bindaddr=0.0.0.0:8088
tlsenable=no
```

Then:

```bash
sudo nano /etc/asterisk/ari.conf
```

Ensure you have (or add):

```ini
[general]
enabled=yes
pretty=yes

[asterisk]
type=user
read_only=no
password=asterisk
```

Restart Asterisk so it loads HTTP/ARI:

```bash
sudo systemctl restart asterisk
```

**9.2 — Set ARI variables in your Voice AI backend**

On the machine where the **Voice AI backend** runs (often the same server as Asterisk), open the backend’s `.env` file, for example:

```bash
nano /var/www/voiceai/backend/.env
```

or, if you run the project from your laptop:

```bash
nano backend/.env
```

Add or uncomment and set (use your real Asterisk IP if the backend is on a different machine):

```env
ASTERISK_ARI_URL=http://127.0.0.1:8088
ASTERISK_ARI_USERNAME=asterisk
ASTERISK_ARI_PASSWORD=asterisk
ASTERISK_ARI_APP=voiceai
ASTERISK_RTP_HOST=127.0.0.1
```

- If the backend runs on the **same server** as Asterisk: keep `127.0.0.1` for URL and RTP host.
- If the backend runs on a **different server**: use that server’s IP that Asterisk can reach (e.g. `ASTERISK_ARI_URL=http://192.168.1.50:8088`, `ASTERISK_RTP_HOST=192.168.1.50`).

**9.3 — Start (or restart) the Voice AI backend**

So it connects to ARI and listens for the `voiceai` app:

```bash
# If you use systemd (e.g. on Ubuntu):
sudo systemctl restart voiceai-api

# Or if you run manually from the project:
cd backend && npm run dev
```

**9.4 — Optional: dashboard trunk and number**

In the Voice AI dashboard, create a SIP trunk with name **telnyx-trunk** and add your Telnyx number (e.g. +12066353849). You can assign the number to an agent there for inbound routing; the dialplan in Step 8 already passes an agent ID, so the call will use that agent even without this, but the trunk/number in the dashboard are needed for outbound and for consistency.

---

## Quick checklist

| Step | Where | Action |
|------|--------|--------|
| 1 | Server | Install Asterisk, start and enable it |
| 2 | Server | Confirm config dir: `/etc/asterisk/` |
| 3 | `/etc/asterisk/pjsip.conf` | Add `[transport-udp]`, `[telnyx-trunk]`, `[telnyx-auth]`, `[telnyx-aor]` with your Telnyx username, password, host |
| 4 | Terminal | Run `sudo asterisk -rx "pjsip reload"` |
| 5 | Terminal | (Optional) `sudo asterisk -rx "pjsip show endpoint telnyx-trunk"` |
| 6 | Server | Open UDP 5060 (and RTP range) in firewall |
| 7 | Telnyx portal | Inbound → set Asterisk public IP (and port 5060) |
| 8 | `/etc/asterisk/extensions.conf` | Add `[from-sip-trunk]` with `Stasis(voiceai,YOUR_AGENT_UUID)` and `dialplan reload` |
| 9 | Voice AI backend | Ensure ARI is configured and Stasis app `voiceai` is used |

After this, the **dashboard** trunk name must be exactly **`telnyx-trunk`** and the phone number +12066353849 added in **Phone Numbers** so inbound/outbound use this Asterisk trunk.
