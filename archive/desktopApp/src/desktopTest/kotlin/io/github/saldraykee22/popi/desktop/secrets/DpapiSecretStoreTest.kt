package io.github.saldraykee22.popi.desktop.secrets

import org.junit.jupiter.api.Assumptions.assumeTrue
import java.io.File
import java.nio.file.Files
import kotlin.test.*

class DpapiSecretStoreTest {

    private fun isWindows(): Boolean = DpapiSecretStore.isWindows()

    @Test
    fun putGetDeleteAndNamesFlow() {
        assumeTrue(isWindows(), "Bu test yalnızca Windows işletim sisteminde çalışır.")

        val tempDir = Files.createTempDirectory("popi-secrets-test").toFile()
        try {
            val store = DpapiSecretStore(tempDir)

            assertTrue(store.names().isEmpty())
            assertNull(store.get("non-existent"))

            store.put("token-alpha", "sk-alpha-123")
            store.put("token-beta", "sk-beta-456")

            assertEquals("sk-alpha-123", store.get("token-alpha"))
            assertEquals("sk-beta-456", store.get("token-beta"))
            assertEquals(listOf("token-alpha", "token-beta"), store.names())

            store.delete("token-alpha")
            assertNull(store.get("token-alpha"))
            assertEquals(listOf("token-beta"), store.names())

            store.delete("token-beta")
            assertNull(store.get("token-beta"))
            assertTrue(store.names().isEmpty())
        } finally {
            tempDir.deleteRecursively()
        }
    }

    @Test
    fun noPlainTextStoredInFile() {
        assumeTrue(isWindows(), "Bu test yalnızca Windows işletim sisteminde çalışır.")

        val tempDir = Files.createTempDirectory("popi-secrets-plaintext").toFile()
        try {
            val store = DpapiSecretStore(tempDir)
            val secretValue = "super-confidential-api-token-987654321"
            store.put("test-token", secretValue)

            val file = File(tempDir, "test-token.bin")
            assertTrue(file.exists(), "Dosya oluşturulmuş olmalı")

            val rawBytes = file.readBytes()
            val rawString = String(rawBytes, Charsets.ISO_8859_1)

            assertFalse(rawString.contains(secretValue), "Şifrelenmiş dosya düz metin içermemeli")
            assertFalse(rawBytes.decodeToString().contains(secretValue), "UTF-8 çözümlemede düz metin bulunmamalı")
        } finally {
            tempDir.deleteRecursively()
        }
    }

    @Test
    fun corruptedFileThrowsClearException() {
        assumeTrue(isWindows(), "Bu test yalnızca Windows işletim sisteminde çalışır.")

        val tempDir = Files.createTempDirectory("popi-secrets-corrupted").toFile()
        try {
            val store = DpapiSecretStore(tempDir)
            val corruptFile = File(tempDir, "corrupted-key.bin")
            corruptFile.writeBytes(byteArrayOf(0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08))

            val ex = assertFailsWith<IllegalStateException> {
                store.get("corrupted-key")
            }
            assertTrue(ex.message?.contains("corrupted-key") == true, "Hata mesajında anahtar adı yer almalı")
        } finally {
            tempDir.deleteRecursively()
        }
    }

    @Test
    fun invalidNamesAreRejected() {
        assumeTrue(isWindows(), "Bu test yalnızca Windows işletim sisteminde çalışır.")

        val tempDir = Files.createTempDirectory("popi-secrets-invalid").toFile()
        try {
            val store = DpapiSecretStore(tempDir)

            assertFailsWith<IllegalArgumentException> { store.put("../escape", "value") }
            assertFailsWith<IllegalArgumentException> { store.put("UPPERCASE", "value") }
            assertFailsWith<IllegalArgumentException> { store.put("invalid_name", "value") }
            assertFailsWith<IllegalArgumentException> { store.get("..\\escape") }
            assertFailsWith<IllegalArgumentException> { store.delete("invalid/slash") }
        } finally {
            tempDir.deleteRecursively()
        }
    }
}
