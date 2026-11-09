package io.github.saldraykee22.popi.desktop

import io.github.saldraykee22.popi.ai.LlmRequest
import io.github.saldraykee22.popi.ai.LlmTransport
import io.github.saldraykee22.popi.desktop.ai.LlmTransportFactory
import io.github.saldraykee22.popi.secrets.SecretStore

/** Ağa çıkmayan, bellek içi anahtar deposu. */
internal class InMemorySecretStore : SecretStore {
    private val values = LinkedHashMap<String, String>()

    override fun put(name: String, value: String) {
        SecretStore.validateName(name)
        values[name] = value
    }

    override fun get(name: String): String? = values[name]

    override fun delete(name: String) {
        values.remove(name)
    }

    override fun names(): List<String> = values.keys.sorted()
}

/** Her çağrıda aynı yanıtı dönen sahte model taşıması. */
internal class FakeTransport(private val response: String) : LlmTransport {
    override fun complete(request: LlmRequest): String = response
}

/** Sabit yanıt üreten taşıma fabrikası. */
internal fun fakeTransportFactory(response: String): LlmTransportFactory =
    LlmTransportFactory { _, _, _ -> FakeTransport(response) }
