package io.github.saldraykee22.popi.domain

import kotlin.test.*

class SchemaV1Test {
    private fun initial() = Project(assets = listOf(
        Asset("v1", "video", "file:///v1.mp4", 8000), Asset("v2", "video", "file:///v2.mp4", 6000),
        Asset("m1", "audio", "file:///m.m4a", 30000)
    ))

    /** c1, c2, c3 sırasıyla video izinde. */
    private fun withThreeClips(): CommandEngine {
        val e = CommandEngine(initial())
        e.executeJson("""[{"op":"import_clip","assetId":"v1","trackId":"v1"},{"op":"import_clip","assetId":"v2","trackId":"v1"},{"op":"import_clip","assetId":"v1","trackId":"v1"}]""")
        return e
    }

    @Test fun relabelKeepsHistoryAndAppliesToSnapshots() {
        val e = withThreeClips()
        e.relabelAsset("v2", "hamur yoğurma")
        assertEquals("hamur yoğurma", e.project.assets.first { it.id == "v2" }.label)
        assertTrue(e.canUndo())
        e.undo()
        assertEquals("hamur yoğurma", e.project.assets.first { it.id == "v2" }.label, "Geri alma etiketi eski hâline döndürmemeli")
        assertFailsWith<DomainError.NotFound> { e.relabelAsset("yok", "x") }
    }

    @Test fun nextAssetIdIsShortAndUnique() {
        val e = CommandEngine(Project())
        assertEquals("s1", e.nextAssetId())
        e.registerAssets(listOf(Asset("s1", "video", "file:///a.mp4", 1000), Asset("s7", "audio", "file:///b.m4a", 1000)))
        assertEquals("s8", e.nextAssetId())
    }

    private fun videoOrder(p: Project) = p.tracks.first { it.id == "v1" }.clips.map { it.id }
    private fun audioClip(p: Project, id: String) = p.tracks.first { it.id == "m1" }.clips.first { it.id == id }

    // move_clip: after

    @Test fun moveAfterNullPutsClipFirst() {
        val e = withThreeClips()
        e.executeJson("""{"op":"move_clip","clipId":"c3","after":null}""")
        assertEquals(listOf("c3", "c1", "c2"), videoOrder(e.project))
    }

    @Test fun moveAfterClipInMiddle() {
        val e = withThreeClips()
        e.executeJson("""{"op":"move_clip","clipId":"c3","after":"c1"}""")
        assertEquals(listOf("c1", "c3", "c2"), videoOrder(e.project))
    }

    @Test fun moveAfterClipAtEnd() {
        val e = withThreeClips()
        e.executeJson("""{"op":"move_clip","clipId":"c1","after":"c3"}""")
        assertEquals(listOf("c2", "c3", "c1"), videoOrder(e.project))
    }

    @Test fun moveWithToIndexStillWorks() {
        val e = withThreeClips()
        e.executeJson("""{"op":"move_clip","clipId":"c3","toIndex":0}""")
        assertEquals(listOf("c3", "c1", "c2"), videoOrder(e.project))
    }

    @Test fun moveWithBothAfterAndToIndexFails() {
        val e = withThreeClips(); val before = e.project
        assertFailsWith<DomainError.InvalidCommand> { e.executeJson("""{"op":"move_clip","clipId":"c3","after":null,"toIndex":0}""") }
        assertEquals(before, e.project)
    }

    @Test fun moveWithNeitherAfterNorToIndexFails() {
        val e = withThreeClips(); val before = e.project
        assertFailsWith<DomainError.InvalidCommand> { e.executeJson("""{"op":"move_clip","clipId":"c3"}""") }
        assertEquals(before, e.project)
    }

    @Test fun moveAfterClipOnAnotherTrackFails() {
        val e = withThreeClips()
        e.executeJson("""{"op":"add_audio","assetId":"m1","trackId":"m1"}""")
        val before = e.project
        assertFailsWith<DomainError.InvalidRange> { e.executeJson("""{"op":"move_clip","clipId":"c1","after":"a1"}""") }
        assertEquals(before, e.project)
    }

    @Test fun moveAfterItselfFails() {
        val e = withThreeClips(); val before = e.project
        assertFailsWith<DomainError.InvalidRange> { e.executeJson("""{"op":"move_clip","clipId":"c2","after":"c2"}""") }
        assertEquals(before, e.project)
    }

    @Test fun moveAfterUnknownClipIsNotFound() {
        val e = withThreeClips()
        assertFailsWith<DomainError.NotFound> { e.executeJson("""{"op":"move_clip","clipId":"c1","after":"c99"}""") }
    }

    // startMs: add_audio ve set_audio_start

    @Test fun addAudioAcceptsStartMs() {
        val e = CommandEngine(initial())
        e.executeJson("""{"op":"add_audio","assetId":"m1","trackId":"m1","startMs":2000}""")
        assertEquals(2000L, audioClip(e.project, "a1").startMs)
    }

    @Test fun addAudioWithoutStartMsKeepsNull() {
        val e = CommandEngine(initial())
        e.executeJson("""{"op":"add_audio","assetId":"m1","trackId":"m1"}""")
        assertNull(audioClip(e.project, "a1").startMs)
    }

    @Test fun addAudioRejectsNegativeStartMs() {
        val e = CommandEngine(initial()); val before = e.project
        assertFailsWith<DomainError.InvalidRange> { e.executeJson("""{"op":"add_audio","assetId":"m1","trackId":"m1","startMs":-1}""") }
        assertEquals(before, e.project)
    }

    @Test fun setAudioStartWorksOnAudioClip() {
        val e = CommandEngine(initial())
        e.executeJson("""{"op":"add_audio","assetId":"m1","trackId":"m1"}""")
        e.executeJson("""{"op":"set_audio_start","clipId":"a1","startMs":3000}""")
        assertEquals(3000L, audioClip(e.project, "a1").startMs)
    }

    @Test fun setAudioStartOnVideoClipFails() {
        val e = withThreeClips(); val before = e.project
        assertFailsWith<DomainError.InvalidRange> { e.executeJson("""{"op":"set_audio_start","clipId":"c1","startMs":3000}""") }
        assertEquals(before, e.project)
    }

    @Test fun setAudioStartRejectsNegativeValue() {
        val e = CommandEngine(initial())
        e.executeJson("""{"op":"add_audio","assetId":"m1","trackId":"m1"}""")
        val before = e.project
        assertFailsWith<DomainError.InvalidRange> { e.executeJson("""{"op":"set_audio_start","clipId":"a1","startMs":-5}""") }
        assertEquals(before, e.project)
    }

    // set_volume: video ve metin izi

    @Test fun setVolumeWorksOnVideoClip() {
        val e = withThreeClips()
        e.executeJson("""{"op":"set_volume","clipId":"c2","volume":0.5}""")
        assertEquals(0.5f, e.project.tracks.first { it.id == "v1" }.clips.first { it.id == "c2" }.volume)
    }

    @Test fun setVolumeOnTextItemFails() {
        val e = CommandEngine(initial())
        e.executeJson("""{"op":"add_text","trackId":"t1","text":"Selam","startMs":0,"durationMs":1000}""")
        val before = e.project
        assertFailsWith<DomainError> { e.executeJson("""{"op":"set_volume","clipId":"x1","volume":0.5}""") }
        assertEquals(before, e.project)
    }

    @Test fun setVolumeOutOfRangeFails() {
        val e = withThreeClips(); val before = e.project
        assertFailsWith<DomainError.InvalidRange> { e.executeJson("""{"op":"set_volume","clipId":"c1","volume":2.5}""") }
        assertEquals(before, e.project)
    }

    // delete_text

    @Test fun deleteTextRemovesItem() {
        val e = CommandEngine(initial())
        e.executeJson("""{"op":"add_text","trackId":"t1","text":"Selam","startMs":0,"durationMs":1000}""")
        e.executeJson("""{"op":"delete_text","itemId":"x1"}""")
        assertEquals(emptyList(), e.project.tracks.first { it.id == "t1" }.items)
    }

    @Test fun deleteUnknownTextIsNotFound() {
        val e = CommandEngine(initial())
        assertFailsWith<DomainError.NotFound> { e.executeJson("""{"op":"delete_text","itemId":"nope"}""") }
    }

    // Karışık dizi ve bütünlük

    @Test fun mixedBatchWithFailingLastCommandLeavesStateUnchanged() {
        val e = CommandEngine(initial()); val before = e.project
        assertFailsWith<DomainError.NotFound> {
            e.executeJson("""[{"op":"import_clip","assetId":"v1","trackId":"v1"},{"op":"add_text","trackId":"t1","text":"A","startMs":0,"durationMs":1000},{"op":"delete_text","itemId":"nope"}]""")
        }
        assertEquals(before, e.project)
        assertFalse(e.canUndo())
    }

    // Geriye uyumluluk

    @Test fun oldProjectJsonWithoutStartMsDecodes() {
        val old = """{"id":"p1","canvas":{"w":1080,"h":1920,"fps":30},"assets":[{"id":"m1","kind":"audio","uri":"file:///m.m4a","durationMs":30000}],"tracks":[{"id":"m1","kind":"audio","clips":[{"id":"a1","assetId":"m1","inMs":0,"outMs":30000,"volume":0.3}],"items":[]}]}"""
        val p = ProjectJson.decode(old)
        assertNull(audioClip(p, "a1").startMs)
        assertEquals(0.3f, audioClip(p, "a1").volume)
    }

    @Test fun nullStartMsIsNotWrittenToJson() {
        val e = CommandEngine(initial())
        e.executeJson("""{"op":"add_audio","assetId":"m1","trackId":"m1"}""")
        assertFalse(ProjectJson.encode(e.project).contains("startMs"))
    }

    @Test fun startMsRoundTrips() {
        val e = CommandEngine(initial())
        e.executeJson("""{"op":"add_audio","assetId":"m1","trackId":"m1","startMs":1500}""")
        assertEquals(e.project, ProjectJson.decode(ProjectJson.encode(e.project)))
    }

    // Undo / redo

    @Test fun undoRedoSetAudioStart() {
        val e = CommandEngine(initial())
        e.executeJson("""{"op":"add_audio","assetId":"m1","trackId":"m1"}""")
        val before = e.project
        e.executeJson("""{"op":"set_audio_start","clipId":"a1","startMs":3000}""")
        val after = e.project
        e.executeJson("""{"op":"undo"}"""); assertEquals(before, e.project)
        e.executeJson("""{"op":"redo"}"""); assertEquals(after, e.project)
    }

    @Test fun undoRedoDeleteText() {
        val e = CommandEngine(initial())
        e.executeJson("""{"op":"add_text","trackId":"t1","text":"A","startMs":0,"durationMs":1000}""")
        val before = e.project
        e.executeJson("""{"op":"delete_text","itemId":"x1"}""")
        val after = e.project
        e.executeJson("""{"op":"undo"}"""); assertEquals(before, e.project)
        e.executeJson("""{"op":"redo"}"""); assertEquals(after, e.project)
    }

    @Test fun undoRedoMoveAfter() {
        val e = withThreeClips()
        val before = e.project
        e.executeJson("""{"op":"move_clip","clipId":"c3","after":null}""")
        val after = e.project
        e.executeJson("""{"op":"undo"}"""); assertEquals(before, e.project)
        e.executeJson("""{"op":"redo"}"""); assertEquals(after, e.project)
    }
}
