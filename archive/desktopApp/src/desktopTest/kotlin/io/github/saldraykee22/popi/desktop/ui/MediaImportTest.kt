package io.github.saldraykee22.popi.desktop.ui

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class MediaImportTest {
    @Test fun supportedVideoAndAudioExtensionsMapToKinds() {
        listOf("a.mp4", "b.MOV", "c.mkv", "d.webm").forEach { assertEquals(MediaKind.VIDEO, MediaFormats.kindOf(it), it) }
        listOf("e.mp3", "f.WAV", "g.m4a", "h.aac", "i.ogg").forEach { assertEquals(MediaKind.AUDIO, MediaFormats.kindOf(it), it) }
    }

    @Test fun unsupportedFilesAreRejectedAndNamedInNotice() {
        val plan = planMediaImport(listOf("klip.mp4", "notlar.txt", "resim.png", "muzik.flac", "README")) { it }

        assertEquals(listOf("klip.mp4"), plan.accepted.map { it.item })
        assertEquals(listOf(MediaKind.VIDEO), plan.accepted.map { it.kind })
        assertEquals(listOf("notlar.txt", "resim.png", "muzik.flac", "README"), plan.rejectedNames)
        assertEquals("Desteklenmeyen dosya: notlar.txt, resim.png, muzik.flac, README", plan.notice)
    }

    @Test fun allSupportedFilesProduceNoNotice() {
        val plan = planMediaImport(listOf("ses.wav", "film.mp4")) { it }

        assertEquals(2, plan.accepted.size)
        assertNull(plan.notice)
    }

    @Test fun acceptedOrderIsPreservedForNamedItems() {
        data class Named(val name: String, val id: Int)
        val plan = planMediaImport(listOf(Named("c.mp3", 1), Named("x.exe", 2), Named("a.mp4", 3))) { it.name }

        assertEquals(listOf(1, 3), plan.accepted.map { it.item.id })
        assertEquals(listOf("x.exe"), plan.rejectedNames)
    }
}
