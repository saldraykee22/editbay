package io.github.saldraykee22.popi.desktop.olcum

import io.github.saldraykee22.popi.ai.LlmTransport
import io.github.saldraykee22.popi.ai.ProviderError
import java.io.IOException
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class HardSetRunnerTest {

    private val durum: Path get() = zorDizin().resolve("durum2.json")

    /** Gerçek testset'in ilk üç satırı: geçici bir dosyaya yazılır. */
    private fun ucluTestset(): Path {
        val satirlar = Files.readAllLines(zorDizin().resolve("testset2.jsonl"), StandardCharsets.UTF_8).take(3)
        val yol = Files.createTempFile("olcum-uc", ".jsonl")
        Files.write(yol, satirlar, StandardCharsets.UTF_8)
        return yol
    }

    private fun ayar(testset: Path, out: Path, limit: Int? = null) = HardSetAyar(
        provider = "openrouter",
        model = "sahte/model",
        testset = testset,
        durum = durum,
        out = out,
        limit = limit,
        paralel = 2,
    )

    private fun koş(
        transport: LlmTransport,
        testset: Path,
        out: Path,
        anahtar: String? = "SAHTE-ANAHTAR-7731",
        bekleme: MutableList<Long> = mutableListOf(),
        geri: List<Long> = listOf(0L, 0L),
        yazilan: StringBuilder = StringBuilder(),
    ): HardSetOzeti = HardSetRunner(
        transportKur = { _, _, _ -> transport },
        anahtarOku = { anahtar },
        yaz = { yazilan.append(it).append('\n') },
        beklet = { bekleme.add(it) },
        geriCekilmeMs = geri,
    ).calistir(ayar(testset, out))

    @Test
    fun cikti_uc_satir_ve_her_satir_json() {
        val out = Files.createTempFile("olcum-cik", ".jsonl")
        val ozet = koş(referansTransport(), ucluTestset(), out)
        val satirlar = Files.readAllLines(out, StandardCharsets.UTF_8)
        assertEquals(3, satirlar.size)
        val ids = satirlar.map { s -> (MiniJson.ayristir(s) as Map<*, *>).also { assertNotNull(it["cevap"]) }["id"] }
        assertEquals(listOf("Z01", "Z02", "Z03"), ids)
        assertEquals(3, ozet.toplam)
        assertEquals(3, ozet.gecerliJson)
        assertEquals(3, ozet.dryRunKabul)
    }

    private val z01Talimat = "müzik çok bağırıyor konuşmamı bastırıyor"

    @Test
    fun gecici_hatada_yeniden_denenir() {
        val out = Files.createTempFile("olcum-yeniden", ".jsonl")
        val cagri = AtomicInteger(0)
        val referans = referansTransport()
        // Yalnız Z01'in ilk çağrısı başarısız olur; diğer testler paralel koşsa da sonuç deterministik kalır.
        val kararsiz = LlmTransport { istek ->
            if (istek.user.endsWith("Kullanıcının isteği: $z01Talimat") && cagri.getAndIncrement() == 0) {
                throw IOException("ağ kesildi")
            }
            referans.complete(istek)
        }
        val bekleme = CopyOnWriteArrayList<Long>()
        koş(kararsiz, ucluTestset(), out, bekleme = bekleme, geri = listOf(7L, 9L), anahtar = "K-1")
        val ilk = MiniJson.ayristir(Files.readAllLines(out, StandardCharsets.UTF_8).first()) as Map<*, *>
        assertNotNull(ilk["cevap"])
        assertEquals(2L, ilk["deneme"])
        assertEquals(listOf(7L), bekleme.toList())
    }

    @Test
    fun kalici_hata_iki_kez_geri_cekilip_satiri_hata_ile_yazar_ve_devam_eder() {
        val out = Files.createTempFile("olcum-kalici", ".jsonl")
        val referans = referansTransport()
        val kalici = LlmTransport { istek ->
            if (istek.user.endsWith("Kullanıcının isteği: $z01Talimat")) {
                throw ProviderError.RateLimited()
            }
            referans.complete(istek)
        }
        val bekleme = CopyOnWriteArrayList<Long>()
        val ozet = koş(kalici, ucluTestset(), out, bekleme = bekleme, geri = listOf(1L, 2L), anahtar = "K-2")
        val satirlar = Files.readAllLines(out, StandardCharsets.UTF_8)
        assertEquals(3, satirlar.size)
        val ilk = MiniJson.ayristir(satirlar.first()) as Map<*, *>
        assertNull(ilk["cevap"])
        assertEquals(3L, ilk["deneme"])
        assertNotNull(ilk["hata"])
        assertEquals(listOf(1L, 2L), bekleme.toList())
        assertEquals(1, ozet.hatali)
        assertEquals(2, ozet.gecerliJson)
    }

    @Test
    fun anahtar_ne_dosyada_ne_ekranda_gorunur() {
        val out = Files.createTempFile("olcum-anahtar", ".jsonl")
        val anahtar = "SAHTE-ANAHTAR-7731"
        val patlayan = LlmTransport { istek ->
            if (istek.user.endsWith("Kullanıcının isteği: müzik çok bağırıyor konuşmamı bastırıyor")) {
                throw IOException("sağlayıcı yanıtı: $anahtar")
            }
            referansTransport().complete(istek)
        }
        val yazilan = StringBuilder()
        koş(patlayan, ucluTestset(), out, anahtar = anahtar, yazilan = yazilan)
        val dosya = Files.readString(out, StandardCharsets.UTF_8)
        assertFalse(dosya.contains(anahtar), "anahtar çıktı dosyasında")
        assertFalse(yazilan.contains(anahtar), "anahtar ekran çıktısında")
        assertTrue(dosya.contains("[GIZLI]"), "hata mesajı redakte edilmeli")
    }

    @Test
    fun anahtar_yoksa_hata_verir() {
        val out = Files.createTempFile("olcum-yok", ".jsonl")
        assertFailsWith<IllegalStateException> { koş(referansTransport(), ucluTestset(), out, anahtar = null) }
    }

    @Test
    fun limit_ilk_n_testi_alir() {
        val out = Files.createTempFile("olcum-limit", ".jsonl")
        val ozet = HardSetRunner(
            transportKur = { _, _, _ -> referansTransport() },
            anahtarOku = { "K-3" },
            yaz = {},
            beklet = {},
        ).calistir(ayar(ucluTestset(), out, limit = 1))
        assertEquals(1, Files.readAllLines(out).size)
        assertEquals(1, ozet.toplam)
    }

    @Test
    fun argumanlar_dogru_ayrisir() {
        val a = HardSetArgumanlari.ayristir(
            arrayOf("--provider", "gemini", "--model", "m1", "--testset", "t.jsonl", "--durum", "d.json", "--out", "o.jsonl", "--limit", "5"),
        )
        assertEquals("gemini", a.provider)
        assertEquals(5, a.limit)
        assertEquals(2, a.paralel)
    }

    @Test
    fun gecersiz_saglayici_ve_eksik_arguman_reddedilir() {
        assertFailsWith<IllegalArgumentException> {
            HardSetArgumanlari.ayristir(arrayOf("--provider", "baska", "--model", "m", "--testset", "t", "--durum", "d", "--out", "o"))
        }
        assertFailsWith<IllegalArgumentException> {
            HardSetArgumanlari.ayristir(arrayOf("--provider", "openrouter", "--testset", "t", "--durum", "d", "--out", "o"))
        }
    }

    @Test
    fun istekMetniPromptBuilderIleAyniYapidadir() {
        // Sahte transport'un talimat çıkarımı, uygulamanın kullanıcı metni biçimine dayanır.
        val talimat = "müziği yüzde elliye çek"
        val istek = io.github.saldraykee22.popi.ai.PromptBuilder().build(talimat, DurumYukleyici.yukleDosya(durum))
        assertEquals(talimat, istek.user.substringAfterLast("Kullanıcının isteği: "))
    }
}
