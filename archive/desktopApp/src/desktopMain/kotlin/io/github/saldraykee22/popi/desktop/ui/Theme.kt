package io.github.saldraykee22.popi.desktop.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.platform.Font

/** Arayüzün tek renk kaynağı. Kırmızı yok; hata durumunda bile vurgu rengi kullanılır. */
object PopiColors {
    val ground = Color(0xFF000000)
    val surface = Color(0xFF111113)
    val raised = Color(0xFF19191C)
    val inset = Color(0xFF080809)
    val lane = Color(0xFF303034)
    val border = Color(0xFF2A2A2F)
    val text = Color(0xFFE7E5E0)
    val textMuted = Color(0xFF9C9A93)
    val accent = Color(0xFFD2B47A)
}

/** IBM Plex aileleri. Değişken sans font 400, 500 ve 600 ağırlıklarına eşlenir. */
object PopiFonts {
    private const val SANS = "font/IBMPlexSans-Variable.ttf"
    private const val MONO_REGULAR = "font/IBMPlexMono-Regular.ttf"
    private const val MONO_MEDIUM = "font/IBMPlexMono-Medium.ttf"

    val sans: FontFamily by lazy {
        FontFamily(
            Font(resource = SANS, weight = FontWeight.Normal, variationSettings = FontVariation.Settings(FontVariation.weight(400))),
            Font(resource = SANS, weight = FontWeight.Medium, variationSettings = FontVariation.Settings(FontVariation.weight(500))),
            Font(resource = SANS, weight = FontWeight.SemiBold, variationSettings = FontVariation.Settings(FontVariation.weight(600))),
        )
    }

    val mono: FontFamily by lazy {
        FontFamily(
            Font(resource = MONO_REGULAR, weight = FontWeight.Normal),
            Font(resource = MONO_MEDIUM, weight = FontWeight.Medium),
        )
    }
}

private val popiScheme: ColorScheme = darkColorScheme(
    background = PopiColors.ground,
    onBackground = PopiColors.text,
    surface = PopiColors.surface,
    onSurface = PopiColors.text,
    surfaceVariant = PopiColors.raised,
    onSurfaceVariant = PopiColors.textMuted,
    surfaceContainerLowest = PopiColors.ground,
    surfaceContainerLow = PopiColors.surface,
    surfaceContainer = PopiColors.surface,
    surfaceContainerHigh = PopiColors.raised,
    surfaceContainerHighest = PopiColors.lane,
    primary = PopiColors.accent,
    onPrimary = PopiColors.ground,
    primaryContainer = PopiColors.accent,
    onPrimaryContainer = PopiColors.ground,
    secondary = PopiColors.accent,
    onSecondary = PopiColors.ground,
    secondaryContainer = PopiColors.accent,
    onSecondaryContainer = PopiColors.ground,
    tertiary = PopiColors.accent,
    onTertiary = PopiColors.ground,
    tertiaryContainer = PopiColors.accent,
    onTertiaryContainer = PopiColors.ground,
    error = PopiColors.accent,
    onError = PopiColors.ground,
    errorContainer = PopiColors.surface,
    onErrorContainer = PopiColors.text,
    outline = PopiColors.border,
    outlineVariant = PopiColors.border,
)

/** Material tipografi ölçekleri aynen korunur; yalnız yazı ailesi Plex Sans olur. */
private val popiTypography: Typography by lazy {
    val base = Typography()
    val family = PopiFonts.sans
    Typography(
        displayLarge = base.displayLarge.copy(fontFamily = family),
        displayMedium = base.displayMedium.copy(fontFamily = family),
        displaySmall = base.displaySmall.copy(fontFamily = family),
        headlineLarge = base.headlineLarge.copy(fontFamily = family),
        headlineMedium = base.headlineMedium.copy(fontFamily = family),
        headlineSmall = base.headlineSmall.copy(fontFamily = family),
        titleLarge = base.titleLarge.copy(fontFamily = family),
        titleMedium = base.titleMedium.copy(fontFamily = family),
        titleSmall = base.titleSmall.copy(fontFamily = family),
        bodyLarge = base.bodyLarge.copy(fontFamily = family),
        bodyMedium = base.bodyMedium.copy(fontFamily = family),
        bodySmall = base.bodySmall.copy(fontFamily = family),
        labelLarge = base.labelLarge.copy(fontFamily = family),
        labelMedium = base.labelMedium.copy(fontFamily = family),
        labelSmall = base.labelSmall.copy(fontFamily = family),
    )
}

@Composable
fun PopiTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = popiScheme, typography = popiTypography, content = content)
}
