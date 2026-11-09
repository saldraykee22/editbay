package io.github.saldraykee22.popi.ai

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

/** Modele verilen ham metnin çözümlenmiş hâli. */
sealed interface ParsedResponse {
    /** Uygulanabilir komutlar; tek nesne de dizi hâline getirilir. */
    data class Commands(val json: String) : ParsedResponse

    /** Model belirsizlik nedeniyle soru sordu. */
    data class Clarify(val question: String) : ParsedResponse

    /** Model isteği bu şemayla yapılamaz buldu. */
    data class Unsupported(val reason: String) : ParsedResponse

    /** Metinde geçerli JSON yok. */
    data class Invalid(val detail: String) : ParsedResponse
}

/**
 * Model çıktısındaki JSON'u bulur ve yorumlar.
 *
 * Desteklenen biçimler: düz JSON, ```json çitli blok, önünde/arkasında açıklama metni
 * olan JSON. Tek nesne diziye çevrilir.
 */
class ResponseParser {
    fun parse(text: String): ParsedResponse {
        val jsonText = extractJson(text) ?: return ParsedResponse.Invalid("Metinde JSON bulunamadı")
        val element = try {
            Json.parseToJsonElement(jsonText)
        } catch (e: Exception) {
            return ParsedResponse.Invalid("JSON çözümlenemedi: ${e.message}")
        }
        return interpret(element)
    }

    private fun interpret(element: JsonElement): ParsedResponse = when (element) {
        is JsonObject -> interpretObjects(listOf(element))
        is JsonArray -> {
            val allObjects = element.all { it is JsonObject }
            if (!allObjects) ParsedResponse.Invalid("Komutlar JSON nesnesi olmalı")
            else interpretObjects(element.filterIsInstance<JsonObject>())
        }
        else -> ParsedResponse.Invalid("Beklenen JSON nesne ya da dizi")
    }

    private fun interpretObjects(objects: List<JsonObject>): ParsedResponse {
        if (objects.isEmpty()) return ParsedResponse.Invalid("Komut listesi boş")
        if (objects.size == 1) {
            when (objects[0].op()) {
                "clarify" -> return ParsedResponse.Clarify(objects[0].string("question") ?: "")
                "unsupported" -> return ParsedResponse.Unsupported(objects[0].string("reason") ?: "")
            }
        }
        return ParsedResponse.Commands(JsonArray(objects).toString())
    }

    private fun JsonObject.op(): String? = this["op"]?.jsonPrimitive?.contentOrNull
    private fun JsonObject.string(name: String): String? = this[name]?.jsonPrimitive?.contentOrNull

    private fun extractJson(text: String): String? {
        val trimmed = text.trim()
        FENCE.find(trimmed)?.let { return it.groupValues[1].trim() }
        runCatching { Json.parseToJsonElement(trimmed) }.onSuccess { return trimmed }
        var i = 0
        while (i < trimmed.length) {
            if (trimmed[i] == '{' || trimmed[i] == '[') {
                val end = matchEnd(trimmed, i)
                if (end != null) return trimmed.substring(i, end + 1)
            }
            i++
        }
        return null
    }

    /** [start] konumundaki açıcının eşleşen kapanış konumunu döndürür; dize içini yok sayar. */
    private fun matchEnd(s: String, start: Int): Int? {
        val open = s[start]
        val close = if (open == '{') '}' else ']'
        var depth = 0
        var inString = false
        var escaped = false
        var i = start
        while (i < s.length) {
            val c = s[i]
            if (inString) {
                when {
                    escaped -> escaped = false
                    c == '\\' -> escaped = true
                    c == '"' -> inString = false
                }
            } else {
                when (c) {
                    '"' -> inString = true
                    open -> depth++
                    close -> {
                        depth--
                        if (depth == 0) return i
                    }
                }
            }
            i++
        }
        return null
    }

    private companion object {
        val FENCE = Regex("```(?:json|JSON)?\\s*([\\s\\S]*?)```")
    }
}
