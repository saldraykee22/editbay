package io.github.saldraykee22.popi.domain

import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * İki proje durumunun farkını kullanıcıya gösterilecek Türkçe satırlara çevirir.
 * Komutlara değil durumların farkına bakar; elle düzenleme ve yapay zekâ için aynı sonucu verir.
 * Değişiklik yoksa boş liste döner.
 */
fun describeChanges(before: Project, after: Project): List<String> {
    val lines = mutableListOf<String>()
    val beforeClips = before.clipsById()
    val afterClips = after.clipsById()

    for (track in after.tracks) {
        val beforeIds = before.tracks.firstOrNull { it.id == track.id }?.clips?.map { it.id }.orEmpty()
        val afterIds = track.clips.map { it.id }
        val orderBefore = beforeIds.filter { it in afterIds }
        val orderAfter = afterIds.filter { it in beforeIds }
        if (orderBefore != orderAfter) {
            lines += "Klip sırası: ${orderBefore.joinToString(", ")} → ${orderAfter.joinToString(", ")}"
        }
        track.clips.forEachIndexed { index, clip ->
            val old = beforeClips[clip.id] ?: return@forEachIndexed
            lines += clipChanges(old, clip, clipLabel(track, index, clip))
        }
    }

    for (clip in before.tracks.flatMap { it.clips }) {
        if (!afterClips.containsKey(clip.id)) lines += "Klip silindi: ${clip.id}"
    }
    for (clip in after.tracks.flatMap { it.clips }) {
        if (!beforeClips.containsKey(clip.id)) lines += "Klip eklendi: ${clip.id}"
    }

    val beforeItems = before.tracks.flatMap { it.items }.associateBy { it.id }
    val afterItems = after.tracks.flatMap { it.items }.associateBy { it.id }
    for (item in after.tracks.flatMap { it.items }) {
        val old = beforeItems[item.id]
        if (old == null) {
            lines += "Metin eklendi: \"${item.text}\" (${range(item.startMs, item.startMs + item.durationMs)})"
            continue
        }
        if (old.text != item.text) lines += "Metin değişti: \"${old.text}\" → \"${item.text}\""
        if (old.startMs != item.startMs || old.durationMs != item.durationMs) {
            val oldRange = range(old.startMs, old.startMs + old.durationMs)
            val newRange = range(item.startMs, item.startMs + item.durationMs)
            lines += "Metin zamanı değişti: \"${item.text}\" ($oldRange → $newRange)"
        }
        if (old.style != item.style) lines += "Metin stili değişti: \"${item.text}\""
    }
    for (item in before.tracks.flatMap { it.items }) {
        if (!afterItems.containsKey(item.id)) lines += "Metin silindi: \"${item.text}\""
    }
    return lines
}

private fun Project.clipsById(): Map<String, Clip> = tracks.flatMap { it.clips }.associateBy { it.id }

/** Ses izindeki klip "Müzik" adıyla, video klibi sıra numarasıyla anılır. Dosya yolu gösterilmez. */
private fun clipLabel(track: Track, index: Int, clip: Clip): String =
    if (track.kind == "audio") "Müzik (${clip.id})" else "${index + 1}. klip (${clip.id})"

private fun clipChanges(old: Clip, new: Clip, label: String): List<String> = buildList {
    if (old.inMs != new.inMs || old.outMs != new.outMs) {
        add("$label kırpıldı: ${range(old.inMs, old.outMs)} → ${range(new.inMs, new.outMs)}")
    }
    if (percent(old.volume) != percent(new.volume)) {
        add("$label sesi: ${percent(old.volume)} → ${percent(new.volume)}")
    }
    val oldStart = old.startMs ?: 0L
    val newStart = new.startMs ?: 0L
    if (oldStart != newStart) {
        add("$label başlangıcı: ${seconds(oldStart)} sn → ${seconds(newStart)} sn")
    }
}

/** Milisaniyeyi bir ondalıklı saniye metnine çevirir, ondalık ayracı virgüldür: 1500 → "1,5". */
private fun seconds(ms: Long): String {
    val sign = if (ms < 0) "-" else ""
    val tenths = (abs(ms) + 50) / 100
    return "$sign${tenths / 10},${tenths % 10}"
}

private fun range(startMs: Long, endMs: Long): String = "${seconds(startMs)}–${seconds(endMs)} sn"

/** Ses seviyesi yüzdesi; null (varsayılan) %100 kabul edilir. */
private fun percent(volume: Float?): String = "%${((volume ?: 1f) * 100f).roundToInt()}"
