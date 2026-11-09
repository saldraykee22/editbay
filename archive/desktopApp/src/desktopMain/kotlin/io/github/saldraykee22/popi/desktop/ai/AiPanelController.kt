package io.github.saldraykee22.popi.desktop.ai

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import io.github.saldraykee22.popi.ai.AiEditor
import io.github.saldraykee22.popi.ai.EditContext
import io.github.saldraykee22.popi.ai.LlmRequest
import io.github.saldraykee22.popi.ai.Proposal
import io.github.saldraykee22.popi.desktop.secrets.OpenRouterOAuth
import io.github.saldraykee22.popi.domain.Project
import io.github.saldraykee22.popi.secrets.SecretStore
import java.awt.Desktop
import java.net.URI
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Yazıyla düzenleme panelinin tek anlık durumu. */
sealed interface AiPanelState {
    /** Anahtar ya da model adı yok; "Bağlan" kartı gösterilir. */
    data object Disconnected : AiPanelState

    /** Bağlı ve beklemede. */
    data object Idle : AiPanelState

    /** Gönderilecek içerik onay bekliyor. */
    data class Approval(
        val outgoing: LlmRequest,
        val userText: String,
        val project: Project,
        val context: EditContext = EditContext(),
    ) : AiPanelState

    /** İstek arka planda gönderiliyor. */
    data class Sending(val outgoing: LlmRequest, val userText: String, val project: Project) : AiPanelState

    /** Model uygulanabilir komutlar döndürdü. */
    data class Ready(
        val commandsJson: String,
        val before: Project,
        val after: Project,
        val userText: String,
        val applied: Boolean,
    ) : AiPanelState

    /** Model geçmiş adımı istedi ("undo" ya da "redo"); uygulanınca gerçek motorda çalışır. */
    data class History(val op: String) : AiPanelState

    /** Model ek bilgi istedi. */
    data class Clarify(val question: String, val userText: String) : AiPanelState

    /** Model isteği bu şemayla yapılamaz buldu. */
    data class Rejected(val reason: String) : AiPanelState

    /** Ağ ya da ayrıştırma hatası. */
    data class Failed(val detail: String) : AiPanelState
}

/**
 * Yazıyla düzenleme akışının durum makinesi. Arayüz yalnız bu nesneye bakar; ağ çağrısı
 * arka plan iş parçacığında yapılır ve anahtarlar hiçbir duruma, loga ya da ekrana yazılmaz.
 *
 * [secretStore] ve [transportFactory] enjekte edilebilir; testler ağa çıkmadan sahte taşıma kullanır.
 */
class AiPanelController(
    private val editor: AiEditor = AiEditor(),
    private val secretStore: SecretStore,
    private val settingsStore: AiSettingsStore = AiSettingsStore(),
    private val transportFactory: LlmTransportFactory = DefaultLlmTransportFactory,
) {
    var settings by mutableStateOf(settingsStore.load())
        private set

    var state by mutableStateOf<AiPanelState>(
        if (connected()) AiPanelState.Idle else AiPanelState.Disconnected,
    )
        private set

    var connectError by mutableStateOf<String?>(null)
        private set

    var connecting by mutableStateOf(false)
        private set

    private var sendJob: Job? = null
    private var oauthJob: Job? = null
    private var pendingClarification: Pair<String, String>? = null

    fun secretName(provider: String = settings.provider): String =
        if (provider == AiSettings.PROVIDER_GEMINI) "gemini-key" else "openrouter-key"

    fun connected(): Boolean = runCatching {
        !secretStore.get(secretName()).isNullOrBlank() && settings.model.isNotBlank()
    }.getOrDefault(false)

    /** Bağlantı durumunu yeniden okur; değişiklik yoksa Idle/Disconnected durumuna döner. */
    fun refresh() {
        state = if (connected()) AiPanelState.Idle else AiPanelState.Disconnected
    }

    fun selectProvider(provider: String) {
        settings = settings.copy(provider = provider)
        settingsStore.save(settings)
        refresh()
    }

    /** İsteği onay kartına taşır. Bağlantı yoksa "Bağlan" kartı gösterilir. */
    fun request(userText: String, project: Project, context: EditContext = EditContext()) {
        if (userText.isBlank()) return
        if (!connected()) {
            state = AiPanelState.Disconnected
            return
        }
        val combined = combineWithClarification(userText)
        val outgoing = editor.outgoing(combined, project, context)
        state = AiPanelState.Approval(outgoing, combined, project, context)
    }

    private fun combineWithClarification(userText: String): String {
        val pending = pendingClarification ?: return userText
        return "${pending.first}\n\nModel sorusu: ${pending.second}\nKullanıcının cevabı: $userText"
    }

    /** Onaylanan isteği arka planda gönderir. */
    fun approve(scope: CoroutineScope) {
        val approval = state as? AiPanelState.Approval ?: return
        val key = runCatching { secretStore.get(secretName()) }.getOrNull() ?: return
        val transport = transportFactory.create(settings.provider, settings.model, key)
        state = AiPanelState.Sending(approval.outgoing, approval.userText, approval.project)
        sendJob?.cancel()
        sendJob = scope.launch {
            val proposal = withContext(Dispatchers.Default) {
                editor.propose(approval.userText, approval.project, transport, approval.context)
            }
            when (proposal) {
                is Proposal.Ready -> {
                    pendingClarification = null
                    state = AiPanelState.Ready(
                        proposal.commandsJson, proposal.before, proposal.after, approval.userText, applied = false,
                    )
                }
                is Proposal.NeedsClarification -> {
                    pendingClarification = approval.userText to proposal.question
                    state = AiPanelState.Clarify(proposal.question, approval.userText)
                }
                is Proposal.HistoryStep -> {
                    pendingClarification = null
                    state = AiPanelState.History(proposal.op)
                }
                is Proposal.Rejected -> state = AiPanelState.Rejected(proposal.reason)
                is Proposal.Failed -> state = AiPanelState.Failed(proposal.detail)
            }
        }
    }

    /** Değişiklik kartı uygulandı olarak işaretlenir. */
    fun markApplied() {
        val ready = state as? AiPanelState.Ready ?: return
        state = ready.copy(applied = true)
    }

    /** Bekleyen kartı kapatır ve bağlantı durumuna döner. */
    fun dismiss() {
        pendingClarification = null
        refresh()
    }

    /** Akışı iptal eder. */
    fun cancel() {
        sendJob?.cancel()
        sendJob = null
        oauthJob?.cancel()
        oauthJob = null
        connecting = false
        refresh()
    }

    /** Anahtarı güvenli depoya yazar; ayarlar dosyasına yalnız sağlayıcı ve model gider. */
    fun connectWithKey(provider: String, model: String, key: String) {
        if (model.isBlank()) {
            connectError = "Model adı gerekli"
            return
        }
        if (key.isBlank()) {
            connectError = "Anahtar gerekli"
            return
        }
        val result = runCatching { secretStore.put(secretName(provider), key) }
        if (result.isFailure) {
            connectError = result.exceptionOrNull()?.message ?: "Anahtar kaydedilemedi"
            return
        }
        connectError = null
        settings = AiSettings(provider, model)
        settingsStore.save(settings)
        refresh()
    }

    /** OpenRouter OAuth PKCE akışını arka planda başlatır; tarayıcı [Desktop.browse] ile açılır. */
    fun connectOAuth(scope: CoroutineScope, model: String) {
        if (model.isBlank()) {
            connectError = "Model adı gerekli"
            return
        }
        connecting = true
        connectError = null
        oauthJob?.cancel()
        oauthJob = scope.launch {
            runCatching {
                OpenRouterOAuth(onOpenUrl = { url -> browse(url) }).authorize()
            }.onSuccess { key ->
                connecting = false
                connectWithKey(AiSettings.PROVIDER_OPENROUTER, model, key)
            }.onFailure {
                connecting = false
                connectError = it.message ?: "Bağlantı kurulamadı"
            }
        }
    }

    private fun browse(url: String) {
        runCatching { if (Desktop.isDesktopSupported()) Desktop.getDesktop().browse(URI(url)) }
    }
}
