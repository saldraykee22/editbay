"""Zor set puanlayıcısı: altın cevap yerine son durum üzerinde koşul (kontrol) değerlendirir.

Kullanım: python puanla2.py testset2.jsonl cevap.jsonl [--ayrinti]
Cevap satırı: {"id": "Z01", "cevap": [komutlar]}
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "kolay"))
import puanla as P  # noqa: E402  (motor: uygula, sema_hatasi, Hata, TUZAK_OPLARI)

KOK = Path(__file__).resolve().parent
DURUM = json.loads((KOK / "durum2.json").read_text(encoding="utf-8"))
ORJ_SIRA = [c["id"] for c in DURUM["tracks"][0]["clips"]]
ESKI_METIN = {x["id"] for t in DURUM["tracks"] for x in t.get("items", [])}


def ortam(st):
    def tum_klipler():
        return [c for t in st["tracks"] for c in t.get("clips", [])]

    def klip(cid):
        for c in tum_klipler():
            if c["id"] == cid:
                return c
        raise KeyError(cid)

    def txt(xid):
        for t in st["tracks"]:
            for x in t.get("items", []):
                if x["id"] == xid:
                    return x
        raise KeyError(xid)

    def vklipler():
        return [t for t in st["tracks"] if t["id"] == "v1"][0]["clips"]

    def kirmizi(h):
        h = h.lstrip("#")
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        return r >= 180 and g <= 90 and b <= 90

    return {
        "klip": klip, "txt": txt, "vklipler": vklipler, "kirmizi": kirmizi,
        "dur": lambda cid: klip(cid)["outMs"] - klip(cid)["inMs"],
        "vol": lambda cid: klip(cid)["volume"],
        "sira": lambda: [c["id"] for c in vklipler()],
        "toplam": lambda: sum(c["outMs"] - c["inMs"] for c in vklipler()),
        "yeni_metinler": lambda: [x for t in st["tracks"] for x in t.get("items", []) if x["id"] not in ESKI_METIN],
        "ORJ_SIRA": ORJ_SIRA, "any": any, "sum": sum, "len": len,
    }


def puanla_bir(test, cevap):
    if cevap is None:
        return False, "cevap yok"
    if isinstance(cevap, str):
        try:
            cevap = json.loads(cevap)
        except json.JSONDecodeError:
            return False, "JSON parse hatası"
    if not isinstance(cevap, list) or not cevap:
        return False, "dizi değil / boş"
    hatalar = [h for h in (P.sema_hatasi(k) for k in cevap) if h]
    if hatalar:
        return False, "şema: " + "; ".join(hatalar)[:150]
    oplar = [k["op"] for k in cevap]
    kabul = test.get("kabul", [])
    if len(cevap) == 1 and oplar[0] in P.TUZAK_OPLARI:
        return (oplar[0] in kabul), f"{oplar[0]} döndü" + ("" if oplar[0] in kabul else " (kabul edilmez)")
    if any(o in P.TUZAK_OPLARI for o in oplar):
        return False, "tuzak op'u işlemle karışık"
    if test.get("undo_kabul") and oplar == ["undo"]:
        return True, "undo"
    if test.get("kontrol") is None:
        return False, f"işlem yaptı, beklenen {kabul}"
    try:
        st = P.uygula(DURUM, [k for k in cevap if k["op"] != "export_project"])
    except Exception as e:  # motor reddi = hata
        return False, f"motor reddetti: {e}"
    if test.get("export_bekle") and "export_project" not in oplar:
        return False, "export_project yok"
    try:
        ok = bool(eval(test["kontrol"], {"__builtins__": {}}, ortam(st)))
    except Exception as e:
        return False, f"kontrol hatası: {e}"
    return ok, "" if ok else "koşul sağlanmadı"


def main():
    testler = [json.loads(l) for l in open(sys.argv[1], encoding="utf-8") if l.strip()]
    cevaplar = {}
    for l in open(sys.argv[2], encoding="utf-8"):
        l = l.strip()
        if l.startswith("{") and '"id"' in l:
            try:
                s = json.loads(l)
                cevaplar[s["id"]] = s.get("cevap")
            except json.JSONDecodeError:
                pass
    dogru = 0
    for t in testler:
        ok, neden = puanla_bir(t, cevaplar.get(t["id"]))
        dogru += ok
        if "--ayrinti" in sys.argv or not ok:
            print(f"{t['id']} {'OK ' if ok else 'YOK'} {neden} | {json.dumps(cevaplar.get(t['id']), ensure_ascii=False)[:160]}")
    print(f"DOGRU {dogru}/{len(testler)} = {100*dogru/len(testler):.1f}%")


if __name__ == "__main__":
    main()

