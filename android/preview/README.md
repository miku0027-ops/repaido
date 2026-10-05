# Repaido Preview APK

Standalone Android 8+ test package of the latest React interface. Package ID com.repaido.preview, version 1.0-preview, debug-signed. Independent of the earlier Compose application. Assets are bundled; a local computer/server is not required. The sample checkout does not create appointments or take payments. External map links require a browser/internet.

Build web first, copy web/dist into preview/src/main/assets/site, then run :preview:assembleDebug with Java 21. The shell serves bundled files through an intercepted HTTPS origin, denies external subresource requests and has no JavaScript bridge. No INTERNET permission is requested. App data is not backed up. Booking form contents live in memory and can reset when the app is closed/recreated.

Install dist/Repaido-Preview-1.0.apk on an Android phone. If prompted, allow installation from the browser/file manager used to open it. Do not disable Play Protect. Tested installation and initial launch on the local emulator; physical-phone testing remains with the user.
