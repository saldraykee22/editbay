package io.github.saldraykee22.popi.desktop.olcum

import io.github.saldraykee22.popi.ai.AiEditor
import io.github.saldraykee22.popi.ai.EditContext
import io.github.saldraykee22.popi.ai.GeminiTransport
import io.github.saldraykee22.popi.ai.LlmRequest
import io.github.saldraykee22.popi.ai.LlmTransport
import io.github.saldraykee22.popi.ai.OpenRouterTransport
import io.github.saldraykee22.popi.ai.ParsedResponse
import io.github.saldraykee22.popi.ai.ProviderError
import io.github.saldraykee22.popi.ai.Proposal
import io.github.saldraykee22.popi.ai.ResponseParser
import io.github.saldraykee22.popi.domain.Project
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import kotlin.system.exitProcess

/** Komut satırı ayarları. Anahtar burada yoktur; yalnız ortam değişkeninden okunur. */
internal data class HardSetAyar(
    val provider: String,
    val model: String,
    val testset: Path,
    val durum: Path,
    val out: Path,
    val limit: Int? = null,
    val paralel: Int = 2,
)

internal object HardSetArgumanlari {
    const val ANAHTAR_ORTAM = "POPI_OLCUM_KEY"

    private val BILINEN = setOf("provider", "model", "testset", "durum", "out", "limit", "paralel")

    fun ayristir(args: Array<String>): HardSetAyar {
        val degerler = HashMap<String, String>()
        var i = 0
        while (i < args.size) {
            val anahtar = args[i]
            require(anahtar.startsWith("--")) { "Beklenmeyen argüman: $anahtar" }
            val ad = anahtar.removePrefix("--")
            require(ad in BILINEN) { "Bilinmeyen seçenek: $anahtar" }
            require(i + 1 < args.size) { "$anahtar için değer verilmedi" }
            degerler[ad] = args[i + 1]
            i += 2
        }
        val provider = zorunlu(degerler, "provider")
        require(provider == "openrouter" || provider == "gemini") { "--provider openrouter ya da gemini olmalı" }
        return HardSetAyar(
            provider = provider,
            model = zorunlu(degerler, "model"),
            testset = Path.of(zorunlu(degerler, "testset")),
            durum = Path.of(zorunlu(degerler, "durum")),
            out = Path.of(zorunlu(degerler, "out")),
            limit = degerler["limit"]?.let { pozitifTamSayi(it, "--limit") },
            paralel = degerler["paralel"]?.let { pozitifTamSayi(it, "--paralel") } ?: 2,
        )
    }

    private fun zorunlu(degerler: Map<String, String>, ad: String): String =
        degerler[ad] ?: throw IllegalArgumentException("--$ad zorunlu")

    private fun pozitifTamSayi(metin: String, ad: String): Int {
        val n = metin.toIntOrNull()
        require(n != null && n > 0) { "$ad pozitif tam sayı olmalı" }
        return n
    }
}

/** Tek testin sonucu: çıktı satırının alanları ve özet için birkaç bayrak. */
internal class SatirSonucu(
    val id: String,
    val alanlar: Map<String, Any?>,
    val gecerliJson: Boolean,
    val dryRunKabul: Boolean,
    val dryRun: String,
    val hata: String?,
    val sureMs: Long,
)

/** Koşunun özeti. */
internal class HardSetOzeti {
    var toplam = 0
        private set
    var gecerliJson = 0
        private set
    var dryRunKabul = 0
        private set
    var hatali = 0
        private set
    var toplamSureMs = 0L

    fun ekle(s: SatirSonucu) {
        toplam++
        if (s.gecerliJson) gecerliJson++
        if (s.dryRunKabul) dryRunKabul++
        if (s.hata != null) hatali++
    }

    fun metin(): String =
        "Özet: $toplam test, $gecerliJson geçerli JSON, $dryRunKabul dry-run kabul, $hatali hatalı satır, toplam süre $toplamSureMs ms"
}

/**
 * Zor seti uygulamanın kendi istemi ([PromptBuilder] üzerinden [AiEditor]) ve motoruyla koşturur.
 *
 * Her test için: transport çağrısı (en fazla [geriCekilmeMs] kadar geri çekilerek yeniden denenir),
 * [ResponseParser] ile çözümleme ve kopya motorda dry-run. Çıktı satırı `puanla2.py`'nin beklediği
 * `{"id", "cevap"}` biçimindedir; ek alanlar puanlayıcıyı etkilemez.
 *
 * Anahtar yalnız [anahtarOku] ile alınır; çıktıya ve yazdırılan satırlara girmeden önce redakte edilir.
 */
internal class HardSetRunner(
    private val transportKur: (provider: String, model: String, anahtar: String) -> LlmTransport,
    private val anahtarOku: () -> String?,
    private val yaz: (String) -> Unit,
    private val beklet: (Long) -> Unit = { Thread.sleep(it) },
    private val geriCekilmeMs: List<Long> = listOf(2_000L, 5_000L),
) {
    fun calistir(ayar: HardSetAyar): HardSetOzeti {
        val anahtar = anahtarOku()?.takeIf { it.isNotBlank() }
            ?: throw IllegalStateException("${HardSetArgumanlari.ANAHTAR_ORTAM} ortam değişkeni tanımlı değil")
        val proje: Project = DurumYukleyici.yukleDosya(ayar.durum)
        val tumTestler = TestSeti.oku(ayar.testset)
        val testler = ayar.limit?.let { tumTestler.take(it) } ?: tumTestler
        val taban = transportKur(ayar.provider, ayar.model, anahtar)
        ayar.out.toAbsolutePath().parent?.let { Files.createDirectories(it) }

        val baslangic = System.nanoTime()
        val ozet = HardSetOzeti()
        val havuz = Executors.newFixedThreadPool(ayar.paralel)
        try {
            val gelecekler = testler.map { t ->
                havuz.submit(Callable { guvenliCalistir(t, proje, taban, anahtar) })
            }
            Files.newBufferedWriter(ayar.out, StandardCharsets.UTF_8).use { yazici ->
                for (gelecek in gelecekler) {
                    val s = gelecek.get()
                    yazici.write(redakte(MiniJson.yaz(s.alanlar), anahtar))
                    yazici.newLine()
                    yazici.flush()
                    ozet.ekle(s)
                    val durumMetni = if (s.hata == null) "dry-run=${s.dryRun}" else "hata"
                    yaz(redakte("${s.id} $durumMetni ${s.sureMs} ms", anahtar))
                }
            }
        } finally {
            havuz.shutdown()
        }
        ozet.toplamSureMs = (System.nanoTime() - baslangic) / 1_000_000
        return ozet
    }

    /** Beklenmeyen bir istisna bile koşuyu durdurmaz; o test hata satırı olarak yazılır. */
    private fun guvenliCalistir(t: TestMaddesi, proje: Project, taban: LlmTransport, anahtar: String): SatirSonucu =
        try {
            calistirTek(t, proje, taban, anahtar)
        } catch (e: Exception) {
            val mesaj = redakte(e.message ?: e.toString(), anahtar)
            val alanlar = linkedMapOf<String, Any?>(
                "id" to t.id,
                "cevap" to null,
                "ayrisma" to "bilinmiyor",
                "dry_run" to "hata",
                "dry_run_neden" to null,
                "ham" to null,
                "sure_ms" to 0L,
                "deneme" to 0,
                "hata" to mesaj,
            )
            SatirSonucu(
                id = t.id,
                alanlar = alanlar,
                gecerliJson = false,
                dryRunKabul = false,
                dryRun = "hata",
                hata = mesaj,
                sureMs = 0L,
            )
        }

    private fun calistirTek(t: TestMaddesi, proje: Project, taban: LlmTransport, anahtar: String): SatirSonucu {
        val baslangic = System.nanoTime()
        val yeniden = YenidenDeneyen(taban, geriCekilmeMs, beklet)
        val kayit = KayitliTransport(yeniden)
        val sonuc: Proposal = try {
            AiEditor().propose(t.talimat, proje, kayit, EditContext(t.secili, listOfNotNull(t.gecmis)))
        } catch (e: Exception) {
            Proposal.Failed(redakte(e.message ?: e.toString(), anahtar))
        }
        val sureMs = (System.nanoTime() - baslangic) / 1_000_000

        val ham = kayit.ham
        val ayrisma: ParsedResponse? = ham?.let { ResponseParser().parse(it) }
        val cevap: Any? = when (ayrisma) {
            is ParsedResponse.Commands -> MiniJson.Ham(ayrisma.json)
            is ParsedResponse.Clarify -> listOf(mapOf("op" to "clarify", "question" to ayrisma.question))
            is ParsedResponse.Unsupported -> listOf(mapOf("op" to "unsupported", "reason" to ayrisma.reason))
            is ParsedResponse.Invalid, null -> null
        }
        val ayrismaEtiketi = when {
            ham == null -> "aga_hatasi"
            ayrisma is ParsedResponse.Commands -> "komut"
            ayrisma is ParsedResponse.Clarify -> "soru"
            ayrisma is ParsedResponse.Unsupported -> "reddedildi"
            else -> "ayrismadi"
        }
        val dryRun: String
        val neden: String?
        val hata: String?
        when (sonuc) {
            is Proposal.Ready -> { dryRun = "kabul"; neden = null; hata = null }
            is Proposal.HistoryStep -> { dryRun = sonuc.op; neden = null; hata = null }
            is Proposal.NeedsClarification -> { dryRun = "soru"; neden = sonuc.question; hata = null }
            is Proposal.Rejected -> { dryRun = "red"; neden = sonuc.reason; hata = null }
            is Proposal.Failed -> { dryRun = "hata"; neden = null; hata = sonuc.detail }
        }

        val alanlar = linkedMapOf<String, Any?>(
            "id" to t.id,
            "cevap" to cevap,
            "ayrisma" to ayrismaEtiketi,
            "dry_run" to dryRun,
            "dry_run_neden" to neden,
            "ham" to ham,
            "sure_ms" to sureMs,
            "deneme" to yeniden.denemeSayisi.get(),
            "hata" to (hata ?: kayit.sonHata),
        )
        return SatirSonucu(
            id = t.id,
            alanlar = alanlar,
            gecerliJson = cevap != null,
            dryRunKabul = dryRun == "kabul",
            dryRun = dryRun,
            hata = hata ?: kayit.sonHata,
            sureMs = sureMs,
        )
    }

    private fun redakte(metin: String, anahtar: String): String =
        if (anahtar.isEmpty()) metin else metin.replace(anahtar, "[GIZLI]")
}

/**
 * Taban transport'u yeniden dener: [geriCekilmeMs] listesi kadar geri çekilir; her denemeyi sayar.
 * Yetki hatası (401/403) yeniden denenmez; anahtar sorunu tekrar denemeyle düzelmez.
 */
internal class YenidenDeneyen(
    private val taban: LlmTransport,
    private val geriCekilmeMs: List<Long>,
    private val beklet: (Long) -> Unit,
) : LlmTransport {
    val denemeSayisi = AtomicInteger(0)

    override fun complete(request: LlmRequest): String {
        var sira = 0
        while (true) {
            denemeSayisi.incrementAndGet()
            try {
                return taban.complete(request)
            } catch (e: ProviderError.Auth) {
                throw e
            } catch (e: Exception) {
                if (sira >= geriCekilmeMs.size) throw e
                beklet(geriCekilmeMs[sira])
                sira++
            }
        }
    }
}

/** Son ham yanıtı ve son hatayı tutar; AiEditor'ün transport çağrısını sarar. */
internal class KayitliTransport(private val icerik: LlmTransport) : LlmTransport {
    @Volatile
    var ham: String? = null
        private set

    @Volatile
    var sonHata: String? = null
        private set

    override fun complete(request: LlmRequest): String = try {
        icerik.complete(request).also { ham = it }
    } catch (e: Exception) {
        sonHata = e.message ?: e.toString()
        throw e
    }
}

internal fun gercekTransport(provider: String, model: String, anahtar: String): LlmTransport = when (provider) {
    "openrouter" -> OpenRouterTransport(anahtar, model)
    "gemini" -> GeminiTransport(anahtar, model)
    else -> throw IllegalArgumentException("Bilinmeyen sağlayıcı: $provider")
}

private const val KULLANIM = """Kullanım:
  .\gradlew.bat :desktopApp:runHardSet --args="--provider openrouter|gemini --model <ad> --testset <testset2.jsonl> --durum <durum2.json> --out <cevaplar.jsonl> [--limit N] [--paralel K]"
Anahtar yalnız POPI_OLCUM_KEY ortam değişkeninden okunur."""

/** Giriş noktası: `runHardSet` görevi bunu çağırır. */
fun main(args: Array<String>) {
    val ayar = try {
        HardSetArgumanlari.ayristir(args)
    } catch (e: IllegalArgumentException) {
        System.err.println("Hata: ${e.message}")
        System.err.println(KULLANIM)
        exitProcess(2)
    }
    val calistirici = HardSetRunner(
        transportKur = ::gercekTransport,
        anahtarOku = { System.getenv(HardSetArgumanlari.ANAHTAR_ORTAM) },
        yaz = { println(it) },
    )
    try {
        val ozet = calistirici.calistir(ayar)
        println(ozet.metin())
        println("Çıktı: ${ayar.out.toAbsolutePath()}")
    } catch (e: Exception) {
        System.err.println("Hata: ${e.message}")
        exitProcess(1)
    }
}
