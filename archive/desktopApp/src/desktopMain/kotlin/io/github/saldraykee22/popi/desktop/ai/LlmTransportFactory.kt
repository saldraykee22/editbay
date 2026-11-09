package io.github.saldraykee22.popi.desktop.ai

import io.github.saldraykee22.popi.ai.GeminiTransport
import io.github.saldraykee22.popi.ai.LlmTransport
import io.github.saldraykee22.popi.ai.OpenRouterTransport

/** Sağlayıcı, model ve anahtardan taşıma katmanı üretir. Testler sahte taşıma enjekte eder. */
fun interface LlmTransportFactory {
    fun create(provider: String, model: String, apiKey: String): LlmTransport
}

/** Gerçek sağlayıcılara bağlanan varsayılan fabrika. Ağ çağrısı yalnız burada yapılır. */
object DefaultLlmTransportFactory : LlmTransportFactory {
    override fun create(provider: String, model: String, apiKey: String): LlmTransport =
        if (provider == AiSettings.PROVIDER_GEMINI) {
            GeminiTransport(apiKey, model)
        } else {
            OpenRouterTransport(apiKey, model)
        }
}
