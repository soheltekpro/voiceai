# SIP Trunk Setup: Connect Real Numbers and Test Calls

This guide walks you through setting up a SIP trunk, attaching a real phone number, and placing an outbound test call.

**Can’t sign up for Twilio or Plivo?** You can test the full inbound voice AI pipeline with **no provider** using a SIP softphone and Asterisk. See **[Testing without Twilio/Plivo](SIP-TESTING-WITHOUT-PROVIDER.md)**.

---

## Overview

1. **SIP trunk** = connection to a provider (Twilio, Plivo, Telnyx) so Asterisk can send/receive calls.
2. **Phone number** = a DID you own on that trunk; used as caller ID for outbound and for inbound routing.
3. **Asterisk** must have PJSIP configured with the **same trunk name** you create in the dashboard.

The dashboard stores trunk **name** and **config (JSON)** for your reference; Asterisk uses its own config files. The **name** you give in the UI (e.g. `twilio-trunk`) is what the app uses as the PJSIP endpoint when placing calls: `PJSIP/<destination>@<trunk-name>`.

---

## Step 1: Get provider credentials and a number

### Twilio

1. Sign up at [twilio.com](https://www.twilio.com).
2. In Console: **Phone Numbers → Manage → Buy a number** (or use an existing one).
3. **Voice → SIP Trunking** (or **Elastic SIP Trunking**): create a trunk and note:
   - SIP domain / endpoint (e.g. `xxx.pstn.twilio.com`)
   - Username and password (or auth credentials Twilio gives for the trunk)
4. Point the number to your Asterisk server (for inbound) or note it for caller ID (outbound).

### Plivo

1. Sign up at [plivo.com](https://www.plivo.com).
2. Buy or use an existing number.
3. In Plivo console, get your SIP endpoint (e.g. `sip.plivo.com` or your subdomain) and auth (username/password) for SIP registration.

### Telnyx (free trial)

1. Sign up at [telnyx.com](https://www.telnyx.com) and use your free trial credit.
2. **Numbers** → buy or use a trial number.
3. **Voice → SIP Trunking → Create SIP Connection**:
   - **Name:** Any label (e.g. `voiceai-asterisk`).
   - **Type:** Choose **Credentials** (username/password) so Asterisk can authenticate. Click **Create**.
4. Complete the wizard:
   - **Authentication and routing:** Note the **SIP username** and **SIP password** Telnyx shows (you’ll put these in Asterisk).
   - **Configuration / Outbound:** Note the **SIP URI** or host (e.g. `sip.telnyx.com` or your connection’s FQDN).
   - **Inbound:** Set your Asterisk server’s public IP or hostname and port (5060) so Telnyx can send inbound calls to Asterisk.
5. **Numbers** → assign your number to this SIP connection for inbound/outbound.

You’ll need: **SIP host (domain)**, **username**, **password**, and (for inbound) your **Asterisk public IP:5060**.

---

## Step 2: Configure Asterisk (PJSIP)

**New to Asterisk?** For a full step-by-step (where to edit, what to type, how to reload), see **[Asterisk Telnyx step-by-step](ASTERISK-TELNYX-STEP-BY-STEP.md)**.

Asterisk must have a PJSIP endpoint whose **name matches** the trunk name you will create in the dashboard.

1. Copy the example config:
   ```bash
   cp backend/telephony/asterisk/pjsip.conf.example /etc/asterisk/pjsip_trunk.conf
   # or merge into your existing pjsip.conf
   ```

2. Edit the section for your provider (e.g. Twilio). Example for **Twilio** with trunk name `twilio-trunk`:

   ```ini
   [twilio-trunk]
   type=endpoint
   transport=transport-udp
   context=from-sip-trunk
   disallow=all
   allow=ulaw
   outbound_auth=twilio-auth
   aors=twilio-aor
   from_domain=YOUR_TWILIO_SIP_DOMAIN

   [twilio-auth]
   type=auth
   auth_type=userpass
   username=YOUR_TWILIO_USERNAME
   password=YOUR_TWILIO_PASSWORD

   [twilio-aor]
   type=aor
   contact=sip:YOUR_TWILIO_SIP_DOMAIN
   ```

   Replace:
   - `YOUR_TWILIO_SIP_DOMAIN` → your Twilio SIP domain
   - `YOUR_TWILIO_USERNAME` / `YOUR_TWILIO_PASSWORD` → credentials from Twilio SIP trunk

3. Ensure `transport=transport-udp` exists (e.g. in `pjsip.conf`):
   ```ini
   [transport-udp]
   type=transport
   protocol=udp
   bind=0.0.0.0
   ```

4. Reload PJSIP:
   ```bash
   asterisk -rx "pjsip reload"
   ```

**For Telnyx** use the same pattern with name `telnyx-trunk` and your connection’s credentials:

```ini
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
username=YOUR_TELNYX_SIP_USERNAME
password=YOUR_TELNYX_SIP_PASSWORD

[telnyx-aor]
type=aor
contact=sip:YOUR_TELNYX_SIP_HOST
```

Replace `YOUR_TELNYX_SIP_USERNAME`, `YOUR_TELNYX_SIP_PASSWORD`, and `YOUR_TELNYX_SIP_HOST` (e.g. `sip.telnyx.com` or the host Telnyx shows in the connection).

Use the **same** trunk name (`twilio-trunk`, `plivo-trunk`, or `telnyx-trunk`) in the dashboard in the next step.

---

## Step 3: Create the SIP trunk in the dashboard

1. Go to **Manage → SIP Trunks**.
2. **Provider**: Choose **TWILIO**, **PLIVO**, or **TELNYX**.
3. **Name (PJSIP endpoint)**: Enter the **exact** name you used in Asterisk (e.g. `twilio-trunk`). The app will dial `PJSIP/<number>@twilio-trunk`.
4. **Config (JSON)**: Store credentials for your reference (the app does not push this to Asterisk). Example for Twilio:
   ```json
   {
     "sipDomain": "xxx.pstn.twilio.com",
     "username": "your_twilio_sip_username",
     "password": "your_twilio_sip_password"
   }
   ```
5. Click **Create trunk**.

You should see the new trunk under **Trunks (1)**.

---

## Step 4: Add a phone number to the trunk

1. Go to **Manage → Phone Numbers**.
2. **SIP trunk**: Select the trunk you just created.
3. **Number**: Enter the E.164 number (e.g. `+14155551234`) that belongs to this trunk. This will be used as **caller ID** for outbound calls and (if you configure Asterisk dialplan) for inbound routing.
4. **Agent** (optional): Select an agent to route inbound calls to this number.
5. Submit to add the number.

You need **at least one number** per trunk for outbound; the system picks that number as the “from” when placing a call.

---

## Step 5: Place an outbound test call

1. Ensure **Asterisk** is running and the Node backend has **ARI** configured (see [Phase 4 Telephony](PHASE4-TELEPHONY.md)).
2. Go to **Manage → Outbound Calls**.
3. **Phone number (to)**: Enter the destination (e.g. your mobile) in E.164 format, e.g. `+14155559999`.
4. **Agent**: Select the voice agent (Pipeline or V2V) that will handle the call.
5. Click **Place outbound call**.

If everything is set up correctly, you should see “Call initiated” and the destination phone should ring; when answered, the AI agent will run (STT → LLM → TTS over RTP).

---

## Troubleshooting

| Issue | Check |
|-------|--------|
| "No SIP trunk or phone number configured" | Create a trunk (Step 3) and add at least one number to it (Step 4). |
| "Telephony (Asterisk) is not configured" | Backend must be started with Asterisk ARI URL and credentials; see env vars and Phase 4 docs. |
| Call never rings / fails | Asterisk PJSIP trunk name must match dashboard trunk **name**; credentials in Asterisk must be correct; firewall must allow SIP/RTP. |
| One-way or no audio | RTP bridge and Node ↔ Asterisk ExternalMedia must be correct; check Asterisk and Node logs. |

---

## Summary

| Step | Where | What |
|------|--------|------|
| 1 | Provider (Twilio/Plivo/Telnyx) | Get SIP credentials and a phone number. |
| 2 | Asterisk `pjsip.conf` | Add endpoint (and auth/aor) with same name you’ll use in dashboard. |
| 3 | Dashboard → SIP Trunks | Create trunk: Provider, **Name** = PJSIP endpoint name, Config JSON. |
| 4 | Dashboard → Phone Numbers | Add number(s) to the trunk (for caller ID and inbound). |
| 5 | Dashboard → Outbound Calls | Dial a number, choose agent, place call. |

The **trunk name** in the dashboard is the only link between the app and Asterisk: it must match the PJSIP endpoint name in Asterisk exactly.
