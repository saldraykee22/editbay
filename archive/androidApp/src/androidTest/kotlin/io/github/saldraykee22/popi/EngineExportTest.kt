package io.github.saldraykee22.popi

import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import io.github.saldraykee22.popi.domain.Project
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@OptIn(androidx.media3.common.util.UnstableApi::class)
@RunWith(AndroidJUnit4::class)
class EngineExportTest {
    @Test fun importEditExportProducesPortraitVideoAndAudio() {
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        val latch = CountDownLatch(1)
        var activityRef: MainActivity? = null
        scenario.onActivity { a ->
            activityRef = a
            a.importMedia()
            val p = a.engine.project
            val byFile = p.assets.associateBy { it.id }
            val videoTrack = p.tracks.first { it.kind == "video" }
            val ids = videoTrack.clips.associateBy { it.assetId }
            fun clip(name: String) = ids[name]?.id ?: error("Klip yok: $name")
            a.applyCommand("""{"op":"trim_clip","clipId":"${clip("klip1")}","inMs":0,"outMs":5000}""")
            a.applyCommand("""{"op":"move_clip","clipId":"${clip("klip2")}","toIndex":0}""")
            a.applyCommand("""{"op":"add_text","trackId":"t1","text":"Merhaba Dünya","startMs":0,"durationMs":3000}""")
            a.applyCommand("""{"op":"add_audio","assetId":"muzik","trackId":"m1","volume":0.3}""")
            AndroidRenderer(a).export(RenderRequest(a.engine.project, File(a.getExternalFilesDir(null), "cikti/export.mp4").absolutePath)) { result ->
                result.fold({ latch.countDown() }, { throw AssertionError(it) })
            }
        }
        assertTrue("Transformer export timeout", latch.await(5, TimeUnit.MINUTES))
        val output = File(activityRef!!.getExternalFilesDir(null), "cikti/export.mp4")
        assertTrue("output file missing", output.exists() && output.length() > 0)
        val retriever = MediaMetadataRetriever().apply { setDataSource(output.absolutePath) }
        assertEquals("1080", retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH))
        assertEquals("1920", retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT))
        val duration = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)!!.toLong()
        assertTrue("expected 18000ms ±100ms but got $duration", kotlin.math.abs(duration - 18000L) <= 100L)
        retriever.release()
        val extractor = MediaExtractor().apply { setDataSource(output.absolutePath) }
        val audio = (0 until extractor.trackCount).any { extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true }
        assertTrue("audio track absent", audio)
        extractor.release(); scenario.close()
    }

    @Test fun projectPersistsAcrossActivityRecreation() {
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        lateinit var before: Project
        scenario.onActivity { a -> a.importMedia(); a.applyCommand("""{"op":"add_text","trackId":"t1","text":"Merhaba Dünya","startMs":0,"durationMs":3000}"""); before = a.engine.project }
        scenario.recreate()
        scenario.onActivity { a -> assertEquals(before, a.engine.project) }
        scenario.close()
    }
}

