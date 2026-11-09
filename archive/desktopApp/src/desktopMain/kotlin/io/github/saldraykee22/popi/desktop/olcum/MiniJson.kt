package io.github.saldraykee22.popi.desktop.olcum

/**
 * Ölçüm aracının kendi küçük JSON okuyucusu ve yazıcısı.
 *
 * Neden: `shared` modülü kotlinx.serialization'ı yalnız `implementation` olarak taşır; desktopApp bu
 * türlere derleme zamanında erişemez. Yeni bağımlılık eklememek için yalnız bu araca yetecek bir alt küme.
 *
 * Okuma: nesne -> LinkedHashMap, dizi -> List, tam sayı -> Long, ondalıklı sayı -> Double, metin,
 * true/false, null (JSON null, Kotlin null olarak döner).
 */
internal object MiniJson {
    /** Önceden üretilmiş bir JSON metnini olduğu gibi gömmek için sarmalayıcı. */
    class Ham(val metin: String)

    fun ayristir(metin: String): Any? {
        val okuyucu = Okuyucu(metin)
        val deger = okuyucu.deger()
        okuyucu.bosluklariAtla()
        require(okuyucu.sondaMi()) { "JSON sonrasında fazla içerik var (konum ${okuyucu.konum})" }
        return deger
    }

    fun yaz(deger: Any?): String {
        val sb = StringBuilder()
        yazInto(sb, deger)
        return sb.toString()
    }

    private fun yazInto(sb: StringBuilder, deger: Any?) {
        when (deger) {
            null -> sb.append("null")
            is Ham -> sb.append(deger.metin)
            is String -> metinYaz(sb, deger)
            is Boolean, is Int, is Long -> sb.append(deger.toString())
            is Double -> {
                require(deger.isFinite()) { "JSON'da sonlu olmayan sayı yazılamaz" }
                sb.append(deger.toString())
            }
            is Map<*, *> -> {
                sb.append('{')
                var ilk = true
                for ((anahtar, value) in deger) {
                    if (!ilk) sb.append(',')
                    ilk = false
                    metinYaz(sb, anahtar as String)
                    sb.append(':')
                    yazInto(sb, value)
                }
                sb.append('}')
            }
            is List<*> -> {
                sb.append('[')
                var ilk = true
                for (oge in deger) {
                    if (!ilk) sb.append(',')
                    ilk = false
                    yazInto(sb, oge)
                }
                sb.append(']')
            }
            else -> throw IllegalArgumentException("JSON'a yazılamayan tür: ${deger::class.simpleName}")
        }
    }

    private fun metinYaz(sb: StringBuilder, s: String) {
        sb.append('"')
        for (c in s) {
            when (c) {
                '"' -> sb.append("\\\"")
                '\\' -> sb.append("\\\\")
                '\n' -> sb.append("\\n")
                '\r' -> sb.append("\\r")
                '\t' -> sb.append("\\t")
                '\b' -> sb.append("\\b")
                '\u000C' -> sb.append("\\f")
                else -> if (c < ' ') sb.append("\\u%04x".format(c.code)) else sb.append(c)
            }
        }
        sb.append('"')
    }

    private class Okuyucu(private val s: String) {
        var konum = 0

        fun sondaMi(): Boolean = konum >= s.length

        fun bosluklariAtla() {
            while (konum < s.length && s[konum].isWhitespace()) konum++
        }

        fun deger(): Any? {
            bosluklariAtla()
            require(konum < s.length) { "JSON beklenmedik şekilde bitti" }
            return when (s[konum]) {
                '{' -> nesne()
                '[' -> dizi()
                '"' -> metin()
                't' -> sabit("true", true)
                'f' -> sabit("false", false)
                'n' -> sabit("null", null)
                else -> sayi()
            }
        }

        private fun sabit(kelime: String, deger: Any?): Any? {
            require(s.startsWith(kelime, konum)) { "JSON geçersiz değer (konum $konum)" }
            konum += kelime.length
            return deger
        }

        private fun karakterBekle(c: Char) {
            bosluklariAtla()
            require(konum < s.length && s[konum] == c) { "JSON '$c' bekleniyordu (konum $konum)" }
            konum++
        }

        private fun nesne(): Map<String, Any?> {
            karakterBekle('{')
            val harita = LinkedHashMap<String, Any?>()
            bosluklariAtla()
            if (konum < s.length && s[konum] == '}') {
                konum++
                return harita
            }
            var devam = true
            while (devam) {
                bosluklariAtla()
                val anahtar = metin()
                karakterBekle(':')
                harita[anahtar] = deger()
                bosluklariAtla()
                require(konum < s.length) { "JSON nesne kapanmadan bitti" }
                val c = s[konum++]
                if (c == '}') devam = false else require(c == ',') { "JSON nesnede ',' ya da '}' bekleniyordu (konum ${konum - 1})" }
            }
            return harita
        }

        private fun dizi(): List<Any?> {
            karakterBekle('[')
            val liste = ArrayList<Any?>()
            bosluklariAtla()
            if (konum < s.length && s[konum] == ']') {
                konum++
                return liste
            }
            var devam = true
            while (devam) {
                liste.add(deger())
                bosluklariAtla()
                require(konum < s.length) { "JSON dizi kapanmadan bitti" }
                val c = s[konum++]
                if (c == ']') devam = false else require(c == ',') { "JSON dizide ',' ya da ']' bekleniyordu (konum ${konum - 1})" }
            }
            return liste
        }

        private fun metin(): String {
            bosluklariAtla()
            require(konum < s.length && s[konum] == '"') { "JSON metin bekleniyordu (konum $konum)" }
            konum++
            val sb = StringBuilder()
            var bitti = false
            while (!bitti) {
                require(konum < s.length) { "JSON metin kapanmadan bitti" }
                val c = s[konum++]
                when (c) {
                    '"' -> bitti = true
                    '\\' -> {
                        require(konum < s.length) { "JSON kaçış dizisi yarım kaldı" }
                        when (val e = s[konum++]) {
                            '"', '\\', '/' -> sb.append(e)
                            'b' -> sb.append('\b')
                            'f' -> sb.append('\u000C')
                            'n' -> sb.append('\n')
                            'r' -> sb.append('\r')
                            't' -> sb.append('\t')
                            'u' -> {
                                require(konum + 4 <= s.length) { "JSON \\u kaçışı yarım kaldı" }
                                sb.append(s.substring(konum, konum + 4).toInt(16).toChar())
                                konum += 4
                            }
                            else -> throw IllegalArgumentException("JSON geçersiz kaçış dizisi (konum ${konum - 1})")
                        }
                    }
                    else -> sb.append(c)
                }
            }
            return sb.toString()
        }

        private fun sayi(): Any {
            val bas = konum
            while (konum < s.length && s[konum] in "+-0123456789.eE") konum++
            val ham = s.substring(bas, konum)
            require(ham.isNotEmpty()) { "JSON geçersiz karakter (konum $konum)" }
            return if (ham.any { it == '.' || it == 'e' || it == 'E' }) ham.toDouble() else ham.toLong()
        }
    }
}
