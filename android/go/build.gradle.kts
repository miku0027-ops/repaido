plugins { id("com.android.application") }

fun quoted(value: String) = "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""
val webOrigin = providers.gradleProperty("REPAIDO_WEB_URL").getOrElse("https://repaido.com").trimEnd('/')
require(webOrigin.matches(Regex("https://[A-Za-z0-9.-]+(?::[0-9]+)?"))) { "REPAIDO_WEB_URL must be an HTTPS origin without a path." }

android {
    namespace = "com.repaido.go"
    compileSdk = 35
    defaultConfig {
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
        buildConfigField("String", "WEB_URL", quoted(webOrigin))
    }
    flavorDimensions += "audience"
    productFlavors {
        create("customer") {
            dimension = "audience"
            applicationId = "com.repaido.go"
            resValue("string", "app_name", "Repaido Go")
            buildConfigField("String", "APP_KIND", "\"go_customer\"")
            buildConfigField("String", "START_PATH", "\"/go?ride=bike\"")
        }
        create("driver") {
            dimension = "audience"
            applicationId = "com.repaido.go.driver"
            resValue("string", "app_name", "Go Driver")
            buildConfigField("String", "APP_KIND", "\"go_driver\"")
            buildConfigField("String", "START_PATH", "\"/worker?mode=driver&tab=bikes\"")
        }
    }
    productFlavors.all {
        val prefix = "REPAIDO_GO_" + name.uppercase() + "_"
        buildConfigField("String", "FIREBASE_APP_ID", quoted(providers.gradleProperty(prefix + "FIREBASE_APP_ID").getOrElse("")))
        buildConfigField("String", "FIREBASE_API_KEY", quoted(providers.gradleProperty(prefix + "FIREBASE_API_KEY").getOrElse("")))
        buildConfigField("String", "FIREBASE_SENDER_ID", quoted(providers.gradleProperty(prefix + "FIREBASE_SENDER_ID").getOrElse("133610574058")))
        buildConfigField("String", "FIREBASE_PROJECT_ID", "\"repaido\"")
    }
    buildFeatures { buildConfig = true }
    sourceSets.getByName("main").java.srcDir("../ride-common/src/main/java")
    sourceSets.getByName("main").res.srcDir("../ride-common/src/main/res")
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    buildTypes {
        release { isMinifyEnabled = false /* Unsigned; production signing is a release step. */ }
    }
}
dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.core:core:1.13.1")
    implementation("com.google.firebase:firebase-messaging:24.1.0")
    testImplementation("junit:junit:4.13.2")
}

// Preview APKs work without push configuration; a release must use the actual
// Firebase registration for its package. Never silently ship disabled alerts.
listOf("Customer", "Driver").forEach { audience ->
    val prefix = "REPAIDO_GO_${audience.uppercase()}_"
    val verify = tasks.register("verify${audience}Firebase") {
        doLast {
            val appId = providers.gradleProperty(prefix + "FIREBASE_APP_ID").orNull.orEmpty()
            val key = providers.gradleProperty(prefix + "FIREBASE_API_KEY").orNull.orEmpty()
            val sender = providers.gradleProperty(prefix + "FIREBASE_SENDER_ID").getOrElse("133610574058")
            require(sender == "133610574058" && appId.matches(Regex("1:$sender:android:[a-f0-9]+")) && key.isNotBlank()) {
                "$audience release needs its own Repaido Firebase Android registration. See go/README.md."
            }
        }
    }
    tasks.matching { it.name == "pre${audience}ReleaseBuild" }.configureEach { dependsOn(verify) }
}
