# Phase 4: Telephony (SIP Trunks + Inbound/Outbound + RTP ↔ AI)

## Goal

Add phone-call support with:
- SIP trunk integration (Twilio, Plivo, Telnyx)
- inbound call handling
- outbound call API
- bridge call audio to the existing real-time voice pipeline

Key production idea: **terminate SIP/RTP on an SBC (Asterisk)**, then bridge media to the Node “AI core” over a controlled interface. This avoids writing a full SIP stack in Node while still giving you full RTP access.

---

## High-level architecture

```
              ┌───────────────────────────────────────────────────────────┐
              │                   PROVIDERS (SIP TRUNKS)                  │
              │   Twilio SIP   |   Plivo SIP   |   Telnyx SIP             │
              └───────────────┬───────────────┬───────────────┬───────────┘
                              │               │               │
                              ▼               ▼               ▼
                    ┌─────────────────────────────────────────────┐
                    │          SIP EDGE / SBC (Asterisk)           │
                    │  - SIP registration / trunk auth             │
                    │  - Receives inbound calls                    │
                    │  - Places outbound calls                     │
                    │  - RTP media in/out                           │
                    │  - ARI for call control                       │
                    │  - ExternalMedia for RTP ↔ Node bridge         │
                    └───────────────┬─────────────────────────────┘
                                    │ ARI (HTTP + WS events)
                                    │
                                    ▼
                    ┌─────────────────────────────────────────────┐
                    │              NODE AI CORE (Fastify)          │
                    │  - REST: /api/v1/telephony/outbound          │
                    │  - Webhooks: provider → SBC config docs      │
                    │  - RTP bridge (UDP): RTP → PCM16             │
                    │  - Streaming STT → LLM → TTS                 │
                    │  - PCM16 → RTP (PCMU/PCMA)                   │
                    │  - call_sessions + call_events persisted     │
                    └─────────────────────────────────────────────┘
```

---

## Media path (RTP ↔ PCM ↔ AI)

### Inbound audio (caller → agent)

1. Provider sends SIP INVITE + RTP to Asterisk.
2. Asterisk answers and attaches an `ExternalMedia` channel (via ARI) targeting Node’s UDP port.
3. Node receives **RTP** (PCMU/PCMA @ 8kHz), decodes to **PCM16**, resamples to **16kHz**.
4. Node sends audio into the **existing Phase 2 streaming STT** (`stt-streaming.ts`).
5. On end-of-utterance (`speech_final`), Node runs streaming LLM → streaming TTS.

### Outbound audio (agent → caller)

1. Node generates/streams agent speech as **PCM16**.
2. Node resamples to **8kHz**, encodes to **PCMU** (μ-law) or **PCMA** (A-law).
3. Node sends RTP packets to Asterisk ExternalMedia’s remote RTP address.
4. Asterisk bridges that ExternalMedia audio into the live call to the caller.

---

## Call control flows

### Inbound call

```
Provider (SIP) → Asterisk (dialplan) → ARI app
   ARI app:
     - create call_session row
     - select agentId (DID mapping)
     - bridge inbound channel + ExternalMedia channel
Node:
  - receives RTP
  - runs AI pipeline
  - sends RTP back
```

### Outbound call

```
Client → Node REST: POST /api/v1/telephony/outbound
Node → Asterisk ARI: originate call over trunk
ARI app sets agentId, bridges ExternalMedia
Node handles RTP ↔ AI
```

---

## Provider support (Twilio / Plivo / Telnyx)

All three are supported as **SIP trunk providers**:
- configure trunk credentials
- point inbound DID(s) to your Asterisk public SIP endpoint
- outbound: Asterisk dials via the selected trunk

This keeps your media + logic consistent (RTP always terminates at your SBC).

---

## Latency + quality notes

- Prefer **20ms RTP frames**.
- Use **PCMU** for broad interoperability.
- Resample once: 8k ↔ 16k.
- Keep pipeline streaming (Deepgram live + LLM streaming) for low latency.
- Barge-in: if caller speech detected while agent speaking, abort agent response and stop sending RTP.

---

## What’s implemented in code (Phase 4)

Phase 4 adds:
- Telephony modules under `backend/src/telephony/*`
- Asterisk ARI controller (originate/bridge/externalMedia)
- RTP packet parse/encode and μ-law conversion
- mp3→PCM conversion (ffmpeg-static) for RTP playout
- REST API to originate calls

### Key code files

- `backend/src/telephony/asterisk/controller.ts`
- `backend/src/telephony/session/session-manager.ts`
- `backend/src/telephony/session/telephony-session.ts`
- `backend/src/telephony/rtp/*`
- `backend/src/telephony/api/routes.ts`

### Asterisk config templates

- `backend/telephony/asterisk/pjsip.conf.example`
- `backend/telephony/asterisk/extensions.conf.example`

See the code section in this phase once generated.

