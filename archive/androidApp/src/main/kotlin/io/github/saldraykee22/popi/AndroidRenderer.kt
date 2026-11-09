package io.github.saldraykee22.popi

import android.content.Context
import androidx.media3.common.util.UnstableApi
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.Transformer
import io.github.saldraykee22.popi.domain.Project
import java.io.File

@UnstableApi
class AndroidRenderer(private val context: Context) : RendererPort {
    override fun preview(project: Project) = RenderPreview(project.tracks.firstOrNull { it.kind == "video" }?.clips?.sumOf { it.outMs - it.inMs } ?: 0L, 1080, 1920)

    override fun export(request: RenderRequest, onComplete: (Result<RenderResult>) -> Unit) {
        val output = File(request.outputPath)
        MediaAdapter.export(context, request.project, output, object : Transformer.Listener {
            override fun onCompleted(composition: androidx.media3.transformer.Composition, exportResult: ExportResult) {
                onComplete(Result.success(RenderResult(output.absolutePath)))
            }
            override fun onError(composition: androidx.media3.transformer.Composition, exportResult: ExportResult, exportException: ExportException) {
                onComplete(Result.failure(exportException))
            }
        })
    }
}
