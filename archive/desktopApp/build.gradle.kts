plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.compose.multiplatform)
    alias(libs.plugins.kotlin.compose.compiler)
}
kotlin {
    jvmToolchain(21)
    jvm("desktop")
    sourceSets {
        val desktopMain by getting {
            dependencies {
                implementation(project(":shared"))
                implementation(compose.runtime)
                implementation(compose.foundation)
                implementation(compose.material3)
                implementation(compose.ui)
                implementation(compose.desktop.currentOs)
                implementation(libs.jna.platform)
            }
        }
        val desktopTest by getting {
            dependencies {
                implementation(kotlin("test"))
                implementation(libs.junit.jupiter)
                implementation("org.jetbrains.compose.ui:ui-test-junit4:1.12.1")
            }
        }
    }
}
compose.desktop { application { mainClass = "io.github.saldraykee22.popi.desktop.MainKt" } }
tasks.withType<Test>().configureEach { useJUnitPlatform() }
tasks.register("test") {
    group = "verification"
    description = "Runs the desktop JVM test suite."
    dependsOn("desktopTest")
}
tasks.register<JavaExec>("runHardSet") {
    group = "verification"
    description = "Zor set ölçümü: uygulamanın istemi ve motoru; anahtar POPI_OLCUM_KEY ortam değişkeninden."
    dependsOn("desktopMainClasses")
    mainClass.set("io.github.saldraykee22.popi.desktop.olcum.HardSetRunnerKt")
    classpath = files(layout.buildDirectory.dir("classes/kotlin/desktop/main")) + configurations.getByName("desktopRuntimeClasspath")
    workingDir = rootProject.projectDir
}
