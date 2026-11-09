package io.github.saldraykee22.popi.desktop.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Önizleme alanı. [preview] içeriği dışarıdan verilebilir; kendisine boyutlu ve arka planlı bir [Modifier] gelir.
 * Oynat/duraklat kontrolü önizlemenin altında, zaman kodunun yanındadır.
 */
@Composable
fun PreviewArea(
    preview: @Composable (Modifier) -> Unit,
    playing: Boolean,
    playheadLabel: String,
    onTogglePlay: () -> Unit,
    modifier: Modifier = Modifier,
) {
    PopiPanel(modifier = modifier, padding = 12.dp, spacing = 10.dp) {
        Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
            preview(
                Modifier
                    .heightIn(max = 410.dp)
                    .aspectRatio(9f / 16f)
                    .fillMaxHeight()
                    .background(PopiColors.inset, RoundedCornerShape(8.dp))
                    .testTag("preview-frame"),
            )
        }
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            TextButton(onClick = onTogglePlay) {
                Text(if (playing) "Ⅱ Duraklat" else "▶ Oynat", color = PopiColors.accent)
            }
            Text(
                playheadLabel,
                color = PopiColors.textMuted,
                fontSize = 12.sp,
                fontFamily = PopiFonts.mono,
                modifier = Modifier.testTag("playhead-label"),
            )
        }
    }
}

/** Varsayılan önizleme: son işlenmiş kare ya da bir yönerge metni. */
@Composable
fun PreviewFrame(modifier: Modifier, image: ImageBitmap?, hint: String) {
    Box(modifier, contentAlignment = Alignment.Center) {
        if (image != null) {
            Image(
                bitmap = image,
                contentDescription = "Video önizlemesi",
                modifier = Modifier.fillMaxSize().testTag("preview-image"),
                contentScale = ContentScale.Fit,
            )
        } else {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("9:16", color = PopiColors.textMuted, fontSize = 18.sp)
                Text(hint, color = PopiColors.text)
            }
        }
    }
}
