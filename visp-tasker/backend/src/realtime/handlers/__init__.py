"""
VISP Real-time Handlers
===============================

WebSocket event handlers for the three namespaces:
  - /jobs     -- job lifecycle events (jobHandler)
  - /location -- provider location tracking (locationHandler)
  - /chat     -- in-app messaging (chatHandler)

Importing this module registers all event handlers with the shared
Socket.IO server instance.
"""

from __future__ import annotations

from . import chatHandler, jobHandler, locationHandler

__all__ = [
    "jobHandler",
    "locationHandler",
    "chatHandler",
]
