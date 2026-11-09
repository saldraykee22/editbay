package io.github.saldraykee22.popi.ai

import java.net.URI
import java.net.http.HttpRequest
import java.nio.charset.StandardCharsets
import java.time.Duration
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject

/**
 * Google Gemini `generateContent` uç noktasına istek atan taşıma katmanı.
 *
 * Anahtar `x-goog-api-key` başlığında gider; URL'ye asla eklenmez.
 *
 * @param apiKey API anahtarı. Hatalara ve loglara asla yazılmaz.
 * @param model çağıran tarafından verilir; burada sabitlenmez.
 * @param baseUrl testlerde sahte sunucuya yöneltmek için.
 * @param timeout bağlantı ve istek zaman aşımı.
 */
class GeminiTransport(
    private val apiKey: String,
    private val model: String,
    baseUrl: String = "https://generativelanguage.googleapis.com",
    private val timeout: Duration = Duration.ofSeconds(60),
) : LlmTransport {
    private val base = baseUrl.trimEnd('/')
    private val client = HttpSupport.client(timeout)

    override fun complete(request: LlmRequest): String {
        val body = buildJsonObject {
            putJsonObject("systemInstruction") {
                putJsonArray("parts") {
                    addJsonObject { put("text", request.system) }
                }
            }
            putJsonArray("contents") {
                addJsonObject {
                    put("role", "user")
                    putJsonArray("parts") {
                        addJsonObject { put("text", request.user) }
                    }
                }
            }
        }.toString()

        val httpRequest = HttpRequest.newBuilder(
            URI.create("$base/v1beta/models/$model:generateContent"),
        )
            .timeout(timeout)
            .header("Content-Type", "application/json")
            .header("x-goog-api-key", apiKey)
            .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
            .build()

        return parseContent(HttpSupport.send(client, httpRequest))
    }

    private fun parseContent(body: String): String {
        val parts = try {
            Json.parseToJsonElement(body).jsonObject["candidates"]?.jsonArray?.firstOrNull()?.jsonObject
                ?.get("content")?.jsonObject?.get("parts")?.jsonArray
        } catch (e: Exception) {
            null
        }
        val text = parts?.mapNotNull { it.jsonObject["text"]?.jsonPrimitive?.contentOrNull }?.joinToString("")
            ?: throw ProviderError.Other("Sağlayıcı yanıtı okunamadı")
        return text
    }
}
