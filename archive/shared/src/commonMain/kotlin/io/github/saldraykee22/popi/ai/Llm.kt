package io.github.saldraykee22.popi.ai

/** Modele gönderilecek sistem ve kullanıcı metni. */
data class LlmRequest(val system: String, val user: String)

/**
 * Model sağlayıcısına senkron istek atan taşıma katmanı.
 * Arayüz bu çağrıyı arka plan iş parçacığında yapar.
 */
fun interface LlmTransport {
    fun complete(request: LlmRequest): String
}

/**
 * İsteğin anlamını değiştiren arayüz bağlamı: "bu klibi sil" seçili öğeye,
 * "az önce yaptığımı geri al" son işleme bakar. Kullanıcının zaten gördüğü bilgilerdir.
 */
data class EditContext(
    /** Seçili klip ya da metin kimliği; yoksa null. */
    val selectedId: String? = null,
    /** Son yapılan işlemin kısa açıklaması (en yeni önce); boşsa gönderilmez. */
    val recentActions: List<String> = emptyList(),
)
