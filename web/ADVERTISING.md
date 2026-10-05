# Discovery sponsorship

A responsive, clearly labelled Advertisement block appears directly below the header, above the hero and service list. It is hidden during search, category filtering, and checkout. The sample is visible in the current preview and never claims to be a real paid campaign.

For a direct paid sponsor, set `discoverySponsor` in `src/advertising.ts` to the advertiser's approved content:

```ts
{
  advertiser: 'Advertiser name',
  title: 'Short ad headline',
  description: 'A clear description of the offer.',
  destination: 'https://advertiser.example/offer',
  action: 'View offer'
}
```

The action opens the advertiser's HTTPS page in a new tab and is marked as a sponsored link. There is no inactive placeholder button. Invalid destinations are not rendered as links. React renders copy as text, not advertiser-provided HTML.

No ad network, tracking, impressions billing, or payment account is connected. Revenue requires a paid sponsorship agreement or a separate ad-provider integration. The placeholder itself does not earn money. No customer address, phone number, or booking information is shared by this component. With preview off, an empty slot is hidden.

## Current sample
Auto Singar car washing, Kadrabad, Salt Road, Balasore. Business name and address were supplied by the user and have not been independently verified. The sample is explicitly labelled and includes a map-search link, not a claimed exact location pin. No prices, opening hours, phone numbers, reviews or paid relationship are invented. `sample: true` keeps the sample disclosure visible.

## Image creative
The Auto Singar banner uses `public/images/auto-singar-car-wash.png`, generated with the built-in image generation tool. Prompt: premium photorealistic car-wash advertising photograph; unbranded dark blue compact car in front three-quarter view being rinsed; white soap foam and water spray; wet reflective ground; navy background and cool blue lighting; no text, logos, people or license-plate text. Illustrative artwork, not a photograph of the business. Copy and the map action are accessible HTML alongside the image.
