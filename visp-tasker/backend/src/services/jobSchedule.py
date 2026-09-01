"""El reloj de un trabajo: cuándo empieza, cuánto dura, cuándo termina.

Plan: ``docs/plan-cierre-y-agenda.md``.

**Por qué existe este módulo.** Hasta el 2026-09-01 nadie sabía a qué hora
termina un trabajo. `jobs.requested_time_end` está NULL en toda la tabla —el
alta solo escribe fecha y hora de inicio— y la duración vivía repartida entre
`jobs.quantity` y `service_tasks.estimated_duration_min`, sin que ningún sitio
las juntara. Consecuencias, las dos reales:

* `TSK-BD00BM` (contrato de 8 h empezado a las 09:12) llevaba 28 h en
  `IN_PROGRESS` con $268.16 retenidos, porque nada tenía contra qué medir que ya
  se había pasado.
* Un proveedor podía aceptar un paseo de perro a las 12:00 teniendo ese contrato
  en curso: sin ventana no hay solape que detectar.

Las dos cosas necesitan la MISMA respuesta —el intervalo que ocupa un trabajo—,
así que se calcula una vez, aquí, y no dos veces con criterios que acaban
divergiendo.

**Dos ventanas, no una.** La distinción importa y es la que causó el enredo:

* :func:`scheduled_window` — lo que se PACTÓ (`requested_date` +
  `requested_time_start`). Es la que ocupa la agenda: bloquea al proveedor aunque
  todavía no haya empezado.
* :func:`working_window` — lo que está PASANDO (`started_at` + duración). Es la
  que dice si un trabajo en curso ya debería haber terminado. `TSK-BD00BM` estaba
  agendado el 29 a las 16:00 y se arrancó el 31 a las 09:12: medir su cierre
  contra la cita habría dado un vencimiento de dos días antes de empezar.
"""

from __future__ import annotations

import logging
from datetime import date as _date, datetime, time as _time, timedelta, timezone
from decimal import Decimal
from typing import Any, Optional
from zoneinfo import ZoneInfo

from src.models.taxonomy import PricingUnit

logger = logging.getLogger(__name__)


# La hora que el cliente elige es la de SU reloj, y la columna es un TIME sin
# zona. Anclarla en UTC corre el trabajo cuatro horas en verano: las 13:00 de
# Toronto son las 17:00 UTC. Cuando VISP abra una zona en otro huso esto tiene
# que salir de `service_zones` y no de una constante — igual que en
# `offerService`, que la usa para el vencimiento de las ofertas.
SERVICE_TIMEZONE_NAME = "America/Toronto"
SERVICE_TIMEZONE = ZoneInfo(SERVICE_TIMEZONE_NAME)

# Un trabajo sin duración conocida en ninguna de sus fuentes. Preferible a
# tratarlo como instantáneo: con duración cero un trabajo nace ya vencido y la
# agenda no bloquearía nada.
_DEFAULT_DURATION = timedelta(hours=1)

# Unidades en las que `jobs.quantity` son HORAS. En PER_CONTRACT las pone el
# cliente al publicar; en HOURLY las pone el proveedor al ofertar y `accept_offer`
# las copia a `quantity`. En las demás la magnitud es metros, unidades o nada:
# medir tiempo con ellas daría una ventana inventada.
_QUANTITY_IS_HOURS = {PricingUnit.HOURLY, PricingUnit.PER_CONTRACT}


def job_duration(job: Any, task: Any) -> timedelta:
    """Cuánto ocupa este trabajo, según de dónde salga su magnitud.

    El orden no es arbitrario: manda lo que se ACORDÓ (las horas del contrato o
    de la oferta) sobre la estimación del catálogo, que es solo un valor por
    defecto del admin.
    """
    unit = getattr(task, "pricing_unit", None)
    quantity: Optional[Decimal] = getattr(job, "quantity", None)

    if unit in _QUANTITY_IS_HOURS and quantity is not None and quantity > 0:
        return timedelta(hours=float(quantity))

    minutes = getattr(task, "estimated_duration_min", None) or 0

    # En los servicios por ítem la estimación es POR ítem: montar tres muebles no
    # dura lo que montar uno.
    if unit == PricingUnit.PER_UNIT and minutes and quantity is not None and quantity > 0:
        return timedelta(minutes=minutes * float(quantity))

    if minutes:
        return timedelta(minutes=minutes)

    return _DEFAULT_DURATION


def _to_utc(day: _date, clock: Optional[_time]) -> datetime:
    """Fecha + hora locales del área de servicio -> instante absoluto."""
    local = datetime.combine(day, clock or _time(0, 0), tzinfo=SERVICE_TIMEZONE)
    return local.astimezone(timezone.utc)


def scheduled_start(job: Any) -> Optional[datetime]:
    """El instante de la CITA, en UTC. None si el trabajo no tiene fecha."""
    day = getattr(job, "requested_date", None)
    if day is None:
        return None
    return _to_utc(day, getattr(job, "requested_time_start", None))


def scheduled_window(job: Any, task: Any) -> Optional[tuple[datetime, datetime]]:
    """El hueco que este trabajo ocupa en la agenda del proveedor, en UTC.

    None cuando no hay fecha: un trabajo "para cuando puedas" no reserva horas y
    por tanto no puede chocar con nada.
    """
    start = scheduled_start(job)
    if start is None:
        return None
    return start, start + job_duration(job, task)


def working_window(job: Any, task: Any) -> Optional[tuple[datetime, datetime]]:
    """Desde que el proveedor pulsó "empezar" hasta que debería haber acabado.

    None si el trabajo no ha empezado: sin `started_at` no hay nada en curso que
    pueda estar vencido.
    """
    started = getattr(job, "started_at", None)
    if started is None:
        return None
    if started.tzinfo is None:
        started = started.replace(tzinfo=timezone.utc)
    return started, started + job_duration(job, task)


def overlaps(
    a: Optional[tuple[datetime, datetime]],
    b: Optional[tuple[datetime, datetime]],
) -> bool:
    """¿Se pisan dos ventanas?

    Solape ESTRICTO, sin margen de traslado (decisión de Ricardo, 2026-09-01):
    terminar a las 17:00 y empezar otro a las 17:00 no cuenta como choque. Los
    extremos abiertos son deliberados — con `>=` un trabajo bloquearía al
    siguiente que arranca en el mismo minuto en que él acaba.

    Una ventana inexistente (trabajo sin fecha) no choca con nada.
    """
    if a is None or b is None:
        return False
    return a[0] < b[1] and b[0] < a[1]
