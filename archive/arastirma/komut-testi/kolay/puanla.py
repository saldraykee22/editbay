# -*- coding: utf-8 -*-
"""H3 komut testi puanlayici.

Kullanim: python puanla.py testset.jsonl cevap.jsonl
cevap.jsonl satiri: {"id": "T01", "cevap": [ ...komutlar... ]}  (cevap liste veya JSON metin olabilir)

Olcutler:
  a) JSON parse oldu mu
  b) Semaya uygun mu (op adi, zorunlu alanlar, tip, bilinmeyen alan)
  c) Durum.json'a uygulaninca altin ile ayni son durum mu (sira farkli olabilir).
     Tuzak testlerinde (clarify/unsupported) tek komut ve op eslesmesi aranir.
"""
import copy
import json
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")

BASE = os.path.dirname(os.path.abspath(__file__))
DURUM_YOLU = os.path.join(BASE, "durum.json")

# op: (zorunlu alanlar, opsiyonel alanlar)
OPS = {
    "import_clip": (["assetId", "trackId"], ["index"]),
    "trim_clip": (["clipId"], ["inMs", "outMs"]),
    "move_clip": (["clipId", "toIndex"], []),
    "delete_clip": (["clipId"], []),
    "add_text": (["trackId", "text", "startMs", "durationMs"], ["style"]),
    "edit_text": (["itemId"], ["text", "startMs", "durationMs", "style"]),
    "add_audio": (["assetId", "trackId"], ["inMs", "outMs", "volume"]),
    "set_volume": (["clipId", "volume"], []),
    "export_project": (["preset", "out"], []),
    "undo": ([], []),
    "redo": ([], []),
    "clarify": (["question"], []),
    "unsupported": (["reason"], []),
}
INT_ALANLAR = {"index", "inMs", "outMs", "toIndex", "startMs", "durationMs"}
STR_ALANLAR = {"assetId", "trackId", "clipId", "itemId", "text", "preset", "out", "question", "reason"}
VARSAYILAN_STIL = {"sizeSp": 48, "color": "#FFFFFF", "position": "center"}
TUZAK_OPLARI = {"clarify", "unsupported"}


class Hata(Exception):
    pass


def is_int(x):
    return isinstance(x, int) and not isinstance(x, bool)


def sema_hatasi(cmd):
    if not isinstance(cmd, dict):
        return "komut nesne degil"
    op = cmd.get("op")
    if op not in OPS:
        return f"bilinmeyen op: {op!r}"
    zorunlu, opsiyonel = OPS[op]
    for a in zorunlu:
        if a not in cmd:
            return f"{op}: zorunlu alan eksik: {a}"
    izinli = set(["op"] + zorunlu + opsiyonel)
    for k in cmd:
        if k not in izinli:
            return f"{op}: bilinmeyen alan: {k}"
    if op == "trim_clip" and "inMs" not in cmd and "outMs" not in cmd:
        return "trim_clip: inMs veya outMs gerekli"
    if op == "edit_text" and len(cmd) == 2:
        return "edit_text: degistirilecek alan yok"
    for k in INT_ALANLAR:
        if k in cmd and not is_int(cmd[k]):
            return f"{op}: {k} tamsayi degil"
        if k in cmd and k in ("toIndex", "index", "inMs", "outMs", "startMs") and cmd[k] < 0:
            return f"{op}: {k} negatif"
    for k in STR_ALANLAR:
        if k in cmd and not isinstance(cmd[k], str):
            return f"{op}: {k} metin degil"
    if "style" in cmd and not isinstance(cmd["style"], dict):
        return f"{op}: style nesne degil"
    if "volume" in cmd:
        v = cmd["volume"]
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not 0.0 <= v <= 2.0:
            return f"{op}: volume 0.0-2.0 araliginda sayi degil"
    return None


def _trk(st, tid):
    for t in st["tracks"]:
        if t["id"] == tid:
            return t
    raise Hata(f"iz yok: {tid}")


def _klip(st, cid):
    for t in st["tracks"]:
        for i, c in enumerate(t.get("clips", [])):
            if c["id"] == cid:
                return t, i, c
    raise Hata(f"klip yok: {cid}")


def _asset(st, aid):
    for a in st["assets"]:
        if a["id"] == aid:
            return a
    raise Hata(f"asset yok: {aid}")


def degistir(st, cmd, yeni):
    op = cmd["op"]
    if op == "import_clip":
        a = _asset(st, cmd["assetId"])
        t = _trk(st, cmd["trackId"])
        if a.get("durationMs") is None or "clips" not in t:
            raise Hata("import_clip: sure yok veya iz klip izi degil")
        idx = cmd.get("index", len(t["clips"]))
        if not 0 <= idx <= len(t["clips"]):
            raise Hata("import_clip: index disari")
        t["clips"].insert(idx, {"id": yeni("c"), "assetId": a["id"], "inMs": 0, "outMs": a["durationMs"]})
    elif op == "trim_clip":
        _, _, c = _klip(st, cmd["clipId"])
        a = _asset(st, c["assetId"])
        yi = cmd.get("inMs", c["inMs"])
        yo = cmd.get("outMs", c["outMs"])
        if a.get("durationMs") is None or not (0 <= yi < yo <= a["durationMs"]):
            raise Hata(f"trim sinir ihlali: in={yi} out={yo}")
        c["inMs"], c["outMs"] = yi, yo
    elif op == "move_clip":
        t, i, c = _klip(st, cmd["clipId"])
        if not 0 <= cmd["toIndex"] < len(t["clips"]):
            raise Hata("move_clip: toIndex disari")
        t["clips"].pop(i)
        t["clips"].insert(cmd["toIndex"], c)
    elif op == "delete_clip":
        t, i, _ = _klip(st, cmd["clipId"])
        t["clips"].pop(i)
    elif op == "add_text":
        t = _trk(st, cmd["trackId"])
        if t.get("kind") != "text" or cmd["durationMs"] <= 0:
            raise Hata("add_text: iz metin degil veya sure gecersiz")
        stil = dict(VARSAYILAN_STIL)
        stil.update(cmd.get("style", {}))
        t["items"].append({"id": yeni("x"), "text": cmd["text"], "startMs": cmd["startMs"],
                           "durationMs": cmd["durationMs"], "style": stil})
    elif op == "edit_text":
        it = None
        for t in st["tracks"]:
            for x in t.get("items", []):
                if x["id"] == cmd["itemId"]:
                    it = x
        if it is None:
            raise Hata(f"metin yok: {cmd['itemId']}")
        for k in ("text", "startMs", "durationMs"):
            if k in cmd:
                it[k] = cmd[k]
        if "style" in cmd:
            it["style"].update(cmd["style"])
        if it["durationMs"] <= 0:
            raise Hata("edit_text: sure gecersiz")
    elif op == "add_audio":
        a = _asset(st, cmd["assetId"])
        t = _trk(st, cmd["trackId"])
        if t.get("kind") != "audio" or a.get("durationMs") is None:
            raise Hata("add_audio: iz ses degil veya asset suresiz")
        yi = cmd.get("inMs", 0)
        yo = cmd.get("outMs", a["durationMs"])
        if not (0 <= yi < yo <= a["durationMs"]):
            raise Hata("add_audio: sinir ihlali")
        t["clips"].append({"id": yeni("c"), "assetId": a["id"], "inMs": yi, "outMs": yo,
                           "volume": cmd.get("volume", 1.0)})
    elif op == "set_volume":
        t, _, c = _klip(st, cmd["clipId"])
        if t.get("kind") != "audio":
            raise Hata("set_volume: klip ses izinde degil")
        c["volume"] = cmd["volume"]
    else:
        raise Hata(f"uygulanamayan op: {op}")


def uygula(baslangic, cmds):
    """Komutlari sirayla uygular. Undo/redo gecmisi tutulur. Hata olursa Hata firlatir."""
    st = copy.deepcopy(baslangic)
    gecmis, ileri = [], []
    sayac = [0]

    def yeni(p):
        sayac[0] += 1
        return f"__{p}{sayac[0]}"

    for cmd in cmds:
        op = cmd["op"]
        if op == "undo":
            if not gecmis:
                raise Hata("geri alinacak islem yok")
            ileri.append(st)
            st = gecmis.pop()
        elif op == "redo":
            if not ileri:
                raise Hata("yinelenecek islem yok")
            gecmis.append(st)
            st = ileri.pop()
        elif op == "export_project":
            if cmd["preset"] != "1080x1920_30" or not cmd["out"].strip():
                raise Hata("export_project: preset/out gecersiz")
        elif op in TUZAK_OPLARI:
            raise Hata("tuzak op durum uygulamasina girmez")
        else:
            gecmis.append(copy.deepcopy(st))
            ileri.clear()
            degistir(st, cmd, yeni)
    return st


def normal(st):
    """Yeni olusturulan ogelerin motor kimlikleri karsilastirmada yok sayilir."""
    s = copy.deepcopy(st)
    for t in s["tracks"]:
        for c in t.get("clips", []):
            if c["id"].startswith("__"):
                c["id"] = "NEW"
        for x in t.get("items", []):
            if x["id"].startswith("__"):
                x["id"] = "NEW"
    return json.dumps(s, sort_keys=True, ensure_ascii=False)


def oku_jsonl(yol):
    satirlar = []
    with open(yol, encoding="utf-8") as f:
        for n, satir in enumerate(f, 1):
            satir = satir.strip()
            if satir:
                try:
                    satirlar.append(json.loads(satir))
                except json.JSONDecodeError as e:
                    raise SystemExit(f"{yol} satir {n}: JSON hatasi: {e}")
    return satirlar


def cevabi_ayikla(ham):
    if isinstance(ham, str):
        try:
            ham = json.loads(ham)
        except json.JSONDecodeError as e:
            return False, None, f"JSON parse hatasi: {e}"
    if not isinstance(ham, list):
        return True, None, "cevap bir dizi degil"
    return True, ham, ""


def puanla_bir(test, cevap_satiri, durum, altin_son):
    sonuc = {"id": test["id"], "zorluk": test["zorluk"], "kategori": test["kategori"],
             "a": False, "b": False, "c": False, "not": ""}
    altin = test["altin"]
    tuzak_beklenen = altin[0]["op"] if altin and altin[0]["op"] in TUZAK_OPLARI else None
    if cevap_satiri is None:
        sonuc["not"] = "cevap yok"
        return sonuc
    ok, liste, msg = cevabi_ayikla(cevap_satiri.get("cevap"))
    sonuc["a"] = ok
    if liste is None:
        sonuc["not"] = msg
        return sonuc
    if not liste:
        sonuc["not"] = "bos dizi"
        return sonuc
    hatalar = [h for h in (sema_hatasi(k) for k in liste) if h]
    if hatalar:
        sonuc["not"] = "; ".join(hatalar)[:200]
        return sonuc
    sonuc["b"] = True
    if tuzak_beklenen:
        if len(liste) == 1 and liste[0]["op"] == tuzak_beklenen:
            sonuc["c"] = True
        else:
            sonuc["not"] = f"tuzak op beklenen: {tuzak_beklenen}"
        return sonuc
    if any(k["op"] in TUZAK_OPLARI for k in liste):
        sonuc["not"] = "tuzak op dondu, islem bekleniyordu"
        return sonuc
    try:
        son = normal(uygula(durum, liste))
    except (Hata, KeyError, TypeError, IndexError) as e:
        sonuc["not"] = f"uygulama hatasi: {e}"
        return sonuc
    sonuc["c"] = son == altin_son
    if not sonuc["c"]:
        sonuc["not"] = "son durum altin ile farkli"
    return sonuc


def main():
    if len(sys.argv) != 3:
        raise SystemExit("Kullanim: python puanla.py testset.jsonl cevap.jsonl")
    testler = oku_jsonl(sys.argv[1])
    cevaplar = {}
    for s in oku_jsonl(sys.argv[2]):
        cevaplar[s["id"]] = s
    with open(DURUM_YOLU, encoding="utf-8") as f:
        durum = json.load(f)

    sonuclar = []
    for t in testler:
        if t["altin"] and t["altin"][0]["op"] in TUZAK_OPLARI:
            altin_son = None  # tuzak testinde durum karsilastirilmaz, op eslesmesi yeterli
        else:
            altin_son = normal(uygula(durum, t["altin"]))  # altin kendi icinde gecerli olmali
        sonuclar.append(puanla_bir(t, cevaplar.get(t["id"]), durum, altin_son))

    n = len(sonuclar)
    def oran(liste):
        return (100.0 * sum(1 for s in liste if s["a"] and s["b"] and s["c"]) / len(liste)) if liste else 0.0

    print(f"Test sayisi: {n}")
    print(f"a) JSON parse: {100.0*sum(s['a'] for s in sonuclar)/n:.1f}%")
    print(f"b) Sema uyumu: {100.0*sum(s['b'] for s in sonuclar)/n:.1f}%")
    print(f"c) Son durum / op eslesmesi: {100.0*sum(s['c'] for s in sonuclar)/n:.1f}%")
    print(f"GENEL dogruluk (a ve b ve c): {oran(sonuclar):.1f}%")
    print()
    print("Zorluk bazinda (genel dogruluk):")
    for z in ("kolay", "orta", "zor"):
        grup = [s for s in sonuclar if s["zorluk"] == z]
        if grup:
            print(f"  {z:6s} n={len(grup):2d}  {oran(grup):5.1f}%")
    print()
    print("Kategori bazinda (genel dogruluk):")
    kategoriler = sorted({s["kategori"] for s in sonuclar})
    for k in kategoriler:
        grup = [s for s in sonuclar if s["kategori"] == k]
        print(f"  {k:24s} n={len(grup):2d}  {oran(grup):5.1f}%")
    basarisiz = [s for s in sonuclar if not (s["a"] and s["b"] and s["c"])]
    print()
    print(f"Basarisiz test sayisi: {len(basarisiz)}")
    for s in basarisiz:
        print(f"  {s['id']}: a={s['a']} b={s['b']} c={s['c']} | {s['not']}")


if __name__ == "__main__":
    main()
