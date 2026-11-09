# Ölçümler

Her sonuç tekrarlanabilir bir deneyden gelir. Tarih: 2026-10-11. Bu sürüm Evren (mimo-v2.6-pro) çapraz eleştirisinden sonra düzeltildi: örnek sayıları, güven aralıkları ve sınırlar eklendi.

**Okuma kuralı:** Küçük örneklerde model sıralaması ayırt edici değildir. n=34'te 1 sorudan oluşan fark gürültüdür. Tablolar "yeterli mi?" sorusunu cevaplar, "hangisi en iyi?" sorusunu değil.

## Türkçe istek → komut çevirisi
Test seti, puanlayıcı ve başlangıç durumları `arastirma/komut-testi/` klasöründe.

**Kolay set (40 istek, tek proje durumu).** Göreli ifadeler ("biraz kıs" = ×0.6 gibi) istemde kural olarak verildi. Bu nedenle set anlamayı değil **kural işlemeyi** ölçer ve tavana vurur; bir doğrulama testidir, ayırt edici değildir. Beş model 40/40 aldı (Haiku 5.5, DeepSeek v4.1 Flash, Gemini 3.8 Flash, GPT-6 Luna, MiMo v2.6 Pro).

**Zor set (34 istek, tek proje durumu).** İstemde kural yok. Konuşma dili, ses tanıma yazım hataları ("iki nci klibi üç saniye kıssalt"), zamir, geçmişe atıf (yalnız 2 istek: Z15, Z28) ve şemanın yapamadığı istekler var. Puanlama son durumu sınayan koşullara bakar.

| Model | Seviye | Puanlayıcı skoru | Notlar |
|---|---|---|---|
| Claude Haiku 5.5 | high | 34/34 | |
| Claude Haiku 5.5 | belirtilmemiş | 33/34 | Z12 |
| Gemini 3.8 Flash | high | 33/34 | Z12 |
| MiMo v2.6 Pro (Evren) | – | 33/34 | Z12 |
| GPT-6 Luna | high | 33/34 | Z34: `move_clip` sıra kayması |
| DeepSeek v4.1 Flash (Evren) | – | 32/34 | Z12; müziği dosya süresinin ötesine uzatmaya çalıştı (motor reddeder) |
| GPT-6 Luna | medium | 28/34 | `move_clip` sıra kayması (2), giriş noktası/zaman çizelgesi karışıklığı, müzik uzatma |

- **Z12 ("bir dakikayı geçmesin"):** puanlayıcı `clarify` cevabını **hatalı** sayıyor; skorlar bu resmî puandır. "Hangi klibi kısaltayım?" sorusu tartışmaya açık, ama skor yumuşatılmadı.
- **Puanlamanın sınırları:** koşullar yalnızca istenen değişikliği kontrol eder; istenmeyen yan etkiler cezalandırılmaz. Tolerans bantları maddeden maddeye farklı (Z02 geniş, Z09 tam eşitlik). Referans motor (`puanla.py`) gerçek uygulamayla henüz karşılaştırılmadı. Sonraki sürümde yan etki farkı da puanlanacak.
- **Düşünme seviyesi önemli:** Luna medium'dan high'a 28 → 33. Karşılaştırmalarda seviye sabitlenip yazılmalı.
- **Sonuç (dar kapsamlı):** tek proje durumu, tek şema ve 74 istek için küçük modeller yeterli. Hataların çoğu şema belirsizliğinden geliyor. Çok turlu sohbet ve farklı projeler ölçülmedi.

## Yerel Türkçe ses tanıma + Haiku 5.5 → komut (uçtan uca)
**Ölçülen şey motor değil, "ses tanıma motorunun dökümü + Claude Haiku 5.5" çiftidir.** Düzenleme komutu niteliğinde 20 cümle; iki sentetik ses (edge-tts Ahmet ve Emel), temiz ve ~15 dB gürültülü, toplam 80 kayıt. Bağımsız senaryo sayısı 20'dir; diğer kayıtlar aynı cümlelerin ses/gürültü tekrarı. Hata türleri kodla ayrılır (`arastirma/ses-tanima/hata_turleri.py`), elle etiketleme yok. Masaüstü CPU: Ryzen 5 5600.

| Motor | Boyut | Tepe RAM | RTF (masaüstü) | Kelime hata oranı | Doğru | Soru/ret | Motor reddi | Yanlış işlem |
|---|---|---|---|---|---|---|---|---|
| whisper-large-v3-turbo q5 | 547 MB | 742 MB | 5.2 | %18.6 | 80/80 | 0 | 0 | 0/80 |
| whisper-small | 465 MB | 772 MB | 1.15 | %27.9 | 75/80 | 1 | 4 | 0/80 |
| whisper-base | 141 MB | 306 MB | 0.24 | %44.5 | 72/80 | 4 | 4 | 0/80 |
| whisper-tiny | 74 MB | 197 MB | 0.15 | %56.0 | 72/80 | 2 | 2 | 4/80 |
| vosk-small-tr | 56 MB | ~5 MB | 0.19 | %41.3 | 66/80 | 6 | 4 | 4/80 |

- **"0/80 yanlış işlem" sıfır risk demek değildir.** Tek yönlü %95 üst sınır: 80 bağımsız örnek varsayımıyla **%3,7**; bağımsız senaryo sayısı 20 alınırsa **%13,9**. Güvenli bir yol görünüyor, kanıtlanmış değil.
- **Kelime hata oranı yanıltıcı:** "2. klibi 2 saniye kısalt" gibi doğru dökümler hata sayılıyor.
- **"Motor reddi zarar vermez" henüz tasarım iddiası:** reddin kullanıcıya nasıl gösterileceği tasarlanmadı. Sessiz bir ret, kullanıcı için de bir hatadır.
- **Telefon için aday whisper-base.** Telefonda gecikme ve ısınma ölçülmedi; bu bir kapı testidir.
- **Android'in yerleşik çevrimdışı Türkçe tanıması:** kaynak taramasıyla "güvenilir değil" deniyor, ölçülmedi.
- **Sınırlar:** sesler sentetik ve gürültü tek tip. Gerçek insan sesi, yankı ve arka plan konuşması sonucu kötüleştirecek.

## Görsel üretimi (Nano Banana, Gemini görsel aracı)
- **Türkçe yazı (n=4 görsel, tek marka):** ı, ş, İ ve "?" hatasız. n=4 küçük; %5 civarı bir hata oranını dışlamaz.
- **İstenmemiş yazı (n=1 olay):** logo görseline kendiliğinden "MAHALLE FIRINI & UNLU MAMULLER" ekledi. Ampirik oran için yetmez, ama "model yazıyı garanti edemez" ilkesi için yeterli.
- **Çözünürlük:** 9:16 görseller 768×1376; 1080×1920 için büyütme gerekir.
- **Referansla tutarlılık (n=1):** logo yeni sahneye aynen yerleştirildi; stil aktarımı değil, kompozisyon.
- **Süre:** 6 görselin ortalaması ~34 sn.

## Kapak yazısı: model kodla (SVG) mı, görsel model mi?
Aynı yazısız arka plan, aynı marka kuralları; her model yazı katmanını SVG olarak yazdı, headless Edge ile 1080×1920 çizildi. Dosyalar: `arastirma/svg-kapak/`.

| Model | Görseli gördü mü | SVG geçerli | 4 metin harfi harfine | Not |
|---|---|---|---|---|
| Haiku 5.5 | ✓ | ✓ | ✓ | lacivert kutu + sarı hap |
| Haiku 5.5 high | ✓ | ✓ | ✓* | *başlığı iki satıra bölerken boşluk kayboldu |
| Gemini 3.8 Flash high | ✓ | ✓ | ✓ | lacivert kutu + sarı hap |
| GPT-6 Luna medium | ✓ | ✗ | – | `&` XML kaçışı yok, SVG açılmıyor |
| GPT-6 Luna high | ✓ | ✓ | ✓ | sol kenar çizgili kart (yapay zekâ kalıbı) |
| Qwen3.8 Flash Next (Evren) | ✓ | ✓ | ✓ | **kutusuz**: yazı taş duvarın en sakin bölümünde, okunaklı; kalıba en az benzeyen |
| DeepSeek v4.1 Flash (Evren) | ✗ (metin tarifi) | ✗ | – | `&` kaçışı yok; kutusuz ama yazı rafların üstünde, alt satır okunmuyor |
| MiMo v2.6 Pro (Evren) | ✓ | – | – | iki denemede de SVG kodu vermedi, yalnız kararları anlattı |

**Okunaklılık (WCAG kontrastı, medyan / en kötü %10 zemin)**, `arastirma/svg-kapak/kontrast.py`:
| Model | Başlık | Alt satır | Fiyat | Marka |
|---|---|---|---|---|
| Gemini high | 12,5 / 11,7 | 8,2 / 7,4 | 7,6 / 7,6 | 7,3 / 7,0 |
| Haiku high | 12,4 / 11,3 | 9,5 / 8,6 | 7,6 / 7,6 | 6,9 / 6,6 |
| Haiku | 12,0 / 9,7 | 9,6 / 7,9 | 7,6 / 7,6 | 7,2 / 6,3 |
| Luna high | 12,1 / 10,9 | 8,6 / 7,3 | 7,6 / 7,6 | 6,3 / 5,9 |
| Qwen3.8 (kutusuz) | 5,0 / 2,1 | **3,4 / 1,5** | 7,3 / 6,8 | **2,2 / 1,7** |
| DeepSeek (kutusuz, görmedi) | 3,9 / 1,0 | **2,2 / 1,0** | 7,6 / 7,6 | **1,5 / 1,2** |
Eşik: normal yazı ≥ 4,5, büyük başlık ≥ 3. Kutulu tasarımlar rahatça geçiyor. Kutusuz iki tasarım ise ışıklı zeminde okunmuyor: ilk göz değerlendirmesi "okunaklı" demişti, Alper itiraz etti, ölçüm onu doğruladı. Kutusuz editoryal tasarım ancak bu kapıdan geçerse sunulur.

Görsel girdi Evren'de ölçüldü: mimo-v2.6-pro, qwen3.8-flash-next, gemma-4-31b, qwen3-vl-30b görüyor; deepseek-v4.1-flash ve glm-5.3 görmüyor. Gemma, qwen3-vl ve glm kararsızlık nedeniyle bu turdan çıkarıldı.

Zor komut setinde ek Evren sonuçları: gemma-4-31b 32/34, qwen3.8-flash-next 30/34; qwen3-vl-30b cevap üretmedi (araç çağırmaya çalıştı).

**Sonuç:** kodla çizilen yazı Türkçe karakterde ve düzenlenebilirlikte görsel modelden açık ara iyi. 8 denemeden 2'si (`&` kaçışı) geçersiz SVG üretti; uygulama SVG'yi çizmeden önce XML doğrulamasından geçirmeli. Görseli görmeyen model yazıyı yanlış yere koyuyor; tasarım modeli mutlaka görsel girdi almalı. Kutu kalıbını yalnız bir model kırdı; dağarcık ve kasıtlı boşlukla ikinci tur yapılacak.

## Media3 dışa aktarma (Android emülatörü, x86_64, Android 16)
3 klip (biri yatay) + metin + müzik → 1080×1920, 18,0 sn. Doğrulama `emu-test.ps1`: instrumented testler, ffprobe, frekans bandıyla ses kontrolü (her klibin tonu ve müzik ayrı ayrı duyulmalı). **Yalnızca işlevsel test:** emülatör performans ve kodek kapasitesi hakkında bilgi vermez.

## Kapı testleri (ölçülmedi, sıradaki iş)
Evren'in çapraz eleştirisinden; her biri bir günden kısa.
1. **Telefonda whisper-base gecikmesi ve ısınma.** Medyan komut gecikmesi > 4 sn ise sesli giriş vaadi değişir.
2. **Gerçek boyutlu dışa aktarma.** 3 dk, 6 klip, biri 4K/HEVC; bellek, süre; çıktı Galeri, WhatsApp ve Instagram'da açılıyor mu?
3. **Ardışık 20 komut + 20 undo + 20 redo.** Her adımda önizleme gecikmesi; sonunda durum başlangıçla birebir aynı mı (hash)?
4. **Sorunlu girdi matrisi.** HDR10, VFR ekran kaydı, bozuk dosya, 4:3, döndürülmüş, sessiz dosya: çökme değil, anlaşılır bir ret.
5. **Marka hafızası tutarlılığı.** 8 üretimde renk sapması (ΔE), yazı tipi uyumu ve ihlali yakalayan filtre.
6. **Gerçek insan sesi** ile uçtan uca test.
