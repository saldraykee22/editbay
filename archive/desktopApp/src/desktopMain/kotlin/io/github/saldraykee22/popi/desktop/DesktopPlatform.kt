package io.github.saldraykee22.popi.desktop

import java.awt.FileDialog
import java.awt.Frame
import java.io.File
import java.nio.file.Path

/** Platform edge injected into the editor UI; Compose components know only these callbacks. */
interface DesktopPlatform {
    fun chooseMediaFiles(): List<File>
    fun chooseExportPath(projectName: String): Path?
}

class WindowsDesktopPlatform : DesktopPlatform {
    override fun chooseMediaFiles(): List<File> {
        val dialog = FileDialog(null as Frame?, "Medya içe aktar", FileDialog.LOAD).apply {
            isMultipleMode = true
            isVisible = true
        }
        return dialog.files.toList()
    }

    override fun chooseExportPath(projectName: String): Path? {
        val dialog = FileDialog(null as Frame?, "Dışa aktar", FileDialog.SAVE).apply {
            file = "$projectName.mp4"
            isVisible = true
        }
        return dialog.file?.let { Path.of(dialog.directory, it) }
    }
}

