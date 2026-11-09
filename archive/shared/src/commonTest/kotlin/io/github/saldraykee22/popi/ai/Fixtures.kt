package io.github.saldraykee22.popi.ai

import io.github.saldraykee22.popi.domain.Asset
import io.github.saldraykee22.popi.domain.Clip
import io.github.saldraykee22.popi.domain.Project
import io.github.saldraykee22.popi.domain.TextItem
import io.github.saldraykee22.popi.domain.TextStyle
import io.github.saldraykee22.popi.domain.Track

internal fun sampleProject(): Project = Project(
    id = "p1",
    assets = listOf(
        Asset("v1", "video", "file:///gizli-klasor/giris_selam.mp4", 8000),
        Asset("v2", "video", "file:///gizli-klasor/hamur.mp4", 6000),
        Asset("m1", "audio", "file:///gizli-klasor/arka_muzik.m4a", 30000),
    ),
    tracks = listOf(
        Track(
            "v1", "video",
            clips = listOf(
                Clip("c1", "v1", 0, 8000),
                Clip("c2", "v2", 1000, 6000, null),
            ),
        ),
        Track(
            "t1", "text",
            items = listOf(
                TextItem("x1", "Kuzey Fırın", 0, 3000, TextStyle(48, "#FFFFFF", "top")),
            ),
        ),
        Track(
            "m1", "audio",
            clips = listOf(Clip("a1", "m1", 0, 30000, 0.4f)),
        ),
    ),
)
