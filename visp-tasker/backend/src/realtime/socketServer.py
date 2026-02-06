"""
WebSocket Server -- VISP-INT-REALTIME-004
==========================================

Main Socket.IO server for the VISP/Tasker platform. Handles real-time
bidirectional communication between mobile clients and the backend for:

  - Job lifecycle events (offers, acceptance, status transitions)
  - Provider location tracking during active jobs
  - In-app chat between customer and provider
  - SLA countdown warnings
  - Emergency broadcasts to Level 4 providers

Architecture:
  - python-socketio AsyncServer mounted as ASGI middleware on FastAPI
  - Redis adapter for horizontal scaling across multiple ECS tasks
  - JWT authentication on connect, extracting user_id and role
  - Room-based routing: job_{job_id}, provider_{user_id}, customer_{user_id}

Connection lifecycle:
  1. Client connects with ``auth: { token: "<jwt>" }``
  2. Server validates JWT, extracts user_id and role
  3. Server joins the user to their personal room (provider_<id> or customer_<id>)
  4. Client explicitly joins job rooms via ``join_job`` event
  5. On disconnect, all room memberships and tracking sessions are cleaned up
"""

from __future__ import annotations

import logging
from typing import Any

import jwt
import socketio
from redis.asyncio import Redis

from src.core.config import settings

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# JWT settings -- in production these come from settings / Secrets Manager
# ---------------------------------------------------------------------------

JWT_SECRET: str = settings.jwt_secret
JWT_ALGORITHM: str = settings.jwt_algorithm


# ---------------------------------------------------------------------------
# Socket.IO server instance
# ---------------------------------------------------------------------------

# Redis adapter URL for pub/sub between multiple server instances
_redis_mgr_url: str = settings.redis_url

# Client manager backed by Redis for horizontal scaling
client_manager = socketio.AsyncRedisManager(
    _redis_mgr_url,
    write_only=False,
)

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=settings.ws_cors_allowed_origins,
    client_manager=client_manager,
    logger=False,
    engineio_logger=False,
    ping_timeout=settings.ws_ping_timeout,
    ping_interval=settings.ws_ping_interval,
    max_http_buffer_size=1_000_000,  # 1 MB
    namespaces=["/jobs", "/location", "/chat"],
)


# ---------------------------------------------------------------------------
# Connection registry: maps user_id -> set of sids (one user, many devices)
# Also maps sid -> user metadata for quick lookup.
# ---------------------------------------------------------------------------

_user_sids: dict[str, set[str]] = {}
_sid_meta: dict[str, dict[str, Any]] = {}


def get_user_sids(user_id: str) -> set[str]:
    """Return all session IDs for a given user (may span multiple devices)."""
    return _user_sids.get(user_id, set())


def get_sid_meta(sid: str) -> dict[str, Any] | None:
    """Return the metadata dict for a given session ID."""
    return _sid_meta.get(sid)


def _register_connection(sid: str, user_id: str, meta: dict[str, Any]) -> None:
    """Track a new connection in the in-process registry."""
    _user_sids.setdefault(user_id, set()).add(sid)
    _sid_meta[sid] = {**meta, "user_id": user_id}


def _unregister_connection(sid: str) -> str | None:
    """Remove a connection from the registry. Returns the user_id or None."""
    meta = _sid_meta.pop(sid, None)
    if meta is None:
        return None
    user_id: str = meta["user_id"]
    user_set = _user_sids.get(user_id)
    if user_set:
        user_set.discard(sid)
        if not user_set:
            del _user_sids[user_id]
    return user_id


# ---------------------------------------------------------------------------
# JWT authentication helper
# ---------------------------------------------------------------------------

def _authenticate_token(token: str | None) -> dict[str, Any] | None:
    """Validate a JWT and return the decoded payload, or None on failure.

    Expected payload fields:
      - sub: str  (user_id as UUID string)
      - role: str (customer | provider | admin)
    """
    if not token:
        return None
    try:
        payload: dict[str, Any] = jwt.decode(
            token,
            JWT_SECRET,
            algorithms=[JWT_ALGORITHM],
        )
        # Minimal validation: must contain sub and role
        if "sub" not in payload or "role" not in payload:
            logger.warning("JWT missing required claims (sub, role)")
            return None
        return payload
    except jwt.ExpiredSignatureError:
        logger.warning("JWT token expired")
        return None
    except jwt.InvalidTokenError as exc:
        logger.warning("Invalid JWT token: %s", exc)
        return None


# ---------------------------------------------------------------------------
# Default namespace connect / disconnect (applies to all namespaces)
# ---------------------------------------------------------------------------

@sio.event
async def connect(sid: str, environ: dict[str, Any], auth: dict[str, Any] | None = None) -> bool:
    """Authenticate the connection and register the user.

    The client must provide ``auth: { token: "<jwt>" }`` on connect.
    Returns ``False`` to reject unauthenticated connections.
    """
    token = (auth or {}).get("token")
    payload = _authenticate_token(token)

    if payload is None:
        logger.info("Connection rejected for sid=%s -- authentication failed", sid)
        return False

    user_id: str = payload["sub"]
    role: str = payload["role"]

    _register_connection(sid, user_id, {"role": role})

    # Auto-join the user's personal room
    personal_room = f"{role}_{user_id}"
    await sio.enter_room(sid, personal_room)

    logger.info(
        "Connected: sid=%s user_id=%s role=%s room=%s",
        sid, user_id, role, personal_room,
    )
    return True


@sio.event
async def disconnect(sid: str) -> None:
    """Clean up rooms and tracking sessions on disconnect."""
    user_id = _unregister_connection(sid)
    if user_id:
        logger.info("Disconnected: sid=%s user_id=%s", sid, user_id)
    else:
        logger.info("Disconnected: sid=%s (no registered user)", sid)


# ---------------------------------------------------------------------------
# Namespace-level connect handlers
# These re-validate via the default connect but also log namespace entry.
# ---------------------------------------------------------------------------

@sio.on("connect", namespace="/jobs")
async def connect_jobs(sid: str, environ: dict[str, Any], auth: dict[str, Any] | None = None) -> bool:
    """Authenticate on /jobs namespace."""
    token = (auth or {}).get("token")
    payload = _authenticate_token(token)
    if payload is None:
        logger.info("Rejected /jobs connect for sid=%s", sid)
        return False
    user_id: str = payload["sub"]
    role: str = payload["role"]
    _register_connection(sid, user_id, {"role": role, "namespace": "/jobs"})
    personal_room = f"{role}_{user_id}"
    await sio.enter_room(sid, personal_room, namespace="/jobs")
    logger.info("Connected /jobs: sid=%s user_id=%s role=%s", sid, user_id, role)
    return True


@sio.on("connect", namespace="/location")
async def connect_location(sid: str, environ: dict[str, Any], auth: dict[str, Any] | None = None) -> bool:
    """Authenticate on /location namespace."""
    token = (auth or {}).get("token")
    payload = _authenticate_token(token)
    if payload is None:
        logger.info("Rejected /location connect for sid=%s", sid)
        return False
    user_id: str = payload["sub"]
    role: str = payload["role"]
    _register_connection(sid, user_id, {"role": role, "namespace": "/location"})
    personal_room = f"{role}_{user_id}"
    await sio.enter_room(sid, personal_room, namespace="/location")
    logger.info("Connected /location: sid=%s user_id=%s role=%s", sid, user_id, role)
    return True


@sio.on("connect", namespace="/chat")
async def connect_chat(sid: str, environ: dict[str, Any], auth: dict[str, Any] | None = None) -> bool:
    """Authenticate on /chat namespace."""
    token = (auth or {}).get("token")
    payload = _authenticate_token(token)
    if payload is None:
        logger.info("Rejected /chat connect for sid=%s", sid)
        return False
    user_id: str = payload["sub"]
    role: str = payload["role"]
    _register_connection(sid, user_id, {"role": role, "namespace": "/chat"})
    personal_room = f"{role}_{user_id}"
    await sio.enter_room(sid, personal_room, namespace="/chat")
    logger.info("Connected /chat: sid=%s user_id=%s role=%s", sid, user_id, role)
    return True


@sio.on("disconnect", namespace="/jobs")
async def disconnect_jobs(sid: str) -> None:
    user_id = _unregister_connection(sid)
    logger.info("Disconnected /jobs: sid=%s user_id=%s", sid, user_id)


@sio.on("disconnect", namespace="/location")
async def disconnect_location(sid: str) -> None:
    user_id = _unregister_connection(sid)
    logger.info("Disconnected /location: sid=%s user_id=%s", sid, user_id)


@sio.on("disconnect", namespace="/chat")
async def disconnect_chat(sid: str) -> None:
    user_id = _unregister_connection(sid)
    logger.info("Disconnected /chat: sid=%s user_id=%s", sid, user_id)


# ---------------------------------------------------------------------------
# Room management events (client-initiated)
# ---------------------------------------------------------------------------

@sio.on("join_job", namespace="/jobs")
async def handle_join_job(sid: str, data: dict[str, Any]) -> dict[str, Any]:
    """Client requests to join a job room on the /jobs namespace.

    Payload: { "job_id": "<uuid>" }
    """
    job_id = data.get("job_id")
    if not job_id:
        return {"ok": False, "error": "job_id is required"}
    room = f"job_{job_id}"
    await sio.enter_room(sid, room, namespace="/jobs")
    logger.info("sid=%s joined room %s on /jobs", sid, room)
    return {"ok": True, "room": room}


@sio.on("leave_job", namespace="/jobs")
async def handle_leave_job(sid: str, data: dict[str, Any]) -> dict[str, Any]:
    """Client requests to leave a job room."""
    job_id = data.get("job_id")
    if not job_id:
        return {"ok": False, "error": "job_id is required"}
    room = f"job_{job_id}"
    await sio.leave_room(sid, room, namespace="/jobs")
    logger.info("sid=%s left room %s on /jobs", sid, room)
    return {"ok": True, "room": room}


@sio.on("join_job", namespace="/location")
async def handle_join_job_location(sid: str, data: dict[str, Any]) -> dict[str, Any]:
    """Client requests to join a job room on the /location namespace."""
    job_id = data.get("job_id")
    if not job_id:
        return {"ok": False, "error": "job_id is required"}
    room = f"job_{job_id}"
    await sio.enter_room(sid, room, namespace="/location")
    logger.info("sid=%s joined room %s on /location", sid, room)
    return {"ok": True, "room": room}


@sio.on("leave_job", namespace="/location")
async def handle_leave_job_location(sid: str, data: dict[str, Any]) -> dict[str, Any]:
    """Client requests to leave a job room on the /location namespace."""
    job_id = data.get("job_id")
    if not job_id:
        return {"ok": False, "error": "job_id is required"}
    room = f"job_{job_id}"
    await sio.leave_room(sid, room, namespace="/location")
    logger.info("sid=%s left room %s on /location", sid, room)
    return {"ok": True, "room": room}


@sio.on("join_job", namespace="/chat")
async def handle_join_job_chat(sid: str, data: dict[str, Any]) -> dict[str, Any]:
    """Client requests to join a job room on the /chat namespace."""
    job_id = data.get("job_id")
    if not job_id:
        return {"ok": False, "error": "job_id is required"}
    room = f"job_{job_id}"
    await sio.enter_room(sid, room, namespace="/chat")
    logger.info("sid=%s joined room %s on /chat", sid, room)
    return {"ok": True, "room": room}


@sio.on("leave_job", namespace="/chat")
async def handle_leave_job_chat(sid: str, data: dict[str, Any]) -> dict[str, Any]:
    """Client requests to leave a job room on the /chat namespace."""
    job_id = data.get("job_id")
    if not job_id:
        return {"ok": False, "error": "job_id is required"}
    room = f"job_{job_id}"
    await sio.leave_room(sid, room, namespace="/chat")
    logger.info("sid=%s left room %s on /chat", sid, room)
    return {"ok": True, "room": room}


# ---------------------------------------------------------------------------
# High-level broadcast helpers (used by handlers and services)
# ---------------------------------------------------------------------------

async def broadcast_to_job(
    job_id: str,
    event: str,
    data: dict[str, Any],
    *,
    namespace: str = "/jobs",
    skip_sid: str | None = None,
) -> None:
    """Send an event to every client in the job room on the given namespace.

    Args:
        job_id: The job UUID string.
        event: Socket.IO event name (e.g. ``job:accepted``).
        data: Event payload dict.
        namespace: The namespace to broadcast on.
        skip_sid: Optional sid to exclude (the sender).
    """
    room = f"job_{job_id}"
    await sio.emit(event, data, room=room, namespace=namespace, skip_sid=skip_sid)
    logger.debug("Broadcast %s to room=%s ns=%s", event, room, namespace)


async def send_to_user(
    user_id: str,
    event: str,
    data: dict[str, Any],
    *,
    namespace: str = "/jobs",
    role: str | None = None,
) -> None:
    """Send an event to a specific user across all their connected sessions.

    Uses the personal room (``<role>_<user_id>``) if the role is known,
    otherwise falls back to sending to each known sid.

    Args:
        user_id: The user UUID string.
        event: Socket.IO event name.
        data: Event payload dict.
        namespace: The namespace to emit on.
        role: The user role (customer/provider) for room-based delivery.
    """
    if role:
        personal_room = f"{role}_{user_id}"
        await sio.emit(event, data, room=personal_room, namespace=namespace)
        logger.debug("Sent %s to room=%s ns=%s", event, personal_room, namespace)
        return

    # Fallback: send to each known sid for the user
    sids = get_user_sids(user_id)
    for sid in sids:
        await sio.emit(event, data, to=sid, namespace=namespace)
    if sids:
        logger.debug("Sent %s to user=%s via %d sids ns=%s", event, user_id, len(sids), namespace)


async def broadcast_emergency(data: dict[str, Any]) -> None:
    """Broadcast an emergency event to all connected Level 4 providers.

    Iterates the connection registry and emits to every provider session.
    In production, a Redis set of L4 provider IDs or a dedicated room
    (``emergency_providers``) would be more efficient.
    """
    count = 0
    for sid, meta in list(_sid_meta.items()):
        if meta.get("role") == "provider":
            # Emit to all providers on /jobs namespace; the client filters
            # based on their level.  For tighter control, maintain a
            # separate ``emergency_l4`` room populated at connect time
            # when the provider's level is verified.
            await sio.emit("job:emergency_broadcast", data, to=sid, namespace="/jobs")
            count += 1
    logger.info("Emergency broadcast sent to %d provider sessions", count)


# ---------------------------------------------------------------------------
# Redis helper for direct key/value operations (location, throttle, etc.)
# ---------------------------------------------------------------------------

_redis_client: Redis | None = None


async def get_redis() -> Redis:
    """Return a shared async Redis client, creating it lazily."""
    global _redis_client
    if _redis_client is None:
        _redis_client = Redis.from_url(
            _redis_mgr_url,
            decode_responses=True,
        )
    return _redis_client


# ---------------------------------------------------------------------------
# ASGI app for mounting onto FastAPI
# ---------------------------------------------------------------------------

socket_app = socketio.ASGIApp(
    socketio_server=sio,
    socketio_path="/ws/socket.io",
)
