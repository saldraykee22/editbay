package io.github.saldraykee22.popi.desktop.secrets

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.URI
import java.net.URLDecoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicReference
import kotlin.test.*

class OpenRouterOAuthTest {

    private fun parseQueryParam(query: String?, key: String): String? {
        if (query.isNullOrBlank()) return null
        return query.split("&")
            .map { it.split("=", limit = 2) }
            .firstOrNull { it.size == 2 && URLDecoder.decode(it[0], "UTF-8") == key }
            ?.let { URLDecoder.decode(it[1], "UTF-8") }
    }

    @Test
    fun successfulAuthorizationFlow() {
        val receivedCode = AtomicReference<String>()
        val receivedVerifier = AtomicReference<String>()

        val fakeApiServer = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        fakeApiServer.createContext("/api/v1/auth/keys") { exchange ->
            val body = exchange.requestBody.readAllBytes().toString(Charsets.UTF_8)
            val code = Regex(""""code"\s*:\s*"([^"]+)"""").find(body)?.groupValues?.get(1)
            val verifier = Regex(""""code_verifier"\s*:\s*"([^"]+)"""").find(body)?.groupValues?.get(1)
            receivedCode.set(code)
            receivedVerifier.set(verifier)

            val responseBody = """{"key":"sk-test-secret-key-12345"}"""
            val bytes = responseBody.toByteArray(Charsets.UTF_8)
            exchange.responseHeaders.set("Content-Type", "application/json")
            exchange.sendResponseHeaders(200, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }
        fakeApiServer.start()

        val apiBase = "http://127.0.0.1:${fakeApiServer.address.port}"
        val executor = Executors.newSingleThreadExecutor()

        try {
            val oauth = OpenRouterOAuth(
                authBase = apiBase,
                apiBase = apiBase,
                timeoutMs = 5000L,
                onOpenUrl = { authUrl ->
                    executor.submit {
                        val uri = URI.create(authUrl)
                        val callbackUrl = parseQueryParam(uri.query, "callback_url")
                        assertNotNull(callbackUrl)

                        val client = HttpClient.newHttpClient()
                        val request = HttpRequest.newBuilder()
                            .uri(URI.create("$callbackUrl?code=my-auth-code-777"))
                            .GET()
                            .build()
                        val response = client.send(request, HttpResponse.BodyHandlers.ofString(Charsets.UTF_8))
                        assertEquals(200, response.statusCode())
                        assertTrue(response.body().contains("Bağlantı tamam"))
                    }
                }
            )

            val testVerifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
            val apiKey = oauth.authorize(customVerifier = testVerifier)

            assertEquals("sk-test-secret-key-12345", apiKey)
            assertEquals("my-auth-code-777", receivedCode.get())
            assertEquals(testVerifier, receivedVerifier.get())
        } finally {
            fakeApiServer.stop(0)
            executor.shutdownNow()
        }
    }

    @Test
    fun invalidPathOrMissingCodeReturns400AndFlowContinues() {
        val fakeApiServer = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        fakeApiServer.createContext("/api/v1/auth/keys") { exchange ->
            val responseBody = """{"key":"sk-recovered-key"}"""
            val bytes = responseBody.toByteArray(Charsets.UTF_8)
            exchange.responseHeaders.set("Content-Type", "application/json")
            exchange.sendResponseHeaders(200, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }
        fakeApiServer.start()

        val apiBase = "http://127.0.0.1:${fakeApiServer.address.port}"
        val executor = Executors.newSingleThreadExecutor()

        try {
            val oauth = OpenRouterOAuth(
                authBase = apiBase,
                apiBase = apiBase,
                timeoutMs = 5000L,
                onOpenUrl = { authUrl ->
                    executor.submit {
                        val uri = URI.create(authUrl)
                        val callbackUrl = parseQueryParam(uri.query, "callback_url")!!
                        val client = HttpClient.newHttpClient()

                        // 1. Yanlış yol -> 400
                        val wrongPath = callbackUrl.replace("/callback", "/unknown") + "?code=test"
                        val r1 = client.send(
                            HttpRequest.newBuilder().uri(URI.create(wrongPath)).GET().build(),
                            HttpResponse.BodyHandlers.ofString(Charsets.UTF_8)
                        )
                        assertEquals(400, r1.statusCode())

                        // 2. Kodsuz istek -> 400
                        val r2 = client.send(
                            HttpRequest.newBuilder().uri(URI.create(callbackUrl)).GET().build(),
                            HttpResponse.BodyHandlers.ofString(Charsets.UTF_8)
                        )
                        assertEquals(400, r2.statusCode())

                        // 3. Geçerli istek -> 200
                        val validUrl = "$callbackUrl?code=valid-code-after-retries"
                        val r3 = client.send(
                            HttpRequest.newBuilder().uri(URI.create(validUrl)).GET().build(),
                            HttpResponse.BodyHandlers.ofString(Charsets.UTF_8)
                        )
                        assertEquals(200, r3.statusCode())
                    }
                }
            )

            val key = oauth.authorize()
            assertEquals("sk-recovered-key", key)
        } finally {
            fakeApiServer.stop(0)
            executor.shutdownNow()
        }
    }

    @Test
    fun timeoutClosesServerAndReleasesPort() {
        val capturedPort = AtomicReference<Int>()

        val oauth = OpenRouterOAuth(
            authBase = "http://127.0.0.1:9",
            apiBase = "http://127.0.0.1:9",
            timeoutMs = 150L,
            onOpenUrl = { authUrl ->
                val uri = URI.create(authUrl)
                val callbackUrl = parseQueryParam(uri.query, "callback_url")!!
                val callbackUri = URI.create(callbackUrl)
                capturedPort.set(callbackUri.port)
            }
        )

        val ex = assertFailsWith<IllegalStateException> {
            oauth.authorize()
        }
        assertTrue(ex.message?.contains("zaman aşımına") == true, "Zaman aşımı hatası olmalı")

        val port = capturedPort.get()
        assertNotNull(port)

        // Port serbest kalmış olmalı: aynı porta yeniden bağlanılabilmeli
        val socket = ServerSocket(port)
        socket.close()
    }

    @Test
    fun exchange401ThrowsClearExceptionWithoutLeakingSecrets() {
        val fakeApiServer = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        fakeApiServer.createContext("/api/v1/auth/keys") { exchange ->
            exchange.sendResponseHeaders(401, -1)
            exchange.close()
        }
        fakeApiServer.start()

        val apiBase = "http://127.0.0.1:${fakeApiServer.address.port}"
        val executor = Executors.newSingleThreadExecutor()

        try {
            val oauth = OpenRouterOAuth(
                authBase = apiBase,
                apiBase = apiBase,
                timeoutMs = 5000L,
                onOpenUrl = { authUrl ->
                    executor.submit {
                        val uri = URI.create(authUrl)
                        val callbackUrl = parseQueryParam(uri.query, "callback_url")!!
                        val client = HttpClient.newHttpClient()
                        client.send(
                            HttpRequest.newBuilder().uri(URI.create("$callbackUrl?code=invalid-code")).GET().build(),
                            HttpResponse.BodyHandlers.ofString(Charsets.UTF_8)
                        )
                    }
                }
            )

            val ex = assertFailsWith<IllegalStateException> {
                oauth.authorize()
            }
            assertTrue(ex.message?.contains("401") == true, "401 hatası belirtilmeli")
        } finally {
            fakeApiServer.stop(0)
            executor.shutdownNow()
        }
    }
}
