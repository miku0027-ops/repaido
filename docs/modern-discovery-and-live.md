# Discovery, transport experiences and live work

Home uses one reusable discovery hub in place of the old promotional slideshow. Cab, Shared ride, Self-drive and Cab rental are separate selected views. Nearby results reuse the existing transport index, approved fleet, road routing and full-price booking workflow. Cab rental is a chauffeured return-trip booking using the owner's existing cab quote; it does not advertise an invented hourly or daily chauffeur tariff. Self-drive retains the daily rental tariff and licence review.

India-time transport peaks are 07:00–09:00 and 17:00–19:00; repair discovery is prioritised at 10:00–12:00. Outside those windows, existing consented interests choose the first view. Explicit choices and active forms are held; updates do not replace a form while someone is using it. Only transport categories are stored, through the existing bounded, deduplicated interest API. Turning personalisation off/resetting clears specific mode preferences as well as broad interests.

Quick repair uses the live catalogue and discovery ranking. A chosen professional is passed into the existing appointment booking. The server checks approval, online location, category, travel limit and appointment availability again. It either offers the visit to that person or rejects the request; it never substitutes a different professional without customer choice. Existing bookings without a preference retain their original retry fingerprints and dispatch rules.

“Share on Repaidians” opens a deliberate preview and publication action for bookings, service work, home plans, hiring, rides, awards and projects. Participants are checked on the server. Posts store only a private source reference; viewers receive a narrow milestone card, never the source ID, addresses, quotes, fares, customer details, rosters, messages or private photos. Current state is rechecked while reading. Withdrawn/cancelled or inaccessible sources lose the card. Customers may publish verified milestones without gaining unrestricted professional social permissions. Approved current cab/driver/scrap memberships qualify for professional social features, while job/transport operational permissions remain separate.

## Cloudflare Stream

Video goes directly between the browser and Cloudflare via WHIP/WHEP. Repaido is the control plane: approval/membership, visibility, provider setup, activation, signed viewing tickets and stop/cleanup. Input credentials are returned only to the creator. Public lists never contain the publishing secret, source customer data, or raw private keys. Viewing tickets are signed locally with RS256 instead of making a Cloudflare API call per viewer. Streaming packets do not pass through Cloud Run or Firestore.

A live input is private and has recording disabled. A feed entry becomes active only after Cloudflare reports a connected input. Creators preview the camera and explicitly consent before Go live. Membership, business approval, trade visibility, blocking and suspension checks apply. One broadcast per account, four creations per hour, a 90-second heartbeat lease, and a two-hour duration limit bound unattended sessions. End hides the entry first and deletes the provider input; provider failures are retried by the existing private work worker. Heartbeats, viewing tickets, activation checks and source previews do not produce save notifications.

Cloudflare's Live WebRTC documentation states no fixed concurrent-viewer limit, but that is not a measured Repaido capacity guarantee. A million requests per second has **not** been load-tested. Reaching that target requires a provider capacity agreement, request/concurrency definitions, Cloudflare limits and WAF settings, control-plane load tests, and regional/cost planning. Existing Cloud Run instance limits are retained; this release does not silently provision millions of requests of paid load. The WebRTC offering does not currently provide HLS/DASH recording or live viewer counts, so the UI does not invent recordings or counters.

Official references:
- https://developers.cloudflare.com/stream/webrtc-beta/
- https://developers.cloudflare.com/stream/viewing-videos/securing-your-stream/
- https://developers.cloudflare.com/stream/stream-live/watch-live-stream/

### Connect the existing GCP deployment

The code can deploy before credentials; Live remains unavailable until the connection is ready. Required runtime values are `CLOUDFLARE_STREAM_ACCOUNT_ID`, `CLOUDFLARE_STREAM_API_TOKEN`, `CLOUDFLARE_STREAM_KEY_ID` and `CLOUDFLARE_STREAM_SIGNING_PEM`. Keep the API token and signing PEM in Secret Manager. The cleanup worker needs only the account ID and API token; the public work API receives neither.

In authenticated Cloud Shell, from the current repository checkout, run:

```sh
python3 scripts/configure-cloudflare-stream.py --project=repaido --region=us-central1
```

Use a Cloudflare account with Stream enabled and an API token restricted to that account's Stream Edit permission. The helper prompts for the account ID and hides token entry, prepares Secret Manager/runtime permissions, generates and stores a signing key, updates the API and cleanup worker, and checks `/api/repaidians/live/status`. It never prints token or private-key values. It preserves other Cloud Run environment settings and secret bindings. The subsequent Cloud Build release inherits these bindings.

Test one real broadcast and a second browser viewer after connection. Verify actual camera/audio, stop, account switching and provider cleanup. Desktop browsers and Android browsers can request camera and microphone access. Existing Android wrappers lack microphone permission; they default to camera-only preview until signed app updates add microphone support. Current APK signing still requires the Desktop project's original signing setup.

## Validation

The isolated browser fixture checks real discovery, selected-professional booking, verified milestone publication, Poppins, light/dark AAA text contrast, mobile reflow and 200% text. Live checks cover actual browser camera capture, WHIP/WHEP SDP negotiation, signed ticket requests, local media-track playback, ending and silent heartbeats. Managed Chromium in this environment disables direct UDP; the playback track is a fixture, not evidence of a real Cloudflare broadcast. A real provider broadcast/viewer check remains required after secure configuration.
