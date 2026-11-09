package io.github.saldraykee22.popi.ai

import io.github.saldraykee22.popi.domain.Project

/**
 * Modele gidecek kısa, okunabilir proje özetini üretir.
 *
 * Gizlilik: [io.github.saldraykee22.popi.domain.Asset.uri] (dosya yolu) ve dosya adı
 * özete hiçbir zaman girmez; yalnız kimlikler, tür, süre ve zaman aralıkları gider.
 */
object ProjectSummary {
    fun summarize(project: Project): String {
        val assetsById = project.assets.associateBy { it.id }
        return buildString {
            appendLine("Proje: ${project.id}, tuval ${project.canvas.w}x${project.canvas.h} @${project.canvas.fps}fps")
            appendLine("Varlıklar:")
            project.assets.forEach { asset ->
                appendLine("- ${asset.id}: ${asset.kind}, ${asset.durationMs} ms" + (asset.label?.let { ", ad: \"$it\"" } ?: ""))
            }
            project.tracks.forEach { track ->
                when (track.kind) {
                    "video", "audio" -> {
                        appendLine("İz ${track.id} (${track.kind}), sıra:")
                        track.clips.forEach { clip ->
                            val asset = assetsById[clip.assetId]
                            val kind = asset?.kind ?: "bilinmiyor"
                            val duration = asset?.durationMs?.let { "$it ms" } ?: "bilinmiyor"
                            val volume = ", seviye ${clip.volume ?: 1f}"
                            val start = if (track.kind == "audio") ", zaman çizelgesinde ${clip.startMs ?: 0} ms'de başlar" else ""
                            appendLine("- ${clip.id}: varlık ${clip.assetId} ($kind, $duration), ${clip.inMs}-${clip.outMs} ms$volume$start")
                        }
                    }
                    "text" -> {
                        appendLine("Metin izi ${track.id}:")
                        track.items.forEach { item ->
                            appendLine("- ${item.id}: \"${item.text}\", ${item.startMs} ms, ${item.durationMs} ms, ${item.style.position}")
                        }
                    }
                    else -> appendLine("İz ${track.id} (${track.kind})")
                }
            }
        }.trimEnd()
    }
}
