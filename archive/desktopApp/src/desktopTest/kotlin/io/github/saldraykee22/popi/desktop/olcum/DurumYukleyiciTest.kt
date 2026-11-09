package io.github.saldraykee22.popi.desktop.olcum

import io.github.saldraykee22.popi.ai.ProjectSummary
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class DurumYukleyiciTest {

    private fun durum() = DurumYukleyici.yukleDosya(zorDizin().resolve("durum2.json"))

    @Test
    fun gercekDurumDosyasiYuklenir() {
        val p = durum()
        assertEquals("p2", p.id)
        assertEquals(1080, p.canvas.w)
        assertEquals(1920, p.canvas.h)
        assertEquals(30, p.canvas.fps)
        assertEquals(9, p.assets.size)
        assertEquals(setOf("v1", "t1", "m1"), p.tracks.map { it.id }.toSet())
    }

    @Test
    fun klipSayilariDogru() {
        val p = durum()
        assertEquals(7, p.tracks.first { it.id == "v1" }.clips.size)
        assertEquals(2, p.tracks.first { it.id == "t1" }.items.size)
        assertEquals(2, p.tracks.first { it.id == "m1" }.clips.size)
    }

    @Test
    fun adLabelaGider() {
        val p = durum()
        assertEquals("giriş - kameraya selam", p.assets.first { it.id == "a1" }.label)
        assertEquals("seslendirme (kullanıcının sesi)", p.assets.first { it.id == "a9" }.label)
        assertEquals("giris_selam.mp4", p.assets.first { it.id == "a1" }.uri)
    }

    @Test
    fun sesKlipleriDogru() {
        val ses = durum().tracks.first { it.id == "m1" }
        assertEquals("audio", ses.kind)
        val c20 = ses.clips.first { it.id == "c20" }
        val c21 = ses.clips.first { it.id == "c21" }
        assertEquals("a8", c20.assetId)
        assertEquals("a9", c21.assetId)
        assertEquals(60000L, c20.outMs)
        assertEquals(40000L, c21.outMs)
        assertEquals(1.0f, c20.volume)
        assertEquals(1.0f, c21.volume)
        assertNull(c20.startMs)
    }

    @Test
    fun yaziOgeleriDogru() {
        val x2 = durum().tracks.first { it.id == "t1" }.items.first { it.id == "x2" }
        assertEquals("Ekşi Maya Ekmeği", x2.text)
        assertEquals(31000L, x2.startMs)
        assertEquals(4000L, x2.durationMs)
        assertEquals("bottom", x2.style.position)
        assertEquals(40, x2.style.sizeSp)
    }

    @Test
    fun bilinmeyenAlanlarYokSayilir() {
        val metin = """
            {"id":"px","canvas":{"w":1080,"h":1920,"fps":30,"gizli":true},
             "assets":[{"id":"a1","kind":"video","uri":"x.mp4","durationMs":1000,"ad":"Deneme","not":"yok"}],
             "tracks":[{"id":"v1","kind":"video","renk":"mavi","clips":[{"id":"c1","assetId":"a1","outMs":1000,"bilinmeyen":5}]}]}
        """.trimIndent()
        val p = DurumYukleyici.yukle(metin)
        assertEquals("Deneme", p.assets.single().label)
        assertEquals(1000L, p.tracks.single().clips.single().outMs)
    }

    @Test
    fun ozetAdiGosterirYoluGostermez() {
        val ozet = ProjectSummary.summarize(durum())
        assertTrue(ozet.contains("ad: \"giriş - kameraya selam\""))
        assertFalse(ozet.contains("giris_selam.mp4"))
        assertFalse(ozet.contains("uri"))
    }

    @Test
    fun zorunluAlanEksikseHata() {
        val metin = """{"id":"p","assets":[{"id":"a1","kind":"video","durationMs":1000}],"tracks":[]}"""
        kotlin.test.assertFailsWith<IllegalArgumentException> { DurumYukleyici.yukle(metin) }
    }
}

class MiniJsonTest {
    @Test
    fun kacisVeUnicodeDogruCozulur() {
        val v = MiniJson.ayristir("""{"a":"x\"y\\z\nç Ş","b":[1,2.5,true,null]}""") as Map<*, *>
        assertEquals("x\"y\\z\nç Ş", v["a"])
        assertEquals(listOf(1L, 2.5, true, null), v["b"])
    }

    @Test
    fun yazVeOkumaTurkceIcinGidisGelis() {
        val girdi = mapOf("metin" to "Kuzey Fırını \"ekmek\"\t", "sayi" to 3L)
        val metin = MiniJson.yaz(girdi)
        assertEquals(girdi, MiniJson.ayristir(metin))
    }

    @Test
    fun bozukJsonHataVerir() {
        kotlin.test.assertFailsWith<IllegalArgumentException> { MiniJson.ayristir("{\"a\":1") }
    }
}
