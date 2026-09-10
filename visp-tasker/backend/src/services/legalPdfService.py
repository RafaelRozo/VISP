"""
Legal PDF Service — el artefacto firmado
=========================================

Renderiza el contrato markdown de ``content/legal/`` a un PDF con la tabla de
aceptación rellenada y una página de firma al final.

Por qué se genera en el SERVIDOR y no en la app
-----------------------------------------------
El documento firmado es prueba. Si lo compusiera el cliente, el contenido, la
fecha y el hash vendrían del mismo dispositivo del firmante — que es justo el
que no puede ser la autoridad sobre lo que se firmó. La app manda el trazo; el
servidor decide el texto, la hora y el hash.

Por qué ``fpdf2``
-----------------
Python puro, sin dependencias de sistema: no toca el Dockerfile. ``reportlab``
es más potente pero más aparatoso, y WeasyPrint exigiría pango/cairo en la
imagen.

Fuentes
-------
Las fuentes básicas de ``fpdf2`` son latin-1 y el contrato lleva em-dash (—) y
comillas tipográficas, que no están en latin-1: saldrían como basura o
reventarían. Por eso se embarca DejaVuSans en ``backend/assets/fonts/``
(licencia Bitstream Vera, redistribuible). La alternativa —normalizar la
tipografía a ASCII— cambiaría el texto de un documento legal; no se hace.
"""

from __future__ import annotations

import hashlib
import io
import logging
import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from fpdf import FPDF
from fpdf.enums import XPos, YPos
from PIL import Image, ImageDraw

logger = logging.getLogger(__name__)

_BACKEND_ROOT = Path(__file__).resolve().parents[2]
FONT_DIR = _BACKEND_ROOT / "assets" / "fonts"
UPLOAD_DIR = _BACKEND_ROOT / "uploads"
CONTRACT_DIR = UPLOAD_DIR / "contracts"

# Ontario: el contrato se rige por las leyes de Ontario (§21), así que la fecha
# de aceptación se sella en la hora de Ontario, no en UTC ni en la del móvil.
ONTARIO_TZ = ZoneInfo("America/Toronto")

FONT_FAMILY = "DejaVu"
COLOR_TEXT = (26, 26, 26)
COLOR_HEADING = (31, 58, 95)
COLOR_MUTED = (110, 110, 110)
COLOR_CALLOUT_BG = (247, 243, 226)
COLOR_CALLOUT_BORDER = (214, 195, 122)
COLOR_TABLE_HEAD = (31, 58, 95)


@dataclass
class SignatureData:
    """El trazo tal y como llega de la app.

    ``strokes`` es una lista de trazos y cada trazo una lista de puntos
    ``[x, y]`` en el sistema de coordenadas del lienzo (``width`` × ``height``).
    Se guarda el VECTOR, no solo el bitmap: permite re-rasterizar a cualquier
    resolución el día que haya que ampliarlo para una disputa.
    """

    width: float
    height: float
    strokes: list[list[list[float]]] = field(default_factory=list)

    def is_empty(self) -> bool:
        return not any(len(s) >= 2 for s in self.strokes)

    def to_svg(self) -> str:
        paths = []
        for stroke in self.strokes:
            if len(stroke) < 2:
                continue
            d = "M " + " L ".join(f"{p[0]:.2f},{p[1]:.2f}" for p in stroke)
            paths.append(
                f'<path d="{d}" fill="none" stroke="#111111" '
                f'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>'
            )
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" '
            f'viewBox="0 0 {self.width:.0f} {self.height:.0f}" '
            f'width="{self.width:.0f}" height="{self.height:.0f}">'
            + "".join(paths)
            + "</svg>"
        )

    def to_png(self, scale: int = 3) -> bytes:
        """Rasteriza el trazo sobre fondo blanco.

        Se dibuja con Pillow y no parseando el SVG: los puntos ya vienen en
        crudo, así que convertirlos a texto SVG para volver a parsearlos solo
        añadiría una capa donde perder precisión.
        """
        w = max(int(self.width * scale), 1)
        h = max(int(self.height * scale), 1)
        img = Image.new("RGB", (w, h), "white")
        draw = ImageDraw.Draw(img)
        for stroke in self.strokes:
            if len(stroke) < 2:
                continue
            pts = [(p[0] * scale, p[1] * scale) for p in stroke]
            draw.line(pts, fill=(17, 17, 17), width=max(2 * scale, 1), joint="curve")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()


@dataclass
class AcceptanceRecord:
    """Los datos que rellenan el bloque de aceptación del contrato."""

    legal_name: str
    account_email: str
    consent_id: uuid.UUID
    user_id: uuid.UUID
    document_version: str
    text_hash: str
    accepted_at: datetime
    business_name: str | None = None
    ip_address: str | None = None
    user_agent: str | None = None
    device_id: str | None = None
    party_label: str = "Service Provider"

    def accepted_at_local(self) -> str:
        return self.accepted_at.astimezone(ONTARIO_TZ).strftime(
            "%Y-%m-%d %H:%M:%S %Z"
        )


class ContractPDF(FPDF):
    """Documento con el encabezado y pie del contrato original."""

    def __init__(self, running_head: str, footer_note: str) -> None:
        super().__init__(format="Letter", unit="pt")
        self.running_head = running_head
        self.footer_note = footer_note
        self.set_auto_page_break(auto=True, margin=54)
        self.set_margins(54, 42, 54)
        for style, filename in (
            ("", "DejaVuSans.ttf"),
            ("B", "DejaVuSans-Bold.ttf"),
            ("I", "DejaVuSans-Oblique.ttf"),
        ):
            self.add_font(FONT_FAMILY, style, str(FONT_DIR / filename))

    def header(self) -> None:  # noqa: D102 - fpdf2 hook
        self.set_font(FONT_FAMILY, "", 6.5)
        self.set_text_color(*COLOR_MUTED)
        self.set_y(24)
        self.cell(0, 10, self.running_head, align="R",
                  new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        self.set_y(42)
        self.set_text_color(*COLOR_TEXT)

    def footer(self) -> None:  # noqa: D102 - fpdf2 hook
        self.set_y(-38)
        self.set_font(FONT_FAMILY, "", 6.5)
        self.set_text_color(*COLOR_MUTED)
        self.cell(0, 10, f"{self.footer_note}  |  Page {self.page_no()}",
                  align="C")
        self.set_text_color(*COLOR_TEXT)


# ---------------------------------------------------------------------------
# Markdown -> PDF
# ---------------------------------------------------------------------------

_TABLE_ROW = re.compile(r"^\|(.+)\|\s*$")
_TABLE_SEP = re.compile(r"^\|[\s:|-]+\|\s*$")


def _split_row(line: str) -> list[str]:
    cells = line.strip().strip("|").split("|")
    return [c.strip().replace("\\|", "|") for c in cells]


def _render_markdown(pdf: ContractPDF, markdown: str, *, replace_acceptance_form: bool = False) -> None:
    lines = markdown.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if not stripped:
            i += 1
            continue

        # --- table ---------------------------------------------------------
        if _TABLE_ROW.match(stripped) and i + 1 < len(lines) and \
                _TABLE_SEP.match(lines[i + 1].strip()):
            header = _split_row(stripped)
            rows = []
            j = i + 2
            while j < len(lines) and _TABLE_ROW.match(lines[j].strip()):
                rows.append(_split_row(lines[j].strip()))
                j += 1
            # The final empty form is completed on the signature page. Keep
            # every clause and other table intact, without a duplicate blank form.
            acceptance_form = (
                header == ["Field", "Value (filled at acceptance)"]
                and len(rows) == 5
                and all(len(row) == 2 and not row[1] for row in rows)
                and rows[0][0] in ("**Customer Legal Name**", "**Service Provider Legal Name**")
                and not any(line.strip() for line in lines[j:])
            )
            if not (replace_acceptance_form and acceptance_form):
                _render_table(pdf, header, rows)
            i = j
            continue

        # --- callout -------------------------------------------------------
        if stripped.startswith(">"):
            block = []
            j = i
            while j < len(lines) and lines[j].strip().startswith(">"):
                block.append(lines[j].strip().lstrip(">").strip())
                j += 1
            title = block[0].strip("*")
            body = " ".join(b for b in block[1:] if b)
            _render_callout(pdf, title, body)
            i = j
            continue

        # --- headings ------------------------------------------------------
        if stripped.startswith("# "):
            pdf.ln(6)
            pdf.set_font(FONT_FAMILY, "B", 15)
            pdf.set_text_color(*COLOR_HEADING)
            pdf.multi_cell(0, 20, stripped[2:].strip(), align="C",
                           new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            pdf.set_text_color(*COLOR_TEXT)
            pdf.ln(6)
            i += 1
            continue

        if stripped.startswith("## "):
            pdf.ln(8)
            pdf.set_font(FONT_FAMILY, "B", 10.5)
            pdf.set_text_color(*COLOR_HEADING)
            pdf.multi_cell(0, 14, stripped[3:].strip(),
                           new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            pdf.set_text_color(*COLOR_TEXT)
            pdf.ln(3)
            i += 1
            continue

        # --- bullet --------------------------------------------------------
        if stripped.startswith("- "):
            pdf.set_font(FONT_FAMILY, "", 8.5)
            left = pdf.l_margin
            pdf.set_x(left + 10)
            pdf.multi_cell(pdf.epw - 10, 11.5, f"•  {stripped[2:].strip()}",
                           markdown=True, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            pdf.ln(1.5)
            i += 1
            continue

        # --- paragraph -----------------------------------------------------
        pdf.set_font(FONT_FAMILY, "", 8.5)
        italic = stripped.startswith("*") and stripped.endswith("*") and \
            not stripped.startswith("**")
        text = stripped.strip("*") if italic else stripped
        if italic:
            pdf.set_font(FONT_FAMILY, "I", 8.5)
        pdf.multi_cell(0, 12, text, markdown=not italic,
                       new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.ln(4)
        i += 1


def _render_callout(pdf: ContractPDF, title: str, body: str) -> None:
    pdf.ln(4)
    pdf.set_fill_color(*COLOR_CALLOUT_BG)
    pdf.set_draw_color(*COLOR_CALLOUT_BORDER)
    pdf.set_line_width(0.8)
    pdf.set_font(FONT_FAMILY, "B", 8.5)
    pdf.multi_cell(0, 13, f"  {title}", fill=True, border="LTR",
                   new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    if body:
        pdf.set_font(FONT_FAMILY, "", 8)
        pdf.multi_cell(0, 11.5, f"  {body}  ", fill=True, border="LBR",
                       new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    else:
        pdf.multi_cell(0, 2, "", fill=True, border="LBR",
                       new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_draw_color(0, 0, 0)
    pdf.ln(6)


def _render_table(pdf: ContractPDF, header: list[str], rows: list[list[str]]) -> None:
    pdf.ln(4)
    ncols = len(header)
    # La matriz de suministros tiene 3 columnas anchas; el resto son tablas de
    # campos, más estrechas. Se reparte el ancho a partes iguales salvo en la
    # tabla de aceptación, donde la etiqueta ocupa poco y el valor mucho.
    if ncols == 2:
        widths = [pdf.epw * 0.38, pdf.epw * 0.62]
    else:
        widths = [pdf.epw / ncols] * ncols

    pdf.set_font(FONT_FAMILY, "B", 7.5)
    pdf.set_fill_color(*COLOR_TABLE_HEAD)
    pdf.set_text_color(255, 255, 255)
    _table_row(pdf, header, widths, fill=True, line_h=10)
    pdf.set_text_color(*COLOR_TEXT)

    pdf.set_font(FONT_FAMILY, "", 7)
    for idx, row in enumerate(rows):
        pdf.set_fill_color(248, 248, 250)
        _table_row(pdf, row, widths, fill=(idx % 2 == 1), line_h=9)
    pdf.ln(6)


def _table_row(pdf: ContractPDF, cells: list[str], widths: list[float],
               *, fill: bool, line_h: float) -> None:
    """Fila de altura variable: se mide la celda más alta y se pintan todas igual."""
    heights = []
    for text, w in zip(cells, widths):
        lines = pdf.multi_cell(w, line_h, _plain(text), dry_run=True,
                               output="LINES", markdown=True)
        heights.append(max(len(lines), 1) * line_h)
    row_h = max(heights) + 4

    # Salto de página ANTES de pintar: partir una fila por la mitad deja media
    # celda huérfana y una tabla ilegible.
    if pdf.get_y() + row_h > pdf.h - pdf.b_margin:
        pdf.add_page()

    x0, y0 = pdf.get_x(), pdf.get_y()
    for text, w in zip(cells, widths):
        x = pdf.get_x()
        pdf.multi_cell(w, line_h, _plain(text), border=0, fill=fill,
                       markdown=True, max_line_height=line_h,
                       new_x=XPos.RIGHT, new_y=YPos.TOP)
        pdf.set_xy(x + w, y0)
    pdf.set_xy(x0, y0)
    pdf.set_draw_color(200, 200, 205)
    pdf.set_line_width(0.4)
    pdf.rect(x0, y0, sum(widths), row_h)
    x = x0
    for w in widths[:-1]:
        x += w
        pdf.line(x, y0, x, y0 + row_h)
    pdf.set_draw_color(0, 0, 0)
    pdf.set_xy(x0, y0 + row_h)


def _plain(text: str) -> str:
    """Quita el marcado que fpdf2 no entiende, conservando **negrita**."""
    return text.replace("\\|", "|")


# ---------------------------------------------------------------------------
# Signature page
# ---------------------------------------------------------------------------

def _render_signature_page(pdf: ContractPDF, record: AcceptanceRecord,
                           signature_png: bytes | None) -> None:
    pdf.add_page()
    pdf.set_font(FONT_FAMILY, "B", 13)
    pdf.set_text_color(*COLOR_HEADING)
    pdf.multi_cell(0, 20, "Electronic Signature and Acceptance Record",
                   new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_text_color(*COLOR_TEXT)
    pdf.ln(6)

    pdf.set_font(FONT_FAMILY, "", 8.5)
    pdf.multi_cell(
        0, 12,
        f"This page records the electronic acceptance of the agreement "
        f"reproduced above, version {record.document_version}. It was produced "
        f"by the VISP platform at the moment of acceptance and forms part of "
        f"the same document.",
        new_x=XPos.LMARGIN, new_y=YPos.NEXT,
    )
    pdf.ln(10)

    # --- el bloque de aceptación del propio contrato, ya relleno -------------
    fields = [
        (f"{record.party_label} Legal Name", record.legal_name),
        ("Business Name (if applicable)", record.business_name or "—"),
        ("VISP Account Email", record.account_email),
        ("Acceptance Date", record.accepted_at_local()),
        ("Electronic Acceptance Record / Account ID",
         f"{record.consent_id} / {record.user_id}"),
    ]
    _render_table(pdf, ["Field", "Value"], [[f"**{k}**", v] for k, v in fields])

    # --- la firma ------------------------------------------------------------
    pdf.ln(4)
    pdf.set_font(FONT_FAMILY, "B", 9)
    pdf.multi_cell(0, 13, "Signature", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(2)

    box_w, box_h = pdf.epw, 90.0
    x0, y0 = pdf.get_x(), pdf.get_y()
    if y0 + box_h + 60 > pdf.h - pdf.b_margin:
        pdf.add_page()
        x0, y0 = pdf.get_x(), pdf.get_y()
    pdf.set_draw_color(180, 180, 185)
    pdf.rect(x0, y0, box_w, box_h)

    if signature_png:
        img = Image.open(io.BytesIO(signature_png))
        ratio = img.height / img.width
        draw_w = min(box_w - 24, 260.0)
        draw_h = draw_w * ratio
        if draw_h > box_h - 30:
            draw_h = box_h - 30
            draw_w = draw_h / ratio
        pdf.image(io.BytesIO(signature_png), x=x0 + 14, y=y0 + 10,
                  w=draw_w, h=draw_h)
    else:
        pdf.set_xy(x0 + 14, y0 + 30)
        pdf.set_font(FONT_FAMILY, "I", 8)
        pdf.set_text_color(*COLOR_MUTED)
        pdf.cell(box_w - 28, 12, "Accepted electronically (no drawn signature)")
        pdf.set_text_color(*COLOR_TEXT)

    # línea de firma con el nombre legal debajo, como en un contrato en papel
    pdf.set_draw_color(120, 120, 125)
    pdf.line(x0 + 14, y0 + box_h - 22, x0 + 274, y0 + box_h - 22)
    pdf.set_xy(x0 + 14, y0 + box_h - 20)
    pdf.set_font(FONT_FAMILY, "", 8)
    pdf.cell(300, 12, record.legal_name)
    pdf.set_xy(x0, y0 + box_h + 8)
    pdf.set_draw_color(0, 0, 0)

    # --- auditoría -----------------------------------------------------------
    pdf.ln(14)
    pdf.set_font(FONT_FAMILY, "B", 9)
    pdf.multi_cell(0, 13, "Audit trail", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    audit = [
        ("Agreement version", record.document_version),
        ("Agreement text SHA-256", record.text_hash),
        ("Accepted at (UTC)", record.accepted_at.astimezone(
            ZoneInfo("UTC")).strftime("%Y-%m-%d %H:%M:%S UTC")),
        ("IP address", record.ip_address or "—"),
        ("Device identifier", record.device_id or "—"),
        ("User agent", (record.user_agent or "—")[:180]),
    ]
    _render_table(pdf, ["Field", "Value"], [[f"**{k}**", v] for k, v in audit])

    pdf.ln(4)
    pdf.set_font(FONT_FAMILY, "I", 7.5)
    pdf.set_text_color(*COLOR_MUTED)
    pdf.multi_cell(
        0, 10,
        "Accepted electronically through the VISP platform under the Electronic "
        "Commerce Act, 2000 (Ontario). This record is append-only: it is never "
        "modified after creation.",
        new_x=XPos.LMARGIN, new_y=YPos.NEXT,
    )
    pdf.set_text_color(*COLOR_TEXT)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def build_signed_contract(
    *,
    markdown: str,
    record: AcceptanceRecord,
    signature: SignatureData | None,
    running_head: str,
    footer_note: str,
) -> tuple[bytes, bytes | None]:
    """Devuelve ``(pdf_bytes, signature_png)``."""
    signature_png = None
    if signature is not None and not signature.is_empty():
        signature_png = signature.to_png()

    pdf = ContractPDF(running_head=running_head, footer_note=footer_note)
    pdf.add_page()
    _render_markdown(pdf, markdown, replace_acceptance_form=True)
    _render_signature_page(pdf, record, signature_png)
    return bytes(pdf.output()), signature_png


def persist_contract(
    consent_id: uuid.UUID,
    pdf_bytes: bytes,
    signature_png: bytes | None,
) -> tuple[str, str, str | None]:
    """Guarda el PDF (y el PNG) y devuelve ``(ruta_pdf, sha256, ruta_png)``.

    Las rutas son relativas a ``backend/uploads`` y llevan el id del
    consentimiento, no el del usuario: el archivo pertenece al acto de firma,
    que es inmutable, no a la persona, que puede firmar varias veces.
    """
    CONTRACT_DIR.mkdir(parents=True, exist_ok=True)
    pdf_name = f"contracts/{consent_id}.pdf"
    (UPLOAD_DIR / pdf_name).write_bytes(pdf_bytes)

    png_name = None
    if signature_png:
        png_name = f"contracts/{consent_id}_signature.png"
        (UPLOAD_DIR / png_name).write_bytes(signature_png)

    digest = hashlib.sha256(pdf_bytes).hexdigest()
    logger.info("Contrato firmado archivado: %s (sha256=%s)", pdf_name, digest[:16])
    return pdf_name, digest, png_name


def contract_absolute_path(document_path: str) -> Path:
    """Resuelve una ruta guardada, impidiendo salir de ``uploads/``."""
    candidate = (UPLOAD_DIR / document_path).resolve()
    if not str(candidate).startswith(str(UPLOAD_DIR.resolve())):
        raise ValueError(f"Ruta fuera de uploads/: {document_path}")
    return candidate
