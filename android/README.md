# Android development and release packaging

The `app` customer launcher and `agent` worker launcher are WebView shells for
the hosted web application. Both default to `https://repaido.web.app`; set
`-PREPAIDO_WEB_URL=https://your-approved-host` to change the web origin. Native
Compose screens remain in the customer source tree, but they are not its current
launcher. `preview` serves its bundled website assets offline.

The `go` module adds separate **Repaido Go** customer and **Go Driver** rider
packages, using `https://repaido.com`. See [Go setup](go/README.md) for builds,
package-specific Firebase configuration and ride push verification.

All four modules use compile/target SDK 35, minimum SDK 26, Android Gradle
Plugin 8.7.3, Gradle 8.9, and Java 17 bytecode. Use a Java 17 or 21 Gradle runtime
with Android SDK 35 and its build tools installed. Install SDK components through
Android Studio or the official Android SDK tools, reviewing their license terms.

From this directory:

```sh
./gradlew :app:assembleDebug :agent:assembleDebug :preview:assembleDebug
./gradlew :app:lintDebug :agent:lintDebug :preview:lintDebug
```

Debug variants keep Android's development signing configuration. Release variants
are deliberately unsigned by default; they never fall back to the debug key.
Configure an approved production signing identity externally before distributing
an APK or uploading an Android App Bundle. A successful unsigned release build
does not establish production signing readiness. No keystore or signing password
belongs in this repository, Gradle command-line arguments, or chat.

The static packaging regression can run without an Android SDK:

```sh
python3 -m unittest discover -s android/tests -v  # from the repository root
```

Compile and lint checks do not replace device tests for push notifications,
camera evidence, permissions, WebView authentication, geolocation, or the agent's
background location service. `scripts/android_smoke.py` targets an older native
UI and a developer-specific adb path; it is not a current launcher smoke test.
