"""
Standalone Realtime Voice AI Agent using LiveKit Python Agents Framework.

V2V provider/model/voice come from agent config (v2vProvider, v2vModel, v2vVoice); fallback: AI_PROVIDER env (OPENAI | GEMINI).
Uses Silero VAD for voice activity detection and user interruption handling.
Tracks audio token usage (input + output) per session; logs and sends to frontend via room data.
V2V: uses systemPrompt from job metadata as base instructions; when knowledgeBaseId is set, RAG retrieves chunks and appends to instructions.
"""

import asyncio
import json
import os
import time
from typing import TYPE_CHECKING, Any

from dotenv import load_dotenv

if TYPE_CHECKING:
    from livekit.rtc import Room

load_dotenv()

import httpx
from livekit import agents
from livekit.agents import AgentServer, AgentSession, Agent, JobContext
from livekit.agents.log import logger
from livekit.agents.metrics import RealtimeModelMetrics
from livekit.agents.metrics.usage_collector import UsageCollector
from livekit.agents.types import APIConnectOptions
from livekit.agents.voice.events import MetricsCollectedEvent
from livekit.plugins import google, openai, silero

load_dotenv()

# Backend: optional. Set VOICEAI_API_URL and VOICEAI_API_TOKEN (or VOICEAI_API_KEY) for V2V RAG and event forwarding.
VOICEAI_API_URL = (os.getenv("VOICEAI_API_URL") or "http://127.0.0.1:3000").rstrip("/")
VOICEAI_API_TOKEN = (os.getenv("VOICEAI_API_TOKEN") or os.getenv("VOICEAI_API_KEY") or "").strip()


async def retrieve_rag_chunks(query: str, knowledge_base_id: str, limit: int = 5) -> list[dict[str, Any]]:
    """Call backend POST /api/v1/rag/retrieve. Returns list of {content, documentId, score}. On failure returns []."""
    if not query or not knowledge_base_id or not VOICEAI_API_TOKEN:
        return []
    url = f"{VOICEAI_API_URL}/api/v1/rag/retrieve"
    headers = {"Authorization": f"Bearer {VOICEAI_API_TOKEN}", "Content-Type": "application/json"}
    payload = {"knowledgeBaseId": knowledge_base_id, "query": query, "limit": limit}
    last_err: Exception | None = None
    for attempt in range(2):  # one retry on 429
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(url, json=payload, headers=headers, timeout=5.0)
                resp.raise_for_status()
                data = resp.json()
                return data.get("chunks") or []
        except httpx.HTTPStatusError as e:
            last_err = e
            if e.response.status_code == 429:
                if attempt == 0:
                    await asyncio.sleep(2.0)
                    continue
            break
        except Exception as e:
            last_err = e
            break
    return []


async def send_voiceai_event(
    call_session_id: str,
    event_name: str,
    payload: dict[str, Any] | None = None,
) -> None:
    """Send a call event to the VoiceAI backend (persisted + broadcast to admin dashboard)."""
    if not call_session_id or not VOICEAI_API_URL:
        return
    if not VOICEAI_API_TOKEN:
        return
    url = f"{VOICEAI_API_URL}/api/v1/calls/{call_session_id}/events"
    body = {"event": event_name, "payload": payload or {}}
    headers: dict[str, str] = {
        "Authorization": f"Bearer {VOICEAI_API_TOKEN}",
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(url, json=body, headers=headers)
            resp.raise_for_status()
    except Exception:
        pass


def _message_text(msg: Any) -> str:
    """Extract plain text from a ChatMessage-like object (content string or list of parts)."""
    if msg is None:
        return ""
    content = getattr(msg, "content", None)
    if content is None:
        return ""
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict):
                parts.append(str(part.get("text", part.get("content", ""))))
            else:
                parts.append(str(part))
        return " ".join(parts).strip()
    return str(content).strip()


# Default to OPENAI if not set
AI_PROVIDER = os.getenv("AI_PROVIDER", "OPENAI").upper().strip()


def _validate_env() -> None:
    """Validate API keys for the selected provider. Call at startup."""
    if AI_PROVIDER == "GEMINI":
        key = os.getenv("GOOGLE_API_KEY") or ""
        key = key.strip()
        if not key:
            raise SystemExit(
                "AI_PROVIDER is GEMINI but GOOGLE_API_KEY is not set or is empty.\n"
                "  • Use the env var GOOGLE_API_KEY (not GEMINI_API_KEY).\n"
                "  • Get a key from https://aistudio.google.com/apikey\n"
                "  • Add to your .env: GOOGLE_API_KEY=your_key_here"
            )
    elif AI_PROVIDER == "OPENAI":
        key = os.getenv("OPENAI_API_KEY") or ""
        if not key.strip():
            raise SystemExit(
                "AI_PROVIDER is OPENAI but OPENAI_API_KEY is not set or is empty.\n"
                "  • Add to your .env: OPENAI_API_KEY=your_key_here"
            )

SYSTEM_INSTRUCTION = (
    "You are a helpful business assistant for Tittu's SaaS platform. "
    "Use a friendly, professional tone. "
    "Always speak and respond in English only; do not use any other language."
)


def _create_realtime_llm(provider: str | None = None, model: str | None = None, voice: str | None = None):
    """Create the realtime LLM from agent config (provider, model, voice) or fall back to AI_PROVIDER env."""
    # Prefer agent config from job metadata; fall back to env then defaults
    p = (provider or "").strip().upper() or os.getenv("AI_PROVIDER", "OPENAI").strip().upper()
    if p in ("OPENAI", "GOOGLE"):
        pass
    elif p == "GEMINI":
        p = "GOOGLE"
    else:
        p = "OPENAI"

    model = (model or "").strip() or None
    voice = (voice or "").strip() or None

    if p == "OPENAI":
        return openai.realtime.RealtimeModel(
            model=model or "gpt-4o-realtime-preview",
            voice=voice or "alloy",
        )
    if p == "GOOGLE":
        # Longer timeout (45s) to reduce "generate_reply timed out waiting for generation_created" with Gemini Live
        conn_options = APIConnectOptions(timeout=45.0, max_retry=2)
        return google.realtime.RealtimeModel(
            model=model or "gemini-2.5-flash-native-audio-preview-12-2025",
            voice=voice or "Puck",
            instructions=SYSTEM_INSTRUCTION,
            language="en-US",
            temperature=0.7,
            conn_options=conn_options,
        )
    raise ValueError(
        f"V2V provider must be 'OPENAI' or 'GOOGLE' (or GEMINI), got: {p!r}. "
        "Set v2vProvider in agent settings or AI_PROVIDER in the environment."
    )


def _create_tts_for_say():
    """Create a TTS instance for session.say() (opening line). Uses the same provider as AI_PROVIDER (OPENAI or GEMINI)."""
    if AI_PROVIDER == "OPENAI":
        return openai.TTS(model="gpt-4o-mini-tts", voice="alloy")
    if AI_PROVIDER == "GEMINI":
        # Gemini TTS uses GOOGLE_API_KEY (same as realtime); no Cloud ADC needed
        return google.beta.GeminiTTS(
            model="gemini-2.5-flash-preview-tts",
            voice_name="Puck",
        )
    raise ValueError(f"AI_PROVIDER must be OPENAI or GEMINI, got: {AI_PROVIDER!r}")


class Assistant(Agent):
    """Business assistant agent; instructions can be overridden per session (from backend systemPrompt)."""

    def __init__(self, instructions: str | None = None) -> None:
        super().__init__(instructions=(instructions or SYSTEM_INSTRUCTION))

    async def on_enter(self) -> None:
        """Greeting is triggered in entrypoint after session.start() via session.generate_reply(); no-op here."""
        pass


server = AgentServer()


def _prewarm(proc) -> None:
    """Load Silero VAD once per worker process for faster session start."""
    proc.userdata["vad"] = silero.VAD.load()


server.setup_fnc = _prewarm


USAGE_TOPIC = "voice-usage"


def _on_metrics_collected(
    collector: UsageCollector,
    ev: MetricsCollectedEvent,
    room: "Room | None" = None,
) -> None:
    """Accumulate usage, log, and send to frontend via room data."""
    collector.collect(ev.metrics)
    if not isinstance(ev.metrics, RealtimeModelMetrics):
        return
    m = ev.metrics
    s = collector.get_summary()
    in_audio = m.input_token_details.audio_tokens
    out_audio = m.output_token_details.audio_tokens
    if room is not None:
        payload = {
            "input_audio_tokens": s.llm_input_audio_tokens,
            "output_audio_tokens": s.llm_output_audio_tokens,
            "total_tokens": s.llm_prompt_tokens + s.llm_completion_tokens,
        }
        data = json.dumps(payload).encode("utf-8")
        asyncio.create_task(
            room.local_participant.publish_data(data, topic=USAGE_TOPIC, reliable=True)
        )


def _parse_job_metadata(ctx: JobContext) -> dict[str, Any]:
    """Extract callSessionId, agentId, knowledgeBaseId, systemPrompt from job/room metadata if present."""
    out: dict[str, Any] = {}
    raw: str | None = None
    job = getattr(ctx, "job", None)
    if job is not None:
        raw = getattr(job, "metadata", None)
    if not raw and ctx.room is not None:
        raw = getattr(ctx.room, "metadata", None)
    if raw:
        try:
            out = json.loads(raw) if isinstance(raw, str) else dict(raw)
        except (json.JSONDecodeError, TypeError):
            pass
    return out


@server.rtc_session(agent_name="realtime-voice-agent")
async def entrypoint(ctx: JobContext) -> None:
    """Join the room and run the realtime speech-to-speech agent session."""
    job_meta = _parse_job_metadata(ctx)
    v2v_provider = (job_meta.get("v2vProvider") or "").strip() or None
    v2v_model = (job_meta.get("v2vModel") or "").strip() or None
    v2v_voice = (job_meta.get("v2vVoice") or "").strip() or None
    llm = _create_realtime_llm(provider=v2v_provider, model=v2v_model, voice=v2v_voice)
    vad = ctx.proc.userdata.get("vad") or silero.VAD.load()

    # V2V: read systemPrompt, openingLine, knowledgeBaseId from dispatch metadata (set by backend from agent config)
    system_prompt = (job_meta.get("systemPrompt") or "").strip()
    user_prompt = system_prompt if system_prompt else SYSTEM_INSTRUCTION
    opening_line: str | None = (job_meta.get("openingLine") or "").strip() or None
    knowledge_base_id: str | None = (job_meta.get("knowledgeBaseId") or "").strip() or None
    call_session_id: str | None = (job_meta.get("callSessionId") or "").strip() or None
    call_started_at: float = time.time()

    # Session userdata: callSessionId for event publishing
    session_userdata: dict[str, Any] = {
        "callSessionId": call_session_id or "",
    }
    # Realtime model handles speech output directly; we do not use session.say() for greetings.
    # Lower min_interruption_duration so the agent stops sooner when user speaks (helps Gemini feel more responsive to barge-in).
    # preemptive_generation=False to reduce "generate_reply timed out waiting for generation_created" (known Gemini Live issue).
    try:
        session = AgentSession(
            llm=llm,
            vad=vad,
            userdata=session_userdata,
            min_interruption_duration=0.3,
            preemptive_generation=False,
        )
    except TypeError:
        session = AgentSession(llm=llm, vad=vad, userdata=session_userdata)

    # IMPORTANT: do not modify the agent-configured systemPrompt. The realtime model should receive it verbatim.
    base_instructions = user_prompt if user_prompt else SYSTEM_INSTRUCTION

    if knowledge_base_id:
        pass  # RAG enabled
    else:
        pass  # RAG disabled

    def _build_instructions(rag_context: str | None) -> str:
        if not rag_context or not rag_context.strip():
            return base_instructions
        return base_instructions + "\n\nKnowledge:\n" + rag_context.strip()

    def should_run_rag(text: str) -> bool:
        """Return False for smalltalk/short phrases to avoid excessive embedding calls and rate limits."""
        if not text:
            return False
        t = text.lower().strip()
        smalltalk = [
            "ok",
            "okay",
            "yes",
            "yeah",
            "hmm",
            "go on",
            "no thanks",
            "ठीक है",
            "हां",
            "मैं ठीक हूं",
            "thanks",
            "thank you",
            "i'm fine",
            "im fine",
        ]
        if t in smalltalk:
            return False
        if len(text) < 15:
            return False
        return True

    # RAG pipeline contract:
    # - generate_reply() never waits for RAG; response starts from partial/final immediately.
    # - RAG runs only after transcript.final, in background; results stored for the next turn.
    # - Stored context is injected when building the next prompt, then cleared after use.
    # Note: Long calls can feel slower over time because the realtime model sends full conversation
    # history; larger context can increase time-to-first-audio. This is a limitation of the API.
    rag_memory: list[str] = [""]
    rag_last_run: list[float] = [0.0]
    RAG_COOLDOWN_SEC = 5.0

    def build_instructions() -> str:
        """Instructions for this turn: base + stored RAG context if any. Cleared after use."""
        if rag_memory[0]:
            return base_instructions + "\n\nKnowledge:\n" + rag_memory[0].strip()
        return base_instructions

    async def on_transcript_final(text: str) -> None:
        """Run RAG only after transcript.final; never blocks reply. Schedules run_rag_async for next turn."""
        if not should_run_rag(text):
            return
        now = time.time()
        if now - rag_last_run[0] < RAG_COOLDOWN_SEC:
            return
        asyncio.create_task(run_rag_async(text))

    async def run_rag_async(query: str) -> None:
        """Background: retrieve chunks and store in rag_memory for the next turn. Never blocks reply."""
        rag_last_run[0] = time.time()
        try:
            chunks = await retrieve_rag_chunks(query, knowledge_base_id, limit=5)
        except Exception:
            return
        if not chunks:
            return
        context = "\n".join((c.get("content") or "").strip() for c in chunks if c.get("content"))
        if not context.strip():
            return
        rag_memory[0] = context.strip()

    async def _on_user_transcribed_async(ev: Any) -> None:
        """Send transcript events to backend; inject stored RAG at turn start; on final run RAG async for next turn."""
        transcript = (getattr(ev, "transcript", None) or "").strip()
        is_final = getattr(ev, "is_final", False)
        ts_ms = int(time.time() * 1000)
        payload: dict[str, Any] = {"text": transcript, "timestamp": ts_ms}
        if is_final and transcript:
            user_has_spoken[0] = True

        # Inject stored RAG from previous turn at start of this turn, then clear so it's used only once.
        if transcript and rag_memory[0]:
            update_fn = getattr(assistant, "update_instructions", None)
            if callable(update_fn):
                try:
                    await update_fn(build_instructions())
                except Exception:
                    pass
            rag_memory[0] = ""

        if call_session_id:
            if is_final:
                asyncio.create_task(send_voiceai_event(call_session_id, "transcript.final", payload))
            else:
                asyncio.create_task(send_voiceai_event(call_session_id, "transcript.partial", payload))

        if not is_final or not transcript or not knowledge_base_id:
            return
        if is_final:
            early_reply_triggered[0] = False
            await on_transcript_final(transcript)

    # Only interrupt when the agent is actually speaking (user barge-in). If we interrupt on every user transcript
    # while the agent is listening, we prevent the agent from ever responding.
    agent_speaking: list[bool] = [False]
    has_greeted: list[bool] = [False]
    user_has_spoken: list[bool] = [False]
    early_reply_triggered: list[bool] = [False]

    def _interrupt_agent() -> None:
        """Stop agent speech. Only call when agent is speaking and user is barging in."""
        interrupt_fn = getattr(session, "interrupt", None)
        if callable(interrupt_fn):
            try:
                interrupt_fn()
            except Exception:
                pass
            return
        current = getattr(session, "current_speech", None)
        if current is not None and hasattr(current, "interrupt"):
            try:
                current.interrupt()
            except Exception:
                pass

    def _on_user_transcribed(ev: Any) -> None:
        """Sync wrapper: interrupt only if agent is speaking (barge-in); trigger early reply on partials; run async RAG/events."""
        transcript = (getattr(ev, "transcript", None) or "").strip()
        is_final = getattr(ev, "is_final", False)
        # Mark user has spoken on any transcript with text (partial or final) so we don't interrupt
        # when the model starts responding during partials (Gemini realtime responds early).
        if transcript:
            if not user_has_spoken[0]:
                user_has_spoken[0] = True
        if agent_speaking[0]:
            _interrupt_agent()
        # Start reply only once per user turn on meaningful partial transcripts (Vapi/Ulei-style).
        # generate_reply() returns a SpeechHandle, not a coroutine; do not use create_task or await.
        if (
            not agent_speaking[0]
            and not early_reply_triggered[0]
            and transcript
            and len(transcript) > 6
            and not is_final
        ):
            try:
                session.generate_reply()
                early_reply_triggered[0] = True
            except Exception:
                pass
        asyncio.create_task(_on_user_transcribed_async(ev))

    def _on_user_state_changed(ev: Any) -> None:
        """When user starts speaking, interrupt only if agent is currently speaking (barge-in)."""
        new_state = getattr(ev, "new_state", None) or (ev.get("new_state") if isinstance(ev, dict) else None)
        if new_state == "speaking" and agent_speaking[0]:
            _interrupt_agent()

    def _on_agent_state_changed(ev: Any) -> None:
        """Track when agent is speaking so we only interrupt on barge-in, not when user is speaking normally."""
        new_state = getattr(ev, "new_state", None) or (ev.get("new_state") if isinstance(ev, dict) else None)
        agent_speaking[0] = new_state == "speaking"
        if new_state == "speaking":
            if not has_greeted[0]:
                has_greeted[0] = True
            elif has_greeted[0] and not user_has_spoken[0]:
                _interrupt_agent()

    try:
        session.on("user_input_transcribed", _on_user_transcribed)
    except Exception:
        pass
    try:
        session.on("user_state_changed", _on_user_state_changed)
    except Exception:
        pass
    try:
        session.on("agent_state_changed", _on_agent_state_changed)
    except Exception:
        pass

    # Capture assistant reply text from conversation_item_added for transcript payload
    last_assistant_text: list[str] = [""]

    def _is_greeting_message(message: str) -> bool:
        """True if the assistant message looks like an initial greeting (block only these when user has not spoken)."""
        if not message or not message.strip():
            return False
        m = message.strip().lower()
        return (
            m.startswith("hello")
            or m.startswith("hi ")
            or m.startswith("hi.")
            or "this is priya" in m
            or "calling from abc" in m
            or "calling from" in m
        )

    def _on_conversation_item_added(ev: Any) -> None:
        item = getattr(ev, "item", ev)
        role = getattr(item, "role", None) or (item.get("role") if isinstance(item, dict) else None)
        if role == "assistant":
            text = _message_text(item)
            if text:
                if not has_greeted[0]:
                    has_greeted[0] = True
                # Only suppress a *repeated* greeting (not the first one we triggered). First message has last_assistant_text empty.
                elif (
                    last_assistant_text[0]
                    and not user_has_spoken[0]
                    and _is_greeting_message(text)
                ):
                    _interrupt_agent()
                last_assistant_text[0] = text

    try:
        session.on("conversation_item_added", _on_conversation_item_added)
    except Exception:
        pass

    # Track token usage (audio in + audio out) for this session
    usage_collector = UsageCollector()
    last_usage_send_at: list[float] = [0.0]
    USAGE_SEND_INTERVAL = 2.0  # throttle: send usage to backend at most every 2s

    def _on_metrics(ev: MetricsCollectedEvent) -> None:
        _on_metrics_collected(usage_collector, ev, ctx.room)
        # Send usage to backend incrementally so we have cost/tokens even if user ends call early
        # (shutdown callback may not complete before process exits)
        if not call_session_id:
            return
        now = time.time()
        if now - last_usage_send_at[0] < USAGE_SEND_INTERVAL:
            return
        try:
            s = usage_collector.get_summary()
            in_tok = int(s.llm_input_audio_tokens or 0)
            out_tok = int(s.llm_output_audio_tokens or 0)
            if in_tok == 0 and out_tok == 0:
                return
            last_usage_send_at[0] = now
            duration_seconds = max(0, int(now - call_started_at))
            payload = {
                "inputTokens": in_tok,
                "outputTokens": out_tok,
                "durationSeconds": duration_seconds,
            }
            loop = asyncio.get_event_loop()
            loop.create_task(
                send_voiceai_event(call_session_id, "usage.updated", payload)
            )
        except Exception:
            pass

    session.on("metrics_collected", _on_metrics)

    assistant = Assistant(instructions=base_instructions)
    greeting_triggered: list[bool] = [False]
    await session.start(room=ctx.room, agent=assistant)

    # Gemini realtime does not auto-start; trigger first reply so the model produces the greeting.
    if not greeting_triggered[0]:
        greeting_triggered[0] = True
        try:
            gen_reply = getattr(session, "generate_reply", None)
            if callable(gen_reply):
                gen_reply()
        except Exception:
            pass

    async def _log_final_usage() -> None:
        s = usage_collector.get_summary()
        payload = {
            "input_audio_tokens": s.llm_input_audio_tokens,
            "output_audio_tokens": s.llm_output_audio_tokens,
            "total_tokens": s.llm_prompt_tokens + s.llm_completion_tokens,
        }
        data = json.dumps(payload).encode("utf-8")
        try:
            await ctx.room.local_participant.publish_data(
                data, topic=USAGE_TOPIC, reliable=True
            )
        except Exception:
            pass  # room may already be disconnecting

        # Also send final usage to backend (incremental updates already sent in _on_metrics).
        # This ensures we have the latest counts if shutdown runs; if it doesn't (e.g. user hung up),
        # the last incremental update from metrics_collected is already persisted.
        if call_session_id:
            try:
                duration_seconds = max(0, int(time.time() - call_started_at))
                await send_voiceai_event(
                    call_session_id,
                    "usage.updated",
                    {
                        "inputTokens": int(s.llm_input_audio_tokens or 0),
                        "outputTokens": int(s.llm_output_audio_tokens or 0),
                        "durationSeconds": duration_seconds,
                    },
                )
            except Exception as e:
                logger.warning("failed to send final usage.updated to backend: %s", e)

    ctx.add_shutdown_callback(_log_final_usage)


if __name__ == "__main__":
    _validate_env()
    agents.cli.run_app(server)
