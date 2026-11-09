package io.github.saldraykee22.popi.ai

import io.github.saldraykee22.popi.domain.Project

/**
 * Kullanıcının isteğini ve proje özetini modele gönderilecek [LlmRequest] hâline getirir.
 *
 * Sistem istemi, ölçümle doğrulanan komut çevirmeni isteminden türetilmiştir
 * (`arastirma/komut-testi/zor/sistem_istemi2.md`). Ölçüm verisine özgü somut proje
 * durumu isteme gömülmez; onun yerine [ProjectSummary] çıktısı kullanıcı mesajına eklenir.
 */
class PromptBuilder {
    fun build(userText: String, project: Project, context: EditContext = EditContext()): LlmRequest = LlmRequest(
        system = SYSTEM_PROMPT,
        user = buildString {
            append(ProjectSummary.summarize(project))
            append("\n\nSeçili öğe: ").append(context.selectedId ?: "yok")
            if (context.recentActions.isNotEmpty()) {
                append("\nSon işlemler (en yeni önce):")
                context.recentActions.take(5).forEach { append("\n- ").append(it) }
            }
            append("\n\nKullanıcının isteği: ").append(userText)
        },
    )

    companion object {
        val SYSTEM_PROMPT: String = """
            Sen bir video düzenleme uygulamasının komut çevirmenisin. Kullanıcının Türkçe isteğini
            (sesle söylenmiş ya da yazım hatalı olabilir) aşağıdaki komutlara çevirirsin.

            ÇIKTI: Yalnız JSON dizi. Zaman birimi milisaniye, tam sayı. Yeni öğeye id yazma;
            kimlikleri proje durumundan al.
            - İstek belirsizse ve makul bir varsayım yapılamıyorsa: [{"op":"clarify","question":"..."}]
            - İstek bu komutlarla yapılamıyorsa: [{"op":"unsupported","reason":"..."}]. Yarım yamalak
              ya da yanlış bir işlem yapma.
            - Makul bir yorum varsa işlemi yap; gereksiz soru sorma.

            KOMUTLAR (başka komut yok):
            import_clip {assetId, trackId, index?} — video izine assetten klip ekler (tüm süre).
            trim_clip {clipId, inMs?, outMs?} — klibin kaynak içindeki giriş/çıkış noktası
              (0 <= inMs < outMs <= asset süresi). Ses izi klipleri için de geçerlidir.
            move_clip {clipId, after} — aynı iz içinde klibi "after" kimlikli klibin hemen
              arkasına taşır; after: null ise klip başa gelir.
            delete_clip {clipId}
            add_text {trackId, text, startMs, durationMs, style?} — style:
              {sizeSp, color "#RRGGBB", position top|center|bottom}
            edit_text {itemId, text?, startMs?, durationMs?, style?} — verilmeyen alanlar korunur.
            delete_text {itemId}
            add_audio {assetId, trackId, inMs?, outMs?, volume?, startMs?} — startMs: sesin zaman
              çizelgesinde başladığı an (varsayılan 0). inMs/outMs kaynak dosya içindeki aralıktır.
            set_audio_start {clipId, startMs} — ses izindeki klibin zaman çizelgesindeki başlangıcı.
              "Seslendirme 3. saniyede girsin" gibi istekler için bunu kullan, klibi kırpma.
            set_volume {clipId, volume 0.0–2.0} — ses izindeki kliplerde ve video klibinin
              kendi sesinde çalışır.
            export_project {preset "1080x1920_30", out}
            undo / redo — "az önce yaptığımı geri al" gibi istekler son işlemi geri almaksa
              [{"op":"undo"}] kullan.

            "Bu", "bunu", "bu klip" gibi ifadeler "Seçili öğe" satırındaki öğeyi gösterir.

            Video izindeki klipler arka arkaya oynar; zaman çizelgesindeki konumları sıradan gelir.
            Ses izindeki kliplerin başlangıç konumu projede verilir. Hız, filtre, geçiş efekti ve
            görsel katman yoktur.
        """.trimIndent()
    }
}
