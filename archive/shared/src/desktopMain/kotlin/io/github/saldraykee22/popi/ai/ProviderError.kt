package io.github.saldraykee22.popi.ai

/**
 * Sağlayıcı isteğinde oluşan hatalar.
 *
 * Mesajlar API anahtarını içermez; anahtar hiçbir hataya ya da loga yazılmaz.
 */
sealed class ProviderError(message: String, cause: Throwable? = null) : Exception(message, cause) {
    /** 401 / 403: anahtar geçersiz ya da yetki yok. */
    class Auth : ProviderError("Sağlayıcı kimlik doğrulaması başarısız oldu")

    /** 429: hız sınırı. */
    class RateLimited : ProviderError("Sağlayıcı hız sınırına takıldı")

    /** Diğer HTTP hataları, ağ hatası ya da zaman aşımı. */
    class Other(message: String, cause: Throwable? = null) : ProviderError(message, cause)
}
