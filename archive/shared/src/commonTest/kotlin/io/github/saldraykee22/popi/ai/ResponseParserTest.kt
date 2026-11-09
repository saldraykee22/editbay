package io.github.saldraykee22.popi.ai

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

class ResponseParserTest {
    private val parser = ResponseParser()

    @Test fun parsesPlainJsonArray() {
        val result = parser.parse("""[{"op":"undo"}]""")
        assertEquals(ParsedResponse.Commands("""[{"op":"undo"}]"""), result)
    }

    @Test fun parsesFencedBlock() {
        val text = "İşte komutlar:\n```json\n[{\"op\":\"delete_clip\",\"clipId\":\"c1\"}]\n```\n"
        val result = parser.parse(text)
        assertEquals(ParsedResponse.Commands("""[{"op":"delete_clip","clipId":"c1"}]"""), result)
    }

    @Test fun parsesJsonSurroundedByProse() {
        val text = "Elbette. Şu komutu uygularım: [{\"op\":\"add_text\",\"trackId\":\"t1\",\"text\":\"Merhaba\",\"startMs\":0,\"durationMs\":1000}] Umarım uygundur."
        val result = parser.parse(text)
        assertIs<ParsedResponse.Commands>(result)
        assertEquals(ParsedResponse.Commands("""[{"op":"add_text","trackId":"t1","text":"Merhaba","startMs":0,"durationMs":1000}]"""), result)
    }

    @Test fun wrapsSingleObjectIntoArray() {
        val result = parser.parse("""{"op":"undo"}""")
        assertEquals(ParsedResponse.Commands("""[{"op":"undo"}]"""), result)
    }

    @Test fun parsesClarify() {
        assertEquals(ParsedResponse.Clarify("Hangi klip?"), parser.parse("""{"op":"clarify","question":"Hangi klip?"}"""))
    }

    @Test fun parsesUnsupported() {
        assertEquals(ParsedResponse.Unsupported("efekt yok"), parser.parse("""[{"op":"unsupported","reason":"efekt yok"}]"""))
    }

    @Test fun brokenJsonIsInvalid() {
        assertIs<ParsedResponse.Invalid>(parser.parse("""[{"op": """))
    }

    @Test fun textWithoutJsonIsInvalid() {
        assertIs<ParsedResponse.Invalid>(parser.parse("Bunu yapamam maalesef."))
    }
}
