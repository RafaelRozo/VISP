"""
Weekly Score Normalizer Job -- VISP-BE-SCORING-005.

Runs once per week (via Celery Beat, AWS EventBridge, or a cron scheduler)
to recover provider scores.  Providers who have been incident-free for one
or more weeks receive +5 points per incident-free week, capped at their
level's base score.

Recovery rules:
- Only active providers are eligible.
- Suspended providers are skipped.
- Recovery stops at the level's base score (never exceeds it).
- Each invocation recovers for the most recent incident-free period.

Usage with Celery::

    from src.jobs.scoreNormalizer import run_weekly_score_normalization

    @celery_app.task
    def weekly_score_normalize():
        import asyncio
        asyncio.run(run_weekly_score_normalization())

Usage with a simple cron runner::

    python -m src.jobs.scoreNormalizer
"""

from __future__ import annotations

import asyncio
import logging
from decimal import Decimal
from typing import Optional

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import (
    ProviderProfile,
    ProviderProfileStatus,
)
from src.services.scoringEngine import (
    LEVEL_SCORE_CONFIG,
    NormalizationBatchResult,
    NormalizationResult,
    normalize_score,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Main weekly job
# ---------------------------------------------------------------------------

async def run_weekly_score_normalization(
    db: AsyncSession,
) -> NormalizationBatchResult:
    """Execute the weekly score normalization for all eligible providers.

    Finds all active providers whose score is below their level's base score
    and applies the recovery logic.

    Args:
        db: Async database session.

    Returns:
        NormalizationBatchResult with aggregate and per-provider results.
    """
    logger.info("Starting weekly score normalization...")

    # Find providers eligible for recovery:
    # - Status is ACTIVE
    # - Score is below their level's base score
    # We fetch all active providers and filter in Python because the base
    # score depends on the provider's current level (not a single threshold).
    stmt = select(ProviderProfile).where(
        ProviderProfile.status == ProviderProfileStatus.ACTIVE,
    )
    result = await db.execute(stmt)
    providers = result.scalars().all()

    results: list[NormalizationResult] = []
    total_recovered = Decimal("0")
    providers_recovered = 0

    for provider in providers:
        config = LEVEL_SCORE_CONFIG.get(provider.current_level)
        if config is None:
            continue

        current_score = Decimal(str(provider.internal_score))
        if current_score >= config.base:
            continue  # Already at or above base, skip

        try:
            norm_result = await normalize_score(db=db, provider_id=provider.id)
            results.append(norm_result)

            if norm_result.points_recovered > 0:
                total_recovered += norm_result.points_recovered
                providers_recovered += 1
        except ValueError:
            logger.warning(
                "Score normalization failed for provider %s (not found?)",
                provider.id,
            )
            continue

    await db.flush()

    batch_result = NormalizationBatchResult(
        providers_processed=len(results),
        providers_recovered=providers_recovered,
        total_points_recovered=total_recovered,
        results=results,
    )

    logger.info(
        "Weekly score normalization completed: processed=%d, recovered=%d, "
        "total_points=%s",
        batch_result.providers_processed,
        batch_result.providers_recovered,
        batch_result.total_points_recovered,
    )

    return batch_result


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

async def _cli_main() -> None:
    """Entry point for running the score normalizer from the command line."""
    from src.api.deps import async_session_factory

    async with async_session_factory() as session:
        try:
            result = await run_weekly_score_normalization(session)
            await session.commit()
            print(  # noqa: T201
                f"Score normalization completed: "
                f"processed={result.providers_processed}, "
                f"recovered={result.providers_recovered}, "
                f"total_points={result.total_points_recovered}"
            )
        except Exception:
            await session.rollback()
            logger.exception("Score normalization failed")
            raise
        finally:
            await session.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(_cli_main())
