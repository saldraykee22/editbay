package io.github.saldraykee22.popi.desktop.secrets

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import io.github.saldraykee22.popi.secrets.OpenRouterAuthJson
import io.github.saldraykee22.popi.secrets.Pkce
import java.net.InetSocketAddress
import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.security.SecureRandom
import java.time.Duration
import java.util.concurrent.CancellationException
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/**
 * OpenRouter OAuth PKCE akışı yöneticisi.
 */
class OpenRouterOAuth(
    private val authBase: String = "https://openrouter.ai",
    private val apiBase: String = "https://openrouter.ai",
    private val timeoutMs: Long = 300_000L,
    private val onOpenUrl: (String) -> Unit = {}
) {
    @Volatile
    private var currentServer: HttpServer? = null
    private var currentPromise: CompletableFuture<String>? = null

    /**
     * OAuth akışını başlatır, yerel geri dönüş sunucusunu açar, yetki bağlantısını tarayıcıya iletir
     * ve kodu API anahtarı ile takas ederek anahtarı döner.
     */
    fun authorize(customVerifier: String? = null): String {
        val verifier = customVerifier ?: run {
            val random = ByteArray(32)
            SecureRandom().nextBytes(random)
            Pkce.verifier(random)
        }
        val challenge = Pkce.challenge(verifier)

        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        currentServer = server
        val port = server.address.port

        val codePromise = CompletableFuture<String>()
        currentPromise = codePromise

        server.createContext("/") { exchange ->
            handleExchange(exchange, codePromise)
        }
        server.start()

        val callbackUrl = "http://127.0.0.1:$port/callback"
        val encodedCallback = URLEncoder.encode(callbackUrl, "UTF-8")
        val authUrl = "$authBase/auth?callback_url=$encodedCallback&code_challenge=$challenge&code_challenge_method=S256"

        try {
            onOpenUrl(authUrl)
        } catch (e: Exception) {
            server.stop(0)
            throw IllegalStateException("Tarayıcı açma geri çağrısı başarısız oldu", e)
        }

        val code = try {
            codePromise.get(timeoutMs, TimeUnit.MILLISECONDS)
        } catch (e: TimeoutException) {
            throw IllegalStateException("OAuth yetkilendirme zaman aşımına uğradı ($timeoutMs ms)", e)
        } catch (e: CancellationException) {
            throw IllegalStateException("OAuth yetkilendirme işlemi iptal edildi", e)
        } finally {
            server.stop(0)
            currentServer = null
            currentPromise = null
        }

        return exchangeCodeForKey(code, verifier)
    }

    /**
     * Bekleyen OAuth akışını iptal eder ve sunucuyu kapatır.
     */
    fun cancel() {
        currentPromise?.cancel(true)
        currentServer?.stop(0)
        currentServer = null
        currentPromise = null
    }

    private fun handleExchange(exchange: HttpExchange, promise: CompletableFuture<String>) {
        try {
            val path = exchange.requestURI.path
            if (path != "/callback") {
                sendResponse(exchange, 400, "Geçersiz istek yolu")
                return
            }

            val query = exchange.requestURI.query
            val code = parseQueryParam(query, "code")
            if (code.isNullOrBlank()) {
                sendResponse(exchange, 400, "Yetkilendirme kodu bulunamadı")
                return
            }

            val html = """
                <!DOCTYPE html>
                <html lang="tr">
                <head>
                    <meta charset="UTF-8">
                    <title>Popi</title>
                </head>
                <body>
                    <p>Bağlantı tamam. Bu sekmeyi kapatabilirsiniz.</p>
                </body>
                </html>
            """.trimIndent()
            sendResponse(exchange, 200, html, contentType = "text/html; charset=UTF-8")
            promise.complete(code)
        } catch (e: Exception) {
            sendResponse(exchange, 500, "Sunucu hatası")
        }
    }

    private fun exchangeCodeForKey(code: String, verifier: String): String {
        val requestBody = OpenRouterAuthJson.createRequestBody(code, verifier)

        val client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(15))
            .build()

        val request = HttpRequest.newBuilder()
            .uri(URI.create("$apiBase/api/v1/auth/keys"))
            .header("Content-Type", "application/json; charset=utf-8")
            .POST(HttpRequest.BodyPublishers.ofString(requestBody, Charsets.UTF_8))
            .timeout(Duration.ofSeconds(30))
            .build()

        val response = client.send(request, HttpResponse.BodyHandlers.ofString(Charsets.UTF_8))
        val status = response.statusCode()

        if (status == 401) {
            throw IllegalStateException("Yetkilendirme reddedildi: Geçersiz kod veya doğrulayıcı (HTTP 401)")
        }

        if (status !in 200..299) {
            throw IllegalStateException("Anahtar takası başarısız oldu (HTTP $status)")
        }

        return OpenRouterAuthJson.extractKey(response.body())
            ?: throw IllegalStateException("API yanıtında 'key' alanı bulunamadı")
    }

    private fun sendResponse(
        exchange: HttpExchange,
        statusCode: Int,
        body: String,
        contentType: String = "text/plain; charset=UTF-8"
    ) {
        val bytes = body.toByteArray(Charsets.UTF_8)
        exchange.responseHeaders.set("Content-Type", contentType)
        exchange.responseHeaders.set("Connection", "close")
        exchange.sendResponseHeaders(statusCode, bytes.size.toLong())
        exchange.responseBody.use { it.write(bytes) }
    }

    private fun parseQueryParam(query: String?, key: String): String? {
        if (query.isNullOrBlank()) return null
        return query.split("&")
            .map { it.split("=", limit = 2) }
            .firstOrNull { it.size == 2 && URLDecoder.decode(it[0], "UTF-8") == key }
            ?.let { URLDecoder.decode(it[1], "UTF-8") }
    }
}
