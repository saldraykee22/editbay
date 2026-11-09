package io.github.saldraykee22.popi.domain

import kotlin.test.*

class CommandEngineTest {
    private fun initial() = Project(assets = listOf(
        Asset("v1", "video", "file:///v1.mp4", 8000), Asset("v2", "video", "file:///v2.mp4", 6000),
        Asset("m1", "audio", "file:///m.m4a", 30000)
    ))
    private fun runOne(op: String): Pair<CommandEngine, Project> {
        val e = CommandEngine(initial())
        var before = e.project
        when (op) {
            "import_clip" -> e.executeJson("""{"op":"import_clip","assetId":"v1","trackId":"v1"}""")
            "trim_clip" -> { e.executeJson("""{"op":"import_clip","assetId":"v1","trackId":"v1"}"""); before = e.project; e.executeJson("""{"op":"trim_clip","clipId":"c1","inMs":100,"outMs":5000}""") }
            "move_clip" -> { e.executeJson("""[{"op":"import_clip","assetId":"v1","trackId":"v1"},{"op":"import_clip","assetId":"v2","trackId":"v1"}]"""); before = e.project; e.executeJson("""{"op":"move_clip","clipId":"c2","toIndex":0}""") }
            "delete_clip" -> { e.executeJson("""{"op":"import_clip","assetId":"v1","trackId":"v1"}"""); before = e.project; e.executeJson("""{"op":"delete_clip","clipId":"c1"}""") }
            "add_text" -> e.executeJson("""{"op":"add_text","trackId":"t1","text":"Merhaba Dünya","startMs":0,"durationMs":3000}""")
            "edit_text" -> { e.executeJson("""{"op":"add_text","trackId":"t1","text":"A","startMs":0,"durationMs":3000}"""); before = e.project; e.executeJson("""{"op":"edit_text","itemId":"x1","text":"B"}""") }
            "add_audio" -> e.executeJson("""{"op":"add_audio","assetId":"m1","trackId":"m1","volume":0.3}""")
            "set_volume" -> { e.executeJson("""{"op":"add_audio","assetId":"m1","trackId":"m1","volume":0.3}"""); before = e.project; e.executeJson("""{"op":"set_volume","clipId":"a1","volume":0.7}""") }
        }
        return e to before
    }
    @Test fun eachMutationCanUndoToInitial() {
        listOf("import_clip", "trim_clip", "move_clip", "delete_clip", "add_text", "edit_text", "add_audio", "set_volume").forEach { op ->
            val (engine, before) = runOne(op); engine.undo(); assertEquals(before, engine.project, op)
        }
    }
    @Test fun rejectsInvalidCommandsWithoutChangingState() {
        val e = CommandEngine(initial()); e.executeJson("""{"op":"import_clip","assetId":"v1","trackId":"v1"}"""); val before = e.project
        listOf("""{"op":"trim_clip","clipId":"c1","inMs":-1}""", """{"op":"trim_clip","clipId":"missing","inMs":1}""", """{"op":"move_clip","clipId":"c1","toIndex":5}""").forEach { json ->
            assertFailsWith<DomainError> { e.executeJson(json) }; assertEquals(before, e.project)
        }
    }
    @Test fun manualAndJsonCommandSequencesAreDeterministic() {
        val manual = CommandEngine(initial()); val agent = CommandEngine(initial())
        val commands = listOf(
            """{"op":"import_clip","assetId":"v1","trackId":"v1"}""",
            """{"op":"import_clip","assetId":"v2","trackId":"v1"}""",
            """{"op":"trim_clip","clipId":"c1","inMs":0,"outMs":5000}""",
            """{"op":"move_clip","clipId":"c2","toIndex":0}""",
            """{"op":"add_text","trackId":"t1","text":"Merhaba Dünya","startMs":0,"durationMs":3000}""",
            """{"op":"add_audio","assetId":"m1","trackId":"m1","volume":0.3}"""
        )
        commands.forEach(manual::executeJson)
        agent.executeJson(commands.joinToString(prefix = "[", postfix = "]"))
        assertEquals(manual.project, agent.project)
    }
    @Test fun serializesAndRestores() { val e = CommandEngine(initial()); e.executeJson("""[{"op":"import_clip","assetId":"v1","trackId":"v1"},{"op":"add_text","trackId":"t1","text":"Merhaba Dünya","startMs":0,"durationMs":1000}]"""); assertEquals(e.project, ProjectJson.decode(ProjectJson.encode(e.project))) }
    @Test fun undoRedoJsonCommandsRestoreAndReapplyState() {
        val e = CommandEngine(initial()); val before = e.project
        e.executeJson("""{"op":"add_text","trackId":"t1","text":"A","startMs":0,"durationMs":1000}""")
        val after = e.project
        e.executeJson("""{"op":"undo"}"""); assertEquals(before, e.project)
        e.executeJson("""{"op":"redo"}"""); assertEquals(after, e.project)
    }
    @Test fun clarifyAndUnsupportedAreTyped() {
        assertFailsWith<DomainError.ClarificationRequired> { CommandEngine().executeJson("""{"op":"clarify","question":"hangi klip?"}""") }
        assertFailsWith<DomainError.Unsupported> { CommandEngine().executeJson("""{"op":"unsupported","reason":"efekt"}""") }
    }

    @Test fun twentyCommandsUndoAndRedoRoundTripSerializedState() {
        val engine = CommandEngine(initial())
        val before = ProjectJson.encode(engine.project)
        repeat(20) { index ->
            engine.executeJson("""{"op":"add_text","id":"txt$index","trackId":"t1","text":"Satır $index","startMs":${index * 1000},"durationMs":900}""")
        }
        val after = ProjectJson.encode(engine.project)
        repeat(20) { engine.undo() }
        assertEquals(before, ProjectJson.encode(engine.project))
        repeat(20) { engine.redo() }
        assertEquals(after, ProjectJson.encode(engine.project))
    }

}

