import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The version comes from the VERSION file at the top of the repository.
val appVersion = rootProject.file("../VERSION").readText().trim()
val parts = appVersion.split(".").map { it.toIntOrNull() ?: 0 } + listOf(0, 0, 0)
val appVersionCode = parts[0] * 10000 + parts[1] * 100 + parts[2]

// Release signing comes from a keystore given by the build (CI secrets), never from the repo.
val signing = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "io.github.mightyx3n.playbigscreen"
    compileSdk = 35

    defaultConfig {
        applicationId = "io.github.mightyx3n.playbigscreen"
        minSdk = 24
        targetSdk = 35
        versionCode = appVersionCode
        versionName = appVersion
    }

    signingConfigs {
        create("release") {
            if (signing.getProperty("storeFile") != null) {
                storeFile = rootProject.file(signing.getProperty("storeFile"))
                storePassword = signing.getProperty("storePassword")
                keyAlias = signing.getProperty("keyAlias")
                keyPassword = signing.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (signing.getProperty("storeFile") != null) signingConfig = signingConfigs.getByName("release")
        }
    }

    buildFeatures { buildConfig = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    testOptions { unitTests.isIncludeAndroidResources = true }
}

// The launcher's web UI (ui/dist, built with `npm run build` in ui/) and the app SDK go
// into the APK's assets.
val copyWeb by tasks.registering(Sync::class) {
    val ui = rootProject.file("../ui/dist")
    doFirst {
        if (!ui.resolve("index.html").exists()) throw GradleException("Build the UI first: cd ui && npm ci && npm run build")
    }
    from(ui) { into("ui") }
    from(rootProject.file("../sdk")) {
        into("sdk")
        include("playbigscreen.js", "pbs.css", "lexend.woff2")
    }
    into(layout.buildDirectory.dir("generated/webassets"))
}
android.sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/webassets"))
tasks.named("preBuild") { dependsOn(copyWeb) }

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.media3:media3-exoplayer:1.5.1")
    implementation("androidx.media3:media3-exoplayer-hls:1.5.1")
    implementation("androidx.media3:media3-ui:1.5.1")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
    testImplementation("org.robolectric:robolectric:4.14.1")
    testImplementation("androidx.test:core:1.6.1")
}
