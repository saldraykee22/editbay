package io.github.saldraykee22.popi.desktop.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Durum satırı. Hata metni yazı renginde kalır; solunda ince vurgu çizgisi görünür. */
data class StatusMessage(val text: String, val isError: Boolean = false)

@Composable
fun PopiPanel(
    modifier: Modifier = Modifier,
    padding: Dp = 14.dp,
    spacing: Dp = 10.dp,
    content: @Composable ColumnScope.() -> Unit,
) {
    Surface(
        modifier = modifier,
        color = PopiColors.surface,
        border = BorderStroke(1.dp, PopiColors.border),
        shape = RoundedCornerShape(10.dp),
    ) {
        Column(
            Modifier.fillMaxSize().padding(padding),
            verticalArrangement = Arrangement.spacedBy(spacing),
            content = content,
        )
    }
}

@Composable
fun StatusLine(message: StatusMessage, modifier: Modifier = Modifier) {
    Row(modifier.height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        if (message.isError) Box(Modifier.width(2.dp).fillMaxHeight().background(PopiColors.accent))
        Text(
            text = message.text,
            color = if (message.isError) PopiColors.text else PopiColors.textMuted,
            fontSize = 11.sp,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
    }
}

/** Zaman kodu: dakika:saniye.onda. Sayılar sabit genişlikli yazı tipiyle gösterilir. */
fun formatTimecode(ms: Long): String = "%02d:%02d.%1d".format(ms / 60_000, (ms / 1000) % 60, (ms % 1000) / 100)

/** Süre yazısı, örnek: 2.5 sn. */
fun formatSeconds(ms: Long): String = "%.1f sn".format(ms / 1000.0)
