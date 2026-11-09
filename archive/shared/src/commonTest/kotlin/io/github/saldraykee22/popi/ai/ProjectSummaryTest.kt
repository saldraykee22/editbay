package io.github.saldraykee22.popi.ai

import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ProjectSummaryTest {
    @Test fun doesNotLeakFilePathsOrNames() {
        val summary = ProjectSummary.summarize(sampleProject())
        listOf(
            "file:///",
            "gizli-klasor",
            "giris_selam.mp4",
            "hamur.mp4",
            "arka_muzik.m4a",
        ).forEach { leak ->
            assertFalse(summary.contains(leak), "Özet sızdırdı: $leak")
        }
    }

    @Test fun includesUserLabelButNeverPath() {
        val project = sampleProject().let { p ->
            p.copy(assets = p.assets.map { if (it.id == "v2") it.copy(label = "hamur yoğurma") else it })
        }
        val summary = ProjectSummary.summarize(project)
        assertContains(summary, "ad: \"hamur yoğurma\"")
        assertFalse(summary.contains("gizli-klasor"), "Özet dosya yolunu sızdırdı")
        assertFalse(summary.contains("hamur.mp4"), "Özet dosya adını sızdırdı")
    }

    @Test fun includesClipIdsAndOrder() {
        val summary = ProjectSummary.summarize(sampleProject())
        assertContains(summary, "c1: varlık v1")
        assertContains(summary, "c2: varlık v2")
        // Sıra korunmalı: c1, c2 özet içinde c1'den sonra gelir.
        assertTrue(summary.indexOf("c1: varlık v1") < summary.indexOf("c2: varlık v2"))
    }

    @Test fun includesAssetKindDurationTextAndVolume() {
        val summary = ProjectSummary.summarize(sampleProject())
        assertContains(summary, "video")
        assertContains(summary, "audio")
        assertContains(summary, "8000 ms")
        assertContains(summary, "Kuzey Fırın")
        assertContains(summary, "seviye 0.4")
    }
}
