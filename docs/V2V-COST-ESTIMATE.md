# V2V approximate cost per minute — Gemini 2.5 Flash Native Audio

This doc explains how to get an **approximate cost per minute** for V2V when using **Gemini 2.5 Flash Native Audio** (e.g. `gemini-2.5-flash-native-audio-preview-12-2025` or `gemini-2.5-flash-native-audio-latest`).

---

## How Google prices it (Live API, Paid Tier)

Google AI Studio — **Gemini 2.5 Flash Native Audio (Live API)**  
`gemini-2.5-flash-native-audio-preview-12-2025`  
Paid tier, **per 1M tokens** (USD):

| Type   | Price (USD)   |
|--------|----------------|
| Input (audio/video) | $3.00 per 1M tokens  |
| Output (audio, incl. thinking tokens) | $12.00 per 1M tokens  |

Google also publishes **text** input/output rates (lower than audio):

| Type | Price (USD) |
|------|-------------|
| Input (text) | $0.50 per 1M tokens |
| Output (text) | $2.00 per 1M tokens |

So for a single blended estimate you can use audio rates; for a **split view** you treat text input (e.g. system prompt + RAG) separately (see below).

- **Cost (USD)** (audio-only view) = `(audioInputTokens / 1_000_000) × 3.00  +  (outputTokens / 1_000_000) × 12.00`
- **Cost per minute** = `Cost (USD) / (durationSeconds / 60)` when the call has a duration.

---

## Dashboard cost breakdown

For each **V2V** call, the dashboard shows a **transparent cost breakdown** when token data is available:

- **Audio in (tokens)** — user speech input tokens  
- **Audio out (tokens)** — model speech output tokens  
- **RAG / text input** — note that system prompt and RAG context are part of input; the Live API does not report text vs audio tokens separately  
- **Total tokens** — audio in + audio out  
- **Input rate (per 1M tokens)** — $3.00  
- **Output rate (per 1M tokens)** — $12.00  
- **Input cost** / **Output cost** / **Actual cost (total)** in USD  
- **Cost per minute (USD)** and **Cost per minute (INR)**  
- **Total cost (INR)**  

INR conversion uses the **USD → INR** rate from env: `USD_TO_INR` or `COST_USD_TO_INR` (default `83` if unset).

---

## Formula in code

```ts
const INPUT_USD_PER_1M  = 3.0;   // audio/video
const OUTPUT_USD_PER_1M = 12.0;  // audio

const costUsd =
  (inputTokens / 1_000_000) * INPUT_USD_PER_1M +
  (outputTokens / 1_000_000) * OUTPUT_USD_PER_1M;

const durationMinutes = durationSeconds / 60;
const costPerMinuteUsd = durationMinutes > 0 ? costUsd / durationMinutes : null;
```

---

## Ballpark “cost per minute” (conversation)

With **$3/1M input** and **$12/1M output**, cost per minute depends on how many input and output tokens you use per minute. The ranges below are based on **assumed token rates** (conversation-style; actual rates depend on speech pace and model tokenization).

### Formula

**Cost per minute (USD)** = `(inputTokensPerMin / 1_000_000) × 3.00  +  (outputTokensPerMin / 1_000_000) × 12.00`

### Token assumptions behind the ballpark

| Scenario | Input tokens/min (approx) | Output tokens/min (approx) | Cost/min (USD) |
|----------|----------------------------|-----------------------------|----------------|
| **Conservative** (fewer turns) | ~2,000 | ~2,000 | (2k×3 + 2k×12)/1e6 = **~$0.03**; range **~$0.05–0.10** with variance |
| **Typical** | ~4,000 | ~4,000 | (4k×3 + 4k×12)/1e6 = **~$0.06**; range **~$0.10–0.20** with variance |
| **Heavy** (lots of back‑and‑forth) | ~8,000+ | ~8,000+ | (8k×3 + 8k×12)/1e6 = **~$0.12**; range **~$0.20–0.40+** |

So:

- **Conservative:** ~\$0.05–0.10 per minute (≈ 2k–3k input + 2k–3k output per minute).  
- **Typical:** ~\$0.10–0.20 per minute (≈ 4k–6k input + 4k–6k output per minute).  
- **Heavy:** ~\$0.20–0.40+ per minute (≈ 8k+ input + 8k+ output per minute).

Actual token counts depend on the Live API’s audio tokenization and how much each side talks; you can confirm with real usage (input/output token totals ÷ call duration in minutes).

**About \$0.10–0.20 per minute** is a reasonable quote for a typical conversation. Free tier is free of charge; rate limits may be more restrictive for preview models.

---

## RAG (retrieve and pass knowledge) — is it included?

**Yes, we’re doing it right.** The RAG context you retrieve and pass to the model **is** part of the cost you’re estimating.

### What we do

1. **Retrieve:** When the user speaks (after `transcript.final`), the agent calls the backend `POST /api/v1/rag/retrieve` with the user’s text. The backend embeds the query (via an embedding API), runs a vector search, and returns the top chunks.
2. **Pass:** The agent appends those chunks to the instructions as `Knowledge:\n{chunks}` and calls `update_instructions(...)` so the **realtime model** (Gemini) receives them as part of its context on the next turn.

### What’s included in the Gemini cost

- The **text you inject** (system prompt + `Knowledge:\n` + RAG chunks) is sent to Gemini as **input**. So it is counted as **input tokens** and billed by Google (e.g. as text input at $0.50/1M or as part of a mixed input; the exact rate may vary). So **yes, the RAG context is included** in the token counts and in the Gemini Live API cost we estimate. We’re doing it right.

### What’s not included (separate cost)

- **RAG retrieval** runs on our backend: we call an **embedding API** (e.g. OpenAI `text-embedding-3-small`) to embed the user query before the vector search. That embedding call is a **separate, small cost** (OpenAI pricing), not part of the Gemini Live API numbers above. So:
  - **Total V2V cost with RAG** ≈ **Gemini cost** (audio + text input/output, including RAG context) **+** **embedding cost** (per RAG query, on our backend).

If you want a single “cost per minute” that includes RAG, use the Gemini-based estimate and add a small buffer for retrieval (e.g. a few cents per conversation depending on how often RAG runs).

---

## Text input (RAG + system prompt) — calculate separately

The text we send to the Live API (system prompt + `Knowledge:\n` + RAG chunks) is **text input**, not audio. Google charges **text input** at **$0.50 per 1M tokens** and **audio input** at **$3.00 per 1M tokens**. To see the cost of RAG/text separately from the rest of the call, use the following.

### What counts as "text input" in our flow

- **System prompt** — from agent config, sent once (or when instructions are updated).
- **RAG context** — each time we call `update_instructions(...)` we send base_instructions + `"\n\nKnowledge:\n"` + retrieved_chunks. So every RAG injection adds more **text input** tokens (instructions + knowledge block).

### Formula for text-input cost only (documentation only)

- **Text input cost (USD)** = `(textInputTokens / 1_000_000) × 0.50`
- **Text input tokens** ≈ system prompt tokens + (for each RAG injection) tokens in the `Knowledge:\n{chunks}` block. If the API does not break out "text input" vs "audio input", estimate text tokens from character count (e.g. ~4 characters per token for English), then apply the formula above.

### Example (illustrative)

- System prompt: ~800 characters → ~200 tokens.
- One RAG injection: 3 chunks, ~1,500 characters → ~375 tokens.
- Total text input for that turn: ~575 tokens.
- **Text input cost** ≈ `(575 / 1_000_000) × 0.50` ≈ **$0.00029** (about **₹0.02** at 83 INR/USD) for that injection.
- Over a 10-minute call with 5 RAG injections and a fixed system prompt, text input might be a few thousand tokens total → **text-only cost** on the order of **$0.002–0.005** per call (roughly **₹0.17–0.42**), with the rest of the cost from audio input/output.

### Summary table (documentation only)

| Component | Rate (USD per 1M tokens) | Use for |
|-----------|--------------------------|---------|
| **Text input** (system prompt + RAG) | $0.50 | Calculate RAG/text cost separately: `(textInputTokens / 1e6) × 0.50` |
| **Audio input** (user speech) | $3.00 | Part of total input when not split by type |
| **Audio output** (model speech) | $12.00 | Part of total output |

So: **RAG + system prompt sent as text to the Live API should be calculated separately** using the **text input** rate ($0.50/1M tokens). This gives you a separate "cost of text/RAG" line in your own cost breakdown. Documentation and manual/spreadsheet estimates only; no implementation in code.

---

## In this codebase

- **Call cost** is stored in `CallSession.estimatedCostUsd` (from usage reported by the agent or computed from tokens).
- **Cost per minute** is computed as:  
  `estimatedCostUsd / (durationSeconds / 60)`  
  and exposed as `costPerMinuteUsd` in the API and UI when both cost and duration exist.
- For V2V, if the backend receives **input and output token counts** (e.g. from `usage.updated`), it can compute `estimatedCostUsd` using the formula above so that cost-per-minute is consistent with Google’s pricing.

---

## Where to get official prices

- **Google AI Studio** — model card for `gemini-2.5-flash-native-audio-preview-12-2025` (Live API, Paid Tier per 1M tokens).
- [Vertex AI pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing)  
- [Google AI (Gemini) pricing](https://ai.google.dev/pricing)  

Rates may differ by product (AI Studio vs Vertex) and over time; use the latest docs for exact numbers. Preview models may have more restrictive rate limits.
