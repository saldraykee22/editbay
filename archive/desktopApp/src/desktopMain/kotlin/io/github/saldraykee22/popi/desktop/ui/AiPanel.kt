package io.github.saldraykee22.popi.desktop.ui

import io.github.saldraykee22.popi.ai.EditContext
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.saldraykee22.popi.desktop.ai.AiPanelController
import io.github.saldraykee22.popi.desktop.ai.AiPanelState
import io.github.saldraykee22.popi.desktop.ai.AiSettings
import io.github.saldraykee22.popi.domain.Project
import io.github.saldraykee22.popi.domain.describeChanges
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel

/**
 * Sağ panel: yazıyla düzenleme. Yazı varsayılandır; JSON komut alanı "Gelişmiş: komut" altında
 * kapalı durur. [onApply] komutları gerçek motorda çalıştırır, [onUndo] tek adım geri alır.
 */
@Composable
fun AiPanel(
    controller: AiPanelController,
    project: Project,
    onApply: (String) -> Unit,
    onUndo: () -> Unit,
    modifier: Modifier = Modifier,
    context: () -> EditContext = { EditContext() },
) {
    var text by remember { mutableStateOf("") }
    var advancedExpanded by remember { mutableStateOf(false) }
    var command by remember { mutableStateOf("") }
    val scope = remember { CoroutineScope(SupervisorJob() + Dispatchers.Default) }
    DisposableEffect(scope) { onDispose { scope.cancel() } }

    PopiPanel(modifier, padding = 14.dp, spacing = 10.dp) {
        Text("YAZIYLA DÜZENLE", color = PopiColors.textMuted, fontSize = 12.sp, letterSpacing = 1.sp)
        OutlinedTextField(
            value = text,
            onValueChange = { text = it },
            modifier = Modifier.fillMaxWidth().testTag("ai-input"),
            placeholder = { Text("Ne değişsin? Örn. \"müziği biraz kıs\"", color = PopiColors.textMuted, fontSize = 12.sp) },
            textStyle = TextStyle(color = PopiColors.text, fontSize = 13.sp),
            singleLine = true,
        )
        Button(
            onClick = {
                controller.request(text, project, context())
                text = ""
            },
            modifier = Modifier.fillMaxWidth().testTag("ai-send"),
            enabled = text.isNotBlank(),
        ) { Text("Gönder") }

        Column(
            Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            when (val state = controller.state) {
                AiPanelState.Disconnected -> ConnectCard(controller, scope)
                AiPanelState.Idle -> Unit
                is AiPanelState.Approval -> ApprovalCard(state, controller, scope)
                is AiPanelState.Sending -> SendingCard(controller)
                is AiPanelState.Ready -> ChangeCard(state, controller, onApply, onUndo)
                is AiPanelState.History -> HistoryCard(state, controller, onApply)
                is AiPanelState.Clarify -> ClarifyCard(state, controller)
                is AiPanelState.Rejected -> MessageCard(state.reason)
                is AiPanelState.Failed -> MessageCard(state.detail)
            }
        }

        TextButton(
            onClick = { advancedExpanded = !advancedExpanded },
            modifier = Modifier.testTag("advanced-toggle"),
        ) {
            Text(if (advancedExpanded) "Gelişmiş: komut ▲" else "Gelişmiş: komut ▼", color = PopiColors.textMuted, fontSize = 12.sp)
        }
        if (advancedExpanded) {
            OutlinedTextField(
                value = command,
                onValueChange = { command = it },
                modifier = Modifier.fillMaxWidth().heightIn(min = 96.dp).testTag("command-input"),
                label = { Text("JSON komutu", color = PopiColors.textMuted) },
                placeholder = { Text("{\"op\":...}", color = PopiColors.textMuted) },
                textStyle = TextStyle(color = PopiColors.text, fontFamily = PopiFonts.mono, fontSize = 12.sp),
            )
            Button(
                onClick = { onApply(command); command = "" },
                modifier = Modifier.fillMaxWidth(),
                enabled = command.isNotBlank(),
            ) { Text("Komutu gönder") }
        }
    }
}

@Composable
private fun Card(content: @Composable () -> Unit) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = PopiColors.raised,
        border = BorderStroke(1.dp, PopiColors.border),
        shape = RoundedCornerShape(8.dp),
    ) {
        Column(Modifier.fillMaxWidth().padding(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { content() }
    }
}

@Composable
private fun ConnectCard(controller: AiPanelController, scope: CoroutineScope) {
    var model by remember { mutableStateOf(controller.settings.model) }
    var key by remember { mutableStateOf("") }
    var provider by remember { mutableStateOf(controller.settings.provider) }

    Card {
        Text("Bağlan", color = PopiColors.text, fontSize = 13.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ProviderToggle("OpenRouter", selected = provider == AiSettings.PROVIDER_OPENROUTER) { provider = AiSettings.PROVIDER_OPENROUTER }
            ProviderToggle("Gemini", selected = provider == AiSettings.PROVIDER_GEMINI) { provider = AiSettings.PROVIDER_GEMINI }
        }
        OutlinedTextField(
            value = model,
            onValueChange = { model = it },
            modifier = Modifier.fillMaxWidth().testTag("ai-model"),
            label = { Text("Model adı", color = PopiColors.textMuted) },
            textStyle = TextStyle(color = PopiColors.text, fontSize = 12.sp),
            singleLine = true,
        )
        OutlinedTextField(
            value = key,
            onValueChange = { key = it },
            modifier = Modifier.fillMaxWidth().testTag("ai-key"),
            label = { Text("API anahtarı", color = PopiColors.textMuted) },
            textStyle = TextStyle(color = PopiColors.text, fontSize = 12.sp),
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            singleLine = true,
        )
        TextButton(
            onClick = { controller.connectWithKey(provider, model, key) },
            modifier = Modifier.testTag("ai-connect-key"),
        ) { Text("Anahtar ile bağlan", color = PopiColors.accent) }
        TextButton(
            onClick = { controller.connectOAuth(scope, model) },
            modifier = Modifier.testTag("ai-oauth"),
        ) { Text("OpenRouter ile bağlan", color = PopiColors.accent) }
        if (controller.connecting) Text("Bağlanıyor…", color = PopiColors.textMuted, fontSize = 11.sp)
        controller.connectError?.let { MessageCard(it) }
    }
}

@Composable
private fun ProviderToggle(label: String, selected: Boolean, onClick: () -> Unit) {
    TextButton(onClick = onClick) {
        Text(label, color = if (selected) PopiColors.accent else PopiColors.textMuted, fontSize = 12.sp)
    }
}

@Composable
private fun ApprovalCard(
    state: AiPanelState.Approval,
    controller: AiPanelController,
    scope: CoroutineScope,
) {
    var systemExpanded by remember { mutableStateOf(false) }
    Card {
        Text("Onay", color = PopiColors.text, fontSize = 13.sp, modifier = Modifier.testTag("ai-approval"))
        Text("Kullanıcı mesajı", color = PopiColors.textMuted, fontSize = 11.sp)
        Text(state.outgoing.user, color = PopiColors.text, fontSize = 12.sp)
        TextButton(onClick = { systemExpanded = !systemExpanded }) {
            Text(if (systemExpanded) "Sistem talimatı ▲" else "Sistem talimatı ▼", color = PopiColors.textMuted, fontSize = 11.sp)
        }
        if (systemExpanded) Text(state.outgoing.system, color = PopiColors.textMuted, fontSize = 11.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { controller.approve(scope) }, modifier = Modifier.testTag("ai-approve")) { Text("Gönder") }
            TextButton(onClick = { controller.dismiss() }) { Text("Vazgeç", color = PopiColors.textMuted) }
        }
    }
}

@Composable
private fun SendingCard(controller: AiPanelController) {
    Card {
        Text("Gönderiliyor…", color = PopiColors.text, fontSize = 13.sp)
        TextButton(onClick = { controller.cancel() }, modifier = Modifier.testTag("ai-cancel")) {
            Text("İptal", color = PopiColors.textMuted)
        }
    }
}

@Composable
private fun ChangeCard(
    state: AiPanelState.Ready,
    controller: AiPanelController,
    onApply: (String) -> Unit,
    onUndo: () -> Unit,
) {
    Card {
        Text(if (state.applied) "Uygulandı" else "Değişiklikler", color = PopiColors.text, fontSize = 13.sp)
        describeChanges(state.before, state.after).forEach { line ->
            Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(Modifier.width(2.dp).fillMaxHeight().background(PopiColors.accent))
                Text(line, color = PopiColors.text, fontSize = 12.sp)
            }
        }
        if (state.applied) {
            TextButton(onClick = { controller.dismiss() }) { Text("Tamam", color = PopiColors.textMuted) }
            Button(onClick = { onUndo(); controller.dismiss() }, modifier = Modifier.testTag("ai-undo")) { Text("Geri al") }
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { onApply(state.commandsJson); controller.markApplied() }, modifier = Modifier.testTag("ai-apply")) { Text("Uygula") }
                TextButton(onClick = { controller.dismiss() }) { Text("Vazgeç", color = PopiColors.textMuted) }
            }
        }
    }
}

@Composable
private fun HistoryCard(state: AiPanelState.History, controller: AiPanelController, onApply: (String) -> Unit) {
    Card {
        Text(
            if (state.op == "undo") "Son işlem geri alınacak" else "Geri alınan işlem yinelenecek",
            color = PopiColors.text,
            fontSize = 13.sp,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = { onApply("""{"op":"${state.op}"}"""); controller.dismiss() },
                modifier = Modifier.testTag("ai-history"),
            ) { Text("Uygula") }
            TextButton(onClick = { controller.dismiss() }) { Text("Vazgeç", color = PopiColors.textMuted) }
        }
    }
}

@Composable
private fun ClarifyCard(state: AiPanelState.Clarify, controller: AiPanelController) {
    Card {
        Text("Model soruyor", color = PopiColors.textMuted, fontSize = 11.sp)
        Text(state.question, color = PopiColors.text, fontSize = 13.sp)
        Text("Cevabınızı yukarıdaki alana yazın.", color = PopiColors.textMuted, fontSize = 11.sp)
        TextButton(onClick = { controller.dismiss() }) { Text("Vazgeç", color = PopiColors.textMuted) }
    }
}

/** Hata ya da ret açıklaması. Kırmızı yok; yazı renginde, solunda ince vurgu çizgisi. */
@Composable
private fun MessageCard(detail: String) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = PopiColors.surface,
        border = BorderStroke(1.dp, PopiColors.border),
        shape = RoundedCornerShape(8.dp),
    ) {
        Row(Modifier.fillMaxWidth().padding(10.dp).height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.width(2.dp).fillMaxHeight().background(PopiColors.accent))
            Text(detail, color = PopiColors.text, fontSize = 12.sp)
        }
    }
}
