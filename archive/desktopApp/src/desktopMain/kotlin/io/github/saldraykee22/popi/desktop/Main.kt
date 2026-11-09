package io.github.saldraykee22.popi.desktop

import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.toComposeImageBitmap
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.isMetaPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.application
import io.github.saldraykee22.popi.desktop.ai.AiPanelController
import io.github.saldraykee22.popi.desktop.ai.AiSettingsStore
import io.github.saldraykee22.popi.desktop.ai.DefaultLlmTransportFactory
import io.github.saldraykee22.popi.desktop.ai.LlmTransportFactory
import io.github.saldraykee22.popi.desktop.preview.PreviewEngine
import io.github.saldraykee22.popi.desktop.secrets.DpapiSecretStore
import io.github.saldraykee22.popi.desktop.ui.AiPanel
import io.github.saldraykee22.popi.desktop.ui.MediaEntry
import io.github.saldraykee22.popi.desktop.ui.MediaKind
import io.github.saldraykee22.popi.desktop.ui.MediaPanel
import io.github.saldraykee22.popi.desktop.ui.MediaThumbnailSource
import io.github.saldraykee22.popi.desktop.ui.PopiColors
import io.github.saldraykee22.popi.desktop.ui.PopiFonts
import io.github.saldraykee22.popi.desktop.ui.PopiPanel
import io.github.saldraykee22.popi.desktop.ui.PopiTheme
import io.github.saldraykee22.popi.desktop.ui.PreviewArea
import io.github.saldraykee22.popi.desktop.ui.PreviewFrame
import io.github.saldraykee22.popi.desktop.ui.StatusLine
import io.github.saldraykee22.popi.desktop.ui.StatusMessage
import io.github.saldraykee22.popi.desktop.ui.TimelineBlock
import io.github.saldraykee22.popi.desktop.ui.TimelineLane
import io.github.saldraykee22.popi.desktop.ui.formatTimecode
import io.github.saldraykee22.popi.desktop.ui.planMediaImport
import io.github.saldraykee22.popi.ai.EditContext
import io.github.saldraykee22.popi.domain.Asset
import io.github.saldraykee22.popi.domain.describeChanges
import io.github.saldraykee22.popi.domain.Clip
import io.github.saldraykee22.popi.domain.CommandEngine
import io.github.saldraykee22.popi.domain.Project
import io.github.saldraykee22.popi.domain.Track
import io.github.saldraykee22.popi.secrets.SecretStore
import java.awt.Component
import java.awt.datatransfer.DataFlavor
import java.awt.dnd.DnDConstants
import java.awt.dnd.DropTarget
import java.awt.dnd.DropTargetAdapter
import java.awt.dnd.DropTargetDropEvent
import java.io.File
import java.net.URI
import java.nio.file.Path
import kotlin.concurrent.thread
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.channels.ReceiveChannel
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

fun main() = application {
    val dropInbox = remember { FileDropInbox() }
    Window(onCloseRequest = ::exitApplication, title = "popi") {
        DisposableEffect(window) {
            installFileDrop(window) { files -> dropInbox.offer(files) }
            onDispose { window.dropTarget = null }
        }
        PopiTheme { DesktopScreen(dropInbox = dropInbox) }
    }
}

/** Pencereye bırakılan dosya gruplarını arayüze iletir. Gönderim iş parçacığı güvenlidir. */
class FileDropInbox {
    private val channel = Channel<List<File>>(Channel.UNLIMITED)

    internal val batches: ReceiveChannel<List<File>> get() = channel

    fun offer(files: List<File>) {
        channel.trySend(files)
    }
}

/** Windows Gezgini'nden bırakılan dosyaları yakalar. Bırakma geçersizse reddeder. */
private fun installFileDrop(component: Component, onFiles: (List<File>) -> Unit): DropTarget =
    DropTarget(component, DnDConstants.ACTION_COPY, object : DropTargetAdapter() {
        override fun drop(event: DropTargetDropEvent) {
            if (!event.isDataFlavorSupported(DataFlavor.javaFileListFlavor)) {
                event.rejectDrop()
                return
            }
            event.acceptDrop(DnDConstants.ACTION_COPY)
            val files = runCatching {
                @Suppress("UNCHECKED_CAST")
                event.transferable.getTransferData(DataFlavor.javaFileListFlavor) as List<File>
            }.getOrNull()
            event.dropComplete(files != null)
            if (files != null) onFiles(files)
        }
    }, true)

@Composable
internal fun DesktopScreen(
    storeOverride: ProjectStore? = null,
    platformOverride: DesktopPlatform? = null,
    thumbnailOverride: MediaThumbnailSource? = null,
    dropInbox: FileDropInbox? = null,
    previewContent: (@Composable (Modifier) -> Unit)? = null,
    secretStoreOverride: SecretStore? = null,
    transportFactoryOverride: LlmTransportFactory? = null,
    settingsFileOverride: Path? = null,
) {
    val platform = remember(platformOverride) { platformOverride ?: WindowsDesktopPlatform() }
    val store = remember(storeOverride) { storeOverride ?: ProjectStore() }
    val thumbnails = remember(thumbnailOverride) {
        thumbnailOverride ?: DesktopMediaThumbnails(Thumbnails(defaultThumbnailCacheDir()))
    }
    val secretStore = remember(secretStoreOverride) { secretStoreOverride ?: DpapiSecretStore() }
    val settingsStore = remember(settingsFileOverride) {
        AiSettingsStore(settingsFileOverride ?: AiSettingsStore.defaultFile())
    }
    val aiController = remember(secretStore, settingsStore, transportFactoryOverride) {
        AiPanelController(
            secretStore = secretStore,
            settingsStore = settingsStore,
            transportFactory = transportFactoryOverride ?: DefaultLlmTransportFactory,
        )
    }
    val restored = remember { store.loadLast() }
    var engine by remember { mutableStateOf(CommandEngine(restored?.second ?: Project())) }
    var project by remember { mutableStateOf(engine.project) }
    var projectName by remember { mutableStateOf(restored?.first ?: "Adsız Proje") }
    var status by remember { mutableStateOf(StatusMessage("Hazır")) }
    var selectedClipId by remember { mutableStateOf<String?>(null) }
    var recentActions by remember { mutableStateOf(emptyList<String>()) }
    var playheadMs by remember { mutableLongStateOf(0L) }
    var playing by remember { mutableStateOf(false) }
    var exportRunning by remember { mutableStateOf(false) }
    var exportPercent by remember { mutableIntStateOf(0) }
    val renderer = remember { DesktopRenderer() }
    val previewEngine = remember { PreviewEngine() }
    var previewImage by remember { mutableStateOf<ImageBitmap?>(null) }
    val videoTrack: Track? = project.tracks.firstOrNull { it.kind == "video" }
    val audioTrack: Track? = project.tracks.firstOrNull { it.kind == "audio" }
    val textTrack: Track? = project.tracks.firstOrNull { it.kind == "text" }
    val selectedClip: Clip? = videoTrack?.clips?.firstOrNull { it.id == selectedClipId }
    val duration = videoTrack?.clips?.sumOf { it.outMs - it.inMs } ?: 0L

    fun assetFor(assetId: String): Asset? = project.assets.firstOrNull { it.id == assetId }
    fun refresh() {
        project = engine.project
        if (selectedClipId !in videoTrack?.clips?.map { it.id }.orEmpty()) selectedClipId = null
    }
    fun save() {
        runCatching { store.save(projectName, project); status = StatusMessage("Kaydedildi") }
            .onFailure { status = StatusMessage("Kaydetme hatası: ${it.message}", true) }
    }
    /** Modelin "az önce yaptığımı geri al" isteğini anlaması için son değişiklik satırları (en yeni önce). */
    fun noteChanges(before: Project, prefix: String = "") {
        val lines = describeChanges(before, engine.project).map { prefix + it }
        if (lines.isNotEmpty()) recentActions = (lines + recentActions).take(5)
    }
    fun execute(json: String) {
        val before = engine.project
        runCatching { engine.executeJson(json); noteChanges(before); refresh(); save(); status = StatusMessage("Düzenleme uygulandı") }
            .onFailure { status = StatusMessage(it.message ?: "Komut uygulanamadı", true) }
    }
    fun undoEdit() {
        val before = engine.project
        runCatching { engine.undo(); noteChanges(before, "Geri alındı: "); refresh(); save(); status = StatusMessage("Geri alındı") }
            .onFailure { status = StatusMessage(it.message ?: "Geri alınacak işlem yok", true) }
    }
    fun redoEdit() {
        runCatching { engine.redo(); refresh(); save(); status = StatusMessage("Yinelendi") }
            .onFailure { status = StatusMessage(it.message ?: "Yinelenecek işlem yok", true) }
    }
    fun togglePlay() {
        if (playing) {
            previewEngine.pause()
            playing = false
        } else if (duration > 0) {
            playing = true
            previewEngine.play(engine.project, playheadMs)
            if (!previewEngine.isPlaying) playing = false
        }
    }
    fun renameAsset(asset: Asset, label: String) {
        engine.relabelAsset(asset.id, label.trim().ifBlank { null })
        refresh()
        save()
    }
    fun importFiles(files: List<File>) {
        val plan = planMediaImport(files) { it.name }
        val result = runCatching {
            plan.accepted.forEach { (file, kind) ->
                val id = engine.nextAssetId()
                val label = file.name.substringBeforeLast('.', file.name)
                engine.registerAssets(listOf(Asset(id, kind.wire, file.toURI().toString(), probeDurationMs(file), label)))
                when (kind) {
                    MediaKind.VIDEO -> engine.executeJson("""{"op":"import_clip","assetId":"$id","trackId":"v1"}""")
                    MediaKind.AUDIO -> {
                        val audioCount = engine.project.tracks.firstOrNull { it.kind == "audio" }?.clips?.size ?: 0
                        if (audioCount == 0) engine.executeJson("""{"op":"add_audio","assetId":"$id","trackId":"m1","volume":0.3}""")
                    }
                }
            }
            refresh()
            save()
        }
        val notice = plan.notice
        status = when {
            result.isFailure -> StatusMessage(result.exceptionOrNull()?.message ?: "İçe aktarma hatası", true)
            notice != null && plan.accepted.isEmpty() -> StatusMessage(notice, true)
            notice != null -> StatusMessage("${plan.accepted.size} medya içe aktarıldı. $notice", true)
            else -> StatusMessage("${plan.accepted.size} medya içe aktarıldı")
        }
    }

    // Önizleme motoru geri çağrıları; pencere kapanınca motor kapanır ve FFmpeg süreçleri temizlenir.
    DisposableEffect(previewEngine) {
        previewEngine.onFrame = { image, _ -> previewImage = image.toComposeImageBitmap() }
        previewEngine.onPosition = { ms -> playheadMs = ms }
        previewEngine.onEnd = { playing = false }
        onDispose { previewEngine.close() }
    }

    LaunchedEffect(project) {
        delay(500)
        runCatching { store.save(projectName, project) }
    }
    LaunchedEffect(dropInbox) {
        dropInbox?.let { inbox -> for (batch in inbox.batches) importFiles(batch) }
    }
    // Düzenleme sonrası o anki konumun karesi yenilenir. Proje anahtarı değişince eski istek iptal olur.
    LaunchedEffect(project, projectName) {
        if (duration <= 0) return@LaunchedEffect
        delay(PREVIEW_DEBOUNCE_MS)
        val at = playheadMs.coerceIn(0L, (duration - 1).coerceAtLeast(0L))
        val frame = withContext(Dispatchers.IO) { runCatching { previewEngine.frameAt(project, at) }.getOrNull() }
        if (frame != null) previewImage = frame.toComposeImageBitmap()
    }

    // Zaman çizelgesi blokları: video klipleri art arda, ses ve metin kendi başlangıçlarında.
    val videoBlocks: List<TimelineBlock> = run {
        var cursor = 0L
        videoTrack?.clips.orEmpty().map { clip ->
            val length = clip.outMs - clip.inMs
            TimelineBlock(clip.id, assetFor(clip.assetId)?.let(::assetLabel) ?: "Klip", cursor, length, assetFor(clip.assetId))
                .also { cursor += length }
        }
    }
    val audioBlocks: List<TimelineBlock> = audioTrack?.clips.orEmpty().map { clip ->
        TimelineBlock(clip.id, assetFor(clip.assetId)?.let(::assetLabel) ?: "Ses", clip.startMs ?: 0L, clip.outMs - clip.inMs, assetFor(clip.assetId))
    }
    val textBlocks: List<TimelineBlock> = textTrack?.items.orEmpty().map { item ->
        TimelineBlock(item.id, item.text, item.startMs, item.durationMs)
    }
    val timelineTotal = (videoBlocks + audioBlocks + textBlocks)
        .maxOfOrNull { it.startMs + it.durationMs }
        ?.coerceAtLeast(duration)
        ?.coerceAtLeast(1L)
        ?: duration.coerceAtLeast(1L)
    val mediaEntries = project.assets.map { MediaEntry(it, assetLabel(it)) }
    val hint = if (videoTrack?.clips.isNullOrEmpty()) "Medya içe aktar" else "Önizleme hazırlanıyor"
    val defaultPreview: @Composable (Modifier) -> Unit = { modifier -> PreviewFrame(modifier, previewImage, hint) }

    Column(Modifier.fillMaxSize().background(PopiColors.ground).onPreviewKeyEvent { event ->
        if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
        val ctrl = event.isCtrlPressed || event.isMetaPressed
        when {
            ctrl && event.key == Key.Z -> { undoEdit(); true }
            ctrl && event.key == Key.Y -> { redoEdit(); true }
            ctrl && event.key == Key.S -> { save(); true }
            event.key == Key.Spacebar -> { togglePlay(); true }
            event.key == Key.Delete && selectedClipId != null -> { execute("""{"op":"delete_clip","clipId":"$selectedClipId"}"""); selectedClipId = null; true }
            else -> false
        }
    }.focusable()) {
        Row(
            Modifier.fillMaxWidth().height(64.dp).background(PopiColors.surface).padding(horizontal = 18.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("popi", color = PopiColors.accent, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
            OutlinedTextField(
                value = projectName,
                onValueChange = { projectName = it },
                modifier = Modifier.width(220.dp),
                singleLine = true,
                textStyle = TextStyle(color = PopiColors.text, fontSize = 14.sp),
                label = { Text("Proje adı", color = PopiColors.textMuted) },
            )
            Spacer(Modifier.weight(1f))
            TextButton(onClick = { undoEdit() }, enabled = engine.canUndo()) { Text("↶ Geri al") }
            TextButton(onClick = { redoEdit() }, enabled = engine.canRedo()) { Text("↷ Yinele") }
            Button(
                onClick = {
                    val output = platform.chooseExportPath(projectName) ?: return@Button
                    exportRunning = true
                    exportPercent = 0
                    thread(name = "popi-export") {
                        runCatching { renderer.export(project, output) { exportPercent = it } }
                            .onSuccess { status = StatusMessage("Dışa aktarıldı: ${it.fileName}") }
                            .onFailure { status = StatusMessage("Dışa aktarma hatası: ${it.message}", true) }
                        exportRunning = false
                    }
                },
                enabled = !exportRunning && (videoTrack?.clips?.isNotEmpty() == true),
            ) { Text(if (exportRunning) "Dışa aktarılıyor %$exportPercent" else "Dışa aktar") }
            if (exportRunning) {
                TextButton(onClick = { renderer.cancelExport(); status = StatusMessage("Dışa aktarma iptal ediliyor") }) { Text("İptal") }
            }
        }
        Row(Modifier.weight(1f).fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            MediaPanel(
                entries = mediaEntries,
                thumbnails = thumbnails,
                onImport = { importFiles(platform.chooseMediaFiles()) },
                onRename = ::renameAsset,
                modifier = Modifier.width(250.dp).fillMaxHeight(),
            )
            Column(Modifier.weight(1f).fillMaxHeight(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                PreviewArea(
                    preview = previewContent ?: defaultPreview,
                    playing = playing,
                    playheadLabel = "${formatTimecode(playheadMs)} / ${formatTimecode(duration)}",
                    onTogglePlay = { togglePlay() },
                    modifier = Modifier.weight(1f).fillMaxWidth(),
                )
                PopiPanel(Modifier.fillMaxWidth().height(228.dp), padding = 12.dp, spacing = 6.dp) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("ZAMAN ÇİZELGESİ", color = PopiColors.textMuted, fontSize = 12.sp, letterSpacing = 1.sp)
                        Spacer(Modifier.weight(1f))
                        TextButton(onClick = { previewEngine.seek(0L); playheadMs = 0L; playing = false }) { Text("Başa", color = PopiColors.accent) }
                    }
                    TimelineLane(
                        name = "Video",
                        blocks = videoBlocks,
                        totalMs = timelineTotal,
                        selectedId = selectedClipId,
                        thumbnails = thumbnails,
                        onSelect = { selectedClipId = it },
                        onSeek = { previewEngine.seek(it); playheadMs = it },
                    )
                    TimelineLane(
                        name = "Metin",
                        blocks = textBlocks,
                        totalMs = timelineTotal,
                        selectedId = null,
                        thumbnails = thumbnails,
                        onSelect = {},
                        onSeek = { previewEngine.seek(it); playheadMs = it },
                    )
                    TimelineLane(
                        name = "Müzik",
                        blocks = audioBlocks,
                        totalMs = timelineTotal,
                        selectedId = null,
                        thumbnails = thumbnails,
                        onSelect = {},
                        onSeek = { previewEngine.seek(it); playheadMs = it },
                    )
                }
            }
            Column(Modifier.width(320.dp).fillMaxHeight(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                AiPanel(
                    controller = aiController,
                    project = project,
                    onApply = { execute(it) },
                    onUndo = { undoEdit() },
                    modifier = Modifier.weight(1f).fillMaxWidth(),
                    context = { EditContext(selectedClipId, recentActions) },
                )
                selectedClip?.let { clip ->
                    ClipDetails(
                        clip = clip,
                        clips = videoTrack?.clips.orEmpty(),
                        onExecute = ::execute,
                        onCleared = { selectedClipId = null },
                    )
                }
                StatusLine(status)
            }
        }
    }
}

private const val PREVIEW_DEBOUNCE_MS = 150L

/** Dosya süresi (ms). FFprobe yoksa ya da okunamazsa 0 döner. */
private fun probeDurationMs(file: File): Long = runCatching {
    val process = ProcessBuilder("ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file.absolutePath).start()
    val seconds = process.inputStream.bufferedReader().readText().trim().toDoubleOrNull() ?: 0.0
    if (process.waitFor() == 0) (seconds * 1000).toLong() else 0L
}.getOrDefault(0L)

/** Varlık için ekranda görünecek ad: kullanıcının verdiği etiket, yoksa dosya adı. */
private fun assetLabel(asset: Asset): String =
    asset.label ?: runCatching { Path.of(URI(asset.uri)).fileName.toString() }.getOrDefault(asset.uri)

/** Seçili klip için elle düzenleme: kırp, taşı, sil. Hepsi komut motorundan geçer. */
@Composable
private fun ClipDetails(
    clip: Clip,
    clips: List<Clip>,
    onExecute: (String) -> Unit,
    onCleared: () -> Unit,
) {
    var inText by remember(clip.id, clip.inMs) { mutableStateOf(clip.inMs.toString()) }
    var outText by remember(clip.id, clip.outMs) { mutableStateOf(clip.outMs.toString()) }
    PopiPanel(padding = 12.dp, spacing = 8.dp) {
        Text("KLİP AYRINTILARI", color = PopiColors.textMuted, fontSize = 12.sp, letterSpacing = 1.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            OutlinedTextField(
                value = inText,
                onValueChange = { inText = it },
                modifier = Modifier.weight(1f).testTag("in-point"),
                label = { Text("Giriş ms") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                singleLine = true,
            )
            OutlinedTextField(
                value = outText,
                onValueChange = { outText = it },
                modifier = Modifier.weight(1f),
                label = { Text("Çıkış ms") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                singleLine = true,
            )
        }
        Button(
            onClick = {
                onExecute("""{"op":"trim_clip","clipId":"${clip.id}","inMs":${inText.toLongOrNull() ?: clip.inMs},"outMs":${outText.toLongOrNull() ?: clip.outMs}}""")
            },
            Modifier.fillMaxWidth(),
        ) { Text("Kırpmayı uygula") }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            OutlinedButton(
                onClick = {
                    val at = clips.indexOfFirst { it.id == clip.id }
                    if (at > 0) onExecute("""{"op":"move_clip","clipId":"${clip.id}","toIndex":${at - 1}}""")
                },
                Modifier.weight(1f),
            ) { Text("Sola") }
            OutlinedButton(
                onClick = {
                    val at = clips.indexOfFirst { it.id == clip.id }
                    if (at < clips.lastIndex) onExecute("""{"op":"move_clip","clipId":"${clip.id}","toIndex":${at + 1}}""")
                },
                Modifier.weight(1f),
            ) { Text("Sağa") }
            OutlinedButton(
                onClick = { onExecute("""{"op":"delete_clip","clipId":"${clip.id}"}"""); onCleared() },
                Modifier.weight(1f),
            ) { Text("Sil") }
        }
    }
}
