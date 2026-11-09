package io.github.saldraykee22.popi.desktop.ui

/** İçe aktarılabilir medya türü; değer, komut motorundaki asset türüyle aynıdır. */
enum class MediaKind(val wire: String) { VIDEO("video"), AUDIO("audio") }

/** Desteklenen uzantılar. Dosya seçici ve sürükle-bırak aynı kuralı kullanır. */
object MediaFormats {
    private val videoExtensions = setOf("mp4", "mov", "mkv", "webm")
    private val audioExtensions = setOf("mp3", "wav", "m4a", "aac", "ogg")

    fun kindOf(fileName: String): MediaKind? {
        val extension = fileName.substringAfterLast('.', "").lowercase()
        return when (extension) {
            in videoExtensions -> MediaKind.VIDEO
            in audioExtensions -> MediaKind.AUDIO
            else -> null
        }
    }
}

data class AcceptedMedia<T>(val item: T, val kind: MediaKind)

/** Bırakılan ya da seçilen dosyaların ayrımı: kabul edilenler ve reddedilen adları. */
data class ImportPlan<T>(val accepted: List<AcceptedMedia<T>>, val rejectedNames: List<String>) {
    /** Reddedilen dosyalar için tek satırlık uyarı; hepsi kabulse null. */
    val notice: String?
        get() = if (rejectedNames.isEmpty()) null else "Desteklenmeyen dosya: ${rejectedNames.joinToString(", ")}"
}

/** Dosya listesini içe aktarılabilir ve reddedilen olarak ayırır. Sıra korunur. */
fun <T> planMediaImport(items: Collection<T>, nameOf: (T) -> String): ImportPlan<T> {
    val accepted = mutableListOf<AcceptedMedia<T>>()
    val rejected = mutableListOf<String>()
    items.forEach { item ->
        val name = nameOf(item)
        val kind = MediaFormats.kindOf(name)
        if (kind == null) rejected += name else accepted += AcceptedMedia(item, kind)
    }
    return ImportPlan(accepted, rejected)
}
