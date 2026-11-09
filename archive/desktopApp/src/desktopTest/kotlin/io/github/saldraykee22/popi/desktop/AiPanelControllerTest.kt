package io.github.saldraykee22.popi.desktop

import io.github.saldraykee22.popi.ai.EditContext
import io.github.saldraykee22.popi.desktop.ai.AiPanelController
import io.github.saldraykee22.popi.desktop.ai.AiPanelState
import io.github.saldraykee22.popi.desktop.ai.AiSettings
import io.github.saldraykee22.popi.desktop.ai.AiSettingsStore
import io.github.saldraykee22.popi.domain.Project
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout

class AiPanelControllerTest {
    private fun controller(response: String): AiPanelController {
        val secrets = InMemorySecretStore().apply { put("openrouter-key", "sk-test") }
        val settings = AiSettingsStore(Files.createTempDirectory("popi-ayar").resolve("ayarlar.json"))
        settings.save(AiSettings(AiSettings.PROVIDER_OPENROUTER, "test-model"))
        return AiPanelController(secretStore = secrets, settingsStore = settings, transportFactory = fakeTransportFactory(response))
    }

    private fun AiPanelController.awaitResult() = runBlocking {
        withTimeout(5_000) { while (state is AiPanelState.Sending) kotlinx.coroutines.delay(10) }
    }

    @Test fun selectionAndRecentActionsReachApprovalCard() {
        val c = controller("""[{"op":"undo"}]""")
        c.request("bu klibi sil", Project(), EditContext("c2", listOf("Müzik (a1) sesi: %100 → %40")))
        val approval = assertIs<AiPanelState.Approval>(c.state)
        assertTrue(approval.outgoing.user.contains("Seçili öğe: c2"))
        assertTrue(approval.outgoing.user.contains("Müzik (a1) sesi: %100 → %40"))
    }

    @Test fun undoAnswerBecomesHistoryCard() = runBlocking {
        val c = controller("""[{"op":"undo"}]""")
        c.request("son yaptığımı geri al", Project())
        c.approve(this)
        c.awaitResult()
        assertEquals(AiPanelState.History("undo"), c.state)
    }
}
