package io.github.saldraykee22.popi.desktop.secrets

import com.sun.jna.Platform
import com.sun.jna.platform.win32.Crypt32Util
import io.github.saldraykee22.popi.secrets.SecretStore
import java.io.File
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption

/**
 * Windows DPAPI (CryptProtectData / CryptUnprotectData) tabanlı güvenli anahtar deposu.
 */
class DpapiSecretStore(
    val dir: File = defaultDir()
) : SecretStore {

    init {
        checkWindows()
    }

    override fun put(name: String, value: String) {
        checkWindows()
        SecretStore.validateName(name)
        if (!dir.exists()) {
            dir.mkdirs()
        }

        val plainBytes = value.toByteArray(Charsets.UTF_8)
        val encryptedBytes = try {
            Crypt32Util.cryptProtectData(plainBytes)
        } catch (e: Exception) {
            throw IllegalStateException("Veri DPAPI ile şifrelenemedi: '$name'", e)
        }

        val targetFile = File(dir, "$name.bin")
        val tempFile = File.createTempFile("secret-", ".tmp", dir)
        try {
            tempFile.writeBytes(encryptedBytes)
            try {
                Files.move(
                    tempFile.toPath(),
                    targetFile.toPath(),
                    StandardCopyOption.REPLACE_EXISTING,
                    StandardCopyOption.ATOMIC_MOVE
                )
            } catch (_: AtomicMoveNotSupportedException) {
                Files.move(
                    tempFile.toPath(),
                    targetFile.toPath(),
                    StandardCopyOption.REPLACE_EXISTING
                )
            }
        } finally {
            if (tempFile.exists()) {
                tempFile.delete()
            }
        }
    }

    override fun get(name: String): String? {
        checkWindows()
        SecretStore.validateName(name)
        val file = File(dir, "$name.bin")
        if (!file.exists() || !file.isFile) {
            return null
        }

        val encryptedBytes = file.readBytes()
        return try {
            val decryptedBytes = Crypt32Util.cryptUnprotectData(encryptedBytes)
            decryptedBytes.toString(Charsets.UTF_8)
        } catch (e: Exception) {
            throw IllegalStateException("Anahtar verisi çözülemedi veya dosya bozuk: '$name'", e)
        }
    }

    override fun delete(name: String) {
        checkWindows()
        SecretStore.validateName(name)
        val file = File(dir, "$name.bin")
        if (file.exists()) {
            file.delete()
        }
    }

    override fun names(): List<String> {
        checkWindows()
        if (!dir.exists() || !dir.isDirectory) return emptyList()
        val files = dir.listFiles { f -> f.isFile && f.name.endsWith(".bin") } ?: return emptyList()
        return files.map { it.name.removeSuffix(".bin") }
            .filter { SecretStore.isValidName(it) }
            .sorted()
    }

    companion object {
        fun isWindows(): Boolean = Platform.isWindows()

        fun checkWindows() {
            if (!isWindows()) {
                throw UnsupportedOperationException("DPAPI anahtar deposu yalnızca Windows işletim sisteminde desteklenir.")
            }
        }

        fun defaultDir(): File {
            val appData = System.getenv("APPDATA")
                ?: (System.getProperty("user.home") + File.separator + "AppData" + File.separator + "Roaming")
            return File(appData, "Popi" + File.separator + "anahtarlar")
        }
    }
}
