package io.github.saldraykee22.popi.desktop.preview

import io.github.saldraykee22.popi.desktop.DesktopRenderer
import io.github.saldraykee22.popi.desktop.DesktopRendererTest
import io.github.saldraykee22.popi.domain.Asset
import io.github.saldraykee22.popi.domain.Clip
import io.github.saldraykee22.popi.domain.Project
import io.github.saldraykee22.popi.domain.TextItem
import io.github.saldraykee22.popi.domain.Track
import java.io.ByteArrayOutputStream
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.abs
import kotlin.math.log10
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class PreviewEngineTest {

    @Test
    fun parityGateMatchesExportAtOneAndFiveSeconds() {
        val dir = Files.createTempDirectory("popi-parity-test")
        val first = dir.resolve("first.mp4")
        val second = dir.resolve("second.mp4")
        val music = dir.resolve("music.m4a")
        makeVideo(first, 440)
        makeVideo(second, 660)
        runCommand("ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=6", "-c:a", "aac", music.toString())

        val project = testProject(first, second, music)
        val exportOutput = dir.resolve("export.mp4")
        DesktopRenderer().export(project, exportOutput)

        val engine = PreviewEngine()
        listOf(1_000L, 5_000L).forEach { timeMs ->
            val exportedPng = dir.resolve("export-${timeMs}.png")
            runCommand("ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-ss", "${timeMs / 1000.0}", "-i", exportOutput.toString(), "-frames:v", "1", "-vf", "scale=540:960", exportedPng.toString())
            val expected = javax.imageio.ImageIO.read(exportedPng.toFile())
            val actual = engine.frameAt(project, timeMs)

            val psnrVal = psnr(expected, actual)
            println("Parity test PSNR at ${timeMs}ms: $psnrVal dB")
            assertTrue(psnrVal >= 30.0, "PSNR at ${timeMs}ms must be >= 30.0 dB, was $psnrVal dB")
            assertTrue(!psnrVal.isInfinite(), "PSNR must be finite (demonstrating distinct code paths)")
        }
        engine.close()
    }

    @Test
    fun playbackStreamDeliversFramesUpdatesPositionAndPausesAndSeeks() {
        val dir = Files.createTempDirectory("popi-playback-test")
        val first = dir.resolve("first.mp4")
        val second = dir.resolve("second.mp4")
        val music = dir.resolve("music.m4a")
        makeVideo(first, 440)
        makeVideo(second, 660)
        runCommand("ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=6", "-c:a", "aac", music.toString())

        val project = testProject(first, second, music)
        val engine = PreviewEngine()

        val frameCount = AtomicInteger(0)
        val positions = CopyOnWriteArrayList<Long>()
        val first20Latch = CountDownLatch(20)

        engine.onFrame = { _, _ ->
            frameCount.incrementAndGet()
            first20Latch.countDown()
        }
        engine.onPosition = { ms ->
            positions.add(ms)
        }

        // 1. play başlat
        engine.play(project, 0L)
        val reached20 = first20Latch.await(1500, TimeUnit.MILLISECONDS)
        assertTrue(reached20, "1,5 sn içinde en az 20 kare gelmeli, gelen kare: ${frameCount.get()}")
        assertTrue(positions.size >= 20, "onPosition en az 20 kez tetiklenmeli")
        assertTrue(positions.last() > positions.first(), "onPosition zaman içinde artmalı")

        // 2. pause çağrısı
        engine.pause()
        val countAtPause = frameCount.get()
        Thread.sleep(400)
        val countAfterWait = frameCount.get()
        assertEquals(countAtPause, countAfterWait, "pause sonrası yeni kare gelmemeli")

        // 3. seek(4000) çağrısı
        val seekLatch = CountDownLatch(1)
        val seekFirstFrameMs = AtomicLong(-1L)
        engine.onFrame = { _, ms ->
            if (seekFirstFrameMs.compareAndSet(-1L, ms)) {
                seekLatch.countDown()
            }
        }

        engine.seek(4000L)
        val seekSuccess = seekLatch.await(2000, TimeUnit.MILLISECONDS)
        assertTrue(seekSuccess, "seek(4000) sonrası kare gelmeli")
        val diff = abs(seekFirstFrameMs.get() - 4000L)
        assertTrue(diff <= 100L, "seek(4000) sonrası ilk kare 4000 ± 100 ms olmalı, gelen: ${seekFirstFrameMs.get()} ms (fark: $diff ms)")

        engine.close()
    }

    @Test
    fun audioStreamHookCapturesPcmAndVerifiesAudioBand() {
        val dir = Files.createTempDirectory("popi-audio-hook-test")
        val first = dir.resolve("first.mp4")
        val second = dir.resolve("second.mp4")
        val music = dir.resolve("music.m4a")
        makeVideo(first, 440)
        makeVideo(second, 660)
        runCommand("ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=6", "-c:a", "aac", music.toString())

        val project = testProject(first, second, music)
        val engine = PreviewEngine()

        val audioStream = ByteArrayOutputStream()
        val collectedBytesLatch = CountDownLatch(1)

        engine.audioDataHook = { bytes, offset, len ->
            synchronized(audioStream) {
                if (audioStream.size() < 48000 * 4 * 2) { // ~2 sn ses topla
                    audioStream.write(bytes, offset, len)
                    if (audioStream.size() >= 48000 * 4) {
                        collectedBytesLatch.countDown()
                    }
                }
            }
        }

        engine.play(project, 0L)
        val captured = collectedBytesLatch.await(3000, TimeUnit.MILLISECONDS)
        engine.pause()
        assertTrue(captured, "Ses kancası yeterli PCM baytı yakalayamadı")

        val capturedBytes = synchronized(audioStream) { audioStream.toByteArray() }
        // 48000 Hz 16-bit stereo: 48000 * 4 bayt/sn. 1. saniyedeki 1 saniyelik bloğu (veya ilk saniyeyi) çıkar
        val monoSamples = ShortArray(capturedBytes.size / 4) { i ->
            val left = ((capturedBytes[i * 4 + 1].toInt() shl 8) or (capturedBytes[i * 4].toInt() and 0xFF)).toShort()
            val right = ((capturedBytes[i * 4 + 3].toInt() shl 8) or (capturedBytes[i * 4 + 2].toInt() and 0xFF)).toShort()
            ((left + right) / 2).toShort()
        }
        val monoBytes = ByteArray(monoSamples.size * 2) { i ->
            val sample = monoSamples[i / 2]
            if (i % 2 == 0) (sample.toInt() and 0xFF).toByte() else ((sample.toInt() shr 8) and 0xFF).toByte()
        }

        val level440 = DesktopRendererTest.goertzelDb(monoBytes, 440, 48000)
        println("PreviewEngine audio hook 440Hz level: $level440 dBFS")
        assertTrue(level440 >= -50.0, "440 Hz bandı ≥ -50 dB olmalı, ölçülen: $level440 dBFS")

        engine.close()
    }

    @Test
    fun latencyMeasurementLoggedAndUnderTarget() {
        val dir = Files.createTempDirectory("popi-latency-test")
        val c1 = dir.resolve("c1.mp4"); val c2 = dir.resolve("c2.mp4"); val c3 = dir.resolve("c3.mp4")
        val music = dir.resolve("music.m4a")
        makeVideo(c1, 440); makeVideo(c2, 550); makeVideo(c3, 660)
        runCommand("ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=9", "-c:a", "aac", music.toString())

        val project = Project(
            assets = listOf(
                Asset("v1", "video", c1.toUri().toString(), 3000),
                Asset("v2", "video", c2.toUri().toString(), 3000),
                Asset("v3", "video", c3.toUri().toString(), 3000),
                Asset("m", "audio", music.toUri().toString(), 9000),
            ),
            tracks = listOf(
                Track("v1", "video", listOf(Clip("c1", "v1", 0, 3000), Clip("c2", "v2", 0, 3000), Clip("c3", "v3", 0, 3000))),
                Track("t1", "text", items = listOf(TextItem("t1", "Popi Gecikme Testi", 0, 3000))),
                Track("m1", "audio", clips = listOf(Clip("m1", "m", 0, 9000, 0.4f))),
            )
        )

        val engine = PreviewEngine()

        // 1. frameAt latency ölçümü
        val frameAtStart = System.nanoTime()
        val frame = engine.frameAt(project, 1500L)
        val frameAtLatencyMs = (System.nanoTime() - frameAtStart) / 1_000_000
        assertEquals(540, frame.width)
        assertEquals(960, frame.height)
        println("MEASURED frameAt latency: $frameAtLatencyMs ms (hedef <= 400 ms)")

        // 2. play to first frame latency ölçümü
        val firstFrameLatch = CountDownLatch(1)
        val playStart = System.nanoTime()
        val firstFrameDelivery = AtomicLong(0L)
        engine.onFrame = { _, _ ->
            if (firstFrameDelivery.compareAndSet(0L, System.nanoTime())) {
                firstFrameLatch.countDown()
            }
        }
        engine.play(project, 0L)
        val delivered = firstFrameLatch.await(3000, TimeUnit.MILLISECONDS)
        engine.pause()
        assertTrue(delivered, "play sonrası ilk kare gelmedi")
        val playLatencyMs = (firstFrameDelivery.get() - playStart) / 1_000_000
        println("MEASURED play to first frame latency: $playLatencyMs ms (hedef <= 400 ms)")

        assertTrue(frameAtLatencyMs <= 400, "frameAt latency <= 400 ms olmalı, ölçülen: $frameAtLatencyMs ms")
        assertTrue(playLatencyMs <= 400, "play to first frame latency <= 400 ms olmalı, ölçülen: $playLatencyMs ms")

        engine.close()
    }

    @Test
    fun noProcessLeakAfterPlaybackAndSeek() {
        val dir = Files.createTempDirectory("popi-leak-test")
        val first = dir.resolve("first.mp4")
        val second = dir.resolve("second.mp4")
        val music = dir.resolve("music.m4a")
        makeVideo(first, 440)
        makeVideo(second, 660)
        runCommand("ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=6", "-c:a", "aac", music.toString())

        val project = testProject(first, second, music)
        val engine = PreviewEngine()

        engine.play(project, 0L)
        Thread.sleep(500)
        engine.seek(2000L)
        Thread.sleep(300)
        engine.pause()
        engine.seek(4000L)
        engine.close()

        // Süreç sızıntısı kontrolü: engine kapandıktan sonra aktif ffmpeg süreci kalmamalı
        Thread.sleep(500)
        // ProcessHandle üzerinden ffmpeg komutuna sahip olup bu süreçte açılmış olanları doğrula
        val aliveFfmpegChildren = ProcessHandle.current().children().filter { child ->
            child.isAlive && child.info().command().orElse("").contains("ffmpeg")
        }.toList()

        assertTrue(aliveFfmpegChildren.isEmpty(), "Engine kapandıktan sonra sızan FFmpeg süreci bulundu: $aliveFfmpegChildren")
    }

    private fun testProject(first: Path, second: Path, music: Path) = Project(
        assets = listOf(
            Asset("v1", "video", first.toUri().toString(), 3000),
            Asset("v2", "video", second.toUri().toString(), 3000),
            Asset("music", "audio", music.toUri().toString(), 6000)
        ),
        tracks = listOf(
            Track("v1", "video", listOf(Clip("c1", "v1", 0, 3000), Clip("c2", "v2", 0, 3000))),
            Track("t1", "text", items = listOf(TextItem("text1", "Merhaba Dunya", 0, 1500))),
            Track("m1", "audio", clips = listOf(Clip("a1", "music", 0, 6000, 0.3f))),
        ),
    )

    private fun makeVideo(path: Path, frequency: Int) {
        runCommand("ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=3", "-f", "lavfi", "-i", "sine=frequency=$frequency:duration=3", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", path.toString())
    }

    private fun psnr(expected: java.awt.image.BufferedImage, actual: java.awt.image.BufferedImage): Double {
        assertEquals(540, actual.width); assertEquals(960, actual.height)
        assertEquals(expected.width, actual.width); assertEquals(expected.height, actual.height)
        var squared = 0.0
        for (y in 0 until actual.height) for (x in 0 until actual.width) {
            val a = expected.getRGB(x, y); val b = actual.getRGB(x, y)
            for (shift in listOf(0, 8, 16)) { val d = ((a shr shift) and 255) - ((b shr shift) and 255); squared += d.toDouble() * d }
        }
        val mse = squared / (actual.width.toLong() * actual.height * 3)
        return if (mse == 0.0) Double.POSITIVE_INFINITY else 10.0 * log10(255.0 * 255.0 / mse)
    }

    private fun runCommand(vararg args: String): String {
        val p = ProcessBuilder(*args).redirectErrorStream(true).start()
        val text = p.inputStream.bufferedReader().use { it.readText() }
        val code = p.waitFor()
        check(code == 0) { "${args.first()} failed ($code): $text" }
        return text.trim()
    }
}
