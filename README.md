# Repaido — home services

A native Kotlin / Jetpack Compose Android app with a FastAPI + SQLite backend, plus a separate React / Tailwind web design system for service discovery and checkout. The Android app uses native screens, not a WebView.

## Included

- Eight service categories, twelve seeded services, search and city selection.
- Service inclusions/exclusions, transparent prices, duration and a four-step booking flow.
- Email/password registration and login; encrypted Android session storage using Android Keystore.
- Durable booking requests, live slot availability, booking history and cancellation.
- Operator API to assign a professional and progress a job through confirmed → in progress → completed.
- Server-owned prices, transactional slot capacity, idempotent booking requests, ownership checks, password hashing, expiring hashed tokens and authentication rate limiting.
- TalkBack-labelled controls, system font scaling, large primary buttons, familiar bottom navigation, confirmation before cancellation, loading/empty/error states.

## Run the backend

Requires Python 3.11 or newer. From `backend`:

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000
```

- API documentation: http://127.0.0.1:8000/docs
- Health check: http://127.0.0.1:8000/health
- Database: `backend/repaido.db` when started in that directory.
- `REPAIDO_DB` changes the database location.
- `REPAIDO_ADMIN_KEY` enables operator endpoints. Set a long random secret in the server environment, never in the Android app. If unset, operator endpoints remain disabled.

To process a booking, use the protected `/admin/bookings` endpoints in the API docs, entering `X-Admin-Key`. Assign a real professional name while changing `requested` to `confirmed`. Then progress to `in_progress` and `completed`. Requests are never presented as confirmed before this happens.

## Run Android

Open the `android` directory in Android Studio, select a Java 17 or 21 Gradle runtime, and run on an API 26+ emulator. The project compiles with Android SDK 35.

The debug build uses `http://10.0.2.2:8000`, Android Emulator’s address for the host computer. Start the backend first. Debug permits local HTTP; release builds forbid cleartext HTTP.

```sh
cd android
./gradlew assembleDebug
```

APK: `android/app/build/outputs/apk/debug/app-debug.apk`.

For a physical device with USB debugging, forward port 8000 using `adb reverse tcp:8000 tcp:8000` and build with:

```sh
./gradlew assembleDebug -PREPAIDO_API_URL=http://127.0.0.1:8000
```

For a hosted backend, set `-PREPAIDO_API_URL=https://your-api.example.com` and configure production release signing separately. Do not distribute the debug APK as a production release.

## Test

```sh
cd backend
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q
```

Tests cover registration/login/logout, invalid input, token expiry, credential hashing, booking ownership, server-side pricing, idempotency, concurrent capacity, persistence, cancellation and operator transitions.

## Backend hosting

`backend/Dockerfile` runs the API as a non-root user. Mount durable storage at `/data` and set `REPAIDO_DB=/data/repaido.db`. Put the service behind an HTTPS reverse proxy or a managed container platform. Keep this SQLite deployment to a single application instance with a local persistent volume; do not use an ephemeral filesystem or replicate independent databases. Back up the database. Move to a shared transactional database before horizontal scaling.

## Scope and launch boundaries

This is a working pilot, not an operating services marketplace. Catalogue prices, service cities and a capacity of three requests per service/city/slot are configurable seed assumptions, not verified commercial inventory. Customer requests are stored for an operator to review; no professional is dispatched automatically.

Payment is explicitly **pay after service**; no card payment or payment verification is implemented. SMS/OTP, push notifications, password recovery/email verification, a professional-facing app, support staffing, live tracking, real provider scheduling, refunds, tax invoicing and production monitoring are not integrated. Status refresh is manual. No invented ratings, reviews or professional credentials are displayed. Pilot branding and content must be reviewed before launch.

The release app requires a reachable HTTPS API and a signing key. No public backend deployment, Play Store publication or website deployment has been performed.

## UX decisions

- Hick’s law: recognisable categories, progressive disclosure, one booking decision per screen.
- Fitts’s law: prominent primary actions, bottom navigation and adequately sized controls.
- Recognition over recall: visible inclusions, prices, address and appointment review.
- Error prevention: constrained slots, mobile-number validation, explicit cancellation confirmation and duplicate-request protection.
- Clear system status: requested vs. assigned vs. completed, loading states and recoverable errors.
- Aesthetic direction: editorial type hierarchy, cobalt blue, generous white space and restrained motion, inspired by minimal work on Awwwards while retaining familiar Android patterns.

## React + Tailwind design system

The `web/` directory now contains the requested responsive service discovery and checkout components, using the white / navy / electric-blue design tokens. See [web setup and integration notes](web/README.md). This interface runs separately from Android and uses an explicitly labelled checkout preview until a compatible server-side payment integration is supplied.
