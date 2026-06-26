"""Provider-set service rate routes (Provider-Set Pricing · PP2).

Lets a verified provider price the services they are qualified for. Mounted
under the same ``/provider`` prefix as the rest of the provider API.

Routes:
  GET    /api/v1/provider/rates             -- Priceable services + current rate
  PUT    /api/v1/provider/rates/{task_id}   -- Set/update the rate for a service
  DELETE /api/v1/provider/rates/{task_id}   -- Remove the rate for a service
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, status

from src.api.deps import CurrentUser, DBSession
from src.api.schemas.provider_rate import SetRateIn
from src.services import providerService, provider_rate_service

router = APIRouter(prefix="/provider", tags=["Provider Rates"])


async def _provider_id(db: DBSession, user: CurrentUser) -> uuid.UUID:
    try:
        profile = await providerService.get_provider_profile(db, user.id)
    except providerService.ProviderNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User does not have a provider profile.",
        )
    return profile.id


@router.get("/rates", summary="List the provider's priceable services + rates")
async def list_rates(db: DBSession, user: CurrentUser) -> dict[str, Any]:
    provider_id = await _provider_id(db, user)
    items = await provider_rate_service.list_priceable_services(db, provider_id)
    return {"data": {"items": items}}


@router.put("/rates/{task_id}", summary="Set or update the rate for a service")
async def set_rate(
    db: DBSession, user: CurrentUser, task_id: uuid.UUID, payload: SetRateIn
) -> dict[str, Any]:
    provider_id = await _provider_id(db, user)
    try:
        rate = await provider_rate_service.set_rate(
            db,
            provider_id,
            task_id,
            rate_cents=payload.rate_cents,
            min_charge_cents=payload.min_charge_cents,
        )
    except provider_rate_service.RateTaskNotFoundError:
        raise HTTPException(status_code=404, detail="Service not found.")
    except provider_rate_service.NotQualifiedError:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "not_qualified",
                "message": "You can only price a service once it is approved (no pending documents).",
            },
        )
    except provider_rate_service.CustomQuoteNoRateError:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "custom_quote_no_rate",
                "message": "This service is quoted per job and takes no fixed rate.",
            },
        )
    except provider_rate_service.PriceOutOfRangeError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "price_out_of_range",
                "message": "Your price is outside the allowed range for this service.",
                "min_cents": exc.min_cents,
                "max_cents": exc.max_cents,
            },
        )
    await db.commit()
    return {
        "data": {
            "task_id": str(rate.task_id),
            "unit": rate.unit.value,
            "rate_cents": rate.rate_cents,
            "min_charge_cents": rate.min_charge_cents,
            "is_active": rate.is_active,
        }
    }


@router.delete("/rates/{task_id}", summary="Remove the rate for a service")
async def delete_rate(
    db: DBSession, user: CurrentUser, task_id: uuid.UUID
) -> dict[str, Any]:
    provider_id = await _provider_id(db, user)
    removed = await provider_rate_service.delete_rate(db, provider_id, task_id)
    if not removed:
        raise HTTPException(status_code=404, detail="No rate set for this service.")
    await db.commit()
    return {"data": {"task_id": str(task_id), "removed": True}}
