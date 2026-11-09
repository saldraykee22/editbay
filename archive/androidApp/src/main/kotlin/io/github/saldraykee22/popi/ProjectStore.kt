package io.github.saldraykee22.popi

import android.content.Context
import io.github.saldraykee22.popi.domain.Project
import io.github.saldraykee22.popi.domain.ProjectJson
import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption

class ProjectStore(context: Context) {
    private val file = File(context.filesDir, "project.json")
    fun load(): Project? = if (file.exists()) runCatching { ProjectJson.decode(file.readText()) }.getOrNull() else null
    fun save(project: Project) {
        val temp = File(file.parentFile, "project.json.tmp")
        temp.writeText(ProjectJson.encode(project))
        Files.move(temp.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
    }
}

