package io.github.saldraykee22.popi.desktop

import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.test.runComposeUiTest
import io.github.saldraykee22.popi.desktop.ui.PopiFonts
import io.github.saldraykee22.popi.desktop.ui.PopiTheme
import java.awt.image.BufferedImage
import java.nio.file.Files
import java.nio.file.Path
import javax.imageio.ImageIO
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class DesktopUiTest {
    /** Test girdisi üretir; FFmpeg hatasında testi durdurur. */
    private fun ffmpegFixture(target: Path, vararg args: String) {
        val process = ProcessBuilder(listOf("ffmpeg", "-y", "-hide_banner", "-loglevel", "error") + args + target.toString())
            .redirectErrorStream(true)
            .start()
        val output = process.inputStream.bufferedReader().readText()
        assertEquals(0, process.waitFor(), "test fixture generation failed: $output")
    }

    private fun videoFixture(target: Path, seconds: Int = 2, color: String = "testsrc2") = ffmpegFixture(
        target,
        "-f", "lavfi", "-i", "$color=size=320x180:rate=30:duration=$seconds",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
    )

    private fun audioFixture(target: Path, seconds: Int = 3) = ffmpegFixture(
        target,
        "-f", "lavfi", "-i", "sine=frequency=440:duration=$seconds",
        "-c:a", "pcm_s16le",
    )

    private fun platformWith(files: List<java.io.File>) = object : DesktopPlatform {
        override fun chooseMediaFiles() = files
        override fun chooseExportPath(projectName: String): Path? = null
    }

    private fun cachedThumbnails(): DesktopMediaThumbnails =
        DesktopMediaThumbnails(Thumbnails(Files.createTempDirectory("popi-ui-cache")))

    private fun settingsFile(): Path = Files.createTempDirectory("popi-ui-ayar").resolve("ayarlar.json")

    @OptIn(ExperimentalTestApi::class)
    @Test fun importSelectTrimUndoRestoresClipAndPreviewRenders() = runComposeUiTest {
        val directory = Files.createTempDirectory("popi-ui-test")
        val video = directory.resolve("ui-clip.mp4")
        videoFixture(video)
        val root = Files.createTempDirectory("popi-ui-store")
        setContent {
            PopiTheme {
                DesktopScreen(
                    ProjectStore(root),
                    platformWith(listOf(video.toFile())),
                    cachedThumbnails(),
                    secretStoreOverride = InMemorySecretStore(),
                    settingsFileOverride = settingsFile(),
                )
            }
        }
        onNodeWithText("+ İçe aktar").fetchSemanticsNode(); onNodeWithText("+ İçe aktar").performClick()
        waitForIdle()
        onAllNodesWithText("ui-clip")[1].performClick()
        onNodeWithTag("in-point").performTextReplacement("500")
        onNodeWithText("Kırpmayı uygula").performClick()
        waitForIdle()
        assertEquals("500", onNodeWithTag("in-point").fetchSemanticsNode().config[SemanticsProperties.EditableText].text)
        onNodeWithText("↶ Geri al").performClick()
        waitForIdle()
        assertEquals("0", onNodeWithTag("in-point").fetchSemanticsNode().config[SemanticsProperties.EditableText].text)

        waitUntil(timeoutMillis = 30_000) { onAllNodesWithTag("preview-image").fetchSemanticsNodes().isNotEmpty() }
    }

    @OptIn(ExperimentalTestApi::class)
    @Test fun dropInboxImportsSupportedFilesAndNamesRejectedOnes() = runComposeUiTest {
        val directory = Files.createTempDirectory("popi-drop-test")
        val video = directory.resolve("drop-clip.mp4")
        videoFixture(video)
        val note = directory.resolve("notlar.txt")
        Files.writeString(note, "not")
        val inbox = FileDropInbox()
        val root = Files.createTempDirectory("popi-drop-store")
        setContent {
            PopiTheme {
                DesktopScreen(
                    ProjectStore(root),
                    platformWith(emptyList()),
                    cachedThumbnails(),
                    dropInbox = inbox,
                    secretStoreOverride = InMemorySecretStore(),
                    settingsFileOverride = settingsFile(),
                )
            }
        }
        waitForIdle()
        inbox.offer(listOf(video.toFile(), note.toFile()))
        waitUntil(timeoutMillis = 30_000) { onAllNodesWithText("drop-clip").fetchSemanticsNodes().isNotEmpty() }
        waitForIdle()
        onNodeWithText("1 medya içe aktarıldı. Desteklenmeyen dosya: notlar.txt").fetchSemanticsNode()
    }

    @OptIn(ExperimentalTestApi::class)
    @Test fun mainScreenCapturesTwoVideosOneTrackAndOneText() = runComposeUiTest {
        val directory = Files.createTempDirectory("popi-screen-test")
        val first = directory.resolve("ilk-video.mp4")
        videoFixture(first, seconds = 2, color = "testsrc2")
        val second = directory.resolve("ikinci-video.mp4")
        videoFixture(second, seconds = 3, color = "smptebars")
        val music = directory.resolve("muzik.wav")
        audioFixture(music)
        val root = Files.createTempDirectory("popi-screen-store")
        setContent {
            PopiTheme {
                DesktopScreen(
                    ProjectStore(root),
                    platformWith(listOf(first.toFile(), second.toFile(), music.toFile())),
                    cachedThumbnails(),
                    secretStoreOverride = InMemorySecretStore(),
                    settingsFileOverride = settingsFile(),
                )
            }
        }
        onNodeWithText("+ İçe aktar").performClick()
        waitForIdle()
        onNodeWithTag("advanced-toggle").performClick()
        waitForIdle()
        onNodeWithTag("command-input").performTextReplacement(
            """{"op":"add_text","trackId":"t1","startMs":0,"durationMs":3000,"text":"Başlık","id":"x1"}""",
        )
        onNodeWithText("Komutu gönder").performClick()
        waitForIdle()
        waitUntil(timeoutMillis = 60_000) { onAllNodesWithTag("preview-image").fetchSemanticsNodes().isNotEmpty() }
        waitForIdle()

        val captured = onRoot().captureToImage()
        val pixelMap = captured.toPixelMap()
        val screenshot = BufferedImage(captured.width, captured.height, BufferedImage.TYPE_INT_ARGB)
        for (y in 0 until captured.height) for (x in 0 until captured.width) screenshot.setRGB(x, y, pixelMap[x, y].toArgb())
        val target = Path.of("build", "ekran", "ana.png").toAbsolutePath()
        Files.createDirectories(target.parent)
        ImageIO.write(screenshot, "png", target.toFile())
        assertTrue(Files.size(target) > 10_000, "Compose screenshot is empty: $target")
    }

    @Test fun thumbnailFrameIs160PixelsWideAndSecondCallUsesCache() {
        val directory = Files.createTempDirectory("popi-thumb-test")
        val video = directory.resolve("kare.mp4")
        videoFixture(video)
        var ffmpegCalls = 0
        val thumbnails = Thumbnails(directory.resolve("onbellek"), execute = { args -> ffmpegCalls++; runFfmpeg("ffmpeg", args) })

        val first = thumbnails.frame(video, durationMs = 2000)
        assertEquals(1, ffmpegCalls)
        assertEquals(160, ImageIO.read(first.toFile()).width)

        val second = thumbnails.frame(video, durationMs = 2000)
        assertEquals(first, second)
        assertEquals(1, ffmpegCalls, "second call must be served from the cache")
    }

    @Test fun waveformHasOneHundredPointsAndSecondCallUsesCache() {
        val directory = Files.createTempDirectory("popi-wave-test")
        val music = directory.resolve("ton.wav")
        audioFixture(music)
        var ffmpegCalls = 0
        val thumbnails = Thumbnails(directory.resolve("onbellek"), execute = { args -> ffmpegCalls++; runFfmpeg("ffmpeg", args) })

        val peaks = thumbnails.waveform(music)
        assertEquals(100, peaks.size)
        assertTrue(peaks.max() > 0.1f, "sine fixture should have audible peaks")
        assertEquals(1, ffmpegCalls)

        val again = thumbnails.waveform(music)
        assertEquals(peaks.toList(), again.toList())
        assertEquals(1, ffmpegCalls, "second call must be served from the cache")
    }

    @Test fun bundledFontsResolveAndFamiliesBuild() {
        val loader = DesktopUiTest::class.java.classLoader
        listOf(
            "font/IBMPlexSans-Variable.ttf",
            "font/IBMPlexMono-Regular.ttf",
            "font/IBMPlexMono-Medium.ttf",
            "font/OFL-IBM-Plex.txt",
        ).forEach { assertNotNull(loader.getResource(it), "missing font resource: $it") }
        assertNotNull(PopiFonts.sans)
        assertNotNull(PopiFonts.mono)
    }
}
