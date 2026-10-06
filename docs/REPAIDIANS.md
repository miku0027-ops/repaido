# Repaidians browser prototype

The Home launcher opens the community in a modal without resetting customer navigation, location or booking state. The module is loaded on demand and uses the shared Repaido theme tokens in light and dark mode.

This implements the uploaded master prompt's **local persistence and mock checkout** scope. Social publications, comments, follows, tender interest, messages and the demo subscription live on the current browser. They are not sent to other people, stored in the backend or charged through Razorpay.

## Included flows

- Fifteen minutes of foreground browsing per local calendar day, persisted per local account; time pauses when the page is hidden and resets at local midnight. An exhausted quota blocks all community content.
- A clearly labelled ₹199 mock checkout activates one calendar month of demo Pro, with no charge or renewal. Publishing, bids, tender contact reveals and DMs check that local subscription.
- Public or same-trade posts, photo carousels, likes, comments, bookmarks, sharing and a Following feed.
- Photo/video stories that expire 24 hours after publication, with progress, pause, skip and Pro-gated replies.
- Uploaded video reels with vertical scrolling, audio controls, pause and a handoff to the existing Repaido service booking flow.
- Tender briefs, budgets, deadlines, crew size, one-click local interest and gated contact details.
- Local follow graph and portfolio profiles, plus live reviewed-profile badges, completed task counts and ratings when the seeded member matches the Repaido directory.
- A publishing studio for photos, video, stories and tenders. Media is saved in IndexedDB; metadata, daily usage and social actions use LocalStorage. Supported media is JPG, PNG, WebP, MP4 and WebM, up to 25 MB per file.

Seeded content uses the requested member names and original profile assets and is visibly marked as sample content. It never represents their actual publications, social engagement or tender commitments. Task ratings and verified work records are read from the existing public directory and are not seeded.

## Production boundary

LocalStorage is editable by the browser owner. This quota and demo subscription are not server authorization or billing entitlements. A shared production community needs authenticated backend storage, server-enforced subscription and usage rules, verified payment/webhook handling, media hosting, content controls and message delivery before real paid access or shared publishing is enabled. Uploaded videos need appropriate captions or other accessible alternatives before sharing beyond this prototype.

Run the behavior tests with `npm test` and build with `npx tsc --noEmit && npm run build` from `web/`. The browser integration checks are in `web/tests/repaidians.browser.mjs`; they use the local preview at port 5187 and a test WebM fixture at `/tmp/repaidians-test.webm`.
