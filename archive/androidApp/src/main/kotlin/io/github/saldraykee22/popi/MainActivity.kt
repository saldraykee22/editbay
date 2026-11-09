package io.github.saldraykee22.popi

import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.transformer.CompositionPlayer
import androidx.media3.transformer.Transformer
import androidx.media3.ui.PlayerView
import io.github.saldraykee22.popi.domain.*
import java.io.File

@OptIn(UnstableApi::class)
class MainActivity : ComponentActivity() {
    lateinit var engine: CommandEngine
        private set
    lateinit var store: ProjectStore
        private set
    private var player: Player? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        File(getExternalFilesDir(null), "medya").mkdirs()
        store = ProjectStore(this)
        engine = CommandEngine(store.load() ?: Project())
        setContent { StudioScreen(this) }
    }
    fun applyCommand(json: String) { engine.executeJson(json); store.save(engine.project); refreshPlayer() }
    fun importMedia() {
        val dir = File(getExternalFilesDir(null), "medya")
        dir.mkdirs()
        val files = dir.listFiles()?.filter { it.extension.lowercase() in setOf("mp4", "m4a") }.orEmpty()
        val assets = files.map { f -> Asset(f.nameWithoutExtension, if (f.extension.lowercase() == "m4a") "audio" else "video", f.toURI().toString(), durationMs(f)) }
        val known = engine.project.assets.map { it.id }.toSet()
        val newAssets = assets.filterNot { it.id in known }
        engine.registerAssets(assets)
        newAssets.filter { it.kind == "video" }.forEach { asset -> applyCommand("""{"op":"import_clip","assetId":"${asset.id}","trackId":"v1"}""") }
        store.save(engine.project)
    }
    fun exportNow(relativeOut: String = "cikti/export.mp4") {
        val safeName = relativeOut.replace('\\', '/').substringAfterLast('/').ifBlank { "export.mp4" }
        val out = File(getExternalFilesDir(null), "cikti/$safeName")
        AndroidRenderer(this).export(RenderRequest(engine.project, out.absolutePath)) { result ->
            runOnUiThread {
                result.fold(
                    { Toast.makeText(this, "Dışa aktarıldı: ${it.outputPath}", Toast.LENGTH_LONG).show() },
                    { Toast.makeText(this, "Dışa aktarma hatası: ${it.message}", Toast.LENGTH_LONG).show() },
                )
            }
        }
    }
    @OptIn(androidx.media3.common.util.ExperimentalApi::class)
    private fun refreshPlayer() {
        runCatching { player?.release() }
        player = runCatching {
            CompositionPlayer.Builder(this).build().also { p -> p.setComposition(MediaAdapter.composition(this, engine.project)); p.prepare() }
        }.getOrElse {
            // Fallback stays on Media3; this preview plays the trimmed clip playlist.
            ExoPlayer.Builder(this).build().also { p ->
                val items = engine.project.tracks.first { it.kind == "video" }.clips.map { clip ->
                    val asset = engine.project.assets.first { it.id == clip.assetId }
                    MediaItem.Builder().setUri(asset.uri).setClippingConfiguration(MediaItem.ClippingConfiguration.Builder().setStartPositionMs(clip.inMs).setEndPositionMs(clip.outMs).build()).build()
                }
                p.setMediaItems(items); p.prepare()
            }
        }
    }
    fun currentPlayer(): Player? { if (player == null) refreshPlayer(); return player }
    private fun durationMs(file: File): Long {
        val retriever = android.media.MediaMetadataRetriever()
        return try { retriever.setDataSource(file.absolutePath); retriever.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLong() ?: 0L } finally { retriever.release() }
    }
    override fun onDestroy() { player?.release(); super.onDestroy() }
}

@Composable private fun StudioScreen(activity: MainActivity) {
    var project by remember { mutableStateOf(activity.engine.project) }
    var command by remember { mutableStateOf("{\"op\":\"add_text\",\"trackId\":\"t1\",\"text\":\"Merhaba Dünya\",\"startMs\":0,\"durationMs\":3000}") }
    var message by remember { mutableStateOf("") }
    val context = LocalContext.current
    fun refresh() { project = activity.engine.project }
    MaterialTheme {
        Column(Modifier.fillMaxSize().padding(12.dp)) {
            Text("Hafızalı Studio · ENGINE-POC", style = MaterialTheme.typography.titleLarge)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { activity.importMedia(); refresh() }) { Text("Medya içe aktar") }
                Button(onClick = { runCatching { activity.exportNow() }.onFailure { message = it.message ?: "Export hatası" } }) { Text("Dışa Aktar") }
                OutlinedButton(onClick = { runCatching { activity.applyCommand("""{"op":"undo"}"""); refresh() }.onFailure { message = it.message ?: "Undo yok" } }) { Text("Undo") }
                OutlinedButton(onClick = { runCatching { activity.applyCommand("""{"op":"redo"}"""); refresh() }.onFailure { message = it.message ?: "Redo yok" } }) { Text("Redo") }
            }
            AndroidView(modifier = Modifier.fillMaxWidth().height(220.dp), factory = { ctx -> PlayerView(ctx).apply { player = activity.currentPlayer(); useController = true } }, update = { it.player = activity.currentPlayer() })
            Text("Klipler", style = MaterialTheme.typography.titleMedium)
            LazyColumn(Modifier.weight(1f, fill = false)) {
                items(project.tracks.firstOrNull { it.kind == "video" }?.clips.orEmpty(), key = { it.id }) { clip ->
                    val asset = project.assets.firstOrNull { it.id == clip.assetId }
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("${asset?.id}: ${clip.inMs}–${clip.outMs} ms", Modifier.weight(1f))
                        TextButton(onClick = { runCatching { activity.applyCommand("""{"op":"trim_clip","clipId":"${clip.id}","inMs":0,"outMs":5000}"""); refresh() }.onFailure { message = it.message ?: "Trim hatası" } }) { Text("Trim 5s") }
                        TextButton(onClick = { runCatching { activity.applyCommand("""{"op":"move_clip","clipId":"${clip.id}","toIndex":0}"""); refresh() }.onFailure { message = it.message ?: "Sıralama hatası" } }) { Text("Başa") }
                        TextButton(onClick = { runCatching { activity.applyCommand("""{"op":"delete_clip","clipId":"${clip.id}"}"""); refresh() }.onFailure { message = it.message ?: "Silme hatası" } }) { Text("Sil") }
                    }
                }
            }
            OutlinedTextField(command, { command = it }, Modifier.fillMaxWidth(), label = { Text("JSON komutu") }, minLines = 2)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { runCatching {
                    val parsed = kotlinx.serialization.json.Json.parseToJsonElement(command)
                    if (parsed is kotlinx.serialization.json.JsonObject && parsed["op"]?.toString()?.trim('"') == "export_project") {
                        require(parsed["preset"]?.toString()?.trim('"') == "1080x1920_30") { "Desteklenen preset: 1080x1920_30" }
                        activity.exportNow(parsed["out"]?.toString()?.trim('"') ?: "export.mp4")
                    } else activity.applyCommand(command)
                    refresh(); message = "Komut uygulandı"
                }.onFailure { message = it.message ?: "Komut geçersiz" } }) { Text("Komutu uygula") }
                OutlinedButton(onClick = { command = """{"op":"add_audio","assetId":"muzik","trackId":"m1","volume":0.3}""" }) { Text("Müzik 0.3") }
            }
            if (message.isNotBlank()) Text(message)
        }
    }
}


