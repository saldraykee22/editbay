package io.github.saldraykee22.popi.secrets

import kotlin.test.Test
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SecretStoreTest {

    @Test
    fun validNamesPass() {
        val validList = listOf(
            "a",
            "openrouter",
            "gemini-api-key",
            "k-1",
            "0-test",
            "a".repeat(64),
            "abc-123-xyz"
        )
        for (name in validList) {
            assertTrue(SecretStore.isValidName(name), "Geçerli olmalı: $name")
            SecretStore.validateName(name)
        }
    }

    @Test
    fun invalidNamesFail() {
        val invalidList = listOf(
            "", // boş
            "a".repeat(65), // 64 karakterden uzun
            "OpenRouter", // büyük harf
            "open_router", // alt çizgi
            "key.name", // nokta
            "../secret", // yol kaçışı
            "..\\secret", // Windows yol kaçışı
            "foo/bar", // slaş
            "key space", // boşluk
            "key@123", // özel karakter
            "türkçe-anahtar" // ASCII dışı
        )
        for (name in invalidList) {
            assertFalse(SecretStore.isValidName(name), "Geçersiz olmalı: $name")
            assertFailsWith<IllegalArgumentException>("Geçersiz isim hata fırlatmalı: $name") {
                SecretStore.validateName(name)
            }
        }
    }
}
