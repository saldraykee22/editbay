package io.github.saldraykee22.popi.domain

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*

class CommandEngine(initial: Project = Project()) {
    var project: Project = initial
        private set
    private val undo = ArrayDeque<Project>()
    private val redo = ArrayDeque<Project>()
    private var nextId = 1

    fun registerAssets(assets: List<Asset>) {
        val known = project.assets.map { it.id }.toSet()
        project = project.copy(assets = project.assets + assets.filterNot { it.id in known })
    }

    /** Etiket düzenleme bir düzenleme adımı değildir: geçmişe girmez ve undo yığınını silmez. */
    fun relabelAsset(assetId: String, label: String?) {
        if (project.assets.none { it.id == assetId }) throw DomainError.NotFound("asset", assetId)
        fun Project.relabel() = copy(assets = assets.map { if (it.id == assetId) it.copy(label = label) else it })
        project = project.relabel()
        // replaceAll Kotlin/Native'de deneysel API; iOS derlemesi için elle döngü.
        for (i in undo.indices) undo[i] = undo[i].relabel()
        for (i in redo.indices) redo[i] = redo[i].relabel()
    }

    /** Sıradaki kısa varlık kimliği (`s1`, `s2`…); modele ve kullanıcıya uzun UUID gitmez. */
    fun nextAssetId(): String {
        val used = project.assets.mapNotNull { it.id.removePrefix("s").toIntOrNull() }
        return "s${(used.maxOrNull() ?: 0) + 1}"
    }

    fun executeJson(json: String): Project {
        val parsed = try { Json.parseToJsonElement(json) } catch (e: Exception) { throw DomainError.InvalidCommand("JSON: ${e.message}") }
        val commands = if (parsed is JsonArray) parsed else JsonArray(listOf(parsed))
        val historyOp = (commands.singleOrNull() as? JsonObject)?.get("op")?.jsonPrimitive?.content
        if (historyOp == "undo") return undo()
        if (historyOp == "redo") return redo()
        if (commands.any { it is JsonObject && it["op"]?.jsonPrimitive?.content in setOf("undo", "redo") }) {
            throw DomainError.InvalidCommand("undo/redo her çağrıda tek komut olmalı")
        }
        // Transactional: all commands validate and reduce against a temporary snapshot first.
        var candidate = project
        var generated = nextId
        val results = mutableListOf<Project>()
        for (element in commands) {
            val obj = element as? JsonObject ?: throw DomainError.InvalidCommand("Komut nesne olmalı")
            val op = obj.string("op")
            when (op) {
                "clarify" -> throw DomainError.ClarificationRequired(obj.string("question"))
                "unsupported" -> throw DomainError.Unsupported(obj.string("reason"))
                "import_clip" -> { candidate = Reducer.importClip(candidate, obj, "c$generated"); generated++ }
                else -> candidate = Reducer.apply(candidate, obj)
            }
            results += candidate
        }
        if (results.isNotEmpty()) {
            undo.addLast(project); project = candidate; redo.clear(); nextId = generated
        }
        return project
    }

    fun undo(): Project {
        if (undo.isEmpty()) throw DomainError.EmptyHistory
        redo.addLast(project); project = undo.removeLast(); return project
    }
    fun redo(): Project {
        if (redo.isEmpty()) throw DomainError.EmptyHistory
        undo.addLast(project); project = redo.removeLast(); return project
    }
    fun canUndo() = undo.isNotEmpty()
    fun canRedo() = redo.isNotEmpty()
}

object ProjectJson {
    private val json = Json { prettyPrint = true; ignoreUnknownKeys = false }
    fun encode(project: Project): String = json.encodeToString(project)
    fun decode(value: String): Project = json.decodeFromString(value)
}

private fun JsonObject.string(name: String): String = this[name]?.jsonPrimitive?.contentOrNull
    ?: throw DomainError.InvalidCommand("'$name' alanı gerekli")
private fun JsonObject.long(name: String, default: Long? = null): Long = this[name]?.jsonPrimitive?.longOrNull
    ?: default ?: throw DomainError.InvalidCommand("'$name' tam sayı olmalı")
private fun JsonObject.float(name: String, default: Float): Float = this[name]?.jsonPrimitive?.floatOrNull ?: default
/** Alan yoksa ya da JSON null ise null; değilse tam sayı zorunlu. */
private fun JsonObject.optionalLong(name: String): Long? = this[name]?.takeUnless { it is JsonNull }?.let { long(name) }

private object Reducer {
    fun importClip(project: Project, c: JsonObject, id: String): Project {
        val asset = project.assets.firstOrNull { it.id == c.string("assetId") } ?: throw DomainError.NotFound("asset", c.string("assetId"))
        if (asset.kind != "video") throw DomainError.InvalidRange("import_clip yalnız video asset alır")
        val trackId = c.string("trackId")
        val track = project.tracks.find { it.id == trackId && it.kind == "video" } ?: throw DomainError.NotFound("video track", trackId)
        val index = c.long("index", track.clips.size.toLong()).toInt()
        if (index !in 0..track.clips.size) throw DomainError.InvalidRange("index aralık dışında")
        val clip = Clip(id, asset.id, 0, asset.durationMs)
        return project.replaceTrack(track.copy(clips = track.clips.toMutableList().apply { add(index, clip) }))
    }

    /**
     * Klibi aynı iz içinde taşır. Ya `after` (klip kimliği ya da JSON null: başa) ya da `toIndex` verilmelidir.
     * Alan yokluğu ile JSON null farklıdır: `"after": null` geçerli, alanın hiç olmaması değildir.
     */
    fun moveClip(p: Project, c: JsonObject): Project {
        val hasAfter = c.containsKey("after"); val hasToIndex = c.containsKey("toIndex")
        if (hasAfter == hasToIndex) throw DomainError.InvalidCommand("move_clip için 'after' ya da 'toIndex' alanlarından tam olarak biri gerekli")
        val clipId = c.string("clipId")
        val (track, clip) = p.clip(clipId)
        val list = track.clips.toMutableList(); list.remove(clip)
        if (hasToIndex) {
            val to = c.long("toIndex").toInt()
            if (to !in track.clips.indices) throw DomainError.InvalidRange("toIndex aralık dışında")
            list.add(to, clip)
        } else {
            val afterElement = c["after"]
            val position = when {
                afterElement is JsonNull -> 0
                afterElement is JsonPrimitive && afterElement.isString -> {
                    val afterId = afterElement.content
                    if (afterId == clipId) throw DomainError.InvalidRange("Klip kendisinin arkasına taşınamaz")
                    val (afterTrack, _) = p.clip(afterId)
                    if (afterTrack.id != track.id) throw DomainError.InvalidRange("'after' farklı bir izdeki klip")
                    list.indexOfFirst { it.id == afterId } + 1
                }
                else -> throw DomainError.InvalidCommand("'after' klip kimliği ya da null olmalı")
            }
            list.add(position, clip)
        }
        return p.replaceTrack(track.copy(clips = list))
    }

    fun apply(p: Project, c: JsonObject): Project = when (c.string("op")) {
        "trim_clip" -> {
            val (track, clip) = p.clip(c.string("clipId")); val asset = p.assets.firstOrNull { it.id == clip.assetId } ?: throw DomainError.NotFound("asset", clip.assetId)
            val start = c.long("inMs", clip.inMs); val end = c.long("outMs", clip.outMs)
            if (start < 0 || start >= end || end > asset.durationMs) throw DomainError.InvalidRange("Trim 0 <= inMs < outMs <= asset.durationMs olmalı")
            p.replaceTrack(track.copy(clips = track.clips.map { if (it.id == clip.id) clip.copy(inMs = start, outMs = end) else it }))
        }
        "move_clip" -> moveClip(p, c)
        "delete_clip" -> { val (track, clip) = p.clip(c.string("clipId")); p.replaceTrack(track.copy(clips = track.clips.filterNot { it.id == clip.id })) }
        "add_text" -> {
            val id = c.string("trackId"); val track = p.tracks.firstOrNull { it.id == id && it.kind == "text" } ?: throw DomainError.NotFound("text track", id)
            val start = c.long("startMs"); val duration = c.long("durationMs"); if (start < 0 || duration <= 0) throw DomainError.InvalidRange("Metin aralığı geçersiz")
            val style = c["style"]?.let { Json.decodeFromJsonElement<TextStyle>(it) } ?: TextStyle()
            p.replaceTrack(track.copy(items = track.items + TextItem(c["id"]?.jsonPrimitive?.content ?: "x${track.items.size + 1}", c.string("text"), start, duration, style)))
        }
        "delete_text" -> {
            val id = c.string("itemId"); val track = p.tracks.firstOrNull { it.kind == "text" && it.items.any { item -> item.id == id } } ?: throw DomainError.NotFound("text item", id)
            p.replaceTrack(track.copy(items = track.items.filterNot { it.id == id }))
        }
        "edit_text" -> {
            val id = c.string("itemId"); val track = p.tracks.firstOrNull { it.kind == "text" && it.items.any { item -> item.id == id } } ?: throw DomainError.NotFound("text item", id)
            p.replaceTrack(track.copy(items = track.items.map { item -> if (item.id != id) item else {
                val start = c.long("startMs", item.startMs); val duration = c.long("durationMs", item.durationMs)
                if (start < 0 || duration <= 0) throw DomainError.InvalidRange("Metin aralığı geçersiz")
                item.copy(text = c["text"]?.jsonPrimitive?.content ?: item.text, startMs = start, durationMs = duration, style = c["style"]?.let { Json.decodeFromJsonElement(it) } ?: item.style)
            } }))
        }
        "add_audio" -> {
            val assetId = c.string("assetId"); val asset = p.assets.firstOrNull { it.id == assetId } ?: throw DomainError.NotFound("asset", assetId)
            if (asset.kind != "audio") throw DomainError.InvalidRange("add_audio audio asset ister")
            val id = c.string("trackId"); val track = p.tracks.firstOrNull { it.id == id && it.kind == "audio" } ?: throw DomainError.NotFound("audio track", id)
            val start = c.long("inMs", 0); val end = c.long("outMs", asset.durationMs); val volume = c.float("volume", 1f)
            val timelineStart = c.optionalLong("startMs")
            if (start < 0 || start >= end || end > asset.durationMs || volume !in 0f..2f || (timelineStart != null && timelineStart < 0)) throw DomainError.InvalidRange("Ses aralığı/hacmi/başlangıcı geçersiz")
            p.replaceTrack(track.copy(clips = track.clips + Clip(c["id"]?.jsonPrimitive?.content ?: "a${track.clips.size + 1}", assetId, start, end, volume, timelineStart)))
        }
        "set_audio_start" -> {
            val (track, clip) = p.clip(c.string("clipId"))
            if (track.kind != "audio") throw DomainError.InvalidRange("set_audio_start yalnız ses izindeki klip için")
            val start = c.long("startMs")
            if (start < 0) throw DomainError.InvalidRange("Ses başlangıcı negatif olamaz")
            p.replaceTrack(track.copy(clips = track.clips.map { if (it.id == clip.id) it.copy(startMs = start) else it }))
        }
        "set_volume" -> {
            // Video ve ses izindeki kliplerde çalışır; metin öğeleri klip değildir, NotFound verir.
            val (track, clip) = p.clip(c.string("clipId")); val volume = c.float("volume", Float.NaN)
            if (volume !in 0f..2f) throw DomainError.InvalidRange("Ses seviyesi 0.0–2.0 olmalı")
            p.replaceTrack(track.copy(clips = track.clips.map { if (it.id == clip.id) it.copy(volume = volume) else it }))
        }
        "export_project" -> throw DomainError.Unsupported("export_project uygulama adaptöründe çalıştırılır")
        "clarify" -> throw DomainError.ClarificationRequired(c.string("question"))
        "unsupported" -> throw DomainError.Unsupported(c.string("reason"))
        else -> throw DomainError.InvalidCommand("Bilinmeyen op: ${c.string("op")}")
    }
    private fun Project.clip(id: String): Pair<Track, Clip> {
        val track = tracks.firstOrNull { it.clips.any { clip -> clip.id == id } }
            ?: throw DomainError.NotFound("clip", id)
        val clip = track.clips.firstOrNull { it.id == id } ?: throw DomainError.NotFound("clip", id)
        return track to clip
    }
    private fun Project.replaceTrack(track: Track) = copy(tracks = tracks.map { if (it.id == track.id) track else it })
}

