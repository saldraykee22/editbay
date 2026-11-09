package io.github.saldraykee22.popi.desktop

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.ComposeUiTest
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.runComposeUiTest
import io.github.saldraykee22.popi.desktop.ui.PopiTheme
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals

class PreviewConnectionTest {

    private fun ffmpegFixture(target: Path, vararg args: String) {
        val process = ProcessBuilder(listOf("ffmpeg", "-y", "-hide_banner", "-loglevel", "error") + args + target.toString())
            .redirectErrorStream(true)
            .start()
        val output = process.inputStream.bufferedReader().readText()
        assertEquals(0, process.waitFor(), "test fixture generation failed: $output")
    }

    private fun videoFixture(target: Path, seconds: Int = 3, color: String = "testsrc2") = ffmpegFixture(
        target,
        "-f", "lavfi", "-i", "$color=size=320x180:rate=30:duration=$seconds",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
    )

    private fun platformWith(files: List<java.io.File>) = object : DesktopPlatform {
        override fun chooseMediaFiles() = files
        override fun chooseExportPath(projectName: String): Path? = null
    }

    @OptIn(ExperimentalTestApi::class)
    private fun ComposeUiTest.playheadText(): String =
        onNodeWithTag("playhead-label").fetchSemanticsNode().config[SemanticsProperties.Text]
            .joinToString("") { it.text }

    @OptIn(ExperimentalTestApi::class)
    @Test fun playShowsFramesAdvancesPlayheadAndPauses() = runComposeUiTest {
        val dir = Files.createTempDirectory("popi-preview-conn")
        val video = dir.resolve("oynat.mp4")
        videoFixture(video)
        setContent {
            PopiTheme {
                DesktopScreen(
                    ProjectStore(Files.createTempDirectory("popi-preview-store")),
                    platformWith(listOf(video.toFile())),
                    DesktopMediaThumbnails(Thumbnails(Files.createTempDirectory("popi-preview-cache"))),
                    secretStoreOverride = InMemorySecretStore(),
                    settingsFileOverride = dir.resolve("ayarlar.json"),
                )
            }
        }
        onNodeWithText("+ İçe aktar").performClick()
        waitForIdle()
        waitUntil(timeoutMillis = 30_000) { onAllNodesWithTag("preview-image").fetchSemanticsNodes().isNotEmpty() }

        val before = playheadText()
        onNodeWithText("▶ Oynat").performClick()
        waitUntil(timeoutMillis = 2_000) {
            onAllNodesWithTag("preview-image").fetchSemanticsNodes().isNotEmpty() && playheadText() != before
        }
        onNodeWithText("Ⅱ Duraklat").performClick()
        waitForIdle()
        onNodeWithText("▶ Oynat").fetchSemanticsNode()
    }
}
