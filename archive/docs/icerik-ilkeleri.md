# İçerik ilkeleri: yapay zekâ kalıbı (AI slop) yok

Popi'nin ürettiği hiçbir şey "yapay zekâ yapmış" gibi görünmemeli. Bu ilkeler hem arayüz için hem de uygulamanın ürettiği içerik için geçerlidir.

## Üretilen içerik
1. **Gerçek görüntü önce gelir.** Kapak ve küçük resimlerde öncelik, kullanıcının kendi çektiği kare ya da ürün fotoğrafıdır. Üretilmiş görsel ancak kullanıcı isterse kullanılır ve "üretildi" diye etiketlenir.
2. **Yazıyı model çizmez.** Görsel modele yazısız arka plan ürettirilir; başlık, fiyat ve tarih uygulamanın düzenlenebilir metin katmanında durur. Ölçüm: model istenmemiş yazı ekledi ("MAHALLE FIRINI & UNLU MAMULLER").
3. **Marka hafızası kuraldır, öneri değil.** Renkler, yazı tipi ve üslup her üretimde uygulanır. Hafızadaki bir kurala aykırı çıktı, kullanıcıya gösterilmeden önce elenir.
4. **Kalıp metin yasak.** Altyazı ve açıklamalarda şunlar kullanılmaz: emoji yığını, "keşfet / kaçırma / ✨ büyülü" kalıpları, ünlem bombardımanı, kullanıcının üslubuna uymayan İngilizce karışımı. Metin önerisi kullanıcının kendi geçmiş metinlerinden öğrenilen üsluba göre yazılır.
5. **Varsayılan efekt yok.** Otomatik geçiş, zoom ya da müzik eklenmez. Kullanıcı istemedikçe video olduğu gibi kalır.
6. **Okunaklılık kapısı (ölçülür).** Model ürettiği yerleşimi kullanıcıya göstermeden önce her metnin, hemen arkasındaki zemine karşı WCAG kontrastı ölçülür: normal yazı ≥ 4,5:1, büyük başlık ≥ 3:1, zeminin en kötü %10'luk bölgesi dahil. Eşiğin altındaki yerleşim ya modele geri gönderilir ya da metne otomatik karartma/gölge eklenir. Ölçüm: `arastirma/svg-kapak/kontrast.py`. (Deneyde kutusuz tek tasarımın alt satırı 3,4 / en kötü 1,5 çıktı; arkadaki ışık yazıyı yuttu.)
7. **SVG doğrulaması.** Modelin yazdığı SVG çizilmeden önce XML olarak doğrulanır; deneyde 8 çıktının 2'si `&` kaçışı yüzünden geçersizdi.
8. **Her yapay zekâ işlemi görünür ve geri alınabilir.** Ne değiştiği sayılarla gösterilir (ör. "müzik %100 → %40"), tek dokunuşla geri alınır.

## Arayüz
- Mor/mavi gradyan, cam efekti, parıltı ikonu ve "sihirli" düğme yoktur.
- Yapay zekâ ayrı bir "AI modu" değildir; düzenleyicinin doğal parçasıdır. Konuşma alanı ve zaman çizelgesi aynı ekrandadır.
- Arayüz geri çekilir, içerik öne çıkar.
- **Renk:** varsayılan zemin AMOLED siyahı (`#000000`); OLED ekranda pil dostu ve göz yormaz. Yazı saf beyaz değil, kırık beyaz (`#E7E5E0`); saf beyaz siyah üstünde parlama yapar. Tek vurgu rengi düşük doygunlukta kum tonu (`#D2B47A`). Kırmızı ve doygun renkler yalnızca uyarı gibi gerçekten dikkat isteyen yerlerde kullanılır. Açık tema sonra eklenecek.
- **Efektler ölçülü:** dokunmada kısa yumuşak geçiş (≤180 ms), klip şeridinde gerçek kareler, ses izinde dalga formu. Parıltı, sürekli animasyon ve gradyan dolgu yok.
- Zaman kodları için eşit aralıklı yazı tipi.

## Herkes için tek uygulama
- **Varsayılan görünüm sade.** Konuşma alanı, önizleme ve klip şeridi; CapCut'ı hiç açmamış biri de anlamalı.
- **Ayrıntılı görünüm bir dokunuş uzakta.** Çok izli zaman çizelgesi, sayısal giriş/çıkış ve klavye kısayolları (masaüstü); Premiere kullanan da aradığını bulmalı.
- **İki görünüm aynı komutları kullanır.** Biri diğerinin "pro modu" değildir, aynı projenin iki penceresidir.
- **Yazı varsayılan, ses isteğe bağlı.** İnsanlar çekingenlik ya da alışkanlık yüzünden derdini yazarak anlatmayı tercih eder. Giriş alanı her zaman yazı alanıdır; mikrofon içinde küçük ve ikincil bir düğmedir. Hazır öneri düğmeleri ("Sonunu kısalt", "Altyazı ekle") ne yazacağını bilmeyene yol gösterir.
- **Model kullanıcının diliyle konuşur.** "Biraz kıs" diyene de "-6 dB" diyene de doğru işlemi yapar; cevaplarını kullanıcının kullandığı terimlerle verir.

