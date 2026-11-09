package io.github.saldraykee22.popi.secrets

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class PkceTest {

    @Test
    fun rfc7636AppendixBVector() {
        val verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
        // Resmî IETF RFC 7636 Ek B standardı test vektörü:
        val expectedChallenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"

        val actualChallenge = Pkce.challenge(verifier)
        assertEquals(expectedChallenge, actualChallenge)
    }

    @Test
    fun verifierLengthBoundaries() {
        // 32 bayt girdi -> 43 karakter (en küçük geçerli)
        val minBytes = ByteArray(32) { (it + 1).toByte() }
        val minVerifier = Pkce.verifier(minBytes)
        assertEquals(43, minVerifier.length)

        // 96 bayt girdi -> 128 karakter (en büyük geçerli)
        val maxBytes = ByteArray(96) { (it + 1).toByte() }
        val maxVerifier = Pkce.verifier(maxBytes)
        assertEquals(128, maxVerifier.length)

        // 16 bayt girdi -> 22 karakter (< 43, geçersiz)
        val tooShortBytes = ByteArray(16) { 0x42.toByte() }
        assertFailsWith<IllegalArgumentException> {
            Pkce.verifier(tooShortBytes)
        }

        // 100 bayt girdi -> 134 karakter (> 128, geçersiz)
        val tooLongBytes = ByteArray(100) { 0x42.toByte() }
        assertFailsWith<IllegalArgumentException> {
            Pkce.verifier(tooLongBytes)
        }
    }

    @Test
    fun verifierCharacterSetAndNoPadding() {
        val bytes = ByteArray(32) { (it * 7).toByte() }
        val verifier = Pkce.verifier(bytes)

        assertFalse(verifier.contains("="), "Dolgusuz olmalı, '=' bulunamaz")
        assertFalse(verifier.contains("+"), "URL safe olmalı, '+' bulunamaz")
        assertFalse(verifier.contains("/"), "URL safe olmalı, '/' bulunamaz")

        val allowedChars = (('A'..'Z') + ('a'..'z') + ('0'..'9') + listOf('-', '.', '_', '~')).toSet()
        assertTrue(verifier.all { it in allowedChars }, "RFC 7636 unreserved karakter kümesinde olmalı")
    }

    @Test
    fun challengeRejectsInvalidVerifier() {
        // 43 karakterden kısa
        assertFailsWith<IllegalArgumentException> {
            Pkce.challenge("too-short")
        }

        // 128 karakterden uzun
        assertFailsWith<IllegalArgumentException> {
            Pkce.challenge("a".repeat(129))
        }

        // Geçersiz karakterler (boşluk, +, /)
        val invalidChars = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r+wW1gFWFOEjXk" // '+' içeriyor
        assertFailsWith<IllegalArgumentException> {
            Pkce.challenge(invalidChars)
        }
    }
}
