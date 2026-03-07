# Phase 7: Production Optimization (Target: 1000 concurrent calls)

## Target & constraints

- **1000 concurrent calls** (mix of browser WS and SIP/Asterisk calls)
- Low-latency real-time audio path must remain **in-process** per call (cannot hop between nodes mid-call)
- Horizontally scalable Node “AI core” with **stateless control plane** and **sticky real-time sessions**

---

## Infrastructure architecture

```
                           ┌──────────────────────────────┐
                           │          ADMIN UI            │
                           │  /admin + realtime timeline  │
                           └──────────────┬───────────────┘
                                          │ HTTPS
                                          ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                           L7 LOAD BALANCER / INGRESS                         │
│   - WebSocket support (/voice, /events)                                       │
│   - Sticky sessions for /voice (by cookie or source IP)                       │
│   - Rate limiting at edge                                                     │
└──────────────┬───────────────────────────────┬───────────────────────────────┘
               │                               │
               ▼                               ▼
┌──────────────────────────────┐     ┌──────────────────────────────┐
│   NODE AI CORE (replica N)    │ ... │   NODE AI CORE (replica N)    │
│  - /voice WS (realtime)       │     │  - /voice WS (realtime)       │
│  - /events WS (fanout)        │     │  - /events WS (fanout)        │
│  - /api/v1 (control plane)    │     │  - /api/v1 (control plane)    │
│  - Prometheus /metrics        │     │  - Prometheus /metrics        │
│  - BullMQ producer (jobs)     │     │  - BullMQ producer (jobs)     │
│  - Redis-backed rate limiting │     │  - Redis-backed rate limiting │
└──────────────┬───────────────┘     └──────────────┬───────────────┘
               │                                     │
               ▼                                     ▼
      ┌───────────────────┐                 ┌───────────────────┐
      │   REDIS CLUSTER    │                 │   POSTGRES (HA)   │
      │ - session index    │                 │ - agents/settings │
      │ - distributed lock │                 │ - call history    │
      │ - rate limit state │                 │ - messages/cost   │
      │ - BullMQ queues    │                 └───────────────────┘
      └───────────────────┘

                 ┌───────────────────────────────────────────────┐
                 │                 TELEPHONY EDGE                 │
                 │  Asterisk SBC (can be clustered)               │
                 │  - SIP trunks: Twilio/Plivo/Telnyx             │
                 │  - ARI call control                             │
                 │  - ExternalMedia RTP <-> Node AI Core          │
                 └───────────────────────────────────────────────┘
```

### Why sticky sessions matter

- A call is a long-lived **WebSocket** (browser) or long-lived **RTP bridge** (telephony) that must stay on the same node.
- Use **sticky routing** for `/voice` and (optionally) `/events`.
- Control-plane APIs (`/api/v1/*`) remain stateless and can go to any node.

---

## Scaling strategy to 1000 concurrent calls

### Node AI core
- Run **multiple replicas** (Kubernetes or Nomad).
- Use **pod CPU limits** and set max concurrent calls per pod (e.g. 50–150 depending on model mix).
- Each pod exposes:
  - `/voice` (WS)
  - `/events` (WS)
  - `/api/v1/*` (REST)
  - `/metrics` (Prometheus)

### Redis
- Use Redis (cluster/sentinel) for:
  - **session index** (callSessionId -> instanceId)
  - **rate limiting** storage
  - **BullMQ** (queues + delayed jobs)
  - basic distributed locks

### Audio worker queues (BullMQ)

Real-time audio must stay in-process, but **non-realtime** tasks should be queued:
- call summarization
- post-call transcript cleanup
- embeddings / indexing
- billing reconciliation
- webhook deliveries with retries

This keeps your real-time path stable under load.

---

## Rate limiting & protection

Apply layered limits:
- **Edge** (ingress): requests/sec and concurrent connections per IP
- **Backend** (Fastify + Redis):
  - `POST /api/v1/telephony/outbound` (to prevent abuse)
  - `POST /api/v1/agents` / settings endpoints
  - `/events` subscription abuse protection

---

## Observability & metrics

Expose:
- **Prometheus `/metrics`** from each Node AI core
- Key metrics:
  - active calls gauge (browser + phone)
  - websocket connects/disconnects counter
  - STT final latency histogram
  - LLM first-token latency histogram
  - TTS chunk latency histogram
  - queue depth gauges (BullMQ)
  - rate-limit blocks counter

Tracing:
- Add OpenTelemetry tracing later for cross-service spans (Node ↔ Redis ↔ Postgres ↔ Deepgram/OpenAI).

