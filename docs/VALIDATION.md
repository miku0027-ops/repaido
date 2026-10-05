# Validation

- Native Android debug APK compiled successfully with Gradle 8.9, Android Gradle Plugin 8.7.3 and Java 21.
- Android lint passed with no errors. Remaining warnings concern newer dependency versions and legacy backup configuration; backups are disabled in the manifest.
- Seven backend integration tests passed, including parallel capacity contention, authentication/session expiry, ownership isolation, duplicate request handling, authoritative pricing, restart persistence and operator state transitions.
- Home, scheduling and booking review screens visually inspected on the Pixel 10a emulator.

The local API binds to the host loopback interface. The debug Android app connects through the emulator host bridge. Release networking requires HTTPS.

- End-to-end emulator test passed: search → service details → date/time → address → registration → booking submission → booking history → cancellation → sign-out. Verified the booking and cancellation in the live database. Synthetic QA records were removed after validation.
