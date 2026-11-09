package io.github.saldraykee22.popi.secrets

/**
 * Anahtarların (API key vb.) güvenli saklanması için ortak depo arayüzü.
 */
interface SecretStore {
    fun put(name: String, value: String)
    fun get(name: String): String?
    fun delete(name: String)
    fun names(): List<String>

    companion object {
        private val NAME_REGEX = Regex("^[a-z0-9-]{1,64}$")

        fun validateName(name: String) {
            if (!NAME_REGEX.matches(name)) {
                throw IllegalArgumentException(
                    "Geçersiz anahtar adı: '$name'. Anahtar adı yalnızca [a-z0-9-] karakterleri içerebilir ve 1 ile 64 karakter arasında olmalıdır."
                )
            }
        }

        fun isValidName(name: String): Boolean = NAME_REGEX.matches(name)
    }
}
