"""Sales-tax engine for the provider-set pricing waterfall (Provider-Set
Pricing · PP3).

Canada only for Phase 1. The provider/company is the Merchant of Record and
*remits* the tax; VISP merely calculates, displays and stores it. Tax is charged
ONLY when the provider is tax-registered — otherwise the service tax is zero and
no tax line is shown (conservative resolution of accountant open-item #1).

Place of supply for a service = where it is performed, so the rate is keyed on
the job's service province (``jobs.service_province_state``), NOT the provider's
home province.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.tax import ProvinceTaxRate

# Full province/territory names → 2-letter code. job.service_province_state and
# provider.home_province_state are free-ish strings; normalise both to a code.
_PROVINCE_NAME_TO_CODE: dict[str, str] = {
    "alberta": "AB",
    "british columbia": "BC",
    "manitoba": "MB",
    "new brunswick": "NB",
    "newfoundland": "NL",
    "newfoundland and labrador": "NL",
    "nova scotia": "NS",
    "northwest territories": "NT",
    "nunavut": "NU",
    "ontario": "ON",
    "prince edward island": "PE",
    "quebec": "QC",
    "québec": "QC",
    "saskatchewan": "SK",
    "yukon": "YT",
}

_VALID_CODES = {
    "AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT",
}


def normalize_province(raw: Optional[str]) -> Optional[str]:
    """Map a free-form province string ('Ontario', 'on', 'ON') to its code, or
    None when it can't be resolved."""
    if not raw:
        return None
    s = raw.strip()
    up = s.upper()
    if up in _VALID_CODES:
        return up
    return _PROVINCE_NAME_TO_CODE.get(s.lower())


async def get_province_tax_rate(
    db: AsyncSession, province: Optional[str]
) -> Optional[ProvinceTaxRate]:
    """Return the active tax-rate row for a province (accepts code or name), or
    None when the province is unknown/inactive."""
    code = normalize_province(province)
    if code is None:
        return None
    return (
        await db.execute(
            select(ProvinceTaxRate).where(
                ProvinceTaxRate.province_code == code,
                ProvinceTaxRate.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()


def _round_cents(value: Decimal) -> int:
    return int(value.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


async def compute_tax(
    db: AsyncSession,
    subtotal_cents: int,
    province: Optional[str],
    provider_tax_registered: bool,
) -> dict[str, Any]:
    """Compute sales tax on a job subtotal.

    Tax applies only when the provider is tax-registered AND the service
    province resolves to a known rate. Otherwise returns a zero-tax result with
    no jurisdiction/label (no tax line shown).

    Returns::

        {
            "service_tax_cents": int,
            "tax_rate": Decimal | None,      # the combined rate applied
            "tax_jurisdiction": str | None,  # province code, e.g. 'ON'
            "label": str | None,             # customer-facing, e.g. 'HST (13%)'
        }
    """
    no_tax: dict[str, Any] = {
        "service_tax_cents": 0,
        "tax_rate": None,
        "tax_jurisdiction": None,
        "label": None,
    }

    if not provider_tax_registered or subtotal_cents <= 0:
        return no_tax

    rate_row = await get_province_tax_rate(db, province)
    if rate_row is None:
        # Registered provider but province unknown → charge nothing rather than
        # guess a rate. Surfaced to admin via the missing jurisdiction.
        return no_tax

    rate = rate_row.combined_rate
    tax_cents = _round_cents(Decimal(subtotal_cents) * rate)
    return {
        "service_tax_cents": tax_cents,
        "tax_rate": rate,
        "tax_jurisdiction": rate_row.province_code,
        "label": rate_row.label,
    }
