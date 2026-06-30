"""Service fee ("Tarifa de servicio") — the Stripe processing fee the customer
covers (Model C, Provider-Set Pricing · PP4c).

Gross-up so the customer's fee line covers the REAL Stripe cost (including the
fee charged on the fee itself): for net = subtotal + tax + tip,

    gross = (net + fixed) / (1 - percent)
    service_fee = gross − net

With CA standard pricing (2.9% + $0.30) this makes ``gross − stripe_fee(gross)``
land back exactly on ``net`` — VISP keeps the full commission and the provider
receives their full payout; neither absorbs the processing fee.

The fee is shown tax-inclusive (no extra micro-tax line). In the destination
charge the platform's ``application_fee_amount`` therefore equals
``commission + service_fee`` so the platform retains exactly the fee portion it
owes Stripe plus its commission.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

# CA standard Stripe card pricing. Override here if a negotiated rate applies.
STRIPE_PERCENT = Decimal("0.029")
STRIPE_FIXED_CENTS = 30


def compute_service_fee_cents(net_cents: int) -> int:
    """Grossed-up Stripe fee for a ``net_cents`` charge (subtotal+tax+tip).

    Returns 0 for a non-positive net (nothing to charge → no fee)."""
    if net_cents <= 0:
        return 0
    gross = (Decimal(net_cents) + STRIPE_FIXED_CENTS) / (Decimal(1) - STRIPE_PERCENT)
    gross_cents = int(gross.quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    return gross_cents - net_cents
