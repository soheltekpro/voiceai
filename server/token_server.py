"""
Token server for self-hosted LiveKit + Voice Agent.

Serves a token endpoint so the frontend can connect to your LiveKit server.
Run from project root: python -m uvicorn server.token_server:app --reload --port 8000
"""

import os
import uuid
from dotenv import load_dotenv

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from livekit.api import AccessToken, VideoGrants
from livekit.protocol.room import RoomConfiguration
from livekit.protocol.agent_dispatch import RoomAgentDispatch

load_dotenv()

# Agent name must match @server.rtc_session(agent_name="...") in agent.py
AGENT_NAME = "realtime-voice-agent"

app = FastAPI(title="Voice Agent Token Server")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class TokenResponse(BaseModel):
    token: str
    url: str


class EndpointTokenRequest(BaseModel):
    room_name: str | None = None
    participant_identity: str | None = None
    participant_name: str | None = None


class EndpointTokenResponse(BaseModel):
    server_url: str
    participant_token: str


def _get_livekit_url() -> str:
    url = os.getenv("LIVEKIT_URL", "").strip()
    if not url:
        raise HTTPException(
            status_code=500,
            detail="LIVEKIT_URL is not set. Add it to your .env.",
        )
    return url.rstrip("/")


def _create_token(
    room_name: str,
    participant_identity: str,
    participant_name: str = "User",
) -> str:
    api_key = os.getenv("LIVEKIT_API_KEY")
    api_secret = os.getenv("LIVEKIT_API_SECRET")
    if not api_key or not api_secret:
        raise HTTPException(
            status_code=500,
            detail="LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set in .env",
        )
    token = (
        AccessToken(api_key=api_key, api_secret=api_secret)
        .with_identity(participant_identity)
        .with_name(participant_name)
        .with_grants(VideoGrants(room_join=True, room=room_name))
        .with_room_config(
            RoomConfiguration(
                agents=[
                    RoomAgentDispatch(agent_name=AGENT_NAME, metadata="{}"),
                ],
            )
        )
        .to_jwt()
    )
    return token


@app.get("/api/token", response_model=TokenResponse)
def get_token(room: str | None = None, identity: str | None = None):
    """GET token (e.g. for simple frontend fetch)."""
    room_name = room or f"voice-room-{uuid.uuid4().hex[:12]}"
    participant_identity = identity or f"user-{uuid.uuid4().hex[:8]}"
    token = _create_token(room_name, participant_identity)
    return TokenResponse(token=token, url=_get_livekit_url())


@app.post("/api/token", response_model=EndpointTokenResponse, status_code=201)
def post_token(body: EndpointTokenRequest | None = None):
    """
    Standard LiveKit token endpoint (POST).
    Body: room_name?, participant_identity?, participant_name?
    """
    body = body or EndpointTokenRequest()
    room_name = body.room_name or f"voice-room-{uuid.uuid4().hex[:12]}"
    participant_identity = body.participant_identity or f"user-{uuid.uuid4().hex[:8]}"
    participant_name = body.participant_name or "User"
    token = _create_token(room_name, participant_identity, participant_name)
    return EndpointTokenResponse(
        server_url=_get_livekit_url(),
        participant_token=token,
    )
