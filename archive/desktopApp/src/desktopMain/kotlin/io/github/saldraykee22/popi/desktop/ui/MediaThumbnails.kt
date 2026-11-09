package io.github.saldraykee22.popi.desktop.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import io.github.saldraykee22.popi.domain.Asset

/**
 * Küçük resim kaynağı. Uygulama tarafı (dosya, FFmpeg, önbellek) bunu sağlar; arayüz yalnız bu arayüzü bilir.
 * Uygulamalar IO iş parçacığında çalışmalıdır; hata ya da veri yoksa null döner.
 */
interface MediaThumbnailSource {
    /** Videonun kare görüntüsü. */
    suspend fun frame(asset: Asset): ImageBitmap?

    /** Sesin dalga formu: 0 ile 1 arasında tepe değerleri. */
    suspend fun waveform(asset: Asset): List<Float>?
}

/** Ses varlığı için dalga formu, video varlığı için kare. Yüklenene kadar koyu bir zemin görünür. */
@Composable
fun AssetThumbnail(asset: Asset, source: MediaThumbnailSource, modifier: Modifier = Modifier) {
    if (asset.kind == MediaKind.AUDIO.wire) {
        val bars by produceState<List<Float>?>(null, asset.id) { value = source.waveform(asset) }
        WaveformView(bars, modifier)
    } else {
        val frame by produceState<ImageBitmap?>(null, asset.id) { value = source.frame(asset) }
        val image = frame
        if (image != null) {
            Image(bitmap = image, contentDescription = null, modifier = modifier, contentScale = ContentScale.Crop)
        } else {
            Box(modifier.background(PopiColors.inset))
        }
    }
}

/** Tepe değerlerinden çizilen basit dalga formu. */
@Composable
fun WaveformView(peaks: List<Float>?, modifier: Modifier = Modifier) {
    Canvas(modifier.background(PopiColors.inset)) {
        val values = peaks ?: return@Canvas
        if (values.isEmpty()) return@Canvas
        val step = size.width / values.size
        val barWidth = (step * 0.6f).coerceAtLeast(1f)
        values.forEachIndexed { index, peak ->
            val height = (peak.coerceIn(0f, 1f) * size.height).coerceAtLeast(1f)
            drawRect(
                color = PopiColors.accent,
                topLeft = Offset(index * step, (size.height - height) / 2f),
                size = Size(barWidth, height),
            )
        }
    }
}
