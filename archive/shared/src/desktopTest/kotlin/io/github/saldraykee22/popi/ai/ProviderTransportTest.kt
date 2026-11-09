package io.github.saldraykee22.popi.ai

import com.sun.net.httpserver.Headers
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.nio.charset.StandardCharsets
import java.time.Duration
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

class ProviderTransportTest {
    private class MockServer(private val status: Int, private val body: String) {
        val server: HttpServer = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        @Volatile var method: String? = null
        @Volatile var path: String? = null
        @Volatile var uri: String? = null
        @Volatile var headers: Headers? = null
        @Volatile var requestBody: String? = null

        init {
            server.createContext("/") { exchange ->
                method = exchange.requestMethod
                path = exchange.requestURI.path
                uri = exchange.requestURI.toString()
                headers = exchange.requestHeaders
                requestBody = exchange.requestBody.readBytes().toString(StandardCharsets.UTF_8)
                val bytes = body.toByteArray(StandardCharsets.UTF_8)
                exchange.responseHeaders.add("Content-Type", "application/json")
                exchange.sendResponseHeaders(status, bytes.size.toLong())
                exchange.responseBody.use { it.write(bytes) }
            }
            server.start()
        }

        val baseUrl: String get() = "http://127.0.0.1:${server.address.port}"
        fun stop() = server.stop(0)
    }

    private fun <T> withServer(status: Int, body: String, block: (MockServer) -> T): T {
        val server = MockServer(status, body)
        return try {
            block(server)
        } finally {
            server.stop()
        }
    }

    @Test fun openRouterSendsRequestAndParsesContent() = withServer(200, OPENROUTER_OK) { server ->
        val transport = OpenRouterTransport("or-secret-key", "test-model", server.baseUrl, Duration.ofSeconds(5))
        val out = transport.complete(LlmRequest("SYS", "USER"))
        assertEquals("""[{"op":"undo"}]""", out)
        assertEquals("POST", server.method)
        assertEquals("/api/v1/chat/completions", server.path)
        assertEquals("Bearer or-secret-key", server.headers!!.getFirst("Authorization"))
        val body = Json.parseToJsonElement(server.requestBody!!).jsonObject
        assertEquals("test-model", body["model"]!!.jsonPrimitive.content)
        val messages = body["messages"]!!.jsonArray
        assertEquals("system", messages[0].jsonObject["role"]!!.jsonPrimitive.content)
        assertEquals("SYS", messages[0].jsonObject["content"]!!.jsonPrimitive.content)
        assertEquals("user", messages[1].jsonObject["role"]!!.jsonPrimitive.content)
        assertEquals("USER", messages[1].jsonObject["content"]!!.jsonPrimitive.content)
    }

    @Test fun geminiSendsRequestAndJoinsParts() = withServer(200, GEMINI_OK) { server ->
        val transport = GeminiTransport("gem-secret-key", "gemini-test", server.baseUrl, Duration.ofSeconds(5))
        val out = transport.complete(LlmRequest("SYS", "USER"))
        assertEquals("parça1parça2", out)
        assertEquals("POST", server.method)
        assertEquals("/v1beta/models/gemini-test:generateContent", server.path)
        assertEquals("gem-secret-key", server.headers!!.getFirst("x-goog-api-key"))
        assertFalse(server.uri!!.contains("gem-secret-key"))
        val body = Json.parseToJsonElement(server.requestBody!!).jsonObject
        assertEquals(
            "SYS",
            body["systemInstruction"]!!.jsonObject["parts"]!!.jsonArray[0].jsonObject["text"]!!.jsonPrimitive.content,
        )
        val content = body["contents"]!!.jsonArray[0].jsonObject
        assertEquals("user", content["role"]!!.jsonPrimitive.content)
        assertEquals("USER", content["parts"]!!.jsonArray[0].jsonObject["text"]!!.jsonPrimitive.content)
    }

    @Test fun openRouterMapsAuthAndRateLimit() {
        withServer(401, "{}") { server ->
            assertFailsWith<ProviderError.Auth> {
                OpenRouterTransport("k", "m", server.baseUrl, Duration.ofSeconds(5)).complete(LlmRequest("s", "u"))
            }
        }
        withServer(429, "{}") { server ->
            assertFailsWith<ProviderError.RateLimited> {
                OpenRouterTransport("k", "m", server.baseUrl, Duration.ofSeconds(5)).complete(LlmRequest("s", "u"))
            }
        }
    }

    @Test fun geminiMapsAuthAndRateLimit() {
        withServer(403, "{}") { server ->
            assertFailsWith<ProviderError.Auth> {
                GeminiTransport("k", "m", server.baseUrl, Duration.ofSeconds(5)).complete(LlmRequest("s", "u"))
            }
        }
        withServer(429, "{}") { server ->
            assertFailsWith<ProviderError.RateLimited> {
                GeminiTransport("k", "m", server.baseUrl, Duration.ofSeconds(5)).complete(LlmRequest("s", "u"))
            }
        }
    }

    @Test fun otherStatusBecomesOtherError() {
        withServer(500, "{}") { server ->
            assertFailsWith<ProviderError.Other> {
                OpenRouterTransport("k", "m", server.baseUrl, Duration.ofSeconds(5)).complete(LlmRequest("s", "u"))
            }
        }
    }

    @Test fun apiKeyNeverAppearsInErrors() {
        val openRouterKey = "or-leak-check-98765"
        withServer(401, "{}") { server ->
            val error = assertFailsWith<ProviderError> {
                OpenRouterTransport(openRouterKey, "m", server.baseUrl, Duration.ofSeconds(5)).complete(LlmRequest("s", "u"))
            }
            assertFalse(error.message.orEmpty().contains(openRouterKey))
            assertFalse(error.toString().contains(openRouterKey))
        }
        val geminiKey = "gem-leak-check-12345"
        withServer(401, "{}") { server ->
            val error = assertFailsWith<ProviderError> {
                GeminiTransport(geminiKey, "m", server.baseUrl, Duration.ofSeconds(5)).complete(LlmRequest("s", "u"))
            }
            assertFalse(error.message.orEmpty().contains(geminiKey))
            assertFalse(error.toString().contains(geminiKey))
        }
    }

    private companion object {
        const val OPENROUTER_OK = """{"choices":[{"message":{"content":"[{\"op\":\"undo\"}]"}}]}"""
        const val GEMINI_OK = """{"candidates":[{"content":{"parts":[{"text":"parça1"},{"text":"parça2"}]}}]}"""
    }
}
