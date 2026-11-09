package io.github.saldraykee22.popi.desktop

import io.github.saldraykee22.popi.domain.Project
import io.github.saldraykee22.popi.domain.ProjectJson
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption

/** Windows project storage. Data is written to a sibling file and atomically promoted. */
class ProjectStore(private val root: Path = defaultRoot()) {
    fun save(name: String, project: Project): Path {
        val path = projectPath(name)
        Files.createDirectories(path.parent)
        val temporary = Files.createTempFile(path.parent, path.fileName.toString(), ".tmp")
        try {
            Files.writeString(temporary, ProjectJson.encode(project), StandardOpenOption.TRUNCATE_EXISTING)
            try {
                Files.move(temporary, path, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
            } catch (_: java.nio.file.AtomicMoveNotSupportedException) {
                Files.move(temporary, path, StandardCopyOption.REPLACE_EXISTING)
            }
            Files.writeString(root.resolve("son-proje.txt"), path.toString())
        } finally {
            Files.deleteIfExists(temporary)
        }
        return path
    }

    fun loadLast(): Pair<String, Project>? = runCatching {
        val last = root.resolve("son-proje.txt")
        if (!Files.isRegularFile(last)) return null
        val path = Path.of(Files.readString(last).trim())
        if (!Files.isRegularFile(path)) return null
        path.fileName.toString().removeSuffix(".popi.json") to ProjectJson.decode(Files.readString(path))
    }.getOrNull()

    private fun projectPath(name: String): Path {
        val safe = name.trim().replace(Regex("[^\\p{L}\\p{N} _-]"), "_").trim().ifBlank { "Adsız Proje" }
        return root.resolve("projeler").resolve("$safe.popi.json")
    }

    companion object {
        private fun defaultRoot(): Path {
            val appData = System.getenv("APPDATA")?.takeIf(String::isNotBlank)
                ?: Path.of(System.getProperty("user.home"), "AppData", "Roaming").toString()
            return Path.of(appData, "Popi")
        }
    }
}

