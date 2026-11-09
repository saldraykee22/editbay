# GÖREV: Kapak yazısını SVG olarak tasarla

Bir telefon video/içerik uygulaması, görsel modelin ürettiği **yazısız** arka planın üstüne yazıyı kendisi çizecek. Senin işin bu yazı katmanını **SVG kodu** olarak tasarlamak.

## Girdi
- Arka plan: `C:\studio-lab\t7-svg\arka.png` (768×1376, 9:16). **Önce görseli aç ve incele.** Yazıyı nereye koyacağına bakarak karar ver: boş alan, ekmeklerin yeri, kontrast.
- Marka: **Kuzey Fırın**, küçük bir mahalle fırını. Renkler: lacivert `#1B2A4A`, buğday sarısı `#E8B64C`. Üslup: sade, el yapımı, sıcak; "siz" diye hitap; emoji yok; ünlem yok; abartılı reklam dili yok.
- Yazılacak metinler (harfi harfine, Türkçe karakterleri koru):
  1. Başlık: `Yeni Sezon Ekmekleri`
  2. Alt satır: `Ekşi mayalı, her sabah 07.00'de fırından`
  3. Fiyat etiketi: `Köy ekmeği 85 ₺`
  4. Marka adı: `Kuzey Fırın`

## Çıktı kuralları
- Tek bir SVG dosyası: `viewBox="0 0 1080 1920"`, `width="1080" height="1920"`.
- Arka planı ilk öğe olarak koy: `<image href="arka.png" x="0" y="0" width="1080" height="1920" preserveAspectRatio="xMidYMid slice"/>`
- **Her metin gerçek `<text>` öğesi olsun.** Yazıyı path'e çevirme; uygulama sonra metni düzenleyebilmeli. Her `<text>`'e `id` ver: `baslik`, `alt`, `fiyat`, `marka`.
- Yazı tipi: yalnız Türkçe destekli şu Google Fonts ailelerinden en fazla 2 tane: `Fraunces`, `DM Serif Display`, `Playfair Display`, `Bricolage Grotesque`, `IBM Plex Sans`, `Work Sans`, `Libre Baskerville`. SVG içinde `<style>@import url('https://fonts.googleapis.com/css2?family=...&display=swap');</style>` ile yükle.
- Okunaklılık için gerekirse yarı saydam şerit, ince gölge (`filter`) veya kontrast kutusu kullanabilirsin. Ama "yapay zekâ kalıbı" yok: gradyan yazı, neon/parıltı, yıldız/ışık süsü, emoji, çerçeve içinde çerçeve yok. Bir grafik tasarımcının elinden çıkmış gibi görünsün; sade ve özenli.
- Telefonda Instagram hikâyesi güvenli alanı: üstten 250 px ve alttan 300 px'e önemli metin koyma.

## Teslim
- Dosyayı `C:\studio-lab\t7-svg\svg\<MODEL>.svg` olarak yaz (MODEL adı sana verilecek).
- Sonra 3–5 satırla tasarım kararlarını açıkla: neden bu yerleşim, bu yazı tipi, bu kontrast çözümü.
- Başka dosyaya dokunma.
