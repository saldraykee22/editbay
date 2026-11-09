package io.github.saldraykee22.popi.desktop.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.saldraykee22.popi.domain.Asset

/** Zaman çizelgesinde tek bir blok: başlangıç ve süre milisaniyedir. Görsel yalnız varlıklı bloklarda olur. */
data class TimelineBlock(
    val id: String,
    val label: String,
    val startMs: Long,
    val durationMs: Long,
    val asset: Asset? = null,
)

/**
 * Tek bir iz. Bloklar süreleriyle orantılı genişlikte ve başlangıçlarında yerleşir.
 * Boş alana dokunmak o zamana atlar.
 */
@Composable
fun TimelineLane(
    name: String,
    blocks: List<TimelineBlock>,
    totalMs: Long,
    selectedId: String?,
    thumbnails: MediaThumbnailSource,
    onSelect: (String) -> Unit,
    onSeek: (Long) -> Unit,
    modifier: Modifier = Modifier,
) {
    val total = totalMs.coerceAtLeast(1L)
    Row(
        modifier.fillMaxWidth().height(44.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(name, color = PopiColors.textMuted, modifier = Modifier.width(52.dp), fontSize = 12.sp)
        BoxWithConstraints(Modifier.weight(1f).fillMaxHeight()) {
            val laneWidth = maxWidth
            Box(
                Modifier.fillMaxSize()
                    .background(PopiColors.ground, RoundedCornerShape(5.dp))
                    .pointerInput(total) {
                        detectTapGestures { offset ->
                            if (size.width > 0) onSeek((offset.x / size.width * total).toLong().coerceIn(0L, total))
                        }
                    },
            )
            blocks.forEach { block ->
                val startFraction = block.startMs.coerceAtLeast(0L).toFloat() / total
                val widthFraction = block.durationMs.coerceAtLeast(0L).toFloat() / total
                TimelineClip(
                    block = block,
                    selected = selectedId == block.id,
                    thumbnails = thumbnails,
                    modifier = Modifier
                        .offset(x = laneWidth * startFraction)
                        .width(laneWidth * widthFraction)
                        .fillMaxHeight()
                        .padding(vertical = 3.dp),
                    onClick = { onSelect(block.id) },
                )
            }
        }
    }
}

@Composable
private fun TimelineClip(
    block: TimelineBlock,
    selected: Boolean,
    thumbnails: MediaThumbnailSource,
    modifier: Modifier,
    onClick: () -> Unit,
) {
    val labelColor = if (selected) PopiColors.ground else PopiColors.text
    Surface(
        onClick = onClick,
        modifier = modifier.testTag("clip-${block.id}"),
        color = if (selected) PopiColors.accent else PopiColors.lane,
        shape = RoundedCornerShape(4.dp),
    ) {
        Row(Modifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
            block.asset?.let { asset ->
                AssetThumbnail(asset = asset, source = thumbnails, modifier = Modifier.fillMaxHeight().width(36.dp))
            }
            Column(Modifier.weight(1f).padding(horizontal = 6.dp)) {
                Text(
                    block.label,
                    color = labelColor,
                    fontSize = 10.sp,
                    lineHeight = 13.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    formatSeconds(block.durationMs),
                    color = if (selected) PopiColors.ground else PopiColors.textMuted,
                    fontSize = 9.sp,
                    lineHeight = 12.sp,
                    fontFamily = PopiFonts.mono,
                    maxLines = 1,
                )
            }
        }
    }
}
