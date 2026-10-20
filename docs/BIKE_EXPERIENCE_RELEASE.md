# Bike experience update

This batch requires a matching backend and website release. It is not compatible
with publishing only the website against the older bike API.

## Behavior

- The customer's open bike screen shows a pickup-arrival dialog and repeats an
  opted-in sound until acknowledged. Leaving the arrival state stops it. Browsers
  require a user gesture to enable sound; background execution depends on the
  device. This is not a guarantee of ringing when the app is closed.
- Normal bike completion requires fresh precise rider GPS within 150 metres of
  the agreed destination, including the reported accuracy uncertainty. The rider
  button follows the server's fresh proximity status.
- Only the booked customer can request an early safe drop-off. The rider still
  supplies fresh GPS to finish; the customer still confirms completion. The
  agreed fare, cash receipt and salary flows remain in force. Actual drop-off
  position and the customer's request are recorded.
- A rider shift reuses a single GPS watch, skips duplicate measurements and uses
  quiet, bounded retries. Persistent loss of location is still shown. Keep the
  browser screen open with precise location permission.
- Incoming rider requests have a green card with visible Accept and Reject
  controls. Search uses a reduced-motion-aware pulse. Available-bike discovery
  exposes approximate fresh positions, without identity or occupied-bike tracks;
  precise accepted-rider location is restricted to the booked ride participants.
- Bike journey maps and location pickers use the Google Maps JavaScript API.
  Other legacy service-map components are outside this bike update.

## Google configuration

The operator's Cloud Shell output on 20 October 2026 confirmed
`scripts/configure-google-bike-map.py --apply` returned `configured`.

The dedicated key resource is
`projects/133610574058/locations/global/keys/repaido-web-maps`.
It targets only `maps-backend.googleapis.com` and permits HTTPS referrers on
`repaido.com`, `www.repaido.com`, `repaido.web.app` and
`repaido.firebaseapp.com`. Firebase and Routes keys were not changed.
The display configuration is stored in `ops_public_maps_config/google`.
The API publishes only this deliberately public browser key; it never falls
back to the private Routes credential. Map usage is billable.

The setup does not deploy code or change traffic. After the application release,
verify the actual Google SDK, domain restrictions, tiles and route overlays on
the production website. Local browser tests use an explicit Maps adapter fixture
and do not prove Google authorization or real device GPS.

## Ground acceptance

Use the approved Himalayan mobile-account rider and a separate customer account.
Confirm online presence, approximate discovery, request popup and acceptance,
pickup arrival dialog/sound/acknowledgement, private live tracking, OTP start,
outside-radius completion rejection, inside-radius completion and customer
confirmation. Exercise early drop-off on a separate ride and verify fare/cash
records. Never fabricate GPS or mark salary paid as part of this test.
