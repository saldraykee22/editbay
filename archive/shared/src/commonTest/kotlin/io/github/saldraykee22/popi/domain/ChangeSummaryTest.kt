package io.github.saldraykee22.popi.domain

import kotlin.test.*

class ChangeSummaryTest {
    private fun initial() = Project(assets = listOf(
        Asset("v1", "video", "file:///v1.mp4", 8000), Asset("v2", "video", "file:///v2.mp4", 6000),
        Asset("m1", "audio", "file:///m.m4a", 30000)
    ))

    /** Önce [setup] komutlarını uygular, sonra [change] komutunu uygular ve farkı döndürür. */
    private fun diff(setup: String?, change: String): List<String> {
        val e = CommandEngine(initial())
        if (setup != null) e.executeJson(setup)
        val before = e.project
        e.executeJson(change)
        return describeChanges(before, e.project)
    }

    private val threeClips = """[{"op":"import_clip","assetId":"v1","trackId":"v1"},{"op":"import_clip","assetId":"v2","trackId":"v1"},{"op":"import_clip","assetId":"v1","trackId":"v1"}]"""

    @Test fun noChangeGivesEmptyList() {
        val e = CommandEngine(initial()); e.executeJson(threeClips)
        assertEquals(emptyList(), describeChanges(e.project, e.project))
    }

    @Test fun volumeFromDefaultToSameHundredPercentIsNotAChange() {
        assertEquals(emptyList(), diff(threeClips, """{"op":"set_volume","clipId":"c2","volume":1.0}"""))
    }

    @Test fun trimLine() {
        assertEquals(
            listOf("2. klip (c2) kırpıldı: 0,0–6,0 sn → 1,5–6,0 sn"),
            diff(threeClips, """{"op":"trim_clip","clipId":"c2","inMs":1500,"outMs":6000}"""),
        )
    }

    @Test fun orderLine() {
        assertEquals(
            listOf("Klip sırası: c1, c2, c3 → c2, c1, c3"),
            diff(threeClips, """{"op":"move_clip","clipId":"c2","after":null}"""),
        )
    }

    @Test fun deletedClipLine() {
        assertEquals(listOf("Klip silindi: c3"), diff(threeClips, """{"op":"delete_clip","clipId":"c3"}"""))
    }

    @Test fun addedClipLine() {
        assertEquals(listOf("Klip eklendi: c4"), diff(threeClips, """{"op":"import_clip","assetId":"v1","trackId":"v1"}"""))
    }

    @Test fun textAddedLine() {
        assertEquals(
            listOf("Metin eklendi: \"Selam\" (2,0–5,0 sn)"),
            diff(null, """{"op":"add_text","trackId":"t1","text":"Selam","startMs":2000,"durationMs":3000}"""),
        )
    }

    @Test fun textChangedLine() {
        assertEquals(
            listOf("Metin değişti: \"Selam\" → \"Merhaba\""),
            diff("""{"op":"add_text","trackId":"t1","text":"Selam","startMs":2000,"durationMs":3000}""", """{"op":"edit_text","itemId":"x1","text":"Merhaba"}"""),
        )
    }

    @Test fun textTimingLine() {
        assertEquals(
            listOf("Metin zamanı değişti: \"Selam\" (2,0–5,0 sn → 3,0–5,0 sn)"),
            diff("""{"op":"add_text","trackId":"t1","text":"Selam","startMs":2000,"durationMs":3000}""", """{"op":"edit_text","itemId":"x1","startMs":3000,"durationMs":2000}"""),
        )
    }

    @Test fun textStyleLine() {
        assertEquals(
            listOf("Metin stili değişti: \"Selam\""),
            diff("""{"op":"add_text","trackId":"t1","text":"Selam","startMs":0,"durationMs":1000}""", """{"op":"edit_text","itemId":"x1","style":{"sizeSp":60,"color":"#FFFFFF","position":"top"}}"""),
        )
    }

    @Test fun textDeletedLine() {
        assertEquals(
            listOf("Metin silindi: \"Selam\""),
            diff("""{"op":"add_text","trackId":"t1","text":"Selam","startMs":0,"durationMs":1000}""", """{"op":"delete_text","itemId":"x1"}"""),
        )
    }

    @Test fun videoClipVolumeLine() {
        assertEquals(
            listOf("2. klip (c2) sesi: %100 → %40"),
            diff(threeClips, """{"op":"set_volume","clipId":"c2","volume":0.4}"""),
        )
    }

    @Test fun audioClipVolumeLine() {
        assertEquals(
            listOf("Müzik (a1) sesi: %100 → %40"),
            diff("""{"op":"add_audio","assetId":"m1","trackId":"m1"}""", """{"op":"set_volume","clipId":"a1","volume":0.4}"""),
        )
    }

    @Test fun audioClipStartLine() {
        assertEquals(
            listOf("Müzik (a1) başlangıcı: 0,0 sn → 3,0 sn"),
            diff("""{"op":"add_audio","assetId":"m1","trackId":"m1"}""", """{"op":"set_audio_start","clipId":"a1","startMs":3000}"""),
        )
    }

    @Test fun audioClipTrimLineUsesMusicLabel() {
        assertEquals(
            listOf("Müzik (a1) kırpıldı: 0,0–30,0 sn → 2,0–30,0 sn"),
            diff("""{"op":"add_audio","assetId":"m1","trackId":"m1"}""", """{"op":"trim_clip","clipId":"a1","inMs":2000,"outMs":30000}"""),
        )
    }

    @Test fun multipleFieldsOnSameClipGiveSeparateLines() {
        assertEquals(
            listOf("2. klip (c2) kırpıldı: 0,0–6,0 sn → 1,0–6,0 sn", "2. klip (c2) sesi: %100 → %50"),
            diff(threeClips, """[{"op":"trim_clip","clipId":"c2","inMs":1000,"outMs":6000},{"op":"set_volume","clipId":"c2","volume":0.5}]"""),
        )
    }
}
