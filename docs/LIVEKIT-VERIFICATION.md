# LiveKit Integration Verification

This document cross-checks our Voice AI platform against [LiveKit’s official docs](https://docs.livekit.io/intro/overview/) and [GitHub (livekit/livekit)](https://github.com/livekit/livekit) to confirm the V2V path is aligned with LiveKit’s model and best practices.

## LiveKit concepts we use

| LiveKit concept | Our implementation | Status |
|-----------------|--------------------|--------|
| **Rooms** | Backend creates a room by name (`voice-room-{uuid}`). User and agent join the same room. | ✅ |
| **JWT access tokens** | Backend uses `livekit-server-sdk` `AccessToken` with API key/secret, identity, `roomJoin` grant for the room. | ✅ |
| **Agent dispatch** | Backend uses `AgentDispatchClient(host, apiKey, apiSecret)` and `createDispatch(roomName, agentName, { metadata })` so the Python agent is sent to the room. | ✅ |
| **Agent name** | Backend `LIVEKIT_AGENT_NAME = 'realtime-voice-agent'` matches Python `@server.rtc_session(agent_name="realtime-voice-agent")`. | ✅ |
| **Python Agents framework** | We use `livekit-agents` (AgentServer, AgentSession, Agent, JobContext, `rtc_session`). | ✅ |
| **Realtime model** | We use OpenAI or Gemini realtime plugins; no separate STT/LLM/TTS for the main conversation. | ✅ |
| **VAD** | We use Silero VAD for voice activity and interruptions. | ✅ |
| **TTS for `session.say()`** | We attach OpenAI TTS so the opening line can be spoken without the realtime model generating it. | ✅ |
| **Client connection** | Frontend uses `livekit-client` `Room.connect(livekitUrl, livekitToken)` and publishes mic with `setMicrophoneEnabled(true)`. | ✅ |
| **Public vs internal URL** | Backend uses `LIVEKIT_PUBLIC_URL` for the token response (browser) and `LIVEKIT_URL` for dispatch; both can be set for cloud/proxy. | ✅ |

## Flow vs LiveKit docs

1. **Token generation**  
   [Tokens & grants](https://docs.livekit.io/home/server/generating-tokens/): we issue a JWT with identity and `roomJoin: true` for the room. Default TTL is 6h; no change required for normal calls.

2. **Agent as backend participant**  
   [Agents](https://docs.livekit.io): we run a Python agent that connects to LiveKit, registers the worker, and is dispatched into the room when we call `createDispatch`. The agent joins the room and runs `AgentSession` with the realtime model.

3. **Room lifecycle**  
   We create the room implicitly by having the user (and dispatch) join the same room name. We do not call a “create room” API; LiveKit creates the room when the first participant joins. This matches typical LiveKit usage.

4. **Metadata**  
   We pass `callSessionId`, `systemPrompt`, `openingLine`, `knowledgeBaseId`, `agentId` in dispatch metadata (JSON string). The Python agent reads this from job/room metadata and uses it for RAG, greeting, and event reporting.

5. **Human handoff**  
   We issue a separate token for the operator with the same room name so they join the existing room. This follows the standard “generate token for room” pattern.

## What’s implemented correctly

- **Backend**
  - `AccessToken` with correct grants and room.
  - `AgentDispatchClient` and `createDispatch(roomName, agentName, { metadata })`.
  - Single source of LiveKit URL/keys; optional split between `LIVEKIT_URL` (dispatch) and `LIVEKIT_PUBLIC_URL` (client).
  - Call session stores `roomName` in metadata for the join endpoint.

- **Python agent**
  - `AgentServer` and `@server.rtc_session(agent_name="realtime-voice-agent")`.
  - `AgentSession(llm=realtime, vad, tts, userdata)` and `session.start(room, agent=assistant)`.
  - `Agent` subclass with `on_enter()` for deterministic opening line via `session.say()`.
  - Job metadata parsed from `job.metadata` / `room.metadata` for config and RAG.

- **Frontend**
  - `Room.connect(livekitUrl, livekitToken)` and mic enabled for the user.
  - Same flow for operator join (separate token, same room).

## Optional improvements (non-blocking)

1. **Token TTL**  
   AccessToken default is 6h. For operator join you can pass a shorter `ttl` (e.g. `'1h'`) when creating the token for tighter security.

2. **Dispatch failure**  
   If `createDispatch` fails, we log and continue; the user still gets a token. In some setups the agent might auto-join via room name. You can add monitoring/alerting on dispatch failures.

3. **Docs / MCP**  
   [Docs MCP server](https://docs.livekit.io) and [LiveKit 101](https://docs.livekit.io) are useful for keeping patterns and SDK usage up to date.

## Summary

Our V2V path matches LiveKit’s intended use: JWT for room access, agent dispatch by room name and agent name, Python agent with realtime model + VAD + TTS for `say()`, and frontend connecting with the same URL/token pattern as in the docs. No structural gaps were found; the optional items above are small hardening and operational improvements.
