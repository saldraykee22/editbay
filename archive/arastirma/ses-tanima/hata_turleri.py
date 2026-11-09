"""Uçtan uca STT→komut cevaplarını hata türüne ayırır (elle etiketleme yok).

doğru         : puanlayıcı koşulu sağlandı
soru/ret      : tek komut clarify veya unsupported döndü (işlem yapılmadı)
motor reddi   : komut(lar) motor doğrulamasından geçemedi (durum değişmez)
yanlış işlem  : motor kabul etti ama son durum koşulu sağlamadı (kullanıcının istemediği değişiklik)

Kullanım: python hata_turleri.py <cevap_klasoru>
"""
import json
import sys
from collections import defaultdict
from pathlib import Path

import hazirla_puanla as H


def main(klasor):
    d = defaultdict(lambda: [0, 0, 0, 0])
    for f in Path(klasor).glob("*.jsonl"):
        for l in open(f, encoding="utf-8"):
            l = l.strip()
            if not l.startswith("{"):
                continue
            s = json.loads(l)
            n = int(s["id"].split("|")[-1])
            m = s["id"].split("|")[0]
            ok, _ = H.Z.puanla_bir(H.TESTLER[n], s.get("cevap"))
            c = s.get("cevap") or []
            if ok:
                d[m][0] += 1
            elif len(c) == 1 and c[0].get("op") in ("clarify", "unsupported"):
                d[m][1] += 1
            else:
                try:
                    H.Z.P.uygula(H.DURUM, [k for k in c if k["op"] != "export_project"])
                    d[m][3] += 1
                except Exception:
                    d[m][2] += 1
    print(f"{'motor':24s} dogru  soru/ret  motor_reddi  yanlis_islem")
    for m, v in sorted(d.items()):
        print(f"{m:24s} {v[0]:5d} {v[1]:9d} {v[2]:12d} {v[3]:13d}")


if __name__ == "__main__":
    main(sys.argv[1])
