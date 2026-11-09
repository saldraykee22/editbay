package io.github.saldraykee22.popi.desktop.ai

import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption

/**
 * Yazıyla düzenleme ayarları. Yalnızca sağlayıcı ve model adı tutulur.
 * API anahtarı burada değildir; anahtarlar [io.github.saldraykee22.popi.secrets.SecretStore] içinde saklanır.
 */
data class AiSettings(
    val provider: String = PROVIDER_OPENROUTER,
    val model: String = "",
) {
    companion object {
        const val PROVIDER_OPENROUTER = "openrouter"
        const val PROVIDER_GEMINI = "gemini"
    }
}

/**
 * `%APPDATA%\Popi\ayarlar.json` dosyasını okur ve yazar. Dosyada anahtar bulunmaz;
 * yalnızca sağlayıcı ve model adı düz metin olarak tutulur.
 */
class AiSettingsStore(private val file: Path = defaultFile()) {
    fun load(): AiSettings = runCatching {
        if (!Files.isRegularFile(file)) return AiSettings()
        val text = Files.readString(file)
        AiSettings(
            provider = stringField(text, "provider") ?: AiSettings.PROVIDER_OPENROUTER,
            model = stringField(text, "model") ?: "",
        )
    }.getOrDefault(AiSettings())

    fun save(settings: AiSettings) {
        runCatching {
            file.parent?.let { Files.createDirectories(it) }
            val temporary = Files.createTempFile(file.parent, "ayarlar", ".tmp")
            try {
                Files.writeString(temporary, encode(settings))
                try {
                    Files.move(temporary, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
                } catch (_: java.nio.file.AtomicMoveNotSupportedException) {
                    Files.move(temporary, file, StandardCopyOption.REPLACE_EXISTING)
                }
            } finally {
                Files.deleteIfExists(temporary)
            }
        }
    }

    private fun encode(settings: AiSettings): String = buildString {
        append("{\n")
        append("  \"provider\": ").append(quote(settings.provider)).append(",\n")
        append("  \"model\": ").append(quote(settings.model)).append("\n")
        append("}\n")
    }

    companion object {
        fun defaultFile(): Path {
            val appData = System.getenv("APPDATA")?.takeIf(String::isNotBlank)
                ?: Path.of(System.getProperty("user.home"), "AppData", "Roaming").toString()
            return Path.of(appData, "Popi", "ayarlar.json")
        }
    }
}

private fun quote(value: String): String = buildString {
    append('"')
    value.forEach { c ->
        when (c) {
            '\\' -> append("\\\\")
            '"' -> append("\\\"")
            '\n' -> append("\\n")
            '\r' -> append("\\r")
            '\t' -> append("\\t")
            else -> append(c)
        }
    }
    append('"')
}

private fun stringField(json: String, name: String): String? {
    val match = Regex("\"${Regex.escape(name)}\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"").find(json) ?: return null
    return unescape(match.groupValues[1])
}

private fun unescape(value: String): String = buildString {
    var i = 0
    while (i < value.length) {
        val c = value[i]
        if (c == '\\' && i + 1 < value.length) {
            when (value[i + 1]) {
                'n' -> append('\n')
                'r' -> append('\r')
                't' -> append('\t')
                '\\' -> append('\\')
                '"' -> append('"')
                else -> append(value[i + 1])
            }
            i += 2
        } else {
            append(c)
            i++
        }
    }
}
