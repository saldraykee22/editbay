package io.github.saldraykee22.popi.desktop.preview

import io.github.saldraykee22.popi.domain.Project
import java.net.URI
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import java.util.Locale
import kotlin.math.roundToInt

data class CompositionGraphResult(
    val inputArgs: List<String>,
    val videoFilterGraph: String,
    val audioFilterGraph: String,
    val filterGraph: String,
    val videoOutLabel: String = "vout",
    val audioOutLabel: String = "aout",
    val totalDurationMs: Long,
)

object CompositionGraph {
    fun build(
        project: Project,
        targetWidth: Int = 1080,
        targetHeight: Int = 1920,
        hasAudio: (Path) -> Boolean,
        fontFile: Path? = defaultFontFile(),
    ): CompositionGraphResult {
        val videoTrack = project.tracks.firstOrNull { it.kind == "video" }
            ?: error("Project has no video track")
        require(videoTrack.clips.isNotEmpty()) { "Önce video klip ekleyin" }

        val videoClips = videoTrack.clips
        val videoPaths = videoClips.map { clip ->
            val asset = project.assets.firstOrNull { it.id == clip.assetId }
                ?: error("Missing asset: ${clip.assetId}")
            require(asset.kind == "video") { "Video izi video asset gerektirir: ${asset.id}" }
            resolvePath(asset.uri)
        }

        val inputArgs = mutableListOf<String>()
        videoPaths.forEach { inputArgs += listOf("-i", it.toString()) }

        val music = project.tracks.firstOrNull { it.kind == "audio" }?.clips.orEmpty()
        music.forEach { clip ->
            val asset = project.assets.firstOrNull { it.id == clip.assetId }
                ?: error("Missing asset: ${clip.assetId}")
            require(asset.kind == "audio") { "Ses izi audio asset gerektirir: ${asset.id}" }
            val path = resolvePath(asset.uri)
            inputArgs += listOf("-stream_loop", "-1", "-i", path.toString())
        }

        val totalVideoDurationMs = videoClips.sumOf { it.outMs - it.inMs }
        val scaleFactor = targetWidth.toDouble() / project.canvas.w.coerceAtLeast(1).toDouble()

        val videoGraph = mutableListOf<String>()
        val segmentSeconds = videoClips.map { (it.outMs - it.inMs).also { ms -> require(ms > 0) { "Invalid clip duration" } } }

        videoClips.forEachIndexed { index, clip ->
            val start = seconds(clip.inMs)
            val duration = seconds(segmentSeconds[index])
            videoGraph += "[$index:v:0]trim=start=$start:duration=$duration,setpts=PTS-STARTPTS,scale=$targetWidth:$targetHeight:force_original_aspect_ratio=increase,crop=$targetWidth:$targetHeight,setsar=1,format=yuv420p[v$index]"
        }

        val videoJoin = buildString {
            videoClips.indices.forEach { append("[v$it]") }
            append("concat=n=${videoClips.size}:v=1:a=0[vbase]")
        }
        videoGraph += videoJoin

        var currentVideo = "vbase"
        val textItems = project.tracks.firstOrNull { it.kind == "text" }?.items.orEmpty()
        textItems.forEachIndexed { index, item ->
            val next = if (index == textItems.lastIndex) "vout" else "vtext$index"
            val scaledY = when (item.style.position) {
                "top" -> "${(40 * scaleFactor).roundToInt()}"
                "bottom" -> "h-th-${(40 * scaleFactor).roundToInt()}"
                else -> "(h-th)/2"
            }
            val color = item.style.color.removePrefix("#").let { if (it.length == 6) "0x$it" else "white" }
            val text = escapeDrawText(item.text)
            val fontArg = fontFile?.let { "fontfile='${escapeDrawText(it.toString())}':" }.orEmpty()
            val scaledFontSize = (item.style.sizeSp * scaleFactor).roundToInt().coerceAtLeast(8)
            videoGraph += "[$currentVideo]drawtext=${fontArg}text='$text':fontcolor=$color:fontsize=$scaledFontSize:x=(w-text_w)/2:y=$scaledY:enable='between(t,${seconds(item.startMs)},${seconds(item.startMs + item.durationMs)})'[$next]"
            currentVideo = next
        }
        if (currentVideo == "vbase") {
            videoGraph += "[vbase]null[vout]"
        }

        val audioGraph = mutableListOf<String>()
        val audioLabels = mutableListOf<String>()
        videoClips.forEachIndexed { index, clip ->
            val label = "clipAudio$index"
            val duration = seconds(segmentSeconds[index])
            val clipVol = clip.volume ?: 1f
            if (hasAudio(videoPaths[index])) {
                audioGraph += "[$index:a:0]atrim=start=${seconds(clip.inMs)}:duration=$duration,asetpts=PTS-STARTPTS,volume=$clipVol,aformat=sample_rates=48000:channel_layouts=stereo[$label]"
            } else {
                audioGraph += "anullsrc=r=48000:cl=stereo,atrim=duration=$duration[$label]"
            }
            audioLabels += label
        }
        audioGraph += buildString {
            audioLabels.forEach { append("[$it]") }
            append("concat=n=${audioLabels.size}:v=0:a=1[abase]")
        }

        val mixLabels = mutableListOf("abase")
        music.forEachIndexed { index, clip ->
            val inputIndex = videoClips.size + index
            val label = "music$index"
            val startMs = (clip.startMs ?: 0L).coerceAtLeast(0L)
            val clipDurationMs = (clip.outMs - clip.inMs).coerceAtLeast(0L)
            val remainingMs = (totalVideoDurationMs - startMs).coerceAtLeast(0L)
            val effectiveDurationMs = minOf(clipDurationMs, remainingMs)
            val duration = seconds(effectiveDurationMs)
            val vol = clip.volume ?: 1f
            val delayPart = if (startMs > 0) "adelay=${startMs}|${startMs}," else ""
            audioGraph += "[$inputIndex:a:0]atrim=start=${seconds(clip.inMs)}:duration=$duration,asetpts=PTS-STARTPTS,${delayPart}volume=$vol,aformat=sample_rates=48000:channel_layouts=stereo[$label]"
            mixLabels += label
        }
        audioGraph += buildString {
            mixLabels.forEach { append("[$it]") }
            append("amix=inputs=${mixLabels.size}:duration=longest:normalize=0[aout]")
        }

        val vStr = videoGraph.joinToString(";")
        val aStr = audioGraph.joinToString(";")

        return CompositionGraphResult(
            inputArgs = inputArgs,
            videoFilterGraph = vStr,
            audioFilterGraph = aStr,
            filterGraph = "$vStr;$aStr",
            videoOutLabel = "vout",
            audioOutLabel = "aout",
            totalDurationMs = totalVideoDurationMs,
        )
    }

    fun resolvePath(value: String): Path =
        if (value.startsWith("file:")) Paths.get(URI(value)) else Paths.get(value)

    fun seconds(ms: Long): String =
        String.format(Locale.US, "%.3f", ms / 1000.0)

    fun escapeDrawText(value: String): String =
        value.replace("\\", "\\\\")
            .replace(":", "\\:")
            .replace("'", "\\'")
            .replace("%", "\\%")
            .replace(",", "\\,")
            .replace("[", "\\[")
            .replace("]", "\\]")

    fun defaultFontFile(): Path? {
        val windows = System.getenv("WINDIR")?.let { Paths.get(it, "Fonts", "arial.ttf") }
        val candidates = listOfNotNull(
            windows,
            Paths.get("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
            Paths.get("/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf"),
            Paths.get("/System/Library/Fonts/Supplemental/Arial.ttf"),
            Paths.get("/System/Library/Fonts/Helvetica.ttc"),
        )
        return candidates.firstOrNull(Files::isRegularFile)
    }
}
