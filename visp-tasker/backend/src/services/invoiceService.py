"""Comprobantes de trabajo: factura del cliente y liquidación del proveedor.

Se emiten al CAPTURAR el cobro, que es cuando las cifras quedan congeladas.
Antes no: hasta la captura el importe puede cambiar por materiales o por un
sobrecoste aprobado, y un comprobante que cambia no es un comprobante.

SON DOS DOCUMENTOS, NO UNO
--------------------------
Nuestro cobro es un *destination charge* con ``on_behalf_of`` apuntando al
proveedor, así que **el que vende el servicio es él**, no VISP; VISP cobra una
comisión por intermediar. De ahí:

  * ``customer`` — la factura del SERVICIO. Qué se hizo, cuánto duró, materiales,
    propina, impuesto y total. Emitida por el proveedor, generada por VISP.
  * ``provider`` — la LIQUIDACIÓN. Qué pagó el cliente, qué se dedujo y qué
    queda. Lleva la comisión de VISP y el neto, que no son asunto del cliente.

Cada parte ve solo el suyo.

INMUTABLE
---------
Las cifras se copian a ``totals_json`` al emitir. Si mañana se corrige una
columna de ``jobs``, el comprobante ya emitido debe seguir contando lo que
contaba. Y un documento emitido no se edita ni se borra: un reembolso genera
otro documento.

EL LOGO ES VECTOR
-----------------
La "V" del login (`AnimatedLogo.tsx`) redibujada con líneas. Incrustar el icono
PNG de la app metía 580 KB en un documento de una página — catorce veces el
resto del PDF. En vector pesa cero y además se imprime nítida.
"""

from __future__ import annotations

import hashlib
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Optional
from zoneinfo import ZoneInfo

from fpdf import FPDF
from fpdf.enums import XPos, YPos
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

_BACKEND_ROOT = Path(__file__).resolve().parent.parent.parent
FONT_DIR = _BACKEND_ROOT / "assets" / "fonts"
UPLOAD_DIR = _BACKEND_ROOT / "uploads"
INVOICE_DIR = UPLOAD_DIR / "invoices"

ZONA = ZoneInfo("America/Toronto")

TINTA = (26, 26, 46)
AZUL = (74, 144, 226)
VIOLETA = (120, 80, 255)      # #7850FF — el tono medio del logo
GRIS = (110, 110, 125)
GRIS_CLARO = (236, 238, 243)
VERDE = (39, 174, 96)
ROJO = (190, 60, 60)


def dinero(cents: Optional[int]) -> str:
    return f"${(cents or 0) / 100:,.2f}"


class ComprobantePDF(FPDF):
    """A4 con la cabecera de VISP y un pie de una sola línea.

    El pie llevaba también el aviso bilingüe de marketplace y se salía del ancho
    de página por los dos lados: en A4 no caben inglés y francés seguidos. Ese
    aviso vive en los Terms, que es donde tiene valor.
    """

    def __init__(self) -> None:
        super().__init__(format="A4")
        for estilo, fichero in (("", "DejaVuSans.ttf"), ("B", "DejaVuSans-Bold.ttf")):
            self.add_font("DejaVu", estilo, str(FONT_DIR / fichero))
        self.set_auto_page_break(auto=True, margin=22)

    def footer(self) -> None:  # noqa: D102 — hook de fpdf2
        self.set_y(-18)
        self.set_font("DejaVu", "", 7)
        self.set_text_color(*GRIS)
        self.cell(
            0, 4,
            "DROZ TECHNOLOGIES, INC., operating as VISP  ·  support@droztechnologies.com",
            align="C",
        )


def _logo(pdf: ComprobantePDF, x: float, y: float, lado: float) -> None:
    """La "V" del login, a escala, en vector.

    El SVG original vive en un lienzo de 100×100: trazo de (20,20) a (50,80) a
    (80,20) con grosor 6 y extremos redondeados.
    """
    e = lado / 100.0
    pdf.set_draw_color(*VIOLETA)
    pdf.set_line_width(6 * e)
    pdf._out("1 J")   # extremo redondeado
    pdf._out("1 j")   # unión redondeada
    pdf.line(x + 20 * e, y + 20 * e, x + 50 * e, y + 80 * e)
    pdf.line(x + 50 * e, y + 80 * e, x + 80 * e, y + 20 * e)


def _cabecera(pdf: ComprobantePDF, titulo_en: str, titulo_fr: str,
              numero: str, fecha: str) -> None:
    pdf.set_fill_color(*TINTA)
    pdf.rect(0, 0, 210, 34, "F")
    _logo(pdf, x=15, y=7, lado=19)

    pdf.set_xy(38, 11)
    pdf.set_font("DejaVu", "B", 17)
    pdf.set_text_color(255, 255, 255)
    pdf.cell(60, 8, "VISP", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_xy(38, 19)
    pdf.set_font("DejaVu", "", 8)
    pdf.set_text_color(160, 160, 170)
    pdf.cell(80, 5, "Verified Independent Service Providers")

    pdf.set_xy(120, 10)
    pdf.set_font("DejaVu", "B", 12)
    pdf.set_text_color(255, 255, 255)
    pdf.cell(75, 6, titulo_en, align="R", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_xy(120, 16)
    pdf.set_font("DejaVu", "", 8)
    pdf.set_text_color(160, 160, 170)
    pdf.cell(75, 5, titulo_fr, align="R", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_xy(120, 22)
    pdf.set_font("DejaVu", "", 8)
    pdf.set_text_color(255, 255, 255)
    pdf.cell(75, 5, f"{numero}   ·   {fecha}", align="R")
    pdf.set_y(44)


def _partes(pdf: ComprobantePDF, izq_tit: str, izq: list[str],
            der_tit: str, der: list[str]) -> None:
    y = pdf.get_y()
    for x, tit, lineas in ((15, izq_tit, izq), (110, der_tit, der)):
        pdf.set_xy(x, y)
        pdf.set_font("DejaVu", "B", 7)
        pdf.set_text_color(*AZUL)
        pdf.cell(85, 4, tit.upper(), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        for i, linea in enumerate(lineas):
            pdf.set_xy(x, y + 6 + i * 4.6)
            pdf.set_font("DejaVu", "B" if i == 0 else "", 9 if i == 0 else 8)
            pdf.set_text_color(*(TINTA if i == 0 else GRIS))
            pdf.cell(85, 4.6, linea)
    pdf.set_y(y + 6 + max(len(izq), len(der)) * 4.6 + 6)


def _seccion(pdf: ComprobantePDF, en: str, fr: str) -> None:
    pdf.set_font("DejaVu", "B", 7)
    pdf.set_text_color(*AZUL)
    pdf.cell(0, 5, f"{en.upper()}   ·   {fr.upper()}", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_draw_color(*AZUL)
    pdf.set_line_width(0.4)
    y = pdf.get_y()
    pdf.line(15, y, 195, y)
    pdf.ln(3)


def _linea(pdf: ComprobantePDF, concepto: str, detalle: Optional[str],
           importe: str, *, color: Optional[tuple] = None) -> None:
    pdf.set_font("DejaVu", "", 9)
    pdf.set_text_color(*(color or TINTA))
    x = pdf.get_x()
    pdf.cell(110, 5.5, concepto)
    pdf.cell(70, 5.5, importe, align="R", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    if detalle:
        pdf.set_font("DejaVu", "", 7)
        pdf.set_text_color(*GRIS)
        pdf.set_x(x)
        pdf.cell(180, 4, detalle, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(1.2)


def _total(pdf: ComprobantePDF, et_en: str, et_fr: str, importe: str,
           color: tuple = TINTA) -> None:
    y = pdf.get_y() + 2
    pdf.set_fill_color(*GRIS_CLARO)
    pdf.rect(15, y, 180, 16, "F")
    pdf.set_xy(20, y + 3)
    pdf.set_font("DejaVu", "B", 10)
    pdf.set_text_color(*TINTA)
    pdf.cell(90, 5, et_en)
    pdf.set_xy(20, y + 8.5)
    pdf.set_font("DejaVu", "", 7)
    pdf.set_text_color(*GRIS)
    pdf.cell(90, 4, et_fr)
    pdf.set_xy(110, y + 4)
    pdf.set_font("DejaVu", "B", 15)
    pdf.set_text_color(*color)
    pdf.cell(80, 8, importe, align="R")
    pdf.set_y(y + 22)


@dataclass
class DatosComprobante:
    """Todo lo que hace falta para pintar, ya resuelto. El PDF no consulta nada."""
    numero: str
    fecha: str
    proveedor_nombre: str
    proveedor_lineas: list[str]
    cliente_nombre: str
    cliente_lineas: list[str]
    servicio: str
    referencia: str
    detalle_servicio: str
    subtotal_cents: int
    labor_cents: int
    materiales_cents: int
    propina_cents: int
    tarifa_servicio_cents: int
    impuesto_cents: int
    impuesto_etiqueta: Optional[str]
    impuesto_numero: Optional[str]
    total_cents: int
    comision_cents: int
    neto_proveedor_cents: int
    tarjeta: Optional[str]
    fecha_cobro: Optional[str]


def _pdf_cliente(d: DatosComprobante) -> bytes:
    p = ComprobantePDF()
    p.add_page()
    _cabecera(p, "RECEIPT", "Reçu", d.numero, d.fecha)
    _partes(p,
            "Service provided by / Service rendu par",
            [d.proveedor_nombre] + d.proveedor_lineas,
            "Billed to / Facturé à",
            [d.cliente_nombre] + d.cliente_lineas)

    _seccion(p, "Work performed", "Travaux effectués")
    _linea(p, d.servicio, d.detalle_servicio, dinero(d.labor_cents))
    if d.materiales_cents:
        _linea(p, "Materials purchased by the provider",
               "Reimbursed in full — receipts on file / Remboursé intégralement",
               dinero(d.materiales_cents))
    if d.propina_cents:
        _linea(p, "Tip / Pourboire",
               "Paid in full to the provider / Versé intégralement",
               dinero(d.propina_cents))
    p.ln(2)

    _seccion(p, "Charges", "Frais")
    _linea(p, "Subtotal / Sous-total", None, dinero(d.subtotal_cents))
    if d.tarifa_servicio_cents:
        _linea(p, "Service fee / Frais de service",
               "VISP platform and payment processing / Plateforme et traitement du paiement",
               dinero(d.tarifa_servicio_cents))
    # La línea de impuesto SOLO si se cobró. Insinuar un impuesto que no se
    # cobró es peor que omitirlo, y hoy los proveedores individuales no están
    # registrados fiscalmente, así que no se cobra ninguno.
    if d.impuesto_cents and d.impuesto_etiqueta:
        _linea(p, d.impuesto_etiqueta,
               f"GST/HST No. {d.impuesto_numero}" if d.impuesto_numero else None,
               dinero(d.impuesto_cents))

    _total(p, "Total charged to your card", "Total débité sur votre carte",
           dinero(d.total_cents))

    if d.fecha_cobro:
        p.set_font("DejaVu", "", 7.5)
        p.set_text_color(*GRIS)
        tarjeta = f" · {d.tarjeta}" if d.tarjeta else ""
        p.multi_cell(180, 4,
                     f"Charged on {d.fecha_cobro}{tarjeta}\n"
                     f"Débité le {d.fecha_cobro}{tarjeta}")
    return bytes(p.output())


def _pdf_proveedor(d: DatosComprobante) -> bytes:
    p = ComprobantePDF()
    p.add_page()
    _cabecera(p, "PAYOUT STATEMENT", "Relevé de versement", d.numero, d.fecha)
    _partes(p,
            "Paid to / Versé à",
            [d.proveedor_nombre] + d.proveedor_lineas,
            "Job / Mission",
            [d.referencia, d.servicio, d.fecha])

    _seccion(p, "What the customer paid", "Ce que le client a payé")
    _linea(p, "Total charged to the customer / Total facturé au client", None,
           dinero(d.total_cents))
    p.ln(2)

    _seccion(p, "Deductions", "Déductions")
    if d.comision_cents:
        _linea(p, "VISP commission / Commission VISP",
               "On the labour subtotal, not on materials or tip",
               f"−{dinero(d.comision_cents)}", color=ROJO)
    if d.tarifa_servicio_cents:
        _linea(p, "Service fee / Frais de service",
               "Collected from the customer, retained by VISP",
               f"−{dinero(d.tarifa_servicio_cents)}", color=ROJO)
    if d.impuesto_cents:
        _linea(p, "Sales tax remitted / Taxe de vente remise",
               "You remit this to the CRA / Vous la remettez à l'ARC",
               f"−{dinero(d.impuesto_cents)}", color=ROJO)

    if d.materiales_cents or d.propina_cents:
        p.ln(2)
        _seccion(p, "Added back", "Ajouté")
        if d.materiales_cents:
            _linea(p, "Materials reimbursement / Remboursement des matériaux",
                   None, f"+{dinero(d.materiales_cents)}")
        if d.propina_cents:
            _linea(p, "Tip / Pourboire", None, f"+{dinero(d.propina_cents)}")

    _total(p, "Deposited to your bank account", "Déposé sur votre compte bancaire",
           dinero(d.neto_proveedor_cents), color=VERDE)

    p.set_font("DejaVu", "", 7.5)
    p.set_text_color(*GRIS)
    p.multi_cell(180, 4,
                 "Expected in your account within 1–2 business days.\n"
                 "Attendu sur votre compte sous 1 à 2 jours ouvrables.")
    return bytes(p.output())


# ---------------------------------------------------------------------------
# Emisión
# ---------------------------------------------------------------------------

async def _siguiente_numero(db: AsyncSession) -> str:
    """El siguiente número de la serie de VISP.

    Lo da POSTGRES, no el código. Un `SELECT MAX()+1` permite que dos capturas
    simultáneas se lleven el mismo número; una secuencia no.
    """
    n = (await db.execute(text("SELECT nextval('visp_invoice_seq')"))).scalar_one()
    return f"VISP-{datetime.now(ZONA).year}-{n:06d}"


async def _reunir_datos(db: AsyncSession, job: Any, numero: str) -> DatosComprobante:
    """Todo lo que el PDF necesita, resuelto aquí. El pintado no consulta nada."""
    from src.models.provider import ProviderProfile
    from src.models.taxonomy import ServiceTask
    from src.models.user import User
    from src.models.job import JobAssignment, AssignmentStatus

    tarea = await db.get(ServiceTask, job.task_id)
    cliente = await db.get(User, job.customer_id)

    asignacion = (await db.execute(
        select(JobAssignment).where(
            JobAssignment.job_id == job.id,
            JobAssignment.status == AssignmentStatus.ACCEPTED,
        ).limit(1)
    )).scalars().first()
    perfil = await db.get(ProviderProfile, asignacion.provider_id) if asignacion else None
    prov_user = await db.get(User, perfil.user_id) if perfil else None

    def nombre(u) -> str:
        if u is None:
            return "—"
        return " ".join(x for x in (u.first_name, u.last_name) if x) or u.email

    prov_lineas = []
    if perfil is not None:
        nivel = int(perfil.current_level.value) if perfil.current_level else None
        if nivel is not None:
            prov_lineas.append(f"Provider · Level {nivel}")
        ciudad = ", ".join(x for x in (perfil.home_city, perfil.home_province_state) if x)
        if ciudad:
            prov_lineas.append(ciudad)

    cli_lineas = []
    if cliente is not None:
        if cliente.default_address_street:
            cli_lineas.append(cliente.default_address_street)
        loc = ", ".join(x for x in (cliente.default_address_city,
                                    cliente.default_address_province) if x)
        if cliente.default_address_postal_code:
            loc = f"{loc}  {cliente.default_address_postal_code}".strip()
        if loc:
            cli_lineas.append(loc)

    total = job.actual_total_cents or job.total_charged_cents or 0
    materiales = job.materials_spent_cents or 0
    propina = job.tip_cents or 0
    tarifa = job.service_fee_cents or 0
    impuesto = job.service_tax_cents or 0
    comision = job.commission_amount_cents or 0
    # La mano de obra es lo que queda al quitar lo que no es trabajo.
    labor = max(total - materiales - propina - tarifa - impuesto, 0)

    # Cómo se compone el precio, para que el cliente entienda el número.
    if job.quantity and job.hourly_rate_cents:
        detalle_precio = f"{float(job.quantity):g} × {dinero(job.hourly_rate_cents)}"
    elif job.hourly_rate_cents:
        detalle_precio = f"{dinero(job.hourly_rate_cents)} / h"
    else:
        detalle_precio = ""

    cuando = job.requested_date.strftime("%B %-d, %Y") if job.requested_date else ""
    detalle = "  ·  ".join(x for x in (job.reference_number, cuando, detalle_precio) if x)

    return DatosComprobante(
        numero=numero,
        fecha=datetime.now(ZONA).strftime("%B %-d, %Y"),
        proveedor_nombre=nombre(prov_user),
        proveedor_lineas=prov_lineas,
        cliente_nombre=nombre(cliente),
        cliente_lineas=cli_lineas,
        servicio=tarea.name if tarea else "Service",
        referencia=job.reference_number or "",
        detalle_servicio=detalle,
        subtotal_cents=labor + materiales + propina,
        labor_cents=labor,
        materiales_cents=materiales,
        propina_cents=propina,
        tarifa_servicio_cents=tarifa,
        impuesto_cents=impuesto,
        impuesto_etiqueta=(
            f"{job.tax_jurisdiction} sales tax" if impuesto and job.tax_jurisdiction else None
        ),
        impuesto_numero=perfil.tax_number if perfil else None,
        total_cents=total,
        comision_cents=comision,
        neto_proveedor_cents=job.provider_payout_cents or 0,
        tarjeta=None,
        fecha_cobro=datetime.now(ZONA).strftime("%B %-d, %Y"),
    )


async def emitir_comprobantes(db: AsyncSession, job: Any) -> list[dict[str, Any]]:
    """Emite los dos documentos del trabajo. Idempotente.

    Si ya existen —una captura reintentada, por ejemplo— devuelve los que hay
    en vez de emitir otros con números nuevos. Una factura duplicada con dos
    números distintos para el mismo cobro es peor que no tener ninguna.

    No lanza nunca: un fallo generando el PDF NO puede tumbar la captura del
    cobro, que es lo que de verdad importa. Se registra y se puede reintentar.
    """
    try:
        ya = (await db.execute(text(
            "SELECT kind, number, document_path FROM job_invoices WHERE job_id = :j"
        ), {"j": str(job.id)})).mappings().all()
        if ya:
            return [dict(r) for r in ya]

        numero = await _siguiente_numero(db)
        datos = await _reunir_datos(db, job, numero)

        INVOICE_DIR.mkdir(parents=True, exist_ok=True)
        salida: list[dict[str, Any]] = []

        for tipo, num, pdf_bytes in (
            ("customer", numero, _pdf_cliente(datos)),
            ("provider", f"{numero}-P", _pdf_proveedor(
                DatosComprobante(**{**datos.__dict__, "numero": f"{numero}-P"}))),
        ):
            nombre_fichero = f"{job.id}_{tipo}_{uuid.uuid4().hex[:8]}.pdf"
            ruta = INVOICE_DIR / nombre_fichero
            ruta.write_bytes(pdf_bytes)
            huella = hashlib.sha256(pdf_bytes).hexdigest()

            await db.execute(text("""
                INSERT INTO job_invoices
                    (job_id, kind, number, document_path, document_hash, totals_json, currency)
                VALUES (:j, :k, :n, :p, :h, CAST(:t AS jsonb), :c)
            """), {
                "j": str(job.id), "k": tipo, "n": num,
                "p": f"uploads/invoices/{nombre_fichero}", "h": huella,
                "t": __import__("json").dumps({
                    "total_cents": datos.total_cents,
                    "labor_cents": datos.labor_cents,
                    "materials_cents": datos.materiales_cents,
                    "tip_cents": datos.propina_cents,
                    "service_fee_cents": datos.tarifa_servicio_cents,
                    "tax_cents": datos.impuesto_cents,
                    "commission_cents": datos.comision_cents,
                    "provider_net_cents": datos.neto_proveedor_cents,
                }),
                "c": (job.currency or "CAD").upper(),
            })
            salida.append({"kind": tipo, "number": num,
                           "document_path": f"uploads/invoices/{nombre_fichero}"})

        await db.flush()
        logger.info("Comprobantes emitidos para %s: %s", job.reference_number, numero)
        return salida
    except Exception:  # noqa: BLE001 — el cobro manda; el PDF se puede reintentar.
        logger.exception("No se pudieron emitir los comprobantes del trabajo %s", job.id)
        return []
