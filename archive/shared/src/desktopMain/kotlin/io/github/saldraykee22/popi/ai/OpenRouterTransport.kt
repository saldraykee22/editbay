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

/**
 * OpenRouter'ın OpenAI uyumlu sohbet uç noktasına istek atan taşıma katmanı.
 *
 * @param apiKey Bearer anahtarı. Hatalara ve loglara asla yazılmaz.
 * @param model çağıran tarafından verilir; burada sabitlenmez.
 * @param baseUrl testlerde sahte sunucuya yöneltmek için.
 * @param timeout bağlantı ve istek zaman aşımı.
 */
class OpenRouterTransport(
    private val apiKey: String,
    private val model: String,
    baseUrl: String = "https://openrouter.ai",
    private val timeout: Duration = Duration.ofSeconds(60),
) : LlmTransport {
    private val base = baseUrl.trimEnd('/')
    private val client = HttpSupport.client(timeout)

    override fun complete(request: LlmRequest): String {
        val body = buildJsonObject {
            put("model", model)
            putJsonArray("messages") {
                addJsonObject {
                    put("role", "system")
                    put("content", request.system)
                }
                addJsonObject {
                    put("role", "user")
                    put("content", request.user)
                }
            }
        }.toString()

        val httpRequest = HttpRequest.newBuilder(URI.create("$base/api/v1/chat/completions"))
            .timeout(timeout)
            .header("Content-Type", "application/json")
            .header("Authorization", "Bearer $apiKey")
            .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
            .build()

        return parseContent(HttpSupport.send(client, httpRequest))
    }

    private fun parseContent(body: String): String {
        val content = try {
            Json.parseToJsonElement(body).jsonObject["choices"]?.jsonArray?.firstOrNull()?.jsonObject
                ?.get("message")?.jsonObject?.get("content")?.jsonPrimitive?.contentOrNull
        } catch (e: Exception) {
            null
        }
        return content ?: throw ProviderError.Other("Sağlayıcı yanıtı okunamadı")
    }
}
