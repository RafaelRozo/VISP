"""
Firebase Cloud Messaging (FCM) Push Service -- VISP-INT-NOTIFICATIONS-003
==========================================================================

Low-level integration with Firebase Admin SDK for sending push notifications.
Handles single-device, multi-device (batch), and topic-based messaging, as
well as topic subscription management and silent data-only pushes.

Initialization:
  The Firebase Admin SDK is initialised lazily on first use. Credentials
  are loaded from one of two environment variables:
    - FIREBASE_SERVICE_ACCOUNT_PATH  -- path to a JSON service account file
    - FIREBASE_CREDENTIALS_JSON      -- raw JSON string of the service account

Retry logic:
  Transient failures (HTTP 500, 503, connection timeouts) are retried up
  to ``MAX_RETRIES`` times with exponential backoff. Permanent failures
  (invalid token, invalid argument) are returned immediately.

Token invalidation:
  When FCM reports a token as invalid (``UNREGISTERED``, ``INVALID_ARGUMENT``
  on the token field), the token string is included in the ``invalid_tokens``
  list of the result so that the caller can deactivate it in the database.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import dataclass, field
from enum import Enum

import firebase_admin
from firebase_admin import credentials, messaging
from firebase_admin.exceptions import (
    InvalidArgumentError,
    NotFoundError,
    UnavailableError,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration constants
# ---------------------------------------------------------------------------

MAX_RETRIES: int = 3
RETRY_BASE_DELAY_SECONDS: float = 0.5
FCM_BATCH_LIMIT: int = 500  # Firebase allows max 500 tokens per multicast


# ---------------------------------------------------------------------------
# Result types
# ---------------------------------------------------------------------------

class SendStatus(str, Enum):
    """Outcome of an individual send attempt."""
    SUCCESS = "success"
    FAILURE = "failure"
    INVALID_TOKEN = "invalid_token"


@dataclass
class SendResult:
    """Result of sending a single notification."""
    success: bool
    message_id: str | None = None
    error: str | None = None
    invalid_token: bool = False


@dataclass
class BatchSendResult:
    """Aggregate result of sending to multiple devices."""
    success_count: int = 0
    failure_count: int = 0
    results: list[SendResult] = field(default_factory=list)
    invalid_tokens: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Firebase Admin SDK initialisation (lazy singleton)
# ---------------------------------------------------------------------------

_firebase_app: firebase_admin.App | None = None


def _ensure_firebase_initialised() -> firebase_admin.App:
    """Initialise the Firebase Admin SDK if it has not been already.

    Checks for existing default app first to support test environments
    where the app may already be initialised.

    Returns:
        The Firebase App instance.

    Raises:
        RuntimeError: If no credentials are configured.
    """
    global _firebase_app

    if _firebase_app is not None:
        return _firebase_app

    # Check if a default app already exists (e.g. initialised by another module)
    try:
        _firebase_app = firebase_admin.get_app()
        logger.info("Using existing Firebase Admin app")
        return _firebase_app
    except ValueError:
        pass  # No default app yet -- we will create one

    # Load credentials from environment
    service_account_path = os.environ.get("FIREBASE_SERVICE_ACCOUNT_PATH")
    credentials_json = os.environ.get("FIREBASE_CREDENTIALS_JSON")

    if service_account_path:
        logger.info(
            "Initialising Firebase Admin SDK from service account file: %s",
            service_account_path,
        )
        cred = credentials.Certificate(service_account_path)
    elif credentials_json:
        logger.info("Initialising Firebase Admin SDK from JSON environment variable")
        cred = credentials.Certificate(json.loads(credentials_json))
    else:
        raise RuntimeError(
            "Firebase credentials not configured. Set either "
            "FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_CREDENTIALS_JSON "
            "environment variable."
        )

    _firebase_app = firebase_admin.initialize_app(cred)
    logger.info("Firebase Admin SDK initialised successfully")
    return _firebase_app


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _is_transient_error(exc: Exception) -> bool:
    """Return True if the exception represents a transient/retryable error."""
    if isinstance(exc, UnavailableError):
        return True
    # firebase_admin wraps HTTP errors; check common transient codes
    error_str = str(exc).lower()
    transient_indicators = [
        "unavailable",
        "deadline exceeded",
        "internal",
        "timeout",
        "503",
        "500",
    ]
    return any(indicator in error_str for indicator in transient_indicators)


def _is_invalid_token_error(exc: Exception) -> bool:
    """Return True if the error indicates the device token is invalid."""
    if isinstance(exc, (InvalidArgumentError, NotFoundError)):
        return True
    error_str = str(exc).lower()
    return any(
        indicator in error_str
        for indicator in ["unregistered", "not-registered", "invalid-registration"]
    )


def _build_message(
    *,
    token: str | None = None,
    topic: str | None = None,
    title: str | None = None,
    body: str | None = None,
    data: dict[str, str] | None = None,
    badge: int | None = None,
    sound: str | None = None,
    priority: str = "high",
    content_available: bool = False,
) -> messaging.Message:
    """Build a Firebase messaging.Message with proper APNS/Android config.

    Args:
        token: Target device token (mutually exclusive with topic).
        topic: Target topic name (mutually exclusive with token).
        title: Notification title (omit for silent/data-only push).
        body: Notification body text.
        data: Key-value payload delivered to the app.
        badge: iOS badge count.
        sound: Sound file name (``"default"`` for system sound).
        priority: ``"high"`` for time-sensitive, ``"normal"`` for background.
        content_available: Set to True for iOS background delivery.

    Returns:
        A configured ``messaging.Message`` instance.
    """
    # Ensure all data values are strings (FCM requirement)
    str_data: dict[str, str] | None = None
    if data:
        str_data = {k: str(v) for k, v in data.items()}

    # APNS (iOS) configuration
    apns_payload_fields: dict = {}
    aps_fields: dict = {}

    if badge is not None:
        aps_fields["badge"] = badge
    if sound:
        aps_fields["sound"] = sound
    if content_available:
        aps_fields["content-available"] = 1

    if aps_fields:
        apns_payload_fields["aps"] = messaging.Aps(**aps_fields)

    apns_config = messaging.APNSConfig(
        headers={"apns-priority": "10" if priority == "high" else "5"},
        payload=messaging.APNSPayload(**apns_payload_fields) if apns_payload_fields else None,
    )

    # Android configuration
    android_priority = "high" if priority == "high" else "normal"
    android_config = messaging.AndroidConfig(
        priority=android_priority,
        notification=messaging.AndroidNotification(
            sound=sound or "default",
            channel_id="visp_default" if priority != "high" else "visp_urgent",
        ) if title else None,
    )

    # Notification payload (omitted for silent/data-only push)
    notification = None
    if title:
        notification = messaging.Notification(title=title, body=body)

    return messaging.Message(
        token=token,
        topic=topic,
        notification=notification,
        data=str_data,
        apns=apns_config,
        android=android_config,
    )


async def _send_with_retry(msg: messaging.Message) -> SendResult:
    """Send a single message with retry logic for transient errors.

    Runs the blocking Firebase send call in a thread pool executor to
    avoid blocking the async event loop.

    Args:
        msg: The Firebase Message to send.

    Returns:
        SendResult with success/failure details.
    """
    _ensure_firebase_initialised()

    last_exception: Exception | None = None

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            message_id: str = await asyncio.to_thread(messaging.send, msg)
            return SendResult(success=True, message_id=message_id)
        except Exception as exc:
            last_exception = exc

            if _is_invalid_token_error(exc):
                logger.warning("Invalid FCM token detected: %s", exc)
                return SendResult(
                    success=False,
                    error=f"Invalid token: {exc}",
                    invalid_token=True,
                )

            if _is_transient_error(exc) and attempt < MAX_RETRIES:
                delay = RETRY_BASE_DELAY_SECONDS * (2 ** (attempt - 1))
                logger.warning(
                    "Transient FCM error (attempt %d/%d), retrying in %.1fs: %s",
                    attempt,
                    MAX_RETRIES,
                    delay,
                    exc,
                )
                await asyncio.sleep(delay)
                continue

            # Non-transient or final attempt
            logger.error("FCM send failed after %d attempts: %s", attempt, exc)
            return SendResult(success=False, error=str(exc))

    # Should not reach here, but guard against it
    return SendResult(
        success=False,
        error=f"Failed after {MAX_RETRIES} retries: {last_exception}",
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def send_notification(
    device_token: str,
    title: str,
    body: str,
    data: dict[str, str] | None = None,
    badge: int | None = None,
    sound: str = "default",
    priority: str = "high",
) -> SendResult:
    """Send a push notification to a single device.

    Args:
        device_token: FCM registration token for the target device.
        title: Notification title displayed to the user.
        body: Notification body text.
        data: Optional key-value payload delivered to the app.
        badge: Optional iOS badge count.
        sound: Sound to play (``"default"`` for system sound).
        priority: ``"high"`` for time-sensitive, ``"normal"`` otherwise.

    Returns:
        SendResult indicating success or failure.
    """
    logger.info(
        "Sending push notification to device: title=%r, priority=%s",
        title,
        priority,
    )

    msg = _build_message(
        token=device_token,
        title=title,
        body=body,
        data=data,
        badge=badge,
        sound=sound,
        priority=priority,
    )

    return await _send_with_retry(msg)


async def send_to_multiple(
    device_tokens: list[str],
    title: str,
    body: str,
    data: dict[str, str] | None = None,
    badge: int | None = None,
    sound: str = "default",
    priority: str = "high",
) -> BatchSendResult:
    """Send a push notification to multiple devices.

    Firebase multicast is limited to 500 tokens per call, so this method
    automatically batches larger lists. Invalid tokens are collected in the
    result for the caller to deactivate.

    Args:
        device_tokens: List of FCM registration tokens.
        title: Notification title.
        body: Notification body text.
        data: Optional key-value payload.
        badge: Optional iOS badge count.
        sound: Sound file name.
        priority: Message priority.

    Returns:
        BatchSendResult with per-token results and invalid token list.
    """
    if not device_tokens:
        logger.warning("send_to_multiple called with empty token list")
        return BatchSendResult()

    logger.info(
        "Sending push notification to %d devices: title=%r",
        len(device_tokens),
        title,
    )

    _ensure_firebase_initialised()

    # Ensure all data values are strings
    str_data: dict[str, str] | None = None
    if data:
        str_data = {k: str(v) for k, v in data.items()}

    batch_result = BatchSendResult()

    # Process in batches of FCM_BATCH_LIMIT
    for batch_start in range(0, len(device_tokens), FCM_BATCH_LIMIT):
        batch_tokens = device_tokens[batch_start : batch_start + FCM_BATCH_LIMIT]

        # APNS config
        apns_payload_fields: dict = {}
        aps_fields: dict = {}
        if badge is not None:
            aps_fields["badge"] = badge
        if sound:
            aps_fields["sound"] = sound
        if aps_fields:
            apns_payload_fields["aps"] = messaging.Aps(**aps_fields)

        apns_config = messaging.APNSConfig(
            headers={"apns-priority": "10" if priority == "high" else "5"},
            payload=messaging.APNSPayload(**apns_payload_fields) if apns_payload_fields else None,
        )

        android_config = messaging.AndroidConfig(
            priority="high" if priority == "high" else "normal",
            notification=messaging.AndroidNotification(
                sound=sound or "default",
                channel_id="visp_default" if priority != "high" else "visp_urgent",
            ),
        )

        multicast = messaging.MulticastMessage(
            tokens=batch_tokens,
            notification=messaging.Notification(title=title, body=body),
            data=str_data,
            apns=apns_config,
            android=android_config,
        )

        try:
            response: messaging.BatchResponse = await asyncio.to_thread(
                messaging.send_each_for_multicast, multicast
            )
        except Exception as exc:
            logger.error("Batch send failed for %d tokens: %s", len(batch_tokens), exc)
            for token in batch_tokens:
                batch_result.failure_count += 1
                batch_result.results.append(
                    SendResult(success=False, error=str(exc))
                )
            continue

        for idx, send_response in enumerate(response.responses):
            if send_response.success:
                batch_result.success_count += 1
                batch_result.results.append(
                    SendResult(success=True, message_id=send_response.message_id)
                )
            else:
                batch_result.failure_count += 1
                error = send_response.exception
                is_invalid = _is_invalid_token_error(error) if error else False

                if is_invalid:
                    batch_result.invalid_tokens.append(batch_tokens[idx])

                batch_result.results.append(
                    SendResult(
                        success=False,
                        error=str(error) if error else "Unknown error",
                        invalid_token=is_invalid,
                    )
                )

    if batch_result.invalid_tokens:
        logger.warning(
            "Batch send found %d invalid tokens", len(batch_result.invalid_tokens)
        )

    logger.info(
        "Batch send complete: %d success, %d failures",
        batch_result.success_count,
        batch_result.failure_count,
    )

    return batch_result


async def send_to_topic(
    topic: str,
    title: str,
    body: str,
    data: dict[str, str] | None = None,
    sound: str = "default",
    priority: str = "high",
) -> SendResult:
    """Send a push notification to all devices subscribed to a topic.

    Args:
        topic: The FCM topic name (e.g. ``"emergency_on_call"``).
        title: Notification title.
        body: Notification body text.
        data: Optional key-value payload.
        sound: Sound file name.
        priority: Message priority.

    Returns:
        SendResult indicating success or failure.
    """
    logger.info("Sending topic notification: topic=%r, title=%r", topic, title)

    msg = _build_message(
        topic=topic,
        title=title,
        body=body,
        data=data,
        sound=sound,
        priority=priority,
    )

    return await _send_with_retry(msg)


async def subscribe_to_topic(
    device_tokens: list[str],
    topic: str,
) -> bool:
    """Subscribe device tokens to an FCM topic.

    Args:
        device_tokens: List of FCM registration tokens to subscribe.
        topic: Topic name to subscribe to.

    Returns:
        True if the subscription was successful (all tokens subscribed),
        False if any tokens failed.
    """
    if not device_tokens:
        logger.warning("subscribe_to_topic called with empty token list")
        return False

    _ensure_firebase_initialised()

    logger.info(
        "Subscribing %d tokens to topic %r", len(device_tokens), topic
    )

    try:
        response: messaging.TopicManagementResponse = await asyncio.to_thread(
            messaging.subscribe_to_topic, device_tokens, topic
        )
        if response.failure_count > 0:
            logger.warning(
                "Topic subscribe partial failure: %d/%d failed for topic %r",
                response.failure_count,
                len(device_tokens),
                topic,
            )
            return False
        logger.info(
            "Successfully subscribed %d tokens to topic %r",
            response.success_count,
            topic,
        )
        return True
    except Exception as exc:
        logger.error("Failed to subscribe tokens to topic %r: %s", topic, exc)
        return False


async def unsubscribe_from_topic(
    device_tokens: list[str],
    topic: str,
) -> bool:
    """Unsubscribe device tokens from an FCM topic.

    Args:
        device_tokens: List of FCM registration tokens to unsubscribe.
        topic: Topic name to unsubscribe from.

    Returns:
        True if the unsubscription was successful (all tokens removed),
        False if any tokens failed.
    """
    if not device_tokens:
        logger.warning("unsubscribe_from_topic called with empty token list")
        return False

    _ensure_firebase_initialised()

    logger.info(
        "Unsubscribing %d tokens from topic %r", len(device_tokens), topic
    )

    try:
        response: messaging.TopicManagementResponse = await asyncio.to_thread(
            messaging.unsubscribe_from_topic, device_tokens, topic
        )
        if response.failure_count > 0:
            logger.warning(
                "Topic unsubscribe partial failure: %d/%d failed for topic %r",
                response.failure_count,
                len(device_tokens),
                topic,
            )
            return False
        logger.info(
            "Successfully unsubscribed %d tokens from topic %r",
            response.success_count,
            topic,
        )
        return True
    except Exception as exc:
        logger.error("Failed to unsubscribe tokens from topic %r: %s", topic, exc)
        return False


async def send_silent_notification(
    device_token: str,
    data: dict[str, str],
) -> SendResult:
    """Send a silent (data-only) push notification for background processing.

    Silent pushes have no visible notification. On iOS they use
    ``content-available`` to wake the app in the background.

    Args:
        device_token: FCM registration token for the target device.
        data: Key-value payload delivered to the app.

    Returns:
        SendResult indicating success or failure.
    """
    logger.info("Sending silent notification to device")

    msg = _build_message(
        token=device_token,
        data=data,
        priority="high",
        content_available=True,
    )

    return await _send_with_retry(msg)
