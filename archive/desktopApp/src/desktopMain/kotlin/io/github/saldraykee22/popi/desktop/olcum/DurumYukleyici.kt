package io.github.saldraykee22.popi.desktop.olcum

import io.github.saldraykee22.popi.domain.Asset
import io.github.saldraykee22.popi.domain.Canvas
import io.github.saldraykee22.popi.domain.Clip
import io.github.saldraykee22.popi.domain.Project
import io.github.saldraykee22.popi.domain.TextItem
import io.github.saldraykee22.popi.domain.TextStyle
import io.github.saldraykee22.popi.domain.Track
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path

/**
 * Ölçüm durum dosyasını (`durum2.json` biçimi) uygulamanın [Project] modeline çevirir.
 *
 * Eşleme: `assets[].ad` -> [Asset.label] (kullanıcının gördüğü ad; modele gider).
 * `uri` olduğu gibi okunur ama [io.github.saldraykee22.popi.ai.ProjectSummary] onu özete koymaz.
 * Bilinmeyen alanlar sessizce yok sayılır.
 */
internal object DurumYukleyici {
    fun yukleDosya(yol: Path): Project = yukle(Files.readString(yol, StandardCharsets.UTF_8))

    fun yukle(metin: String): Project {
        val kok = nesne(MiniJson.ayristir(metin), "kök")
        return Project(
            id = kok.metin("id") ?: "p1",
            canvas = kok["canvas"]?.let { canvas(nesne(it, "canvas")) } ?: Canvas(),
            assets = dizi(kok, "assets").map { asset(nesne(it, "asset")) },
            tracks = dizi(kok, "tracks").map { iz(nesne(it, "track")) },
        )
    }

    private fun canvas(m: Map<String, Any?>): Canvas {
        val varsayilan = Canvas()
        return Canvas(
            w = m.tamsayi("w") ?: varsayilan.w,
            h = m.tamsayi("h") ?: varsayilan.h,
            fps = m.tamsayi("fps") ?: varsayilan.fps,
        )
    }

    private fun asset(m: Map<String, Any?>): Asset = Asset(
        id = m.zorunluMetin("id"),
        kind = m.zorunluMetin("kind"),
        uri = m.zorunluMetin("uri"),
        durationMs = m.zorunluUzun("durationMs"),
        label = m.metin("ad"),
    )

    private fun iz(m: Map<String, Any?>): Track = Track(
        id = m.zorunluMetin("id"),
        kind = m.zorunluMetin("kind"),
        clips = dizi(m, "clips").map { klip(nesne(it, "clip")) },
        items = dizi(m, "items").map { yazi(nesne(it, "item")) },
    )

    private fun klip(m: Map<String, Any?>): Clip = Clip(
        id = m.zorunluMetin("id"),
        assetId = m.zorunluMetin("assetId"),
        inMs = m.uzunSayi("inMs") ?: 0L,
        outMs = m.zorunluUzun("outMs"),
        volume = m.sayi("volume")?.toFloat(),
        startMs = m.uzunSayi("startMs"),
    )

    private fun yazi(m: Map<String, Any?>): TextItem = TextItem(
        id = m.zorunluMetin("id"),
        text = m.zorunluMetin("text"),
        startMs = m.zorunluUzun("startMs"),
        durationMs = m.zorunluUzun("durationMs"),
        style = m["style"]?.let { stil(nesne(it, "style")) } ?: TextStyle(),
    )

    private fun stil(m: Map<String, Any?>): TextStyle {
        val varsayilan = TextStyle()
        return TextStyle(
            sizeSp = m.tamsayi("sizeSp") ?: varsayilan.sizeSp,
            color = m.metin("color") ?: varsayilan.color,
            position = m.metin("position") ?: varsayilan.position,
        )
    }

    private fun nesne(deger: Any?, ad: String): Map<String, Any?> {
        @Suppress("UNCHECKED_CAST")
        return deger as? Map<String, Any?> ?: throw IllegalArgumentException("'$ad' bir JSON nesnesi olmalı")
    }

    private fun dizi(m: Map<String, Any?>, anahtar: String): List<Any?> = when (val d = m[anahtar]) {
        null -> emptyList()
        is List<*> -> d
        else -> throw IllegalArgumentException("'$anahtar' bir dizi olmalı")
    }

    private fun Map<String, Any?>.metin(anahtar: String): String? = when (val d = this[anahtar]) {
        null -> null
        is String -> d
        else -> throw IllegalArgumentException("'$anahtar' metin olmalı")
    }

    private fun Map<String, Any?>.zorunluMetin(anahtar: String): String =
        metin(anahtar) ?: throw IllegalArgumentException("'$anahtar' alanı eksik")

    private fun Map<String, Any?>.sayi(anahtar: String): Number? = when (val d = this[anahtar]) {
        null -> null
        is Number -> d
        else -> throw IllegalArgumentException("'$anahtar' sayı olmalı")
    }

    private fun Map<String, Any?>.tamsayi(anahtar: String): Int? = sayi(anahtar)?.toInt()

    private fun Map<String, Any?>.uzunSayi(anahtar: String): Long? = sayi(anahtar)?.toLong()

    private fun Map<String, Any?>.zorunluUzun(anahtar: String): Long =
        uzunSayi(anahtar) ?: throw IllegalArgumentException("'$anahtar' alanı eksik")
}
