package io.github.saldraykee22.popi.ai

import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.charset.StandardCharsets
import java.time.Duration

/** Sağlayıcı istemcilerinin ortak HTTP gönderimi ve durum kodu eşlemesi. */
internal object HttpSupport {
    fun client(timeout: Duration): HttpClient = HttpClient.newBuilder()
        .connectTimeout(timeout)
        .build()

    /** İsteği gönderir; 2xx dışı durumlar [ProviderError]'a çevrilir. */
    fun send(client: HttpClient, request: HttpRequest): String {
        val response = try {
            client.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8))
        } catch (e: java.net.http.HttpTimeoutException) {
            throw ProviderError.Other("İstek zaman aşımına uğradı", e)
        } catch (e: java.io.IOException) {
            throw ProviderError.Other("Ağ hatası", e)
        } catch (e: InterruptedException) {
            Thread.currentThread().interrupt()
            throw ProviderError.Other("İstek kesildi", e)
        }
        return when (response.statusCode()) {
            in 200..299 -> response.body()
            401, 403 -> throw ProviderError.Auth()
            429 -> throw ProviderError.RateLimited()
            else -> throw ProviderError.Other("Sağlayıcı hatası: HTTP ${response.statusCode()}")
        }
    }
}
