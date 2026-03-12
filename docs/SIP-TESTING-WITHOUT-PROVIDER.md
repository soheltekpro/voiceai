# Testing SIP / Voice AI Without Twilio or Plivo

If you can’t register for Twilio or Plivo (e.g. for testing or region limits), you can still test the full **inbound** voice AI pipeline using **Asterisk + a SIP softphone** and no external trunk.

**→ For a single, start-to-finish free setup (no provider at all), see [FREE-VOICE-AI-TESTING-GUIDE.md](FREE-VOICE-AI-TESTING-GUIDE.md).**

---

## Option A: Softphone Only (No Trunk – Recommended for Testing)

Use a **local SIP user** in Asterisk. A softphone (Zoiper, Linphone, etc.) registers to Asterisk; when you “call” an extension, Asterisk sends the call into your app via ARI and the AI answers. **No Twilio/Plivo signup required.**

### 1. Add a local PJSIP user for the softphone

In Asterisk (e.g. `/etc/asterisk/pjsip.conf` or a separate file included from it), add:

```ini
; --- UDP transport (if not already present) ---
[transport-udp]
type=transport
protocol=udp
bind=0.0.0.0

; --- Local user for softphone (testing) ---
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

Reload PJSIP:

```bash
asterisk -rx "pjsip reload"
```

### 2. Dialplan: call extension 1000 → Voice AI (Stasis)

In `extensions.conf`, in the context used by the softphone (e.g. `[default]`), add:

```ini
[default]
; Call extension 1000 to talk to the Voice AI agent.
; Replace AGENT_UUID with a real agent ID from your dashboard (Agents → copy ID).
exten => 1000,1,NoOp(Call to Voice AI)
 same => n,Stasis(voiceai,AGENT_UUID)
 same => n,Hangup()

exten => _X.,1,Hangup()
```

Replace `AGENT_UUID` with an actual agent ID (e.g. from the dashboard URL when you open an agent: `/admin/agents/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`).

Reload dialplan:

```bash
asterisk -rx "dialplan reload"
```

### 3. Install a SIP softphone

- **Zoiper** (Windows/macOS/Linux/Android/iOS): [zoiper.com](https://www.zoiper.com)
- **Linphone**: [linphone.org](https://www.linphone.org)

### 4. Configure the softphone

- **Protocol:** SIP.
- **Domain / server:** Your Asterisk server IP or hostname (e.g. `192.168.1.100` or `asterisk.local`).
- **Username:** `test`
- **Password:** `test123`
- **Port:** 5060 (default).

Register; the softphone should show “Registered”.

### 5. Place a “call” to the AI

Dial **1000** from the softphone. Asterisk will:

1. Receive the call
2. Run `Stasis(voiceai, AGENT_UUID)`
3. Your Node app (via ARI) will create the session, bridge with ExternalMedia, and run STT → LLM → TTS

You should hear the AI agent and be able to talk. No Twilio/Plivo needed.

### 6. Dashboard (optional)

- You still need the **Node backend** and **ARI** configured (see [Phase 4 Telephony](PHASE4-TELEPHONY.md)).
- The dashboard **SIP Trunks** and **Phone Numbers** are used for **outbound** and for **inbound from a real trunk**. For this softphone-only test you don’t need to create a trunk or phone number; the dialplan sends the call straight into Stasis with an `agentId`.

---

## Option B: Outbound Testing Without a Real Trunk

**Outbound** (Node asks Asterisk to dial a number) requires Asterisk to send the call somewhere. Without a provider you have two options:

1. **Second softphone**  
   - In Asterisk, add another PJSIP user (e.g. `softphone2`).  
   - In dialplan, when your app originates a call, use the **local** endpoint (e.g. `PJSIP/softphone2`) as the “destination” instead of a PSTN number.  
   - Your app would originate to `PJSIP/1000@softphone` or similar so the second softphone rings.  
   - This requires changing how the app picks the “destination” for testing (e.g. a test mode that uses a local PJSIP user instead of a phone number).

2. **Use a provider with a free trial** when you’re ready for real outbound:
   - **Telnyx**: [telnyx.com](https://telnyx.com) – often has trial credit and simpler signup.
   - **Twilio**: Trial account with a small credit (may require phone/ID verification).
   - **SignalWire**: Can be easier for testing in some regions.

---

## Option C: Minimal Dashboard Setup for Inbound (Softphone) Tests

For **inbound** softphone tests you don’t need a SIP trunk in the dashboard. You do need:

1. **Asterisk** with the Stasis app `voiceai` and the dialplan above.
2. **Node backend** with ARI configured (`ASTERISK_ARI_URL`, `ASTERISK_ARI_USER`, `ASTERISK_ARI_PASSWORD` or your env names).
3. **Agent** created in the dashboard; use its ID in the dialplan `Stasis(voiceai, AGENT_UUID)`.

If you later add a real trunk (Twilio/Plivo/Telnyx), follow [SIP-TRUNK-SETUP.md](SIP-TRUNK-SETUP.md) and use the same Asterisk + Node setup.

---

## Summary

| Goal                         | What to do                                                                 |
|-----------------------------|----------------------------------------------------------------------------|
| Test **inbound** voice AI   | Use Option A: local PJSIP user + softphone, dial 1000 → Stasis(voiceai, agentId). |
| Test **outbound** later     | Use a trial (e.g. Telnyx) or second softphone + local PJSIP destination.  |
| No Twilio/Plivo signup      | Option A is enough to test the full pipeline (Asterisk ↔ Node ↔ AI).       |
