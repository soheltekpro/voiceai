# Debugging the Pipeline Voice Agent

When the pipeline voice agent shows "On call" but **no transcript or agent reply** in the Live Transcript (only `call.started` / `call.connected`), or you **don’t hear any agent voice**, use this guide.

## Why you don’t hear the agent

The agent only speaks after: **your speech** → **STT** → **LLM** → **TTS** → **playback**. If STT always returns empty text, the server never runs LLM or TTS, so **no agent audio is ever sent**. So “no voice” almost always means **STT is returning empty** (see below).

## 1. Enable pipeline debug logging

In the **same process** that serves the WebSocket (usually the main API server, not the voice worker), set:

```bash
export VOICE_DEBUG=1
# or
export LOG_LEVEL=debug
```

Then restart the server and start a Web Call again. Watch the **server** terminal (where you run `npm run dev` or `node dist/index.js`), not the voice worker.

You should see one of these patterns:

| Log | Meaning |
|-----|--------|
| `[voice] pipeline running (batch STT)` | Buffer reached min length; pipeline is running. |
| `[voice] STT returned empty transcript` | STT ran but returned no text → **no LLM/TTS**, so nothing is sent to the UI. |
| `[voice] STT result` + `preview` | STT returned text; pipeline should continue. |
| `[voice] pipeline LLM started` | Pipeline reached the LLM step. |
| `[voice] pipeline TTS started` | Pipeline is generating and sending audio. |
| `[voice] pipeline error` | Pipeline threw; check the `message` in the log and any provider errors. |

If you **only** see repeated `pipeline running (batch STT)` and **never** `STT result` or `STT returned empty transcript`, the pipeline may be stuck in STT (e.g. provider timeout) or errors are being swallowed before our log.

## 2. Interpret your logs

### Repeated "pipeline running (batch STT)" and no transcript

- **STT is returning empty**  
  You should see `[voice] STT returned empty transcript` when debug is on. Common causes:
  - **Silence or very low level** in the captured audio.
  - **Wrong language** (e.g. agent/lang set to one language, user speaking another).
  - **Resampling/format** (pipeline resamples to 16 kHz; if the client sends bad data, STT can return nothing).

- **STT is failing and failing over**  
  You may see `[provider-failover] Voice provider failover triggered` and `[latency-optimization] switch provider`. That means:
  - Primary STT (e.g. OpenAI) failed or was slow → failover to next (e.g. Deepgram).
  - If **all** providers fail, the pipeline will log `[voice] pipeline error` and send an `error` message to the client.

- **High latency**  
  `latency: 1915ms` / `2962ms` etc. mean STT is slow. The pipeline still continues; if you then see `STT result` or `STT returned empty`, the bottleneck was latency, not a hard failure.

### What runs where

- **WebSocket and pipeline** run in the **main API server** (the process that handles `/voice` and the WS). So `[voice] pipeline …` and `[voice] STT …` logs appear in that process.
- **Voice worker** (`npm run worker:voice`) handles **queued** pipeline jobs (e.g. from telephony). For a **Web Call** from the Test UI, the pipeline runs in the **server** that the browser connects to, not necessarily in the worker.

So: to debug "no transcript on Web Call", watch the **server** logs with `VOICE_DEBUG=1`.

## 3. Check environment and config

- **API keys**  
  Batch STT uses the configured STT provider (or fallbacks). If OpenAI is first and fails, you’ll see failover to Deepgram. Ensure:
  - `OPENAI_API_KEY` is set if OpenAI is in the STT chain.
  - `DEEPGRAM_API_KEY` (and optional `DEEPGRAM_MODEL` / `DEEPGRAM_LANGUAGE`) if Deepgram is used.

- **Buffer timing**  
  Pipeline runs when buffered audio length ≥ `MIN_AUDIO_MS` (default 1800 ms). If you speak for less than that before pausing, the pipeline may keep getting small/silent chunks and STT returns empty. Try speaking a clear phrase for ~2+ seconds.

- **Agent STT provider**  
  In the admin, the agent can have a preferred STT provider. If that provider’s key is missing or invalid, failover will occur; if every provider fails, you get `pipeline error`.

## 4. Call trace (optional)

For a given call session you can inspect latency and provider usage:

```bash
curl -s "http://127.0.0.1:3000/debug/calls/:callSessionId"
```

Use the `callSessionId` from the server logs or from the client (e.g. from the Test Voice Agent UI or from `call.started` payload). This shows whether STT/LLM/TTS ran and which provider was used.

## 5. Quick checklist

1. Set `VOICE_DEBUG=1` and restart the **API server** (not only the worker).
2. Start a Web Call and speak clearly for 2+ seconds.
3. In the **server** logs, look for:
   - `STT returned empty transcript` → fix audio level, language, or format; or increase `MIN_AUDIO_MS`.
   - `STT result` but no `pipeline LLM started` → possible LLM or config issue.
   - `pipeline LLM started` and `pipeline TTS started` but no audio in UI → check frontend WS handling and playback.
   - `pipeline error` → read the error message and check the failing provider’s API key and quota.
4. Confirm STT provider keys (OpenAI, Deepgram, etc.) in `backend/.env`.
5. Optionally call `GET /debug/calls/:callSessionId` to see per-call trace.

## Get STT to return text (fix “no agent voice”)

If logs show `[voice] STT returned empty transcript` every time:

1. **Mic level**  
   Speak clearly and close to the mic. In browser, allow mic access and avoid “mute” in the OS or tab. If the mic is very quiet, STT may treat it as silence. The Test UI applies a small gain to the mic; if it’s still too quiet, increase system mic level or use a better mic.

2. **Sample rate**  
   With `VOICE_DEBUG=1` you should see `[voice] pipeline input` with `sampleRate: 48000` (or 44100) when using the browser. If you see `16000` and the client is actually sending 48k, the backend is misinterpreting the audio; ensure the client sends a `config` message with `sampleRate` before sending audio.

3. **Speak long enough**  
   The pipeline runs STT only when buffered audio ≥ `MIN_AUDIO_MS` (default 1800 ms). Speak a full phrase for at least ~2 seconds before pausing so a real chunk is sent to STT.

4. **Language**  
   If the agent or STT is set to one language and you speak another, STT may return empty. Match the agent/language setting to the language you speak.

5. **API keys**  
   If the primary STT provider fails, the backend fails over (e.g. OpenAI → Deepgram). If all providers fail, you get `[voice] pipeline error`. Ensure the provider you’re using (and fallbacks) have valid keys in `backend/.env` (e.g. `OPENAI_API_KEY`, `DEEPGRAM_API_KEY`).

6. **Network / DevTools**  
   In Chrome DevTools → Network → WS → Messages, you should see `↑` (client → server) messages with `type: "audio"` when you speak. If you don’t, the browser isn’t sending mic data. If you do but the server still logs “STT returned empty”, the problem is server-side (format, provider, or audio content).
