package io.github.saldraykee22.popi.secrets

/**
 * RFC 4648 ve RFC 7636 uyumlu dolgusuz (unpadded) Base64URL kodlayıcı.
 */
internal object Base64Url {
    private const val ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

    fun encode(data: ByteArray): String {
        if (data.isEmpty()) return ""
        val sb = StringBuilder((data.size * 4 + 2) / 3)
        var i = 0
        while (i < data.size) {
            val b0 = data[i].toInt() and 0xFF
            val b1 = if (i + 1 < data.size) data[i + 1].toInt() and 0xFF else -1
            val b2 = if (i + 2 < data.size) data[i + 2].toInt() and 0xFF else -1

            val c0 = b0 ushr 2
            val c1 = if (b1 != -1) {
                ((b0 and 0x03) shl 4) or (b1 ushr 4)
            } else {
                (b0 and 0x03) shl 4
            }

            sb.append(ALPHABET[c0])
            sb.append(ALPHABET[c1])

            if (b1 != -1) {
                val c2 = if (b2 != -1) {
                    ((b1 and 0x0F) shl 2) or (b2 ushr 6)
                } else {
                    (b1 and 0x0F) shl 2
                }
                sb.append(ALPHABET[c2])
                if (b2 != -1) {
                    val c3 = b2 and 0x3F
                    sb.append(ALPHABET[c3])
                }
            }
            i += 3
        }
        return sb.toString()
    }
}
