package io.github.saldraykee22.popi

import io.github.saldraykee22.popi.domain.Project

data class RenderPreview(val durationMs: Long, val width: Int, val height: Int)
data class RenderRequest(val project: Project, val outputPath: String)
data class RenderResult(val outputPath: String)

/** Platform rendering boundary; the shared model does not depend on media frameworks. */
interface RendererPort {
    fun preview(project: Project): RenderPreview
    fun export(request: RenderRequest, onComplete: (Result<RenderResult>) -> Unit)
}

