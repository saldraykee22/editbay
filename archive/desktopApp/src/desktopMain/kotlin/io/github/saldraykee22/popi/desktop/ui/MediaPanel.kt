package io.github.saldraykee22.popi.desktop.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.saldraykee22.popi.domain.Asset

/** Medya listesindeki bir varlık ve ekranda gösterilecek ad (etiket). */
data class MediaEntry(val asset: Asset, val name: String)

@Composable
fun MediaPanel(
    entries: List<MediaEntry>,
    thumbnails: MediaThumbnailSource,
    onImport: () -> Unit,
    onRename: (Asset, String) -> Unit,
    modifier: Modifier = Modifier,
) {
    PopiPanel(modifier = modifier, padding = 14.dp, spacing = 10.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("MEDYA", color = PopiColors.textMuted, fontSize = 12.sp, letterSpacing = 1.sp)
            Spacer(Modifier.weight(1f))
            TextButton(onClick = onImport) { Text("+ İçe aktar", color = PopiColors.accent) }
        }
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            items(entries, key = { it.asset.id }) { entry -> MediaCard(entry, thumbnails, onRename) }
        }
        Text("Etiketi düzenlemek için çift tıklayın", color = PopiColors.textMuted, fontSize = 12.sp)
    }
}

@Composable
private fun MediaCard(entry: MediaEntry, thumbnails: MediaThumbnailSource, onRename: (Asset, String) -> Unit) {
    var editing by remember(entry.asset.id) { mutableStateOf(false) }
    var draft by remember(entry.asset.id) { mutableStateOf(entry.name) }

    Surface(
        color = PopiColors.raised,
        border = BorderStroke(1.dp, PopiColors.border),
        shape = RoundedCornerShape(7.dp),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(8.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            AssetThumbnail(
                asset = entry.asset,
                source = thumbnails,
                modifier = Modifier.size(width = 56.dp, height = 40.dp).clip(RoundedCornerShape(4.dp)),
            )
            Column(Modifier.weight(1f)) {
                if (editing) {
                    OutlinedTextField(
                        value = draft,
                        onValueChange = { draft = it },
                        modifier = Modifier.fillMaxWidth().testTag("label-input-${entry.asset.id}"),
                        textStyle = TextStyle(color = PopiColors.text, fontSize = 12.sp),
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = {
                            onRename(entry.asset, draft)
                            editing = false
                        }),
                    )
                } else {
                    Text(
                        entry.name,
                        color = PopiColors.text,
                        fontSize = 12.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier
                            .fillMaxWidth()
                            .testTag("label-${entry.asset.id}")
                            .pointerInput(entry.asset.id, entry.name) {
                                detectTapGestures(onDoubleTap = {
                                    draft = entry.name
                                    editing = true
                                })
                            },
                    )
                }
                Text(
                    "${entry.asset.kind} · ${entry.asset.durationMs / 1000}s",
                    color = PopiColors.textMuted,
                    fontSize = 11.sp,
                )
            }
        }
    }
}
