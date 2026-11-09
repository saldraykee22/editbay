# Yol haritası: Windows alfa

Karar (2026-10-11): ilk alfa Windows masaüstünde. Mimari Android ve iOS'u her adımda gözetir: iş mantığı `shared/commonMain`'de, platforma özel kod ince arayüzlerin arkasında; CI her commit'te üç platformu derler.

Her aşama ancak kabul testleri **otomatik ve içerik ölçerek** geçince biter: "dosya var" yetmez; ses bandı, kare karşılaştırması ve kontrast ölçülür.

## M1 — Masaüstü kabuğu ve elle düzenleme
- Arayüz: tasarımdaki masaüstü ekranı (medya paneli, önizleme, zaman çizelgesi, istek alanı). AMOLED siyah, kum vurgu.
- Proje aç/kaydet (`%APPDATA%\Popi\projeler\`), medya içe aktarma (dosya seçici ve sürükle-bırak).
- Elle düzenleme: kırp, taşı, sil, metin, müzik, ses seviyesi; hepsi aynı komut motorundan; Ctrl+Z / Ctrl+Y.
- Önizleme: FFmpeg'den düşük çözünürlüklü kare akışı + ses (dış süreç; LGPL derleme).
- Dışa aktarma: 1080×1920 MP4, ilerleme göstergesi, iptal.
- **Kabul:** komut motoru testleri; dışa aktarmada çözünürlük, süre ±100 ms, frekans bandıyla her klibin sesi ve müzik; önizleme karesi ile dışa aktarılan kare aynı anda karşılaştırılır (PSNR eşiği); Compose arayüz testi: içe aktar → kırp → undo → durum başlangıçla aynı.

## M2 — Yazıyla düzenleme (yapay zekâ)
- İstek alanı → model → komut → doğrulama → değişiklik kartı ("müzik %100 → %40") + tek dokunuşla geri al.
- Sağlayıcı: OpenRouter (anahtar ya da OAuth PKCE) ve Gemini anahtarı. Anahtar Windows Kimlik Bilgisi Yöneticisi'nde (DPAPI) saklanır.
- Gönderilecek içerik önce gösterilir; medya buluta gönderilmez.
- Komut şeması v1 (`after: clipId`, ses `startMs`, video sesi, `delete_text`).
- **Kabul:** zor komut seti uygulamanın kendi istemi ve motoruyla ≥ 32/34 (Haiku sınıfı model, high); yan etki farkı da puanlanır.

## M3 — Kapak ve görsel
- Görsel model yazısız arka plan üretir (kasıtlı boşlukla); tasarım modeli görseli görerek SVG yazı katmanı yazar; uygulama çizer.
- SVG XML doğrulaması; okunaklılık kapısı (WCAG ≥ 4,5 / başlık ≥ 3, en kötü %10 dahil); eşik altı → otomatik karartma ya da modele geri gönderme.
- Üç yerleşim seçeneği; metinler düzenlenebilir katman.
- **Kabul:** 10 üretimde geçersiz SVG kullanıcıya hiç ulaşmaz; gösterilen her tasarım kontrast kapısını geçer.

## M4 — Marka hafızası
- `%APPDATA%\Popi\marka\` altında okunabilir markdown dosyaları + SQLite indeks; "Öğrendiklerim" listesi, kaynak ve tarihle; Unut / dışa aktar.
- Hafıza kuralları üretime deterministik kontrol olarak uygulanır (renk ΔE, yasaklı ifadeler, emoji sayısı).
- **Kabul:** 8 üretimde hafıza kuralı ihlali kullanıcıya ulaşmaz.

## M5 — Paket ve alfa dağıtımı
- MSI paketi (Compose Desktop `packageMsi`), FFmpeg LGPL derlemesi uygulamayla birlikte, `mimari.md` §7'deki lisans yükümlülükleri.
- GitHub Releases'ta imzasız alfa; CI her etikette paketi üretir.
- **Kabul:** temiz bir Windows'ta kur → aç → içe aktar → dışa aktar akışı CI'da (windows-latest) geçer.

## Sonra
- Android: Media3 motoru hazır (emülatörde doğrulandı); arayüz Compose Multiplatform ile paylaşılır.
- iOS: ortak çekirdek CI'da derleniyor; AVFoundation `RendererPort` ve SwiftUI/Compose kabuğu.
- Gerçek ses testi ve isteğe bağlı yerel ses tanıma (whisper-base) modülü.
