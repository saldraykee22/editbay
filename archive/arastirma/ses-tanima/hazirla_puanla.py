"""Uçtan uca: STT dökümü -> model komutu -> son durum.

hazirla: python hazirla_puanla.py hazirla   -> briefs/<motor>.md (+ ref)
puanla : python hazirla_puanla.py puanla <cevap_klasoru>
"""
import json
import sys
from pathlib import Path

KOK = Path(__file__).resolve().parent
sys.path.insert(0, str(KOK.parent / "komut-testi" / "zor"))
import puanla2 as Z  # noqa: E402

DURUM = json.loads((KOK.parent / "komut-testi" / "kolay" / "durum.json").read_text(encoding="utf-8"))
Z.DURUM = DURUM
Z.ORJ_SIRA = [c["id"] for c in DURUM["tracks"][0]["clips"]]
Z.ESKI_METIN = {x["id"] for t in DURUM["tracks"] for x in t.get("items", [])}
_eski_ortam = Z.ortam


def _ortam(st):
    o = _eski_ortam(st)
    o["ORJ_SIRA"] = Z.ORJ_SIRA

    def sari(h):
        h = h.lstrip("#")
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        return r >= 200 and g >= 170 and b <= 120
    o["sari"] = sari
    return o


Z.ortam = _ortam
TESTLER = {json.loads(l)["n"]: json.loads(l) for l in open(KOK / "testset_e2e.jsonl", encoding="utf-8") if l.strip()}
SIS = (KOK.parent / "komut-testi" / "zor" / "sistem_istemi2.md").read_text(encoding="utf-8")


def sis_metni():
    bas = SIS.split("PROJE DURUMU:")[0]
    return bas + "PROJE DURUMU:\n" + json.dumps(DURUM, ensure_ascii=False, indent=1)


def hazirla():
    res = json.loads((KOK / "dokumler.json").read_text(encoding="utf-8"))
    refs = [l.strip() for l in open(KOK / "ref.txt", encoding="utf-8") if l.strip()]
    (KOK / "briefs").mkdir(exist_ok=True)
    gruplar = {"ref": [(f"ref|{i}", r) for i, r in enumerate(refs, 1)]}
    for motor, v in res.items():
        satir = []
        for kosul, c in v["conditions"].items():
            for it in c["items"]:
                satir.append((f"{motor}|{kosul}|{it['idx']}", it["hyp"]))
        gruplar[motor] = satir
    for ad, satir in gruplar.items():
        istek = "\n".join(json.dumps({"id": i, "talimat": t, "secili": "yok"}, ensure_ascii=False) for i, t in satir)
        b = (f"# GÖREV: Sesli komut dökümü -> komut (toplu, kör)\n"
             f"Talimatlar bir ses tanıma motorunun dökümüdür; yazım/duyma hataları olabilir. Kullanıcının NE İSTEDİĞİNİ anlamaya çalış.\n"
             f"{len(satir)} isteğin HER BİRİ bağımsızdır; hepsi aynı başlangıç durumuna uygulanır.\n"
             f"Çıktı: istek başına tek satır {{\"id\": \"...\", \"cevap\": [komutlar]}}. Başka metin yok.\n"
             f"Başka dosya okuma, araç/kod kullanma YASAK.\n\n=== SİSTEM İSTEMİ ===\n{sis_metni()}\n\n=== İSTEKLER ===\n{istek}\n")
        (KOK / "briefs" / f"{ad}.md").write_text(b, encoding="utf-8")
        print(ad, len(satir))


def puanla(klasor):
    sonuc = {}
    for f in sorted(Path(klasor).glob("*.jsonl")):
        for l in open(f, encoding="utf-8"):
            l = l.strip()
            if not l.startswith("{"):
                continue
            try:
                s = json.loads(l)
            except json.JSONDecodeError:
                continue
            parca = s["id"].split("|")
            motor, n = parca[0], int(parca[-1])
            kosul = parca[1] if len(parca) == 3 else "ref"
            ok, _ = Z.puanla_bir(TESTLER[n], s.get("cevap"))
            sonuc.setdefault(motor, {}).setdefault(kosul, []).append(ok)
    for motor, k in sonuc.items():
        top = sum(sum(v) for v in k.values()); say = sum(len(v) for v in k.values())
        detay = "  ".join(f"{kk}:{sum(v)}/{len(v)}" for kk, v in k.items())
        print(f"{motor:24s} {top}/{say} = {100*top/say:5.1f}%   {detay}")


if __name__ == "__main__":
    hazirla() if sys.argv[1] == "hazirla" else puanla(sys.argv[2])

