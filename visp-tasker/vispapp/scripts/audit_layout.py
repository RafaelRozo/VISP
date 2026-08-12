"""Auditoría de fallos de layout en vispapp.

Busca patrones CONCRETOS y verificables, no opiniones de diseño:

 1. ScrollView/FlatList HORIZONTAL sin `flexGrow: 0` ni altura fija.
    En un padre flex-column se expande y se come el espacio vertical. Es el bug
    de la pantalla "My Work": los pills se quedaban con media pantalla.

 2. Pantalla que usa <ScreenTitle> (que ya pinta su propio título + safe area)
    mientras el navegador le muestra además un header -> dos títulos y doble
    inset superior.

 3. contentContainerStyle de un ScrollView vertical sin paddingBottom: el último
    elemento queda debajo de la tab bar.

 4. `alignItems: 'center'` en el contentContainer de un ScrollView horizontal
    (centra verticalmente y delata una caja más alta de lo previsto).
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "src"
findings: list[dict] = []


def add(kind: str, sev: str, f: Path, line: int, detail: str) -> None:
    findings.append({
        "kind": kind, "sev": sev,
        "file": str(f.relative_to(ROOT)), "line": line, "detail": detail,
    })


def line_of(txt: str, pos: int) -> int:
    return txt[:pos].count("\n") + 1


# ---------------------------------------------------------------- 1 + 4
# ScrollView/FlatList horizontal: localizar la etiqueta y su bloque de props.
HORIZ = re.compile(r"<(ScrollView|FlatList)\b([^>]*?)(/?)>", re.S)

for f in sorted(ROOT.rglob("*.tsx")):
    txt = f.read_text(encoding="utf-8")
    for m in HORIZ.finditer(txt):
        tag, props, _ = m.group(1), m.group(2), m.group(3)
        if not re.search(r"\bhorizontal\b", props):
            continue
        ln = line_of(txt, m.start())

        # ¿tiene flexGrow: 0 / flex: 0 / height en el style inline?
        inline_ok = re.search(r"flexGrow:\s*0|flex:\s*0|height:\s*\d", props)

        # ¿el style apunta a una clave de StyleSheet? seguir la referencia.
        ref_ok = False
        style_ref = re.search(r"\bstyle=\{(?:\[)?\s*([A-Za-z_$][\w$]*)\.(\w+)", props)
        if style_ref:
            obj, key = style_ref.group(1), style_ref.group(2)
            blk = re.search(
                r"%s\s*=\s*StyleSheet\.create\(\{.*?\b%s\s*:\s*\{(.*?)\}" % (re.escape(obj), re.escape(key)),
                txt, re.S,
            )
            if blk and re.search(r"flexGrow:\s*0|flex:\s*0|height:\s*\d", blk.group(1)):
                ref_ok = True

        if not (inline_ok or ref_ok):
            add("horizontal-scroll-grows", "HIGH", f, ln,
                f"<{tag} horizontal> sin flexGrow:0 ni altura -> se expande y roba espacio vertical")

        # contentContainerStyle con alignItems center
        cc = re.search(r"contentContainerStyle=\{(?:\[)?\s*([A-Za-z_$][\w$]*)\.(\w+)", props)
        if cc:
            obj, key = cc.group(1), cc.group(2)
            blk = re.search(
                r"%s\s*=\s*StyleSheet\.create\(\{.*?\b%s\s*:\s*\{(.*?)\}" % (re.escape(obj), re.escape(key)),
                txt, re.S,
            )
            if blk and re.search(r"alignItems:\s*'center'", blk.group(1)):
                add("horizontal-cc-center", "MED", f, ln,
                    f"contentContainer de <{tag} horizontal> con alignItems:'center' "
                    f"(centra en vertical; delata caja sobredimensionada)")

# ---------------------------------------------------------------- 2
# ScreenTitle + header del navegador
nav = (ROOT / "navigation" / "AppNavigator.tsx").read_text(encoding="utf-8")

# pantallas cuyo componente usa <ScreenTitle
self_titled: set[str] = set()
for f in sorted(ROOT.rglob("*.tsx")):
    txt = f.read_text(encoding="utf-8")
    if "<ScreenTitle" in txt:
        self_titled.add(f.stem)

# registros <X.Screen name="Foo" component={FooScreen} ... options
for m in re.finditer(
    r"<(\w+)\.Screen\s+([^>]*?)/?>", nav, re.S
):
    block = m.group(2)
    name = re.search(r'name="(\w+)"', block)
    comp = re.search(r"component=\{(\w+)\}", block)
    if not (name and comp):
        continue
    if comp.group(1) not in self_titled:
        continue
    has_title = re.search(r"title:\s*['\"`]", block)
    hides = re.search(r"headerShown:\s*false", block)
    if has_title and not hides:
        add("duplicate-title", "HIGH", ROOT / "navigation" / "AppNavigator.tsx",
            line_of(nav, m.start()),
            f"{name.group(1)} usa <ScreenTitle> Y el navegador le pone title -> "
            f"dos títulos + doble safe-area superior")

# ---------------------------------------------------------------- 3
# ScrollView vertical: contentContainerStyle sin paddingBottom
for f in sorted(ROOT.rglob("*.tsx")):
    txt = f.read_text(encoding="utf-8")
    for m in re.finditer(r"<ScrollView\b([^>]*?)>", txt, re.S):
        props = m.group(1)
        if re.search(r"\bhorizontal\b", props):
            continue
        cc = re.search(r"contentContainerStyle=\{(?:\[)?\s*([A-Za-z_$][\w$]*)\.(\w+)", props)
        if not cc:
            if "contentContainerStyle" not in props:
                add("scroll-no-bottom-pad", "LOW", f, line_of(txt, m.start()),
                    "<ScrollView> vertical sin contentContainerStyle "
                    "(el último elemento puede quedar bajo la tab bar)")
            continue
        obj, key = cc.group(1), cc.group(2)
        blk = re.search(
            r"%s\s*=\s*StyleSheet\.create\(\{.*?\b%s\s*:\s*\{(.*?)\}" % (re.escape(obj), re.escape(key)),
            txt, re.S,
        )
        if blk and not re.search(r"paddingBottom|paddingVertical|padding:", blk.group(1)):
            add("scroll-no-bottom-pad", "MED", f, line_of(txt, m.start()),
                f"contentContainer '{key}' sin paddingBottom -> el último "
                f"elemento queda bajo la tab bar")

# ---------------------------------------------------------------- salida
order = {"HIGH": 0, "MED": 1, "LOW": 2}
findings.sort(key=lambda d: (order[d["sev"]], d["kind"], d["file"], d["line"]))

by_kind: dict[str, int] = {}
for d in findings:
    by_kind[f'{d["sev"]} {d["kind"]}'] = by_kind.get(f'{d["sev"]} {d["kind"]}', 0) + 1

print("=" * 78)
print("AUDITORÍA DE LAYOUT — vispapp")
print("=" * 78)
for k, v in sorted(by_kind.items()):
    print(f"  {k}: {v}")
print(f"\n  TOTAL: {len(findings)}\n")

cur = None
for d in findings:
    tag = f'{d["sev"]} · {d["kind"]}'
    if tag != cur:
        cur = tag
        print(f"\n── {tag} ──")
    print(f"  {d['file']}:{d['line']}")
    print(f"      {d['detail']}")

if "--json" in sys.argv:
    print(json.dumps(findings, indent=2, ensure_ascii=False))

# Salida distinta de cero si queda algo HIGH: sirve para un hook o CI.
sys.exit(1 if any(d["sev"] == "HIGH" for d in findings) else 0)
