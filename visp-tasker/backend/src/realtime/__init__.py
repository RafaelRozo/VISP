"""
VISP Real-time Module
==============================

WebSocket server and event handlers for real-time communication.

Usage in FastAPI app startup::

    from src.realtime import socket_app, sio
    app.mount("/", socket_app)

Or for more control::

    from src.realtime.socketServer import sio, socket_app
    from src.realtime.handlers import jobHandler, locationHandler, chatHandler

The ``handlers`` sub-package registers all Socket.IO event handlers
as a side-effect of import, so simply importing it is sufficient to
activate all real-time event processing.
"""

from __future__ import annotations

from .socketServer import (
    broadcast_emergency,
    broadcast_to_job,
    get_redis,
    send_to_user,
    sio,
    socket_app,
)

# Importing handlers registers the Socket.IO event listeners
from . import handlers  # noqa: F401

__all__ = [
    "sio",
    "socket_app",
    "broadcast_to_job",
    "send_to_user",
    "broadcast_emergency",
    "get_redis",
    "handlers",
]
