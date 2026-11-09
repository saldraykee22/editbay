package io.github.saldraykee22.popi.desktop.olcum

import io.github.saldraykee22.popi.ai.LlmRequest
import io.github.saldraykee22.popi.ai.LlmTransport
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths

/** Depo kökü: `settings.gradle.kts` bulunan ilk üst dizin. Testler kişisel yol kullanmaz. */
internal fun kokDizin(): Path {
    var d: Path? = Paths.get("").toAbsolutePath()
    while (d != null && !Files.exists(d.resolve("settings.gradle.kts"))) d = d.parent
    return d ?: error("Depo kökü bulunamadı")
}

internal fun zorDizin(): Path = kokDizin().resolve("arastirma/komut-testi/zor")

/**
 * Referans cevapları talimat metnine göre döndüren sahte transport.
 * PromptBuilder kullanıcı metni `...Kullanıcının isteği: <talimat>` biçimindedir; talimat oradan okunur.
 */
internal fun referansTransport(): LlmTransport {
    val testler = TestSeti.oku(zorDizin().resolve("testset2.jsonl"))
    val talimatIdler = testler.associate { it.talimat to it.id }
    val referans = Files.readAllLines(zorDizin().resolve("referans.jsonl"), StandardCharsets.UTF_8)
        .filter { it.isNotBlank() }
        .associate { satir ->
            val m = MiniJson.ayristir(satir) as Map<*, *>
            (m["id"] as String) to MiniJson.yaz(m["cevap"])
        }
    return LlmTransport { istek -> referansCevap(istek, talimatIdler, referans) }
}

internal fun referansCevap(istek: LlmRequest, talimatIdler: Map<String, String>, referans: Map<String, String>): String {
    val talimat = istek.user.substringAfterLast("Kullanıcının isteği: ")
    val id = talimatIdler[talimat] ?: error("Bilinmeyen talimat")
    return referans[id] ?: error("Referans yok: $id")
}
