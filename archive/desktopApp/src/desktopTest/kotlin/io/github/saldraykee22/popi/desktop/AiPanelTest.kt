package io.github.saldraykee22.popi.desktop

import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.ComposeUiTest
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.test.runComposeUiTest
import io.github.saldraykee22.popi.desktop.ui.PopiTheme
import java.awt.image.BufferedImage
import java.nio.file.Files
import java.nio.file.Path
import javax.imageio.ImageIO
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class AiPanelTest {

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
        DesktopMediaThumbnails(Thumbnails(Files.createTempDirectory("popi-ai-cache")))

    private fun connectedSecrets(): InMemorySecretStore =
        InMemorySecretStore().apply { put("openrouter-key", "sk-test-key") }

    private fun settingsFile(dir: Path, model: String = "test-model"): Path {
        val file = dir.resolve("ayarlar.json")
        Files.writeString(file, """{"provider":"openrouter","model":"$model"}""")
        return file
    }

    private fun outputFile(name: String): Path = Path.of("build", "ekran", name).toAbsolutePath()

    @OptIn(ExperimentalTestApi::class)
    private fun ComposeUiTest.capture(path: Path) {
        val captured = onRoot().captureToImage()
        val pixelMap = captured.toPixelMap()
        val screenshot = BufferedImage(captured.width, captured.height, BufferedImage.TYPE_INT_ARGB)
        for (y in 0 until captured.height) for (x in 0 until captured.width) screenshot.setRGB(x, y, pixelMap[x, y].toArgb())
        Files.createDirectories(path.parent)
        ImageIO.write(screenshot, "png", path.toFile())
        assertTrue(Files.size(path) > 10_000, "Compose screenshot is empty: $path")
    }

    @OptIn(ExperimentalTestApi::class)
    @Test fun textEditingFlowAppliesAndUndoesThroughCommandEngine() = runComposeUiTest {
        val dir = Files.createTempDirectory("popi-ai-flow")
        val video = dir.resolve("onay.mp4")
        videoFixture(video)
        val root = Files.createTempDirectory("popi-ai-store")
        val store = ProjectStore(root)
        setContent {
            PopiTheme {
                DesktopScreen(
                    store,
                    platformWith(listOf(video.toFile())),
                    cachedThumbnails(),
                    secretStoreOverride = connectedSecrets(),
                    transportFactoryOverride = fakeTransportFactory(
                        """[{"op":"set_volume","clipId":"c1","volume":0.4}]""",
                    ),
                    settingsFileOverride = settingsFile(dir),
                )
            }
        }
        onNodeWithText("+ İçe aktar").performClick()
        waitForIdle()
        val initial = store.loadLast()!!.second

        onNodeWithTag("ai-input").performTextReplacement("sesi kıs")
        onNodeWithTag("ai-send").performClick()
        waitForIdle()

        val userNodes = onAllNodesWithText("sesi kıs", substring = true).fetchSemanticsNodes()
        assertTrue(userNodes.isNotEmpty(), "onay kartı isteği göstermeli")
        val userText = userNodes.first().config[SemanticsProperties.Text].joinToString { it.text }
        assertTrue(userText.contains("onay"), "onay kartı klip etiketini içermeli")
        assertFalse(userText.contains(".mp4"), "onay kartı dosya adını içermemeli")
        assertFalse(userText.contains(dir.toString()), "onay kartı dosya yolunu içermemeli")

        onNodeWithTag("ai-approve").performScrollTo().performClick()
        waitUntil(timeoutMillis = 10_000) {
            onAllNodesWithText("%100 → %40", substring = true).fetchSemanticsNodes().isNotEmpty()
        }
        onNodeWithTag("ai-apply").performScrollTo().performClick()
        waitForIdle()
        val applied = store.loadLast()!!.second
        assertNotEquals(initial, applied, "uygulama proje durumunu değiştirmeli")

        onNodeWithTag("ai-undo").performScrollTo().performClick()
        waitForIdle()
        assertEquals(initial, store.loadLast()!!.second, "geri al proje durumunu başlangıca döndürmeli")
    }

    @OptIn(ExperimentalTestApi::class)
    @Test fun clarifyResultShowsModelQuestion() = runComposeUiTest {
        val dir = Files.createTempDirectory("popi-ai-clarify")
        val video = dir.resolve("klip.mp4")
        videoFixture(video)
        setContent {
            PopiTheme {
                DesktopScreen(
                    ProjectStore(Files.createTempDirectory("popi-ai-clarify-store")),
                    platformWith(listOf(video.toFile())),
                    cachedThumbnails(),
                    secretStoreOverride = connectedSecrets(),
                    transportFactoryOverride = fakeTransportFactory("""{"op":"clarify","question":"Hangi klip?"}"""),
                    settingsFileOverride = settingsFile(dir),
                )
            }
        }
        onNodeWithText("+ İçe aktar").performClick()
        waitForIdle()
        onNodeWithTag("ai-input").performTextReplacement("şunu kes")
        onNodeWithTag("ai-send").performClick()
        waitForIdle()
        onNodeWithTag("ai-approve").performScrollTo().performClick()
        waitUntil(timeoutMillis = 10_000) {
            onAllNodesWithText("Hangi klip?", substring = true).fetchSemanticsNodes().isNotEmpty()
        }
    }

    @OptIn(ExperimentalTestApi::class)
    @Test fun failedResultShowsExplanationWithoutApplyButton() = runComposeUiTest {
        val dir = Files.createTempDirectory("popi-ai-failed")
        val video = dir.resolve("klip.mp4")
        videoFixture(video)
        setContent {
            PopiTheme {
                DesktopScreen(
                    ProjectStore(Files.createTempDirectory("popi-ai-failed-store")),
                    platformWith(listOf(video.toFile())),
                    cachedThumbnails(),
                    secretStoreOverride = connectedSecrets(),
                    transportFactoryOverride = fakeTransportFactory("Bunu yapamam."),
                    settingsFileOverride = settingsFile(dir),
                )
            }
        }
        onNodeWithText("+ İçe aktar").performClick()
        waitForIdle()
        onNodeWithTag("ai-input").performTextReplacement("bir şey yap")
        onNodeWithTag("ai-send").performClick()
        waitForIdle()
        onNodeWithTag("ai-approve").performScrollTo().performClick()
        waitUntil(timeoutMillis = 10_000) {
            onAllNodesWithText("Metinde JSON bulunamadı", substring = true).fetchSemanticsNodes().isNotEmpty()
        }
        assertTrue(onAllNodesWithTag("ai-apply").fetchSemanticsNodes().isEmpty(), "başarısız sonuçta uygulama düğmesi olmamalı")
    }

    @OptIn(ExperimentalTestApi::class)
    @Test fun disconnectedShowsConnectCard() = runComposeUiTest {
        val dir = Files.createTempDirectory("popi-ai-disconnected")
        setContent {
            PopiTheme {
                DesktopScreen(
                    ProjectStore(Files.createTempDirectory("popi-ai-disconnected-store")),
                    platformWith(emptyList()),
                    cachedThumbnails(),
                    secretStoreOverride = InMemorySecretStore(),
                    settingsFileOverride = settingsFile(dir),
                )
            }
        }
        waitForIdle()
        onNodeWithText("Bağlan").fetchSemanticsNode()
        onNodeWithTag("ai-oauth").fetchSemanticsNode()
    }

    @OptIn(ExperimentalTestApi::class)
    @Test fun approvalAndChangeScreenshots() = runComposeUiTest {
        val dir = Files.createTempDirectory("popi-ai-screen")
        val first = dir.resolve("ilk-video.mp4")
        videoFixture(first, seconds = 2, color = "testsrc2")
        val second = dir.resolve("ikinci-video.mp4")
        videoFixture(second, seconds = 3, color = "smptebars")
        val music = dir.resolve("muzik.wav")
        audioFixture(music)
        setContent {
            PopiTheme {
                DesktopScreen(
                    ProjectStore(Files.createTempDirectory("popi-ai-screen-store")),
                    platformWith(listOf(first.toFile(), second.toFile(), music.toFile())),
                    cachedThumbnails(),
                    secretStoreOverride = connectedSecrets(),
                    transportFactoryOverride = fakeTransportFactory(
                        """[{"op":"set_volume","clipId":"c1","volume":0.4}]""",
                    ),
                    settingsFileOverride = settingsFile(dir),
                )
            }
        }
        onNodeWithText("+ İçe aktar").performClick()
        waitForIdle()
        onNodeWithTag("ai-input").performTextReplacement("ilk klibin sesini kıs")
        onNodeWithTag("ai-send").performClick()
        waitUntil(timeoutMillis = 60_000) { onAllNodesWithTag("preview-image").fetchSemanticsNodes().isNotEmpty() }
        waitForIdle()
        Thread.sleep(500)
        capture(outputFile("m2-onay.png"))

        onNodeWithTag("ai-approve").performScrollTo().performClick()
        waitUntil(timeoutMillis = 10_000) {
            onAllNodesWithText("%100 → %40", substring = true).fetchSemanticsNodes().isNotEmpty()
        }
        waitForIdle()
        Thread.sleep(300)
        capture(outputFile("m2-degisiklik.png"))
    }
}
