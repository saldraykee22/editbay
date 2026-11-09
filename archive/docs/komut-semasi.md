# Komut şeması v0 (ENGINE-POC sözleşmesi)

Manuel UI ve ajan AYNI komutları üretir. Komut bir JSON nesnesidir; motor doğrular, uygular, tersini (undo) kaydeder.
Zaman birimi her yerde **milisaniye (ms)**, tamsayı. Kimlikler string. Bu dosyayı değiştirme; öneri varsa raporda yaz.

## Proje durumu (özet)
```json
{
  "id": "p1", "canvas": {"w": 1080, "h": 1920, "fps": 30},
  "assets": [{"id": "a1", "kind": "video|audio|image", "uri": "...", "durationMs": 8000}],
  "tracks": [
    {"id": "v1", "kind": "video", "clips": [{"id": "c1", "assetId": "a1", "inMs": 0, "outMs": 5000}]},
    {"id": "t1", "kind": "text",  "items": [{"id": "x1", "text": "Başlık", "startMs": 0, "durationMs": 3000, "style": {"sizeSp": 48, "color": "#FFFFFF", "position": "top|center|bottom"}}]},
    {"id": "m1", "kind": "audio", "clips": [{"id": "c9", "assetId": "a4", "inMs": 0, "outMs": 30000, "volume": 0.3}]}
  ]
}
```
Video izindeki klipler arka arkaya dizilir (boşluk yok); klibin zaman çizelgesindeki yeri sırasıyla belirlenir.

## Komutlar
| op | alanlar | anlamı |
|---|---|---|
| `import_clip` | `assetId`, `trackId`, `index?` | Asset'ten yeni klip; `index` yoksa sona. Yeni klip id'sini motor verir. |
| `trim_clip` | `clipId`, `inMs?`, `outMs?` | Klibin kaynak içindeki giriş/çıkış noktası. `0 <= inMs < outMs <= asset.durationMs`. |
| `move_clip` | `clipId`, `toIndex` | Aynı iz içinde sıra değiştir (0 tabanlı). |
| `delete_clip` | `clipId` | Klibi sil. |
| `add_text` | `trackId`, `text`, `startMs`, `durationMs`, `style?` | Metin katmanı ekle. |
| `edit_text` | `itemId`, `text?`, `startMs?`, `durationMs?`, `style?` | Metni değiştir. |
| `add_audio` | `assetId`, `trackId`, `inMs?`, `outMs?`, `volume?` | Müzik/ses klibi ekle. |
| `set_volume` | `clipId`, `volume` | 0.0–2.0 arası (1.0 = orijinal). |
| `export_project` | `preset` (`"1080x1920_30"`), `out` | MP4 dışa aktar. |
| `undo` / `redo` | — | Son komutu geri al / yinele. |

Ajan birden fazla komutu sırayla dizi olarak verebilir: `[{"op": "...", ...}, ...]`.
Belirsiz talimatta ajan komut yerine `{"op": "clarify", "question": "..."}` döner. Bu doğru davranış sayılır.
Desteklenmeyen istekte `{"op": "unsupported", "reason": "..."}` döner (ör. efekt, filtre, hız değiştirme v0'da yok).

## v1 eklemeleri (2026-10-11, geriye uyumlu)
Gerekçeler `mimari.md` §4'te. Motor: `shared/.../domain/CommandEngine.kt`, testler `SchemaV1Test.kt`.

| op | alanlar | anlamı |
|---|---|---|
| `move_clip` | `clipId`, `after` (klip id ya da `null`) | Klibi `after` klibinin hemen arkasına taşır; `null` → başa. `toIndex` de geçerli, ama ikisinden tam olarak biri verilmelidir. |
| `add_audio` | … + `startMs?` | Sesin zaman çizelgesindeki başlangıcı (varsayılan 0). |
| `set_audio_start` | `clipId`, `startMs` | Yalnız ses izindeki klip için. |
| `set_volume` | `clipId`, `volume` | Artık video klibinin kendi sesinde de çalışır. |
| `delete_text` | `itemId` | Metin katmanını siler. |

Ses klibi alanı: `"startMs": 3000` (yoksa 0). Kullanıcıya gösterilen "ne değişti" satırları `ChangeSummary.kt` dosyasındaki `describeChanges(before, after)` fonksiyonundan gelir.
