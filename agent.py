"""
Standalone Realtime Voice AI Agent using LiveKit Python Agents Framework.

Supports multi-model switch via AI_PROVIDER env var: OPENAI | GEMINI.
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
                    logger.warning(
                        "RAG 429 Too Many Requests (embedding API rate limit). Retrying once in 2s."
                    )
                    await asyncio.sleep(2.0)
                    continue
                logger.warning(
                    "RAG still rate limited after retry. Reduce RAG calls or increase OpenAI tier."
                )
            break
        except Exception as e:
            last_err = e
            break
    if last_err:
        logger.warning("RAG retrieve failed: %s", last_err)
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
        logger.warning(
            "VOICEAI_API_TOKEN not set. Events will not be sent to backend. "
            "Set VOICEAI_API_TOKEN or VOICEAI_API_KEY in .env"
        )
        return
    url = f"{VOICEAI_API_URL}/api/v1/calls/{call_session_id}/events"
    body = {"event": event_name, "payload": payload or {}}
    headers: dict[str, str] = {
        "Authorization": f"Bearer {VOICEAI_API_TOKEN}",
        "Content-Type": "application/json",
    }
    logger.info("Sending VoiceAI event", extra={"event": event_name, "payload": body})
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(url, json=body, headers=headers)
            if resp.status_code not in (200, 204):
                logger.warning(
                    "VoiceAI event failed: %s %s",
                    resp.status_code,
                    resp.text[:500] if resp.text else "",
                )
            resp.raise_for_status()
    except Exception as e:
        logger.warning("send_voiceai_event %s failed: %s", event_name, e)


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


def _create_realtime_llm():
    """Create the realtime LLM based on AI_PROVIDER (OPENAI or GEMINI)."""
    if AI_PROVIDER == "OPENAI":
        return openai.realtime.RealtimeModel(
            model="gpt-4o-realtime-preview",
            voice="alloy",
        )
    elif AI_PROVIDER == "GEMINI":
        # Use the native-audio model ID that supports bidiGenerateContent (Live API). "gemini-2.5-flash" is not valid for Live.
        # Shorter timeout (15s) for faster fail/retry and lower perceived latency; slightly lower temperature for more focused replies.
        conn_options = APIConnectOptions(timeout=15.0, max_retry=2)
        return google.realtime.RealtimeModel(
            model="gemini-2.5-flash-native-audio-preview-12-2025",
            voice="Puck",
            instructions=SYSTEM_INSTRUCTION,
            language="en-US",
            temperature=0.7,
            conn_options=conn_options,
        )
    else:
        raise ValueError(
            f"AI_PROVIDER must be 'OPENAI' or 'GEMINI', got: {AI_PROVIDER!r}. "
            "Set AI_PROVIDER in the environment."
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
    logger.info(
        "audio usage (this turn) | input_audio_tokens=%s output_audio_tokens=%s | total session: input=%s output=%s",
        in_audio,
        out_audio,
        s.llm_input_audio_tokens,
        s.llm_output_audio_tokens,
    )
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
    llm = _create_realtime_llm()
    vad = ctx.proc.userdata.get("vad") or silero.VAD.load()

    # V2V: read systemPrompt, openingLine, knowledgeBaseId from dispatch metadata (set by backend from agent config)
    job_meta = _parse_job_metadata(ctx)
    system_prompt = (job_meta.get("systemPrompt") or "").strip()
    user_prompt = system_prompt if system_prompt else SYSTEM_INSTRUCTION
    opening_line: str | None = (job_meta.get("openingLine") or "").strip() or None
    knowledge_base_id: str | None = (job_meta.get("knowledgeBaseId") or "").strip() or None
    call_session_id: str | None = (job_meta.get("callSessionId") or "").strip() or None

    # Session userdata: callSessionId for event publishing
    session_userdata: dict[str, Any] = {
        "callSessionId": call_session_id or "",
    }
    # Realtime model handles speech output directly; we do not use session.say() for greetings.
    # Lower min_interruption_duration so the agent stops sooner when user speaks (helps Gemini feel more responsive to barge-in)
    try:
        session = AgentSession(
            llm=llm,
            vad=vad,
            userdata=session_userdata,
            min_interruption_duration=0.3,
        )
    except TypeError:
        session = AgentSession(llm=llm, vad=vad, userdata=session_userdata)

    # IMPORTANT: do not modify the agent-configured systemPrompt. The realtime model should receive it verbatim.
    base_instructions = user_prompt if user_prompt else SYSTEM_INSTRUCTION

    print("System prompt loaded", flush=True)
    logger.info(
        "Loaded system prompt: %s",
        (base_instructions[:200] + "..." if len(base_instructions) > 200 else base_instructions),
    )
    print(
        "Loaded system prompt:",
        (base_instructions[:200] + "..." if len(base_instructions) > 200 else base_instructions),
        flush=True,
    )

    if knowledge_base_id:
        logger.info("V2V RAG enabled for knowledgeBaseId=%s", knowledge_base_id[:8] + "...")
    else:
        logger.debug("No knowledgeBaseId in metadata, RAG disabled for this session")

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
            logger.debug("Skipping RAG for smalltalk query: %s", text)
            return
        now = time.time()
        if now - rag_last_run[0] < RAG_COOLDOWN_SEC:
            logger.debug("Skipping RAG (cooldown %.0fs)", RAG_COOLDOWN_SEC)
            return
        asyncio.create_task(run_rag_async(text))

    async def run_rag_async(query: str) -> None:
        """Background: retrieve chunks and store in rag_memory for the next turn. Never blocks reply."""
        rag_last_run[0] = time.time()
        try:
            chunks = await retrieve_rag_chunks(query, knowledge_base_id, limit=5)
        except Exception as e:
            logger.warning("RAG failed: %s", e)
            return
        if not chunks:
            logger.debug("No RAG context found (no chunks returned)")
            return
        context = "\n".join((c.get("content") or "").strip() for c in chunks if c.get("content"))
        if not context.strip():
            logger.debug("No RAG context found (empty chunks)")
            return
        rag_memory[0] = context.strip()
        logger.info("Stored RAG context for next turn")

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
                except Exception as e:
                    logger.warning("update_instructions failed: %s", e)
            rag_memory[0] = ""

        if call_session_id:
            if is_final:
                logger.info("Sending transcript.final")
                print("Sending transcript.final", flush=True)
                asyncio.create_task(send_voiceai_event(call_session_id, "transcript.final", payload))
            else:
                logger.debug("Sending transcript.partial")
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
                logger.debug("Called session.interrupt() (barge-in)")
            except Exception as e:
                logger.debug("session.interrupt() failed: %s", e)
            return
        current = getattr(session, "current_speech", None)
        if current is not None and hasattr(current, "interrupt"):
            try:
                current.interrupt()
                logger.debug("Called current_speech.interrupt() (barge-in)")
            except Exception as e:
                logger.debug("current_speech.interrupt() failed: %s", e)

    def _on_user_transcribed(ev: Any) -> None:
        """Sync wrapper: interrupt only if agent is speaking (barge-in); trigger early reply on partials; run async RAG/events."""
        transcript = (getattr(ev, "transcript", None) or "").strip()
        is_final = getattr(ev, "is_final", False)
        # Mark user has spoken on any transcript with text (partial or final) so we don't interrupt
        # when the model starts responding during partials (Gemini realtime responds early).
        if transcript:
            if not user_has_spoken[0]:
                user_has_spoken[0] = True
                logger.info("user_has_spoken = True")
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
                logger.debug("Triggered early reply from partial transcript")
            except Exception as e:
                logger.debug("generate_reply failed: %s", e)
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
                logger.info("Assistant speaking (initial greeting)")
            elif has_greeted[0] and not user_has_spoken[0]:
                logger.info("Blocking repeated greeting before user speaks")
                _interrupt_agent()

    try:
        session.on("user_input_transcribed", _on_user_transcribed)
    except Exception as e:
        logger.debug("Could not subscribe to user_input_transcribed: %s", e)

    try:
        session.on("user_state_changed", _on_user_state_changed)
    except Exception as e:
        logger.debug("Could not subscribe to user_state_changed: %s", e)

    try:
        session.on("agent_state_changed", _on_agent_state_changed)
    except Exception as e:
        logger.debug("Could not subscribe to agent_state_changed: %s", e)

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
                    logger.info("Suppressing repeated greeting (assistant message)")
                    _interrupt_agent()
                last_assistant_text[0] = text
                logger.info("Captured assistant transcript: %s", text[:80] + ("..." if len(text) > 80 else ""))
                print("Sending assistant transcript:", text[:100] + ("..." if len(text) > 100 else ""), flush=True)

    try:
        session.on("conversation_item_added", _on_conversation_item_added)
    except Exception as e:
        logger.debug("Could not subscribe to conversation_item_added: %s", e)

    # Track token usage (audio in + audio out) for this session
    usage_collector = UsageCollector()

    def _on_metrics(ev: MetricsCollectedEvent) -> None:
        _on_metrics_collected(usage_collector, ev, ctx.room)

    session.on("metrics_collected", _on_metrics)

    print("Applying base instructions to session", flush=True)
    assistant = Assistant(instructions=base_instructions)
    greeting_triggered: list[bool] = [False]
    await session.start(room=ctx.room, agent=assistant)
    print("Session started", flush=True)

    # Gemini realtime does not auto-start; trigger first reply so the model produces the greeting.
    # generate_reply() returns a SpeechHandle, not a coroutine; do not await.
    if not greeting_triggered[0]:
        greeting_triggered[0] = True
        try:
            gen_reply = getattr(session, "generate_reply", None)
            if callable(gen_reply):
                gen_reply()
                logger.info("Triggered initial greeting via generate_reply()")
            else:
                logger.warning("session.generate_reply not available; realtime model may not greet")
        except Exception as e:
            logger.warning("generate_reply (initial greeting) failed: %s", e)

    async def _log_final_usage() -> None:
        s = usage_collector.get_summary()
        logger.info(
            "session usage total | input_audio_tokens=%s output_audio_tokens=%s | input_text=%s output_text=%s | total_tokens=%s",
            s.llm_input_audio_tokens,
            s.llm_output_audio_tokens,
            s.llm_input_text_tokens,
            s.llm_output_text_tokens,
            s.llm_prompt_tokens + s.llm_completion_tokens,
        )
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

    ctx.add_shutdown_callback(_log_final_usage)


if __name__ == "__main__":
    _validate_env()
    agents.cli.run_app(server)
