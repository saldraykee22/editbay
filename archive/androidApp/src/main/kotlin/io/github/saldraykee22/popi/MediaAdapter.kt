package io.github.saldraykee22.popi

import android.content.Context
import android.net.Uri
import android.text.SpannableString
import android.text.style.ForegroundColorSpan
import android.text.Spanned
import android.graphics.Color
import android.text.style.AbsoluteSizeSpan
import androidx.media3.common.MediaItem
import androidx.media3.common.OverlaySettings
import androidx.media3.common.audio.ChannelMixingAudioProcessor
import androidx.media3.common.audio.ChannelMixingMatrix
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.OverlayEffect
import androidx.media3.effect.Presentation
import androidx.media3.effect.StaticOverlaySettings
import androidx.media3.effect.TextOverlay
import androidx.media3.transformer.*
import io.github.saldraykee22.popi.domain.Project
import java.io.File

@UnstableApi
object MediaAdapter {
    fun composition(context: Context, project: Project): Composition {
        val videoTrack = project.tracks.first { it.kind == "video" }
        val clips = videoTrack.clips.map { clip ->
            val asset = project.assets.first { it.id == clip.assetId }
            val item = MediaItem.Builder().setUri(Uri.parse(asset.uri)).setClippingConfiguration(
                MediaItem.ClippingConfiguration.Builder().setStartPositionMs(clip.inMs).setEndPositionMs(clip.outMs).build()
            ).build()
            // Klibin kendi sesi korunur; ses izindeki klipler ayrı sequence olarak üstüne karışır.
            EditedMediaItem.Builder(item).build()
        }
        require(clips.isNotEmpty()) { "Önce video klip ekleyin" }
        val video = EditedMediaItemSequence.withAudioAndVideoFrom(clips)
        val sequences = mutableListOf(video)
        val audioTrack = project.tracks.firstOrNull { it.kind == "audio" }
        audioTrack?.clips.orEmpty().forEach { clip ->
            val asset = project.assets.first { it.id == clip.assetId }
            val channelMixer = ChannelMixingAudioProcessor().apply {
                putChannelMixingMatrix(ChannelMixingMatrix.createForConstantGain(1, 1).scaleBy(clip.volume ?: 1f))
                putChannelMixingMatrix(ChannelMixingMatrix.createForConstantGain(2, 2).scaleBy(clip.volume ?: 1f))
            }
            val audioItem = EditedMediaItem.Builder(MediaItem.Builder().setUri(Uri.parse(asset.uri)).setClippingConfiguration(
                MediaItem.ClippingConfiguration.Builder().setStartPositionMs(clip.inMs).setEndPositionMs(clip.outMs).build()
            ).build()).setEffects(Effects(listOf(channelMixer), emptyList())).build()
            sequences += EditedMediaItemSequence.withAudioFrom(listOf(audioItem)).buildUpon().setIsLooping(true).build()
        }
        val overlays = project.tracks.firstOrNull { it.kind == "text" }?.items?.map { item ->
            val styled = SpannableString(item.text).apply {
                setSpan(ForegroundColorSpan(Color.parseColor(item.style.color)), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                setSpan(AbsoluteSizeSpan(item.style.sizeSp, true), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            }
            val y = when (item.style.position) { "top" -> 0.8f; "bottom" -> -0.8f; else -> 0f }
            val visible = StaticOverlaySettings.Builder().setOverlayFrameAnchor(0f, y).setBackgroundFrameAnchor(0f, y).build()
            // Boş metin 0x0 bitmap üretip TextOverlay'i çökertir; aralık dışında metni gizlemek için alpha 0 kullanılır.
            val hidden = StaticOverlaySettings.Builder().setOverlayFrameAnchor(0f, y).setBackgroundFrameAnchor(0f, y).setAlphaScale(0f).build()
            val range = item.startMs * 1000 until (item.startMs + item.durationMs) * 1000
            object : TextOverlay() {
                override fun getText(presentationTimeUs: Long): SpannableString = styled
                override fun getOverlaySettings(presentationTimeUs: Long): OverlaySettings =
                    if (presentationTimeUs in range) visible else hidden
            }
        }.orEmpty()
        val effects = mutableListOf<androidx.media3.common.Effect>(
            Presentation.createForWidthAndHeight(1080, 1920, Presentation.LAYOUT_SCALE_TO_FIT_WITH_CROP)
        )
        if (overlays.isNotEmpty()) effects += OverlayEffect(overlays)
        return Composition.Builder(sequences).setEffects(Effects(emptyList(), effects)).build()
    }

    fun export(context: Context, project: Project, out: File, callback: Transformer.Listener) {
        out.parentFile?.mkdirs()
        val transformer = Transformer.Builder(context).setVideoMimeType("video/avc").setPortraitEncodingEnabled(true).addListener(callback).build()
        transformer.start(composition(context, project), out.absolutePath)
    }
}

