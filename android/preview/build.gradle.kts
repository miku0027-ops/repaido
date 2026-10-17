plugins { id("com.android.application") }
android {
    namespace = "com.repaido.preview"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.repaido.preview"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0-preview"
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    buildTypes {
        release {
            isMinifyEnabled = false
            // Release artifacts stay unsigned until a production signer is configured.
        }
    }
}
