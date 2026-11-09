package io.github.saldraykee22.popi.desktop.preview

import io.github.saldraykee22.popi.domain.Project
import java.awt.image.BufferedImage
import java.io.Closeable
import java.nio.file.Path
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import javax.sound.sampled.AudioFormat
import javax.sound.sampled.AudioSystem
import javax.sound.sampled.DataLine
import javax.sound.sampled.SourceDataLine

class PreviewEngine(
    private val ffmpeg: String = "ffmpeg",
    private val ffprobe: String = "ffprobe",
    private val fontFile: Path? = CompositionGraph.defaultFontFile(),
) : Closeable {

    var onFrame: ((BufferedImage, Long) -> Unit)? = null
    var onPosition: ((Long) -> Unit)? = null
    var onEnd: (() -> Unit)? = null

    /** Test kancası: Ses hattına giden PCM baytlarını yakalar. */
    var audioDataHook: ((ByteArray, Int, Int) -> Unit)? = null

    @Volatile var isPlaying: Boolean = false
        private set

    @Volatile private var currentProject: Project? = null
    private val currentPositionMs = AtomicLong(0L)

    private val activeProcesses = CopyOnWriteArrayList<Process>()
    @Volatile private var audioLine: SourceDataLine? = null
    @Volatile private var videoThread: Thread? = null
    @Volatile private var audioThread: Thread? = null

    /** Tek kare, oynatmasız. Rawvideo yolundan doğrudan bellekten okunur. */
    fun frameAt(project: Project, ms: Long): BufferedImage {
        val started = System.nanoTime()
        currentProject = project
        val graphResult = CompositionGraph.build(project, 540, 960, ::hasAudio, fontFile)
        val targetMs = ms.coerceIn(0L, graphResult.totalDurationMs.coerceAtLeast(0L))
        val targetTimeSec = CompositionGraph.seconds(targetMs)

        val args = mutableListOf(
            ffmpeg, "-hide_banner", "-loglevel", "error"
        ) + graphResult.inputArgs + listOf(
            "-filter_complex", graphResult.videoFilterGraph,
            "-map", "[${graphResult.videoOutLabel}]",
            "-ss", targetTimeSec,
            "-frames:v", "1",
            "-f", "rawvideo",
            "-pix_fmt", "rgb24",
            "-s", "540x960",
            "pipe:1"
        )

        val process = ProcessBuilder(args).redirectErrorStream(false).start()
        activeProcesses += process
        try {
            val frameSize = 540 * 960 * 3
            val bytes = process.inputStream.readNBytes(frameSize)
            check(bytes.size == frameSize) { "FFmpeg eksik kare döndürdü (${bytes.size} / $frameSize bayt)" }
            val image = rawBytesToImage(bytes, 540, 960)
            val elapsedMs = (System.nanoTime() - started) / 1_000_000
            println("Popi preview frameAt latency: $elapsedMs ms at $ms ms")
            return image
        } finally {
            destroyProcess(process)
            activeProcesses.remove(process)
        }
    }

    /** Önizleme oynatmasını başlatır. */
    @Synchronized
    fun play(project: Project, fromMs: Long = 0L) {
        stopPlaybackInternal()

        currentProject = project
        val graphResult = CompositionGraph.build(project, 540, 960, ::hasAudio, fontFile)
        val totalDuration = graphResult.totalDurationMs
        if (fromMs >= totalDuration && totalDuration > 0) {
            onEnd?.invoke()
            return
        }

        currentPositionMs.set(fromMs)
        isPlaying = true

        val playStartedNanos = System.nanoTime()
        val firstFrameDelivered = AtomicBoolean(false)
        val fromSec = CompositionGraph.seconds(fromMs)

        // Ses süreci
        val audioArgs = mutableListOf(
            ffmpeg, "-hide_banner", "-loglevel", "error"
        ) + graphResult.inputArgs + listOf(
            "-filter_complex", graphResult.audioFilterGraph,
            "-map", "[${graphResult.audioOutLabel}]"
        ) + (if (fromMs > 0) listOf("-ss", fromSec) else emptyList()) + listOf(
            "-f", "s16le",
            "-ar", "48000",
            "-ac", "2",
            "pipe:1"
        )

        // Video süreci
        val videoArgs = mutableListOf(
            ffmpeg, "-hide_banner", "-loglevel", "error"
        ) + graphResult.inputArgs + listOf(
            "-filter_complex", graphResult.videoFilterGraph,
            "-map", "[${graphResult.videoOutLabel}]"
        ) + (if (fromMs > 0) listOf("-ss", fromSec) else emptyList()) + listOf(
            "-f", "rawvideo",
            "-pix_fmt", "rgb24",
            "-s", "540x960",
            "pipe:1"
        )

        val audioProcess = ProcessBuilder(audioArgs).redirectErrorStream(false).start()
        val videoProcess = ProcessBuilder(videoArgs).redirectErrorStream(false).start()
        activeProcesses += audioProcess
        activeProcesses += videoProcess

        // Ses cihazı kurulumu
        val format = AudioFormat(48000f, 16, 2, true, false)
        var line: SourceDataLine? = null
        try {
            val info = DataLine.Info(SourceDataLine::class.java, format)
            if (AudioSystem.isLineSupported(info)) {
                line = AudioSystem.getLine(info) as? SourceDataLine
                line?.open(format, 48000 * 4) // ~1 sn buffer
                line?.start()
            }
        } catch (_: Throwable) {
            line = null
        }
        audioLine = line

        val wallClockStartNanos = System.nanoTime()
        fun getClockMs(): Long {
            val currentLine = audioLine
            return if (currentLine != null && currentLine.isOpen) {
                fromMs + (currentLine.microsecondPosition / 1000L)
            } else {
                fromMs + ((System.nanoTime() - wallClockStartNanos) / 1_000_000L)
            }
        }

        // Ses iş parçacığı
        audioThread = Thread({
            val buffer = ByteArray(4096)
            val input = audioProcess.inputStream
            try {
                while (isPlaying) {
                    val read = input.read(buffer)
                    if (read <= 0) break
                    audioDataHook?.invoke(buffer, 0, read)
                    line?.write(buffer, 0, read)
                }
            } catch (_: Throwable) {
            } finally {
                destroyProcess(audioProcess)
                activeProcesses.remove(audioProcess)
            }
        }, "popi-preview-audio").apply {
            isDaemon = true
            start()
        }

        // Video iş parçacığı
        videoThread = Thread({
            val frameSize = 540 * 960 * 3
            val input = videoProcess.inputStream
            val fps = project.canvas.fps.coerceAtLeast(1)
            val frameIntervalMs = 1000.0 / fps
            var frameIndex = 0L

            try {
                while (isPlaying) {
                    val frameBytes = input.readNBytes(frameSize)
                    if (frameBytes.size < frameSize) break

                    val frameMs = fromMs + (frameIndex * frameIntervalMs).toLong()
                    if (firstFrameDelivered.compareAndSet(false, true)) {
                        val playLatencyMs = (System.nanoTime() - playStartedNanos) / 1_000_000
                        println("Popi preview play latency: $playLatencyMs ms")
                    }

                    // Ses saatine göre senkronizasyon
                    val clockMs = getClockMs()
                    val diff = frameMs - clockMs
                    if (diff > 5) {
                        try {
                            Thread.sleep(diff.coerceAtMost(50))
                        } catch (_: InterruptedException) {
                            break
                        }
                    }

                    val image = rawBytesToImage(frameBytes, 540, 960)
                    if (isPlaying) {
                        currentPositionMs.set(frameMs)
                        onFrame?.invoke(image, frameMs)
                        onPosition?.invoke(frameMs)
                    }

                    frameIndex++
                    if (frameMs >= totalDuration && totalDuration > 0) {
                        break
                    }
                }
            } catch (_: Throwable) {
            } finally {
                destroyProcess(videoProcess)
                activeProcesses.remove(videoProcess)
                if (isPlaying) {
                    isPlaying = false
                    onEnd?.invoke()
                }
            }
        }, "popi-preview-video").apply {
            isDaemon = true
            start()
        }
    }

    /** Oynatmayı duraklatır ve süreçleri temizler. */
    @Synchronized
    fun pause() {
        stopPlaybackInternal()
    }

    /** Belirtilen konuma gider. */
    @Synchronized
    fun seek(ms: Long) {
        val wasPlaying = isPlaying
        val project = currentProject
        stopPlaybackInternal()
        currentPositionMs.set(ms)

        if (project != null) {
            if (wasPlaying) {
                play(project, ms)
            } else {
                val frame = frameAt(project, ms)
                onFrame?.invoke(frame, ms)
                onPosition?.invoke(ms)
            }
        }
    }

    private fun stopPlaybackInternal() {
        isPlaying = false

        audioLine?.let {
            runCatching { it.stop() }
            runCatching { it.flush() }
            runCatching { it.close() }
        }
        audioLine = null

        activeProcesses.forEach { destroyProcess(it) }
        activeProcesses.clear()

        videoThread?.let {
            it.interrupt()
            runCatching { it.join(500) }
        }
        videoThread = null

        audioThread?.let {
            it.interrupt()
            runCatching { it.join(500) }
        }
        audioThread = null
    }

    override fun close() {
        pause()
    }

    private fun destroyProcess(process: Process) {
        runCatching { process.inputStream?.close() }
        runCatching { process.outputStream?.close() }
        runCatching { process.errorStream?.close() }
        process.destroy()
        if (!process.waitFor(200, TimeUnit.MILLISECONDS)) {
            process.destroyForcibly()
        }
    }

    private fun hasAudio(path: Path): Boolean {
        return try {
            val process = ProcessBuilder(
                ffprobe, "-v", "error", "-select_streams", "a",
                "-show_entries", "stream=index", "-of", "csv=p=0", path.toString()
            ).redirectErrorStream(true).start()
            val text = process.inputStream.bufferedReader().use { it.readText() }
            process.waitFor()
            text.isNotBlank()
        } catch (_: Throwable) {
            false
        }
    }

    companion object {
        fun rawBytesToImage(bytes: ByteArray, width: Int, height: Int): BufferedImage {
            val image = BufferedImage(width, height, BufferedImage.TYPE_INT_RGB)
            val pixels = IntArray(width * height)
            var bi = 0
            for (i in pixels.indices) {
                val r = bytes[bi++].toInt() and 0xFF
                val g = bytes[bi++].toInt() and 0xFF
                val b = bytes[bi++].toInt() and 0xFF
                pixels[i] = (r shl 16) or (g shl 8) or b
            }
            image.setRGB(0, 0, width, height, pixels, 0, width)
            return image
        }
    }
}
