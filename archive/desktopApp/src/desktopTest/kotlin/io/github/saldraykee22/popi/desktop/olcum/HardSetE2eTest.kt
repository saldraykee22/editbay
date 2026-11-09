package io.github.saldraykee22.popi.desktop.olcum

import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.util.concurrent.TimeUnit
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import org.junit.jupiter.api.Assumptions.assumeTrue

/**
 * Uçtan uca: sahte transport referans cevaplarını döndürür, runner çıktı dosyasını üretir,
 * ardından gerçek puanlayıcı (`puanla2.py`) çağrılır. Puan 32/34 ve üzeri olmalıdır.
 * Bu, araç ile puanlayıcının biçim uyumunun kanıtıdır; gerçek model koşusu değildir.
 */
class HardSetE2eTest {

    private fun pythonVar(): Boolean = try {
        val surec = ProcessBuilder("python", "--version").redirectErrorStream(true).start()
        surec.inputStream.readAllBytes()
        surec.waitFor(15, TimeUnit.SECONDS) && surec.exitValue() == 0
    } catch (e: Exception) {
        false
    }

    @Test
    fun referansCevaplarPuanlayiciyiGecer() {
        assumeTrue(pythonVar(), "Python bulunamadı; uçtan uca puanlama atlandı")

        val testset = zorDizin().resolve("testset2.jsonl")
        val cikti = Files.createTempFile("olcum-e2e", ".jsonl")
        val ozet = HardSetRunner(
            transportKur = { _, _, _ -> referansTransport() },
            anahtarOku = { "SAHTE-ANAHTAR-e2e" },
            yaz = {},
            beklet = {},
            geriCekilmeMs = listOf(0L, 0L),
        ).calistir(
            HardSetAyar(
                provider = "openrouter",
                model = "sahte/model",
                testset = testset,
                durum = zorDizin().resolve("durum2.json"),
                out = cikti,
                paralel = 2,
            ),
        )
        assertEquals(34, ozet.toplam)
        assertEquals(34, Files.readAllLines(cikti, StandardCharsets.UTF_8).size)

        val puanla = zorDizin().resolve("puanla2.py")
        val surec = ProcessBuilder("python", puanla.toString(), testset.toString(), cikti.toString())
            .redirectErrorStream(true)
            .apply { environment()["PYTHONIOENCODING"] = "utf-8" }
            .start()
        val cikis = surec.inputStream.readAllBytes().toString(StandardCharsets.UTF_8)
        assertTrue(surec.waitFor(120, TimeUnit.SECONDS), "puanlayıcı zaman aşımına uğradı")
        assertEquals(0, surec.exitValue(), "puanlayıcı hata verdi: $cikis")

        val eslesme = Regex("DOGRU (\\d+)/(\\d+)").find(cikis) ?: error("Puanlayıcı çıktısında DOGRU satırı yok: $cikis")
        val dogru = eslesme.groupValues[1].toInt()
        val toplam = eslesme.groupValues[2].toInt()
        assertEquals(34, toplam)
        assertTrue(dogru >= 32, "puan $dogru/$toplam, eşik 32/34")
    }
}
