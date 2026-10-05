import type { SponsorCampaign } from './components/SponsoredPlacement';

// Sample creative using the business name and address supplied by the owner.
// The map link searches this address; it is not a verified business listing.
export const discoverySponsor: SponsorCampaign | null = {
  advertiser: 'Auto Singar',
  title: 'Get your car washed at Auto Singar',
  description: 'Car washing in Kadrabad, Salt Road, Balasore.',
  destination: 'https://www.google.com/maps/search/?api=1&query=Auto%20Singar%20car%20wash%2C%20Kadrabad%2C%20Salt%20Road%2C%20Balasore',
  action: 'Find on map',
  image: '/images/auto-singar-car-wash.png',
  imageAlt: 'Illustration of a blue car being washed with foam and water.',
  sample: true,
  category: 'car-wash',
};
