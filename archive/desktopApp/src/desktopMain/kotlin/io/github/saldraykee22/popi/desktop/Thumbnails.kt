package io.github.saldraykee22.popi.desktop

import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.res.loadImageBitmap
import io.github.saldraykee22.popi.desktop.ui.MediaThumbnailSource
import io.github.saldraykee22.popi.domain.Asset
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.URI
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.util.Locale
import kotlin.math.abs

/**
 * Video karesi ve ses dalga formu üretir. Sonuçlar [cacheDir] altında saklanır; anahtar yolun,
 * boyutun ve değiştirilme zamanının özetidir. FFmpeg çağrısı [execute] üzerinden yapılır,
 * böylece testler çağrı sayısını doğrulayabilir.
 */
class Thumbnails(
    private val cacheDir: Path,
    private val ffmpeg: String = "ffmpeg",
    private val execute: (List<String>) -> ByteArray = { args -> runFfmpeg(ffmpeg, args) },
) {
    private val lock = Any()

    /** Videonun 1. saniyesinden (kısaysa ortasından) 160 px genişliğinde PNG kare. */
    fun frame(source: Path, durationMs: Long): Path {
        require(Files.isRegularFile(source)) { "Kaynak dosya yok: $source" }
        synchronized(lock) { return frameLocked(source, durationMs) }
    }

    /** Ses kaynağının tepe değerleri: [buckets] nokta, 0 ile 1 arasında. */
    fun waveform(source: Path, buckets: Int = WAVEFORM_POINTS): FloatArray {
        require(buckets > 0) { "Nokta sayısı pozitif olmalı" }
        require(Files.isRegularFile(source)) { "Kaynak dosya yok: $source" }
        synchronized(lock) { return waveformLocked(source, buckets) }
    }

    private fun frameLocked(source: Path, durationMs: Long): Path {
        val target = cacheDir.resolve("${cacheKey(source)}-kare160.png")
        if (Files.isRegularFile(target)) return target
        Files.createDirectories(cacheDir)
        val seekSeconds = if (durationMs in 1 until 1000) durationMs / 2000.0 else 1.0
        val temporary = cacheDir.resolve("${target.fileName}.${System.nanoTime()}.tmp.png")
        try {
            execute(
                listOf(
                    "-y", "-hide_banner", "-loglevel", "error",
                    "-ss", String.format(Locale.US, "%.3f", seekSeconds),
                    "-i", source.toString(),
                    "-frames:v", "1",
                    "-vf", "scale=160:-2",
                    temporary.toString(),
                ),
            )
            check(Files.isRegularFile(temporary)) { "Kare üretilemedi: $source" }
            moveIntoPlace(temporary, target)
        } finally {
            Files.deleteIfExists(temporary)
        }
        return target
    }

    private fun waveformLocked(source: Path, buckets: Int): FloatArray {
        val target = cacheDir.resolve("${cacheKey(source)}-dalga$buckets.txt")
        if (Files.isRegularFile(target)) {
            val cached = Files.readString(target).split(',').map { it.toFloat() }.toFloatArray()
            if (cached.size == buckets) return cached
        }
        val pcm = execute(
            listOf(
                "-hide_banner", "-loglevel", "error",
                "-i", source.toString(),
                "-vn", "-ac", "1", "-ar", "8000",
                "-f", "s16le", "pipe:1",
            ),
        )
        val peaks = FloatArray(buckets)
        val samples = pcm.size / 2
        for (index in 0 until samples) {
            val low = pcm[index * 2].toInt() and 0xff
            val high = pcm[index * 2 + 1].toInt()
            val sample = ((high shl 8) or low).toShort().toInt()
            val bucket = (index.toLong() * buckets / samples).toInt()
            val peak = abs(sample) / 32768f
            if (peak > peaks[bucket]) peaks[bucket] = peak
        }
        // Önbellekteki değerle birebir aynı sonuç dönsün diye diske yazılan hassasiyete yuvarla.
        for (i in peaks.indices) peaks[i] = String.format(Locale.US, "%.4f", peaks[i]).toFloat()
        Files.createDirectories(cacheDir)
        val temporary = cacheDir.resolve("${target.fileName}.${System.nanoTime()}.tmp")
        try {
            Files.writeString(temporary, peaks.joinToString(",") { String.format(Locale.US, "%.4f", it) })
            moveIntoPlace(temporary, target)
        } finally {
            Files.deleteIfExists(temporary)
        }
        return peaks
    }

    private fun cacheKey(source: Path): String {
        val text = "${source.toAbsolutePath()}|${Files.size(source)}|${Files.getLastModifiedTime(source).toMillis()}"
        return MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8))
            .joinToString("") { String.format(Locale.US, "%02x", it) }
    }

    private fun moveIntoPlace(from: Path, to: Path) {
        try {
            Files.move(from, to, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        } catch (_: java.nio.file.AtomicMoveNotSupportedException) {
            Files.move(from, to, StandardCopyOption.REPLACE_EXISTING)
        }
    }

    companion object {
        const val WAVEFORM_POINTS = 100
    }
}

/** Gerçek FFmpeg çağrısı. Standart çıktıyı döndürür; hata kodunda istisna fırlatır. */
internal fun runFfmpeg(tool: String, args: List<String>): ByteArray {
    val process = ProcessBuilder(listOf(tool) + args)
        .redirectError(ProcessBuilder.Redirect.DISCARD)
        .start()
    val output = process.inputStream.readBytes()
    val code = process.waitFor()
    check(code == 0) { "$tool çıkış kodu $code" }
    return output
}

/** Windows önbellek konumu: %LOCALAPPDATA%\Popi\onbellek. */
fun defaultThumbnailCacheDir(): Path {
    val local = System.getenv("LOCALAPPDATA")?.takeIf(String::isNotBlank)
        ?: Path.of(System.getProperty("user.home"), "AppData", "Local").toString()
    return Path.of(local, "Popi", "onbellek")
}

internal fun Asset.localPath(): Path = if (uri.startsWith("file:")) Paths.get(URI(uri)) else Paths.get(uri)

/** Arayüzün kullandığı küçük resim kaynağı; işler IO iş parçacığında yapılır, arayüz donmaz. */
class DesktopMediaThumbnails(private val thumbnails: Thumbnails) : MediaThumbnailSource {
    override suspend fun frame(asset: Asset): ImageBitmap? = withContext(Dispatchers.IO) {
        runCatching {
            thumbnails.frame(asset.localPath(), asset.durationMs).let { file ->
                Files.newInputStream(file).use { loadImageBitmap(it) }
            }
        }.getOrNull()
    }

    override suspend fun waveform(asset: Asset): List<Float>? = withContext(Dispatchers.IO) {
        runCatching { thumbnails.waveform(asset.localPath()).toList() }.getOrNull()
    }
}
