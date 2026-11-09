package io.github.saldraykee22.popi.domain

import kotlinx.serialization.Serializable

@Serializable data class Canvas(val w: Int = 1080, val h: Int = 1920, val fps: Int = 30)
/** [label]: kullanıcının gördüğü ve değiştirebildiği ad. Modele gider ve onay ekranında görünür; [uri] (dosya yolu) asla gitmez. */
@Serializable data class Asset(val id: String, val kind: String, val uri: String, val durationMs: Long, val label: String? = null)
@Serializable data class Clip(
    val id: String,
    val assetId: String,
    val inMs: Long = 0,
    val outMs: Long,
    val volume: Float? = null,
    /** Yalnız ses izindeki klip için: klibin zaman çizelgesindeki başlangıcı. null = 0. */
    val startMs: Long? = null,
)
@Serializable data class TextStyle(val sizeSp: Int = 48, val color: String = "#FFFFFF", val position: String = "center")
@Serializable data class TextItem(val id: String, val text: String, val startMs: Long, val durationMs: Long, val style: TextStyle = TextStyle())
@Serializable data class Track(
    val id: String,
    val kind: String,
    val clips: List<Clip> = emptyList(),
    val items: List<TextItem> = emptyList(),
)
@Serializable data class Project(
    val id: String = "p1",
    val canvas: Canvas = Canvas(),
    val assets: List<Asset> = emptyList(),
    val tracks: List<Track> = listOf(Track("v1", "video"), Track("t1", "text"), Track("m1", "audio")),
)

sealed class DomainError(message: String) : IllegalArgumentException(message) {
    data class InvalidCommand(val detail: String) : DomainError(detail)
    data class NotFound(val entity: String, val id: String) : DomainError("$entity bulunamadı: $id")
    data class InvalidRange(val detail: String) : DomainError(detail)
    data class Unsupported(val reason: String) : DomainError(reason)
    data class ClarificationRequired(val question: String) : DomainError(question)
    data object EmptyHistory : DomainError("Undo/redo yığını boş")
}

