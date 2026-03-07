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

# Backend RAG: optional. Set VOICEAI_API_URL and VOICEAI_API_KEY for V2V RAG.
VOICEAI_API_URL = (os.getenv("VOICEAI_API_URL") or "http://127.0.0.1:3000").rstrip("/")
VOICEAI_API_KEY = (os.getenv("VOICEAI_API_KEY") or "").strip()


async def retrieve_rag_chunks(query: str, knowledge_base_id: str, limit: int = 5) -> list[dict[str, Any]]:
    """Call backend POST /api/v1/rag/retrieve. Returns list of {content, documentId, score}. On failure returns []."""
    if not query or not knowledge_base_id or not VOICEAI_API_KEY:
        return []
    url = f"{VOICEAI_API_URL}/api/v1/rag/retrieve"
    headers = {"Authorization": f"Bearer {VOICEAI_API_KEY}", "Content-Type": "application/json"}
    payload = {"knowledgeBaseId": knowledge_base_id, "query": query, "limit": limit}
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(url, json=payload, headers=headers, timeout=5.0)
            resp.raise_for_status()
            data = resp.json()
            return data.get("chunks") or []
    except Exception as e:
        logger.warning("RAG retrieve failed: %s", e)
        return []


async def send_voiceai_event(
    call_session_id: str,
    event_name: str,
    payload: dict[str, Any] | None = None,
) -> None:
    """Send a call event to the VoiceAI backend (persisted + broadcast to admin dashboard)."""
    if not call_session_id or not VOICEAI_API_URL:
        return
    url = f"{VOICEAI_API_URL}/api/v1/calls/{call_session_id}/events"
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if VOICEAI_API_KEY:
        headers["Authorization"] = f"Bearer {VOICEAI_API_KEY}"
    body = {"event": event_name, "payload": payload or {}}
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(url, json=body, headers=headers, timeout=5.0)
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
        # Longer timeout for Gemini Live API handshake (default 10s can be too short)
        conn_options = APIConnectOptions(timeout=30.0, max_retry=3)
        return google.realtime.RealtimeModel(
            model="gemini-2.5-flash",
            voice="Puck",
            instructions=SYSTEM_INSTRUCTION,
            language="en-US",
            conn_options=conn_options,
        )
    else:
        raise ValueError(
            f"AI_PROVIDER must be 'OPENAI' or 'GEMINI', got: {AI_PROVIDER!r}. "
            "Set AI_PROVIDER in the environment."
        )


def _create_tts_for_say():
    """Create a TTS instance for session.say() (opening line). Realtime model does not provide TTS for arbitrary text."""
    # Use OpenAI TTS for deterministic opening line; voice matches realtime when OPENAI
    return openai.TTS(model="gpt-4o-mini-tts", voice="alloy")


class Assistant(Agent):
    """Business assistant agent; instructions can be overridden per session (from backend systemPrompt)."""

    def __init__(self, instructions: str | None = None) -> None:
        super().__init__(instructions=(instructions or SYSTEM_INSTRUCTION))

    async def on_enter(self) -> None:
        """LiveKit lifecycle hook: speak the opening line from backend so the greeting is deterministic (no LLM)."""
        try:
            userdata = getattr(self.session, "userdata", None)
            if userdata is None:
                return
            opening_line = (userdata.get("openingLine") or "").strip()
            call_session_id = (userdata.get("callSessionId") or "").strip()
            # Do not speak markdown headers or prompt metadata (e.g. "# Title" or "System prompt:")
            if not opening_line or opening_line.startswith("#") or opening_line.lower().startswith("system prompt"):
                return
            logger.info("on_enter: saying opening line from backend")
            print("Saying opening line from backend (on_enter)", flush=True)
            if call_session_id:
                await send_voiceai_event(call_session_id, "agent.speaking", {"text": "", "timestamp": int(time.time() * 1000)})
            handle = self.session.say(opening_line, allow_interruptions=True)
            await handle
            if call_session_id:
                await send_voiceai_event(
                    call_session_id,
                    "agent.finished",
                    {"text": opening_line, "timestamp": int(time.time() * 1000)},
                )
        except Exception as e:
            logger.warning("on_enter greeting failed: %s", e)


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

    # Session userdata: openingLine and callSessionId for on_enter() greeting and event reporting
    session_userdata: dict[str, str] = {
        "openingLine": opening_line or "",
        "callSessionId": call_session_id or "",
    }
    # TTS required for session.say() (opening line); realtime model does not synthesize arbitrary text
    tts = _create_tts_for_say()
    session = AgentSession(
        llm=llm,
        vad=vad,
        tts=tts,
        userdata=session_userdata,
    )

    # Language guardrail: respond in the same language as the caller; do not switch unless caller does
    LANGUAGE_RULE = """
Always respond in the SAME language as the caller.
If the caller speaks English, respond only in English.
Do not switch languages unless the caller clearly switches language first.
""".strip()
    base_instructions = LANGUAGE_RULE + "\n\n" + user_prompt
    print("Language guardrail applied", flush=True)
    print("System prompt loaded", flush=True)

    logger.info("Loaded system prompt: %s", (base_instructions[:120] + "..." if len(base_instructions) > 120 else base_instructions))
    print("Loaded system prompt:", (base_instructions[:200] + "..." if len(base_instructions) > 200 else base_instructions), flush=True)

    if knowledge_base_id:
        logger.info("V2V RAG enabled for knowledgeBaseId=%s", knowledge_base_id[:8] + "...")
    else:
        logger.debug("No knowledgeBaseId in metadata, RAG disabled for this session")

    def _build_instructions(rag_context: str | None) -> str:
        if not rag_context or not rag_context.strip():
            return base_instructions
        return (
            base_instructions
            + "\n\nUse the following knowledge when answering the user.\n\n"
            + rag_context.strip()
            + "\n\nAnswer naturally and conversationally based on the above when relevant."
        )

    async def _on_user_transcribed_async(ev: Any) -> None:
        """Send transcript events to backend; on final transcript run RAG and update agent instructions."""
        transcript = (getattr(ev, "transcript", None) or "").strip()
        is_final = getattr(ev, "is_final", False)
        ts_ms = int(time.time() * 1000)
        payload: dict[str, Any] = {"text": transcript, "timestamp": ts_ms}

        if call_session_id:
            if is_final:
                logger.info("Sending transcript.final")
                print("Sending transcript.final", flush=True)
                await send_voiceai_event(call_session_id, "transcript.final", payload)
            else:
                logger.debug("Sending transcript.partial")
                await send_voiceai_event(call_session_id, "transcript.partial", payload)

        if not is_final or not transcript or not knowledge_base_id:
            return
        logger.info("RAG query: %s", transcript[:80] + ("..." if len(transcript) > 80 else ""))
        try:
            chunks = await retrieve_rag_chunks(transcript, knowledge_base_id, limit=5)
        except Exception as e:
            logger.warning("RAG retrieve error: %s", e)
            chunks = []
        if chunks:
            context = "\n\n".join((c.get("content") or "").strip() for c in chunks if c.get("content"))
            if context.strip():
                new_instructions = _build_instructions(context)
                try:
                    # Agent may have update_instructions (session does not in this SDK version)
                    update_fn = getattr(assistant, "update_instructions", None)
                    if callable(update_fn):
                        await update_fn(new_instructions)
                        logger.info("Using RAG context (%d chunks)", len(chunks))
                        print("Using RAG context", flush=True)
                    else:
                        logger.debug("Agent has no update_instructions, RAG context not applied mid-session")
                except Exception as e:
                    logger.warning("update_instructions failed: %s", e)
            else:
                logger.debug("No RAG context found (empty chunks)")
                print("No RAG context found", flush=True)
        else:
            logger.debug("No RAG context found (no chunks returned)")
            print("No RAG context found", flush=True)

    def _on_user_transcribed(ev: Any) -> None:
        """Sync wrapper: framework requires sync callback; schedule async RAG handler."""
        asyncio.create_task(_on_user_transcribed_async(ev))

    try:
        session.on("user_input_transcribed", _on_user_transcribed)
    except Exception as e:
        logger.debug("Could not subscribe to user_input_transcribed: %s", e)

    # Capture assistant reply text from conversation_item_added for transcript payload
    last_assistant_text: list[str] = [""]

    def _on_conversation_item_added(ev: Any) -> None:
        item = getattr(ev, "item", ev)
        role = getattr(item, "role", None) or (item.get("role") if isinstance(item, dict) else None)
        if role == "assistant":
            text = _message_text(item)
            if text:
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

    # Greeting is handled only in Assistant.on_enter() via session.say(openingLine); no generate_reply at startup
    print("Applying base instructions to session", flush=True)
    assistant = Assistant(instructions=base_instructions)
    await session.start(
        room=ctx.room,
        agent=assistant,
    )
    print("Session started", flush=True)

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
