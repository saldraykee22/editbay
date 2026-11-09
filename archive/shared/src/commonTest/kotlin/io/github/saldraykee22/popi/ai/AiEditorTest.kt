package io.github.saldraykee22.popi.ai

import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class AiEditorTest {
    private val editor = AiEditor()

    private class Capture(private val response: String) : LlmTransport {
        var last: LlmRequest? = null
        override fun complete(request: LlmRequest): String {
            last = request
            return response
        }
    }

    @Test fun validCommandsProduceReadyAndDoNotMutateProject() {
        val project = sampleProject()
        val transport = Capture("""[{"op":"add_text","trackId":"t1","text":"Merhaba","startMs":0,"durationMs":1000}]""")
        val proposal = editor.propose("başa merhaba yaz", project, transport)
        val ready = assertIs<Proposal.Ready>(proposal)
        assertTrue(ready.after.tracks.first { it.id == "t1" }.items.any { it.text == "Merhaba" })
        assertEquals(1, project.tracks.first { it.id == "t1" }.items.size)
        assertEquals(project, ready.before)
    }

    @Test fun undoBecomesHistoryStep() {
        val proposal = editor.propose("son yaptığımı geri al", sampleProject(), Capture("""[{"op":"undo"}]"""))
        assertEquals(Proposal.HistoryStep("undo"), proposal)
    }

    @Test fun contextGoesIntoOutgoingAndIsSent() {
        val transport = Capture("""[{"op":"delete_clip","clipId":"c2"}]""")
        val context = EditContext(selectedId = "c2", recentActions = listOf("Müzik (a1) sesi: %100 → %40"))
        editor.propose("bu klibi sil", sampleProject(), transport, context)
        val sent = transport.last!!
        assertEquals(editor.outgoing("bu klibi sil", sampleProject(), context), sent)
        assertContains(sent.user, "Seçili öğe: c2")
        assertContains(sent.user, "Müzik (a1) sesi: %100 → %40")
        assertContains(editor.outgoing("x", sampleProject()).user, "Seçili öğe: yok")
    }

    @Test fun engineRejectionBecomesRejected() {
        val transport = Capture("""[{"op":"trim_clip","clipId":"c1","inMs":100,"outMs":999999}]""")
        val proposal = editor.propose("kırp", sampleProject(), transport)
        assertIs<Proposal.Rejected>(proposal)
    }

    @Test fun transportExceptionBecomesFailed() {
        val transport = LlmTransport { throw RuntimeException("bağlantı koptu") }
        val proposal = editor.propose("bir şey yap", sampleProject(), transport)
        val failed = assertIs<Proposal.Failed>(proposal)
        assertContains(failed.detail, "bağlantı koptu")
    }

    @Test fun sentRequestEqualsOutgoing() {
        val project = sampleProject()
        val transport = Capture("""[{"op":"undo"}]""")
        editor.propose("geri al", project, transport)
        assertEquals(editor.outgoing("geri al", project), transport.last)
    }

    @Test fun unsupportedResponseBecomesRejected() {
        val transport = Capture("""[{"op":"unsupported","reason":"efekt yok"}]""")
        assertIs<Proposal.Rejected>(editor.propose("filtre ekle", sampleProject(), transport))
    }

    @Test fun clarifyResponseBecomesNeedsClarification() {
        val transport = Capture("""{"op":"clarify","question":"Hangi klip?"}""")
        val proposal = editor.propose("şunu kes", sampleProject(), transport)
        assertEquals(Proposal.NeedsClarification("Hangi klip?"), proposal)
    }

    @Test fun invalidResponseBecomesFailed() {
        val transport = Capture("Bunu yapamam.")
        assertIs<Proposal.Failed>(editor.propose("bir şey", sampleProject(), transport))
    }
}
