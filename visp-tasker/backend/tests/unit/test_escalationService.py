"""
Unit tests for the Auto-Escalation Service -- VISP-BE-ESCALATION-008.

Tests keyword detection, level escalation logic, multi-keyword handling,
and escalation resolution flow.
"""

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.models.job import EscalationType, Job, JobEscalation, JobStatus
from src.models.provider import ProviderLevel
from src.models.taxonomy import ServiceTask
from src.services.escalationService import (
    ESCALATION_KEYWORDS,
    EscalationResult,
    _KEYWORD_PATTERNS,
    _level_value,
    approve_escalation,
    check_escalation,
    reject_escalation,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_job_with_task(
    level: ProviderLevel = ProviderLevel.LEVEL_1,
    job_id: uuid.UUID | None = None,
) -> MagicMock:
    """Create a mock Job with an attached task at the specified level."""
    task = MagicMock(spec=ServiceTask)
    task.id = uuid.uuid4()
    task.level = level

    job = MagicMock(spec=Job)
    job.id = job_id or uuid.uuid4()
    job.task_id = task.id
    job.task = task
    job.status = JobStatus.DRAFT
    job.is_emergency = False
    job.priority = "standard"
    return job


def _make_escalation(
    escalation_id: uuid.UUID | None = None,
    job_id: uuid.UUID | None = None,
    resolved: bool = False,
    from_level: ProviderLevel = ProviderLevel.LEVEL_1,
    to_level: ProviderLevel = ProviderLevel.LEVEL_4,
) -> MagicMock:
    """Create a mock JobEscalation."""
    esc = MagicMock(spec=JobEscalation)
    esc.id = escalation_id or uuid.uuid4()
    esc.job_id = job_id or uuid.uuid4()
    esc.escalation_type = EscalationType.KEYWORD_DETECTED
    esc.from_level = from_level
    esc.to_level = to_level
    esc.trigger_keyword = "flood"
    esc.trigger_description = "Keywords detected: [flood]."
    esc.resolved = resolved
    esc.resolved_at = None
    esc.resolved_by = None
    esc.resolution_notes = None
    esc.created_at = datetime(2025, 2, 1, tzinfo=timezone.utc)
    return esc


def _mock_db_returning_job(job: MagicMock) -> AsyncMock:
    """Create a mock db that returns the given job from _get_job_with_task."""
    db = AsyncMock()
    result_mock = MagicMock()
    result_mock.scalar_one_or_none.return_value = job
    db.execute.return_value = result_mock
    db.add = MagicMock()
    db.flush = AsyncMock()
    return db


# ---------------------------------------------------------------------------
# Keyword detection triggers escalation
# ---------------------------------------------------------------------------


class TestKeywordDetection:
    """Tests that the keyword scanner detects escalation triggers."""

    @pytest.mark.asyncio
    async def test_flood_keyword_triggers_escalation(self):
        """The word 'flood' should trigger a Level 4 escalation."""
        job = _make_job_with_task(level=ProviderLevel.LEVEL_1)
        db = _mock_db_returning_job(job)

        result = await check_escalation(db, job.id, "There is a flood in my basement")

        assert result.should_escalate is True
        assert result.target_level == ProviderLevel.LEVEL_4.value
        assert any(m.keyword == "flood" for m in result.matched_keywords)

    @pytest.mark.asyncio
    async def test_gas_keyword_triggers_level3_escalation(self):
        """The word 'gas' should trigger a Level 3 escalation for a Level 1 job."""
        job = _make_job_with_task(level=ProviderLevel.LEVEL_1)
        db = _mock_db_returning_job(job)

        result = await check_escalation(db, job.id, "I smell gas in my kitchen")

        assert result.should_escalate is True
        assert result.target_level == ProviderLevel.LEVEL_3.value
        assert any(m.keyword == "gas" for m in result.matched_keywords)

    @pytest.mark.asyncio
    async def test_gas_leak_detected_as_gas_keyword(self):
        """The phrase 'gas leak' should match the 'gas' keyword (word boundary)."""
        job = _make_job_with_task(level=ProviderLevel.LEVEL_1)
        db = _mock_db_returning_job(job)

        result = await check_escalation(db, job.id, "Possible gas leak detected")

        assert result.should_escalate is True
        assert any(m.keyword == "gas" for m in result.matched_keywords)

    @pytest.mark.asyncio
    async def test_emergency_keyword_triggers_level4(self):
        """The word 'emergency' should trigger Level 4 escalation."""
        job = _make_job_with_task(level=ProviderLevel.LEVEL_1)
        db = _mock_db_returning_job(job)

        result = await check_escalation(db, job.id, "This is an emergency!")

        assert result.should_escalate is True
        assert result.target_level == ProviderLevel.LEVEL_4.value

    @pytest.mark.asyncio
    async def test_fire_keyword_triggers_level4(self):
        """The word 'fire' should trigger Level 4 escalation."""
        job = _make_job_with_task(level=ProviderLevel.LEVEL_1)
        db = _mock_db_returning_job(job)

        result = await check_escalation(db, job.id, "There is a fire in the garage")

        assert result.should_escalate is True
        assert result.target_level == ProviderLevel.LEVEL_4.value


# ---------------------------------------------------------------------------
# "flood" keyword -> Level 4
# ---------------------------------------------------------------------------


class TestFloodKeywordLevel4:
    """Specific tests for the 'flood' keyword escalating to Level 4."""

    @pytest.mark.asyncio
    async def test_flood_from_level1_escalates_to_level4(self):
        job = _make_job_with_task(level=ProviderLevel.LEVEL_1)
        db = _mock_db_returning_job(job)

        result = await check_escalation(db, job.id, "Basement flood!")
        assert result.current_level == ProviderLevel.LEVEL_1.value
        assert result.target_level == ProviderLevel.LEVEL_4.value

    @pytest.mark.asyncio
    async def test_flood_from_level3_escalates_to_level4(self):
        job = _make_job_with_task(level=ProviderLevel.LEVEL_3)
        db = _mock_db_returning_job(job)

        result = await check_escalation(db, job.id, "Major flood damage")
        assert result.should_escalate is True
        assert result.target_level == ProviderLevel.LEVEL_4.value

    @pytest.mark.asyncio
    async def test_flood_case_insensitive(self):
        """Keyword matching should be case-insensitive."""
        job = _make_job_with_task(level=ProviderLevel.LEVEL_1)
        db = _mock_db_returning_job(job)

        result = await check_escalation(db, job.id, "FLOOD in the house")
        assert result.should_escalate is True
        assert result.target_level == ProviderLevel.LEVEL_4.value


# ---------------------------------------------------------------------------
# Multiple keywords in single description
# ---------------------------------------------------------------------------


class TestMultipleKeywords:
    """Tests that multiple keywords are detected and highest level wins."""

    @pytest.mark.asyncio
    async def test_multiple_keywords_highest_level_wins(self):
        """When both L3 ('gas') and L4 ('flood') keywords are present, L4 wins."""
        job = _make_job_with_task(level=ProviderLevel.LEVEL_1)
        db = _mock_db_returning_job(job)

        result = await check_escalation(
            db, job.id, "Gas leak caused a flood in the basement"
        )

        assert result.should_escalate is True
        assert result.target_level == ProviderLevel.LEVEL_4.value
        # Should have both keywords detected
        keywords_found = {m.keyword for m in result.matched_keywords}
        assert "gas" in keywords_found
        assert "flood" in keywords_found

    @pytest.mark.asyncio
    async def test_l2_and_l3_keywords_selects_l3(self):
        """When both L2 ('electrical') and L3 ('structural') are found, L3 wins."""
        job = _make_job_with_task(level=ProviderLevel.LEVEL_1)
        db = _mock_db_returning_job(job)

        result = await check_escalation(
            db, job.id, "Electrical wiring and structural damage"
        )

        assert result.should_escalate is True
        assert result.target_level == ProviderLevel.LEVEL_3.value
        keywords_found = {m.keyword for m in result.matched_keywords}
        assert "electrical" in keywords_found
        assert "structural" in keywords_found


# ---------------------------------------------------------------------------
# No keywords = no escalation
# ---------------------------------------------------------------------------


class TestNoKeywordsNoEscalation:
    """Tests that text without trigger keywords does not cause escalation."""

    @pytest.mark.asyncio
    async def test_benign_text_no_escalation(self):
        """Normal text with no keywords should not trigger escalation."""
        job = _make_job_with_task(level=ProviderLevel.LEVEL_1)
        db = _mock_db_returning_job(job)

        result = await check_escalation(
            db, job.id, "Please clean the kitchen and bathroom"
        )

        assert result.should_escalate is False
        assert result.target_level is None
        assert result.matched_keywords == []
        assert result.escalation_id is None

    @pytest.mark.asyncio
    async def test_empty_string_no_escalation(self):
        """An empty string should not trigger escalation."""
        job = _make_job_with_task(level=ProviderLevel.LEVEL_1)
        db = _mock_db_returning_job(job)

        result = await check_escalation(db, job.id, "")

        assert result.should_escalate is False

    @pytest.mark.asyncio
    async def test_keyword_at_same_level_no_escalation(self):
        """If the job is already at the keyword's level, no escalation needed."""
        # Job is Level 4, keyword 'flood' targets Level 4 -- no escalation
        # since target_level must be HIGHER than current
        job = _make_job_with_task(level=ProviderLevel.LEVEL_4)
        db = _mock_db_returning_job(job)

        result = await check_escalation(db, job.id, "flood in the basement")

        assert result.should_escalate is False

    @pytest.mark.asyncio
    async def test_l2_keyword_for_l3_job_no_escalation(self):
        """A Level 2 keyword ('electrical') should not escalate a Level 3 job."""
        job = _make_job_with_task(level=ProviderLevel.LEVEL_3)
        db = _mock_db_returning_job(job)

        result = await check_escalation(db, job.id, "Check the electrical panel")

        # 'electrical' targets L2, job is L3 -- target not higher than current
        assert result.should_escalate is False


# ---------------------------------------------------------------------------
# Escalation resolution flow
# ---------------------------------------------------------------------------


class TestEscalationResolution:
    """Tests for admin escalation approval/rejection."""

    @pytest.mark.asyncio
    async def test_approve_escalation_marks_resolved(self, mock_db):
        """Approving an escalation should mark it as resolved."""
        esc = _make_escalation(resolved=False)
        admin_id = uuid.uuid4()

        # First call returns escalation, second (for L4) returns the job
        job = _make_job_with_task(level=ProviderLevel.LEVEL_1, job_id=esc.job_id)
        call_count = 0

        def side_effect(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            result_mock = MagicMock()
            if call_count == 1:
                result_mock.scalar_one_or_none.return_value = esc
            else:
                result_mock.scalar_one_or_none.return_value = job
            return result_mock

        mock_db.execute.side_effect = side_effect

        result = await approve_escalation(mock_db, esc.id, admin_id)

        assert result.action == "approved"
        assert esc.resolved is True
        assert esc.resolved_at is not None
        assert esc.resolved_by == admin_id

    @pytest.mark.asyncio
    async def test_approve_l4_escalation_marks_job_emergency(self, mock_db):
        """Approving a Level 4 escalation should mark the job as emergency."""
        esc = _make_escalation(
            resolved=False,
            from_level=ProviderLevel.LEVEL_1,
            to_level=ProviderLevel.LEVEL_4,
        )
        job = _make_job_with_task(level=ProviderLevel.LEVEL_1, job_id=esc.job_id)
        admin_id = uuid.uuid4()

        call_count = 0

        def side_effect(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            result_mock = MagicMock()
            if call_count == 1:
                result_mock.scalar_one_or_none.return_value = esc
            else:
                result_mock.scalar_one_or_none.return_value = job
            return result_mock

        mock_db.execute.side_effect = side_effect

        await approve_escalation(mock_db, esc.id, admin_id)

        assert job.is_emergency is True
        assert job.priority == "emergency"

    @pytest.mark.asyncio
    async def test_reject_escalation_marks_resolved(self, mock_db):
        """Rejecting an escalation should mark it as resolved with reason."""
        esc = _make_escalation(resolved=False)
        admin_id = uuid.uuid4()

        result_mock = MagicMock()
        result_mock.scalar_one_or_none.return_value = esc
        mock_db.execute.return_value = result_mock

        result = await reject_escalation(
            mock_db, esc.id, admin_id, reason="False alarm"
        )

        assert result.action == "rejected"
        assert esc.resolved is True
        assert "Rejected: False alarm" in esc.resolution_notes

    @pytest.mark.asyncio
    async def test_reject_already_resolved_raises(self, mock_db):
        """Rejecting an already-resolved escalation should raise ValueError."""
        esc = _make_escalation(resolved=True)
        esc.resolved_at = datetime(2025, 2, 1, tzinfo=timezone.utc)

        result_mock = MagicMock()
        result_mock.scalar_one_or_none.return_value = esc
        mock_db.execute.return_value = result_mock

        with pytest.raises(ValueError, match="already resolved"):
            await reject_escalation(
                mock_db, esc.id, uuid.uuid4(), reason="Too late"
            )

    @pytest.mark.asyncio
    async def test_approve_already_resolved_raises(self, mock_db):
        """Approving an already-resolved escalation should raise ValueError."""
        esc = _make_escalation(resolved=True)
        esc.resolved_at = datetime(2025, 2, 1, tzinfo=timezone.utc)

        result_mock = MagicMock()
        result_mock.scalar_one_or_none.return_value = esc
        mock_db.execute.return_value = result_mock

        with pytest.raises(ValueError, match="already resolved"):
            await approve_escalation(mock_db, esc.id, uuid.uuid4())

    @pytest.mark.asyncio
    async def test_reject_with_empty_reason_raises(self, mock_db):
        """Rejecting without a reason should raise ValueError."""
        with pytest.raises(ValueError, match="rejection reason is required"):
            await reject_escalation(mock_db, uuid.uuid4(), uuid.uuid4(), reason="")


# ---------------------------------------------------------------------------
# Keyword pattern configuration
# ---------------------------------------------------------------------------


class TestKeywordPatternConfig:
    """Tests that the keyword configuration matches the documented hierarchy."""

    def test_level4_keywords_are_registered(self):
        """All Level 4 keywords should be present in the pattern list."""
        l4_keywords = None
        for level, keywords in ESCALATION_KEYWORDS:
            if level == ProviderLevel.LEVEL_4:
                l4_keywords = keywords
                break
        assert l4_keywords is not None
        assert "emergency" in l4_keywords
        assert "flood" in l4_keywords
        assert "fire" in l4_keywords
        assert "burst" in l4_keywords
        assert "no heat" in l4_keywords
        assert "no power" in l4_keywords

    def test_level3_keywords_are_registered(self):
        l3_keywords = None
        for level, keywords in ESCALATION_KEYWORDS:
            if level == ProviderLevel.LEVEL_3:
                l3_keywords = keywords
                break
        assert l3_keywords is not None
        assert "gas" in l3_keywords
        assert "permit" in l3_keywords
        assert "structural" in l3_keywords
        assert "hvac" in l3_keywords
        assert "plumbing main" in l3_keywords

    def test_level2_keywords_are_registered(self):
        l2_keywords = None
        for level, keywords in ESCALATION_KEYWORDS:
            if level == ProviderLevel.LEVEL_2:
                l2_keywords = keywords
                break
        assert l2_keywords is not None
        assert "electrical" in l2_keywords
        assert "wiring" in l2_keywords

    def test_patterns_are_compiled(self):
        """All patterns should be pre-compiled regex objects."""
        assert len(_KEYWORD_PATTERNS) > 0
        for level, keyword, pattern in _KEYWORD_PATTERNS:
            assert hasattr(pattern, "search"), f"Pattern for '{keyword}' is not compiled"
