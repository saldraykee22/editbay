package io.github.saldraykee22.popi.desktop

import io.github.saldraykee22.popi.RenderPreview
import io.github.saldraykee22.popi.RenderRequest
import io.github.saldraykee22.popi.RenderResult
import io.github.saldraykee22.popi.RendererPort
import io.github.saldraykee22.popi.desktop.preview.CompositionGraph
import io.github.saldraykee22.popi.desktop.preview.PreviewEngine
import io.github.saldraykee22.popi.domain.Project
import java.awt.image.BufferedImage
import java.io.IOException
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths

/** JVM renderer that shells out to the user's ffmpeg/ffprobe installation. */
class DesktopRenderer(
    private val ffmpeg: String = "ffmpeg",
    private val ffprobe: String = "ffprobe",
) : RendererPort {
    @Volatile private var activeExport: Process? = null
    private val previewEngine = PreviewEngine(ffmpeg, ffprobe)

    fun cancelExport() {
        activeExport?.destroy()
        activeExport?.let { if (it.isAlive) it.destroyForcibly() }
    }

    override fun preview(project: Project) = RenderPreview(
        project.tracks.firstOrNull { it.kind == "video" }?.clips?.sumOf { it.outMs - it.inMs } ?: 0L,
        project.canvas.w,
        project.canvas.h
    )

    override fun export(request: RenderRequest, onComplete: (Result<RenderResult>) -> Unit) {
        onComplete(runCatching { RenderResult(export(request.project, Paths.get(request.outputPath)).toString()) })
    }

    fun export(project: Project, output: Path): Path = export(project, output) { }

    fun export(project: Project, output: Path, onProgress: (Int) -> Unit): Path {
        require(project.canvas.w == 1080 && project.canvas.h == 1920) { "Desktop export requires 1080x1920 portrait output" }
        ensureTool(ffmpeg)
        ensureTool(ffprobe)

        val graphResult = CompositionGraph.build(
            project = project,
            targetWidth = 1080,
            targetHeight = 1920,
            hasAudio = ::hasAudio,
            fontFile = CompositionGraph.defaultFontFile(),
        )

        output.toAbsolutePath().parent?.toFile()?.mkdirs()
        val command = mutableListOf(ffmpeg, "-y", "-hide_banner", "-loglevel", "error") +
            graphResult.inputArgs +
            listOf(
                "-filter_complex", graphResult.filterGraph,
                "-map", "[${graphResult.videoOutLabel}]",
                "-map", "[${graphResult.audioOutLabel}]",
                "-c:v", "libx264",
                "-pix_fmt", "yuv420p",
                "-c:a", "aac",
                "-movflags", "+faststart",
                "-progress", "pipe:1",
                "-nostats",
                output.toAbsolutePath().toString()
            )

        try {
            runProgress(command, graphResult.totalDurationMs, onProgress)
        } catch (e: Throwable) {
            Files.deleteIfExists(output)
            throw e
        }
        return output.toAbsolutePath()
    }

    /** Exact composition frame used by the desktop preview and by the parity gate. */
    fun previewFrame(project: Project, timeMs: Long): BufferedImage {
        return previewEngine.frameAt(project, timeMs)
    }

    private fun hasAudio(path: Path): Boolean {
        val result = runChecked(
            listOf(ffprobe, "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", path.toString()),
            "ffprobe"
        )
        return result.isNotBlank()
    }

    private fun ensureTool(tool: String) {
        try {
            val p = ProcessBuilder(tool, "-version").redirectErrorStream(true).start()
            if (!p.waitFor().let { it == 0 }) throw IllegalStateException("Could not run $tool from PATH")
        } catch (e: IOException) {
            throw IllegalStateException("$tool was not found. Install ffmpeg and ffprobe and add them to PATH.", e)
        }
    }

    private fun runProgress(args: List<String>, durationMs: Long, onProgress: (Int) -> Unit) {
        val process = ProcessBuilder(args).redirectErrorStream(true).start()
        activeExport = process
        try {
            process.inputStream.bufferedReader().useLines { lines ->
                lines.forEach { line ->
                    if (line.startsWith("out_time_ms=")) {
                        val elapsed = line.substringAfter('=').toLongOrNull() ?: 0L
                        onProgress(((elapsed * 100 / (durationMs * 1000).coerceAtLeast(1)).toInt()).coerceIn(0, 99))
                    }
                }
            }
            val exit = process.waitFor()
            check(exit == 0) { "ffmpeg export başarısız (exit=$exit)" }
            onProgress(100)
        } finally {
            if (activeExport === process) activeExport = null
        }
    }

    private fun runChecked(args: List<String>, action: String): String {
        try {
            val process = ProcessBuilder(args).redirectErrorStream(true).start()
            val output = process.inputStream.bufferedReader().use { it.readText() }
            val exit = process.waitFor()
            check(exit == 0) { "$action başarısız (exit=$exit): $output\nKomut: ${args.joinToString(" ")}" }
            return output.trim()
        } catch (e: IOException) {
            throw IllegalStateException("Could not start $action. ffmpeg and ffprobe must be on PATH.", e)
        }
    }
}
