"""
Job Reminder Scheduler -- VISP-INT-NOTIFICATIONS-003
=====================================================

Background task that periodically scans for jobs starting within the next
10-12 minutes and sends a push notification reminder to the assigned
provider.

Usage (integrated into the FastAPI app lifecycle)::

    from src.services.reminderScheduler import start_reminder_scheduler, stop_reminder_scheduler

    @app.on_event("startup")
    async def startup():
        await start_reminder_scheduler()

    @app.on_event("shutdown")
    async def shutdown():
        await stop_reminder_scheduler()

The scheduler uses asyncio.create_task and sleeps between runs -- no
external dependency like Celery or APScheduler is required for this
single periodic task.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from src.api.deps import async_session_factory
from src.models.job import Job, JobAssignment, JobStatus, AssignmentStatus
from src.services import notificationService

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# How often (in seconds) the scheduler checks for upcoming jobs
CHECK_INTERVAL_SECONDS: int = 60

# The reminder window: jobs starting within 10–12 minutes from now will
# get a reminder.  The 2-minute window covers clock drift between runs.
REMINDER_WINDOW_MIN_MINUTES: int = 10
REMINDER_WINDOW_MAX_MINUTES: int = 12

# Internal state
_scheduler_task: asyncio.Task | None = None
_running: bool = False

# Track already-reminded jobs to avoid duplicate notifications
_reminded_jobs: set[uuid.UUID] = set()


# ---------------------------------------------------------------------------
# Core logic
# ---------------------------------------------------------------------------

async def _check_and_send_reminders() -> None:
    """Find jobs starting within the reminder window and send notifications."""
    now = datetime.now(timezone.utc)
    window_start = now + timedelta(minutes=REMINDER_WINDOW_MIN_MINUTES)
    window_end = now + timedelta(minutes=REMINDER_WINDOW_MAX_MINUTES)

    try:
        async with async_session_factory() as db:
            # Query for jobs with a scheduled_start within the reminder window
            stmt = (
                select(Job)
                .options(
                    selectinload(Job.assignments).selectinload(JobAssignment.provider),
                )
                .where(
                    Job.scheduled_start.isnot(None),
                    Job.scheduled_start >= window_start,
                    Job.scheduled_start <= window_end,
                    # Only jobs that are confirmed / assigned
                    Job.status.in_([
                        JobStatus.PROVIDER_ACCEPTED,
                        JobStatus.MATCHED,
                    ]),
                )
            )
            result = await db.execute(stmt)
            upcoming_jobs = result.scalars().all()

            if not upcoming_jobs:
                return

            logger.info(
                "Reminder check: found %d jobs starting in %d-%d minutes",
                len(upcoming_jobs),
                REMINDER_WINDOW_MIN_MINUTES,
                REMINDER_WINDOW_MAX_MINUTES,
            )

            for job in upcoming_jobs:
                # Skip already-reminded jobs in this cycle
                if job.id in _reminded_jobs:
                    continue

                # Find the accepted assignment
                provider_user_id: uuid.UUID | None = None
                for assignment in job.assignments:
                    if assignment.status in (
                        AssignmentStatus.ACCEPTED,
                        AssignmentStatus.OFFERED,
                    ):
                        if assignment.provider:
                            provider_user_id = assignment.provider.user_id
                            break

                if provider_user_id is None:
                    logger.warning(
                        "No active provider for job %s, skipping reminder",
                        job.id,
                    )
                    continue

                # Calculate minutes until start
                minutes_until = int(
                    (job.scheduled_start - now).total_seconds() / 60
                )

                try:
                    await notificationService.notify_job_reminder(
                        job_id=job.id,
                        provider_id=provider_user_id,
                        minutes_until_start=minutes_until,
                        db=db,
                    )
                    _reminded_jobs.add(job.id)
                    logger.info(
                        "Sent reminder for job %s to provider %s (%d min)",
                        job.id,
                        provider_user_id,
                        minutes_until,
                    )
                except Exception:
                    logger.exception(
                        "Failed to send reminder for job %s", job.id
                    )

            await db.commit()

    except Exception:
        logger.exception("Error in reminder scheduler check")


async def _run_scheduler() -> None:
    """Main loop: check for reminders every CHECK_INTERVAL_SECONDS."""
    global _running
    logger.info("Reminder scheduler started (interval=%ds)", CHECK_INTERVAL_SECONDS)

    while _running:
        await _check_and_send_reminders()

        # Clean up old reminded jobs (older than 1 hour) to limit memory
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(hours=1)
        try:
            async with async_session_factory() as db:
                old_jobs_stmt = select(Job.id).where(
                    Job.id.in_(list(_reminded_jobs)),
                    Job.scheduled_start < cutoff,
                )
                result = await db.execute(old_jobs_stmt)
                old_ids = {row[0] for row in result.all()}
                _reminded_jobs.difference_update(old_ids)
        except Exception:
            pass  # Cleanup is best-effort

        await asyncio.sleep(CHECK_INTERVAL_SECONDS)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def start_reminder_scheduler() -> None:
    """Start the background reminder scheduler task."""
    global _scheduler_task, _running

    if _scheduler_task is not None:
        logger.warning("Reminder scheduler is already running")
        return

    _running = True
    _scheduler_task = asyncio.create_task(_run_scheduler())
    logger.info("Reminder scheduler started")


async def stop_reminder_scheduler() -> None:
    """Stop the background reminder scheduler task."""
    global _scheduler_task, _running

    _running = False

    if _scheduler_task is not None:
        _scheduler_task.cancel()
        try:
            await _scheduler_task
        except asyncio.CancelledError:
            pass
        _scheduler_task = None
        logger.info("Reminder scheduler stopped")
