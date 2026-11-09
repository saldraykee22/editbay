package io.github.saldraykee22.popi.secrets

/**
 * OAuth 2.0 PKCE (RFC 7636) yardımcı işlevleri.
 */
object Pkce {
    private const val MIN_VERIFIER_LENGTH = 43
    private const val MAX_VERIFIER_LENGTH = 128

    /**
     * Rastgele bayt dizisinden RFC 7636 uyumlu dolgusuz Base64URL code_verifier üretir.
     * Çıktı uzunluğu 43 ile 128 karakter arasında olmalıdır.
     */
    fun verifier(random: ByteArray): String {
        val encoded = Base64Url.encode(random)
        if (encoded.length !in MIN_VERIFIER_LENGTH..MAX_VERIFIER_LENGTH) {
            throw IllegalArgumentException(
                "Verifier uzunluğu $MIN_VERIFIER_LENGTH ile $MAX_VERIFIER_LENGTH karakter arasında olmalıdır (üretilen: ${encoded.length})."
            )
        }
        return encoded
    }

    /**
     * Verilen code_verifier için S256 code_challenge üretir (BASE64URL-ENCODE(SHA256(ASCII(verifier))), dolgusuz).
     */
    fun challenge(verifier: String): String {
        if (verifier.length !in MIN_VERIFIER_LENGTH..MAX_VERIFIER_LENGTH) {
            throw IllegalArgumentException(
                "Verifier uzunluğu $MIN_VERIFIER_LENGTH ile $MAX_VERIFIER_LENGTH karakter arasında olmalıdır (verilen: ${verifier.length})."
            )
        }
        val isUnreserved = verifier.all { c ->
            (c in 'A'..'Z') || (c in 'a'..'z') || (c in '0'..'9') ||
                    c == '-' || c == '.' || c == '_' || c == '~'
        }
        if (!isUnreserved) {
            throw IllegalArgumentException("Verifier yalnızca RFC 7636 unreserved karakterlerini içerebilir.")
        }

        val shaBytes = Sha256.digest(verifier.encodeToByteArray())
        return Base64Url.encode(shaBytes)
    }
}
