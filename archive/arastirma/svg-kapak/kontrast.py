"""SVG kapaklarında her metin öğesinin WCAG kontrastını ölçer.

Yöntem: tüm metinler gizli zemin + yalnız tek metin görünür çizimi; farktan metin maskesi.
Metin rengi: maskeli pikseller (yazının kendisi). Zemin: maskenin 6 px genişletilmiş halkası, zemin çiziminden.
Kontrast: WCAG göreli parlaklık oranı; zemin için medyan ve en kötü %10'luk dilim.
"""
import re
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

KOK = Path(__file__).resolve().parent
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
IDS = ["baslik", "alt", "fiyat", "marka"]
TMP = KOK / "_kontrast"
TMP.mkdir(exist_ok=True)


def ciz(svg_text, ad):
    html = KOK / f"_k_{ad}.html"
    html.write_text("<!doctype html><html><head><meta charset='utf-8'><style>html,body{margin:0;background:#000}svg{display:block}</style></head><body>"
                    + svg_text + "</body></html>", encoding="utf-8")
    png = TMP / f"{ad}.png"
    subprocess.run([EDGE, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--window-size=1080,1920",
                    "--virtual-time-budget=8000", f"--screenshot={png}", html.as_uri()], check=True, capture_output=True, timeout=120)
    html.unlink()
    return np.asarray(Image.open(png).convert("RGB")).astype(float)


def gizle(svg, gorunur=None):
    def sub(m):
        tag = m.group(0)
        idm = re.search(r'id="([^"]+)"', tag)
        if idm and idm.group(1) == gorunur:
            return tag
        return tag[:-1] + ' visibility="hidden">' if not tag.endswith("/>") else tag
    return re.sub(r"<text\b[^>]*>", sub, svg)


def lum(rgb):
    c = rgb / 255.0
    c = np.where(c <= 0.03928, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * c[..., 0] + 0.7152 * c[..., 1] + 0.0722 * c[..., 2]


def oran(l1, l2):
    a, b = max(l1, l2), min(l1, l2)
    return (a + 0.05) / (b + 0.05)


def olc(svg_yolu):
    svg = svg_yolu.read_text(encoding="utf-8")
    svg = re.sub(r"&(?!amp;|lt;|gt;|quot;|apos;|#)", "&amp;", svg)
    zemin = ciz(gizle(svg), svg_yolu.stem + "_zemin")
    sonuc = {}
    for i in IDS:
        if f'id="{i}"' not in svg:
            continue
        tek = ciz(gizle(svg, i), f"{svg_yolu.stem}_{i}")
        fark = np.abs(tek - zemin).sum(axis=2)
        maske = fark > 60
        if maske.sum() < 20:
            sonuc[i] = None
            continue
        m_img = Image.fromarray((maske * 255).astype("uint8"))
        halka = np.asarray(m_img.filter(ImageFilter.MaxFilter(13))) > 0
        halka &= ~maske
        yazi_l = np.median(lum(tek[maske]))
        zemin_l = lum(zemin[halka])
        med = oran(yazi_l, np.median(zemin_l))
        # en kötü: zeminin yazıya en yakın parlaklıktaki %10'u
        fark_l = np.abs(zemin_l - yazi_l)
        kotu = zemin_l[fark_l <= np.percentile(fark_l, 10)]
        en_kotu = oran(yazi_l, np.median(kotu))
        sonuc[i] = (round(med, 1), round(en_kotu, 1))
    return sonuc


def main():
    print(f"{'svg':28s} " + "  ".join(f"{i:>14s}" for i in IDS) + "   (medyan / en kötü %10)")
    for svg in sorted((KOK / "svg").glob("*.svg")):
        if "mimo" in svg.stem and "build" not in svg.stem:
            continue
        try:
            s = olc(svg)
        except Exception as e:
            print(f"{svg.stem:28s} HATA {e}")
            continue
        hucre = []
        for i in IDS:
            v = s.get(i)
            hucre.append(f"{'-':>14s}" if v is None else f"{v[0]:>6.1f} / {v[1]:<5.1f}")
        print(f"{svg.stem:28s} " + "  ".join(hucre))


if __name__ == "__main__":
    main()
