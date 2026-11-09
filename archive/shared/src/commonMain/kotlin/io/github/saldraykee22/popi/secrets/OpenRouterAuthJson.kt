package io.github.saldraykee22.popi.secrets

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * OpenRouter OAuth istek ve yanıt JSON yardımcıları.
 */
object OpenRouterAuthJson {

    fun createRequestBody(code: String, verifier: String): String = buildJsonObject {
        put("code", code)
        put("code_verifier", verifier)
        put("code_challenge_method", "S256")
    }.toString()

    fun extractKey(jsonText: String): String? {
        return try {
            val element = Json.parseToJsonElement(jsonText).jsonObject
            element["key"]?.jsonPrimitive?.content
        } catch (_: Exception) {
            null
        }
    }
}
