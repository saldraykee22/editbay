package io.github.saldraykee22.popi.desktop.olcum

import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path

/** Zor set satırının modele giden kısmı. Kontrol alanları puanlayıcıda kalır. */
internal data class TestMaddesi(val id: String, val talimat: String, val secili: String? = null, val gecmis: String? = null)

/** `testset2.jsonl` okuyucu: her boş olmayan satır bir JSON nesnesi. */
internal object TestSeti {
    fun oku(yol: Path): List<TestMaddesi> = Files.readAllLines(yol, StandardCharsets.UTF_8)
        .filter { it.isNotBlank() }
        .map { satir ->
            val m = MiniJson.ayristir(satir) as? Map<*, *> ?: throw IllegalArgumentException("Test satırı nesne değil")
            TestMaddesi(
                id = m["id"] as? String ?: throw IllegalArgumentException("Test satırında 'id' yok"),
                talimat = m["talimat"] as? String ?: throw IllegalArgumentException("Test ${m["id"]} içinde 'talimat' yok"),
                secili = (m["secili"] as? String)?.takeUnless { it == "yok" },
                gecmis = m["gecmis"] as? String,
            )
        }
}
