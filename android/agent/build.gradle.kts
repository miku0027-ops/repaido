plugins { id("com.android.application") }
android {
    namespace = "com.repaido.agent"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.repaido.agent"
        minSdk = 26
        targetSdk = 35
        versionCode = 13
        versionName = "1.2.10"
        buildConfigField("String", "WEB_URL", "\"${providers.gradleProperty("REPAIDO_WEB_URL").getOrElse("https://repaido.web.app")}\"")
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}
configurations.all {
    exclude(group = "org.jetbrains.kotlin", module = "kotlin-stdlib-jdk7")
    exclude(group = "org.jetbrains.kotlin", module = "kotlin-stdlib-jdk8")
}
dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("com.google.firebase:firebase-messaging:24.1.0")
    implementation("androidx.activity:activity:1.9.3")
    implementation("androidx.core:core:1.13.1")
    implementation("org.jetbrains.kotlin:kotlin-stdlib:1.8.22")
}
