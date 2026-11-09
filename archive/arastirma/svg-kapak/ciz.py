"""SVG kapakları headless Edge ile 1080x1920 PNG'ye çizer ve metin kontrolü yapar.

Kullanım: python ciz.py
"""
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

KOK = Path(__file__).resolve().parent
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"  # yerel Edge yolu; gerekirse değiştirin
BEKLENEN = {
    "baslik": "Yeni Sezon Ekmekleri",
    "alt": "Ekşi mayalı, her sabah 07.00'de fırından",
    "fiyat": "Köy ekmeği 85 ₺",
    "marka": "Kuzey Fırın",
}
NS = "{http://www.w3.org/2000/svg}"


def metin_kontrol(svg_yolu):
    """Her beklenen id'nin gerçek <text> olarak ve harfi harfine bulunduğunu doğrular."""
    sorunlar = []
    agac = ET.parse(svg_yolu)
    metinler = {}
    for el in agac.iter():
        if el.tag in (NS + "text", "text") and el.get("id"):
            metinler[el.get("id")] = re.sub(r"\s+", " ", "".join(el.itertext())).strip()
    for k, v in BEKLENEN.items():
        if k not in metinler:
            sorunlar.append(f"{k}: <text id> yok")
        elif metinler[k] != v:
            sorunlar.append(f"{k}: '{metinler[k]}' != '{v}'")
    yasak = [t for t in ("linearGradient", "radialGradient") if t in Path(svg_yolu).read_text(encoding="utf-8")]
    return sorunlar, yasak


def ciz(svg_yolu, png_yolu):
    html = KOK / "render" / (svg_yolu.stem + ".html")
    svg = svg_yolu.read_text(encoding="utf-8")
    html.write_text(
        "<!doctype html><html><head><meta charset='utf-8'><style>html,body{margin:0;padding:0;background:#000}"
        "svg{display:block}</style></head><body>" + svg + "</body></html>", encoding="utf-8")
    # arka.png göreli yolu için html'yi kök dizine kopyala
    kok_html = KOK / ("_" + svg_yolu.stem + ".html")
    kok_html.write_text(html.read_text(encoding="utf-8"), encoding="utf-8")
    subprocess.run([EDGE, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                    "--window-size=1080,1920", "--virtual-time-budget=8000",
                    f"--screenshot={png_yolu}", kok_html.as_uri()], check=True, capture_output=True, timeout=120)
    kok_html.unlink()


def main():
    for svg in sorted((KOK / "svg").glob("*.svg")):
        png = KOK / "render" / (svg.stem + ".png")
        try:
            sorun, yasak = metin_kontrol(svg)
        except ET.ParseError as e:
            print(f"{svg.stem}: SVG BOZUK ({e})")
            continue
        ciz(svg, png)
        print(f"{svg.stem}: metin {'TAM' if not sorun else 'SORUNLU'} {sorun} | gradyan: {yasak or 'yok'} | {png.name}")


if __name__ == "__main__":
    sys.exit(main())

