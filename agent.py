"""
Standalone Realtime Voice AI Agent using LiveKit Python Agents Framework.

Supports multi-model switch via AI_PROVIDER env var: OPENAI | GEMINI.
Uses Silero VAD for voice activity detection and user interruption handling.
Tracks audio token usage (input + output) per session; logs and sends to frontend via room data.
"""

import asyncio
import json
import os
from typing import TYPE_CHECKING

from dotenv import load_dotenv

if TYPE_CHECKING:
    from livekit.rtc import Room

load_dotenv()

from livekit import agents
from livekit.agents import AgentServer, AgentSession, Agent, JobContext
from livekit.agents.log import logger
from livekit.agents.metrics import RealtimeModelMetrics
from livekit.agents.metrics.usage_collector import UsageCollector
from livekit.agents.types import APIConnectOptions
from livekit.agents.voice.events import MetricsCollectedEvent
from livekit.plugins import google, openai, silero

load_dotenv()

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
    "You are a helpful business assistant for Devanshu's SaaS platform. "
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


class Assistant(Agent):
    """Business assistant agent with shared system instruction."""

    def __init__(self) -> None:
        super().__init__(instructions=SYSTEM_INSTRUCTION)


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


@server.rtc_session(agent_name="realtime-voice-agent")
async def entrypoint(ctx: JobContext) -> None:
    """Join the room and run the realtime speech-to-speech agent session."""
    llm = _create_realtime_llm()
    vad = ctx.proc.userdata.get("vad") or silero.VAD.load()
    session = AgentSession(
        llm=llm,
        vad=vad,
    )

    # Track token usage (audio in + audio out) for this session
    usage_collector = UsageCollector()

    def _on_metrics(ev: MetricsCollectedEvent) -> None:
        _on_metrics_collected(usage_collector, ev, ctx.room)

    session.on("metrics_collected", _on_metrics)

    await session.start(
        room=ctx.room,
        agent=Assistant(),
    )

    await session.generate_reply(
        instructions="Greet the user in English and offer your assistance."
    )

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
