# Repaido Go Android apps

Two independent installable packages share Repaido accounts, booking rules and
the hosted interface. Main Repaido keeps its Go tab and Services tab.

| Variant | Launcher | Package | Initial screen |
| --- | --- | --- | --- |
| customer | Repaido Go | `com.repaido.go` | `/go?ride=bike` |
| driver | Go Driver | `com.repaido.go.driver` | `/worker?mode=driver&tab=bikes` |

Go uses the trusted `https://repaido.com` origin by default. Set the existing
`REPAIDO_WEB_URL` Gradle property to an approved HTTPS staging origin to test an
unreleased website. Each package has its own WebView login session. The customer
app's Repaido shortcut opens the installed main app, or its website if absent.
Neither package embeds a second booking engine or invents ride state.

## Build and install for testing

Use the SDK/JDK setup in [../README.md](../README.md). From `android`:

```sh
python3 go/build.py customer
python3 go/build.py driver
./gradlew :go:testCustomerDebugUnitTest :go:testDriverDebugUnitTest
adb install -r go/build/outputs/apk/customer/debug/go-customer-debug.apk
adb install -r go/build/outputs/apk/driver/debug/go-driver-debug.apk
```

These debug APKs can open the hosted service without Firebase client settings,
but show a clear message that push is unconfigured. They are development-signed,
not store releases. They display the deployed website; unreleased web changes
require a staging origin or the requested website release.

## Enable real Android push

Register **both packages** as separate Android apps in the `repaido` Firebase
project. Register the appropriate debug/release certificate fingerprints and
restrict their API keys to those package/certificate combinations. Existing
customer, agent and browser Firebase IDs must not be reused for these packages.
Keep downloaded configuration outside the repository.

For each app, supply its own downloaded `google-services.json`:

```sh
python3 go/build.py customer --firebase-config /private/path/go-customer/google-services.json
python3 go/build.py driver --firebase-config /private/path/go-driver/google-services.json
```

The helper verifies project and package, passes configuration through Gradle's
environment properties, and does not print values or copy configuration into
source. `--release` requires this configuration and builds an **unsigned** APK;
production signing remains the external release step described in the Android
README. Direct Gradle release builds also reject missing Firebase registration.

Users sign in, open **Ride alerts** (customer) or **Ride settings** (driver), then
tap **Enable ride notifications**. Permission is requested on that action.
Existing opt-ins refresh tokens quietly on resume without repeated permission
prompts. Android controls sound, heads-up presentation, DND and vibration.

Bike and cab updates use the existing durable `work_push` FCM relay. New builds
register `ride_push_capable`; older apps are not sent unsupported ride payloads.
Messages contain only identifiers and state, not addresses, OTPs or payment data.
The server checks the participant, state, version, expiry and device owner before
sending. Native code checks the bound signed-in account and expiry again,
deduplicates versions, and opens a fixed internal ride path. It never accepts,
starts, completes or cancels a ride from a push payload. Signing out clears the
account binding and visible ride notifications.

The backend, website and native changes must be released together to enable this
flow. A successful compile or mocked FCM test does not verify actual delivery.
Before distribution, test both packages on a real Android device: sign-in,
precise-location consent, foreground/background and locked-screen delivery,
request expiry, account switch/logout, notification denial, reconnect, and
tap-to-open of the account's actual ride. The Go wrapper uses the existing web
location session while open; it does not add background bike-location tracking.

## Shared implementation

`../ride-common` provides validated routing, account binding and the notification
channel to Go and the existing customer/agent apps. Firebase registration is
initialized on process startup for cold FCM delivery. The bridge is attached only
to the trusted top-level origin; third-party authentication frames do not receive
native capabilities. File selection and location permissions remain explicit.
