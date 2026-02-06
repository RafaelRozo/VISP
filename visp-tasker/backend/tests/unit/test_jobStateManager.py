"""
Unit tests for the Job State Manager -- VISP-BE-JOBS-002.

Tests the finite state machine governing job status transitions, guard
conditions, cancellation logic, and the complete job lifecycle.
"""

import pytest

from src.models.job import JobStatus
from src.services.jobStateManager import (
    ActorType,
    TransitionResult,
    VALID_TRANSITIONS,
    _CUSTOMER_CANCELLABLE,
    _PROVIDER_CANCELLABLE,
    get_valid_transitions,
    validate_transition,
)


# ---------------------------------------------------------------------------
# Valid state transitions (happy path)
# ---------------------------------------------------------------------------


class TestValidTransitions:
    """Tests that all documented valid transitions are allowed."""

    def test_draft_to_pending_match(self):
        result = validate_transition(JobStatus.DRAFT, JobStatus.PENDING_MATCH)
        assert result.allowed is True

    def test_pending_match_to_matched(self):
        result = validate_transition(JobStatus.PENDING_MATCH, JobStatus.MATCHED)
        assert result.allowed is True

    def test_matched_to_provider_accepted(self):
        result = validate_transition(
            JobStatus.MATCHED, JobStatus.PROVIDER_ACCEPTED, ActorType.PROVIDER
        )
        assert result.allowed is True

    def test_provider_accepted_to_en_route(self):
        result = validate_transition(
            JobStatus.PROVIDER_ACCEPTED,
            JobStatus.PROVIDER_EN_ROUTE,
            ActorType.PROVIDER,
        )
        assert result.allowed is True

    def test_en_route_to_in_progress(self):
        result = validate_transition(
            JobStatus.PROVIDER_EN_ROUTE,
            JobStatus.IN_PROGRESS,
            ActorType.PROVIDER,
        )
        assert result.allowed is True

    def test_in_progress_to_completed(self):
        result = validate_transition(
            JobStatus.IN_PROGRESS, JobStatus.COMPLETED, ActorType.PROVIDER
        )
        assert result.allowed is True

    def test_completed_to_disputed(self):
        result = validate_transition(JobStatus.COMPLETED, JobStatus.DISPUTED)
        assert result.allowed is True

    def test_disputed_to_refunded(self):
        result = validate_transition(JobStatus.DISPUTED, JobStatus.REFUNDED)
        assert result.allowed is True

    def test_disputed_to_completed(self):
        """A dispute resolved in favour of the provider returns to COMPLETED."""
        result = validate_transition(JobStatus.DISPUTED, JobStatus.COMPLETED)
        assert result.allowed is True

    def test_matched_to_pending_match_on_decline(self):
        """A provider decline should allow re-entering matching."""
        result = validate_transition(JobStatus.MATCHED, JobStatus.PENDING_MATCH)
        assert result.allowed is True


# ---------------------------------------------------------------------------
# Invalid state transitions
# ---------------------------------------------------------------------------


class TestInvalidTransitions:
    """Tests that invalid transitions are correctly rejected."""

    def test_draft_to_completed_rejected(self):
        """Cannot jump from draft directly to completed."""
        result = validate_transition(JobStatus.DRAFT, JobStatus.COMPLETED)
        assert result.allowed is False
        assert result.reason is not None

    def test_completed_to_in_progress_rejected(self):
        """Cannot go backwards from completed to in_progress."""
        result = validate_transition(JobStatus.COMPLETED, JobStatus.IN_PROGRESS)
        assert result.allowed is False

    def test_cancelled_by_system_is_terminal(self):
        """CANCELLED_BY_SYSTEM is truly terminal -- no transitions allowed."""
        result = validate_transition(
            JobStatus.CANCELLED_BY_SYSTEM, JobStatus.DRAFT
        )
        assert result.allowed is False

    def test_draft_to_in_progress_rejected(self):
        """Cannot skip matching and go directly to in_progress."""
        result = validate_transition(JobStatus.DRAFT, JobStatus.IN_PROGRESS)
        assert result.allowed is False

    def test_pending_match_to_completed_rejected(self):
        result = validate_transition(JobStatus.PENDING_MATCH, JobStatus.COMPLETED)
        assert result.allowed is False

    def test_provider_accepted_to_draft_rejected(self):
        result = validate_transition(JobStatus.PROVIDER_ACCEPTED, JobStatus.DRAFT)
        assert result.allowed is False

    def test_in_progress_to_matched_rejected(self):
        result = validate_transition(JobStatus.IN_PROGRESS, JobStatus.MATCHED)
        assert result.allowed is False


# ---------------------------------------------------------------------------
# Guard conditions
# ---------------------------------------------------------------------------


class TestGuardConditions:
    """Tests for actor-type guard enforcement on transitions."""

    def test_customer_cannot_accept_job(self):
        """A customer actor should not be able to accept a job."""
        result = validate_transition(
            JobStatus.MATCHED,
            JobStatus.PROVIDER_ACCEPTED,
            ActorType.CUSTOMER,
        )
        assert result.allowed is False
        assert "provider" in result.reason.lower()

    def test_customer_cannot_start_work(self):
        """A customer cannot mark a job as in_progress."""
        result = validate_transition(
            JobStatus.PROVIDER_EN_ROUTE,
            JobStatus.IN_PROGRESS,
            ActorType.CUSTOMER,
        )
        assert result.allowed is False

    def test_customer_cannot_complete_job(self):
        """A customer cannot mark a job as completed."""
        result = validate_transition(
            JobStatus.IN_PROGRESS,
            JobStatus.COMPLETED,
            ActorType.CUSTOMER,
        )
        assert result.allowed is False

    def test_system_can_accept_on_behalf_of_provider(self):
        """System should be able to accept a job on behalf of a provider."""
        result = validate_transition(
            JobStatus.MATCHED,
            JobStatus.PROVIDER_ACCEPTED,
            ActorType.SYSTEM,
        )
        assert result.allowed is True

    def test_admin_can_accept_on_behalf_of_provider(self):
        """Admin should be able to accept a job on behalf of a provider."""
        result = validate_transition(
            JobStatus.MATCHED,
            JobStatus.PROVIDER_ACCEPTED,
            ActorType.ADMIN,
        )
        assert result.allowed is True

    def test_customer_cannot_mark_en_route(self):
        """A customer cannot mark a provider as en route."""
        result = validate_transition(
            JobStatus.PROVIDER_ACCEPTED,
            JobStatus.PROVIDER_EN_ROUTE,
            ActorType.CUSTOMER,
        )
        assert result.allowed is False


# ---------------------------------------------------------------------------
# Cancellation from various states
# ---------------------------------------------------------------------------


class TestCancellationTransitions:
    """Tests cancellation rules for customers and providers."""

    def test_customer_can_cancel_from_draft(self):
        result = validate_transition(
            JobStatus.DRAFT, JobStatus.CANCELLED_BY_CUSTOMER
        )
        assert result.allowed is True

    def test_customer_can_cancel_from_pending_match(self):
        result = validate_transition(
            JobStatus.PENDING_MATCH, JobStatus.CANCELLED_BY_CUSTOMER
        )
        assert result.allowed is True

    def test_customer_can_cancel_from_matched(self):
        result = validate_transition(
            JobStatus.MATCHED, JobStatus.CANCELLED_BY_CUSTOMER
        )
        assert result.allowed is True

    def test_customer_cannot_cancel_after_acceptance(self):
        """Customer cannot cancel once the provider has accepted."""
        result = validate_transition(
            JobStatus.PROVIDER_ACCEPTED, JobStatus.CANCELLED_BY_CUSTOMER
        )
        assert result.allowed is False

    def test_customer_cannot_cancel_in_progress(self):
        result = validate_transition(
            JobStatus.IN_PROGRESS, JobStatus.CANCELLED_BY_CUSTOMER
        )
        assert result.allowed is False

    def test_provider_can_cancel_from_matched(self):
        result = validate_transition(
            JobStatus.MATCHED, JobStatus.CANCELLED_BY_PROVIDER
        )
        assert result.allowed is True

    def test_provider_can_cancel_after_acceptance(self):
        result = validate_transition(
            JobStatus.PROVIDER_ACCEPTED, JobStatus.CANCELLED_BY_PROVIDER
        )
        assert result.allowed is True

    def test_provider_can_cancel_en_route(self):
        result = validate_transition(
            JobStatus.PROVIDER_EN_ROUTE, JobStatus.CANCELLED_BY_PROVIDER
        )
        assert result.allowed is True

    def test_provider_can_cancel_in_progress(self):
        result = validate_transition(
            JobStatus.IN_PROGRESS, JobStatus.CANCELLED_BY_PROVIDER
        )
        assert result.allowed is True

    def test_provider_cannot_cancel_from_draft(self):
        """Provider cannot cancel a job that hasn't been matched yet."""
        result = validate_transition(
            JobStatus.DRAFT, JobStatus.CANCELLED_BY_PROVIDER
        )
        assert result.allowed is False

    def test_provider_cannot_cancel_from_pending_match(self):
        result = validate_transition(
            JobStatus.PENDING_MATCH, JobStatus.CANCELLED_BY_PROVIDER
        )
        assert result.allowed is False

    def test_system_can_cancel_from_any_non_terminal_state(self):
        """CANCELLED_BY_SYSTEM should be reachable from most states."""
        non_terminal_states = [
            JobStatus.DRAFT,
            JobStatus.PENDING_MATCH,
            JobStatus.MATCHED,
            JobStatus.PROVIDER_ACCEPTED,
            JobStatus.PROVIDER_EN_ROUTE,
            JobStatus.IN_PROGRESS,
        ]
        for state in non_terminal_states:
            result = validate_transition(
                state, JobStatus.CANCELLED_BY_SYSTEM, ActorType.SYSTEM
            )
            assert result.allowed is True, (
                f"System should be able to cancel from {state.value}"
            )


# ---------------------------------------------------------------------------
# Complete state machine lifecycle
# ---------------------------------------------------------------------------


class TestCompleteLifecycle:
    """Tests the full happy-path job lifecycle through the state machine."""

    def test_full_lifecycle_draft_to_completed(self):
        """Walk through the entire happy path:
        draft -> pending_match -> matched -> provider_accepted ->
        provider_en_route -> in_progress -> completed
        """
        transitions = [
            (JobStatus.DRAFT, JobStatus.PENDING_MATCH, ActorType.SYSTEM),
            (JobStatus.PENDING_MATCH, JobStatus.MATCHED, ActorType.SYSTEM),
            (JobStatus.MATCHED, JobStatus.PROVIDER_ACCEPTED, ActorType.PROVIDER),
            (JobStatus.PROVIDER_ACCEPTED, JobStatus.PROVIDER_EN_ROUTE, ActorType.PROVIDER),
            (JobStatus.PROVIDER_EN_ROUTE, JobStatus.IN_PROGRESS, ActorType.PROVIDER),
            (JobStatus.IN_PROGRESS, JobStatus.COMPLETED, ActorType.PROVIDER),
        ]

        for current, target, actor in transitions:
            result = validate_transition(current, target, actor)
            assert result.allowed is True, (
                f"Transition {current.value} -> {target.value} "
                f"by {actor.value} should be allowed"
            )

    def test_lifecycle_with_dispute_and_refund(self):
        """Test the dispute path: completed -> disputed -> refunded."""
        result1 = validate_transition(JobStatus.COMPLETED, JobStatus.DISPUTED)
        assert result1.allowed is True

        result2 = validate_transition(JobStatus.DISPUTED, JobStatus.REFUNDED)
        assert result2.allowed is True

    def test_lifecycle_with_dispute_resolved(self):
        """Test the dispute resolution path: completed -> disputed -> completed."""
        result1 = validate_transition(JobStatus.COMPLETED, JobStatus.DISPUTED)
        assert result1.allowed is True

        result2 = validate_transition(JobStatus.DISPUTED, JobStatus.COMPLETED)
        assert result2.allowed is True

    def test_lifecycle_customer_cancels_early(self):
        """Customer cancels during matching phase."""
        result1 = validate_transition(JobStatus.DRAFT, JobStatus.PENDING_MATCH)
        assert result1.allowed is True

        result2 = validate_transition(
            JobStatus.PENDING_MATCH, JobStatus.CANCELLED_BY_CUSTOMER
        )
        assert result2.allowed is True


# ---------------------------------------------------------------------------
# get_valid_transitions utility
# ---------------------------------------------------------------------------


class TestGetValidTransitions:
    """Tests the get_valid_transitions helper function."""

    def test_draft_valid_transitions_for_customer(self):
        """A customer should be able to see cancellation as an option from draft."""
        valid = get_valid_transitions(JobStatus.DRAFT, ActorType.CUSTOMER)
        assert JobStatus.PENDING_MATCH in valid
        assert JobStatus.CANCELLED_BY_CUSTOMER in valid
        # System cancel should also be valid (no guard blocks it)
        assert JobStatus.CANCELLED_BY_SYSTEM in valid

    def test_matched_valid_transitions_for_provider(self):
        """A provider should be able to accept or cancel from matched."""
        valid = get_valid_transitions(JobStatus.MATCHED, ActorType.PROVIDER)
        assert JobStatus.PROVIDER_ACCEPTED in valid
        assert JobStatus.CANCELLED_BY_PROVIDER in valid

    def test_completed_valid_transitions(self):
        """From completed, only disputed should be available."""
        valid = get_valid_transitions(JobStatus.COMPLETED)
        assert JobStatus.DISPUTED in valid
        assert len(valid) == 1

    def test_cancelled_by_system_no_transitions(self):
        """CANCELLED_BY_SYSTEM is terminal -- no transitions available."""
        valid = get_valid_transitions(JobStatus.CANCELLED_BY_SYSTEM)
        assert valid == []

    def test_in_progress_provider_options(self):
        """Provider in progress should see completed and cancel options."""
        valid = get_valid_transitions(JobStatus.IN_PROGRESS, ActorType.PROVIDER)
        assert JobStatus.COMPLETED in valid
        assert JobStatus.CANCELLED_BY_PROVIDER in valid


# ---------------------------------------------------------------------------
# Transition map completeness
# ---------------------------------------------------------------------------


class TestTransitionMapCompleteness:
    """Tests that every JobStatus has an entry in VALID_TRANSITIONS."""

    def test_all_statuses_have_transition_entry(self):
        """Every JobStatus enum value should have a key in VALID_TRANSITIONS."""
        for status in JobStatus:
            assert status in VALID_TRANSITIONS, (
                f"JobStatus.{status.name} ({status.value}) is missing "
                f"from VALID_TRANSITIONS"
            )

    def test_customer_cancellable_states_are_correct(self):
        """Verify the customer-cancellable states match the documentation."""
        expected = {JobStatus.DRAFT, JobStatus.PENDING_MATCH, JobStatus.MATCHED}
        assert _CUSTOMER_CANCELLABLE == expected

    def test_provider_cancellable_states_are_correct(self):
        """Verify the provider-cancellable states match the documentation."""
        expected = {
            JobStatus.MATCHED,
            JobStatus.PROVIDER_ACCEPTED,
            JobStatus.PROVIDER_EN_ROUTE,
            JobStatus.IN_PROGRESS,
        }
        assert _PROVIDER_CANCELLABLE == expected
