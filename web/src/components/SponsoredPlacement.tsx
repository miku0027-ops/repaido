import { ArrowUpRight, CarFront, Megaphone } from 'lucide-react';

export interface SponsorCampaign {
  sample?: boolean;
  category?: 'car-wash';
  image?: string;
  imageAlt?: string;
  advertiser: string;
  title: string;
  description: string;
  destination: string;
  action: string;
}

function safeDestination(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch { return null; }
}

/** Direct sponsorship slot. No ad scripts, tracking, or booking data are sent. */
export default function SponsoredPlacement({ campaign = null, preview = false }: {
  campaign?: SponsorCampaign | null;
  preview?: boolean;
}) {
  const destination = campaign ? safeDestination(campaign.destination) : null;
  if ((!campaign || !destination) && !preview) return null;
  const active = campaign && destination;
  if (active && campaign.image) return <aside aria-label="Advertisement" className="mb-8 overflow-hidden rounded-2xl border border-control" data-ad-slot="discovery-sponsor">
    <div className="flex flex-wrap justify-between gap-2 bg-white px-6 py-2 text-sm text-muted"><strong>Advertisement</strong><span>{campaign.sample ? 'Sample ad' : `Paid for by ${campaign.advertiser}`}</span></div>
    <div className="grid bg-ink text-white md:grid-cols-2">
      <div className="order-2 flex flex-col items-start justify-center px-6 py-6 md:order-1 md:px-10 md:py-8">
        <p className="text-sm font-semibold tracking-[.12em]">CAR WASH</p>
        <h2 className="mt-2 text-4xl font-bold leading-tight tracking-tight md:text-5xl">{campaign.advertiser}</h2>
        <p className="mt-3 text-xl font-medium">Give your car a fresh wash.</p>
        <p className="mt-3 text-base leading-6">Kadrabad, Salt Road, Balasore</p>
        <a href={destination} target="_blank" rel="sponsored noopener noreferrer" className="mt-6 inline-flex min-h-14 w-full items-center justify-center gap-3 rounded-xl bg-white px-6 py-4 font-semibold text-ink transition-colors hover:bg-line sm:w-auto" aria-label={`${campaign.action} — ${campaign.advertiser} (opens a new tab)`}>{campaign.action}<ArrowUpRight size={18}/></a>
      </div>
      <div className="relative order-1 md:order-2"><img src={campaign.image} alt={campaign.imageAlt || ''} width="1536" height="1024" className="h-48 w-full object-cover sm:h-64 md:h-full md:min-h-80"/><span className="absolute bottom-3 right-3 rounded bg-ink px-3 py-1 text-xs text-white">Illustrative image</span></div>
    </div>
  </aside>;
  const Icon = campaign?.category === 'car-wash' ? CarFront : Megaphone;
  return <aside aria-label="Advertisement" className="mb-8 overflow-hidden rounded-2xl border border-control bg-surface" data-ad-slot="discovery-sponsor">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b px-6 py-2 text-sm text-muted">
      <span className="font-semibold">Advertisement</span>
      <span>{active ? (campaign.sample ? `Sample ad · ${campaign.advertiser}` : `Paid for by ${campaign.advertiser}`) : 'Sample ad space'}</span>
    </div>
    <div className="flex min-h-32 flex-col items-start justify-center gap-6 p-6 sm:min-h-28 sm:flex-row sm:items-center sm:justify-between md:px-8 md:py-6">
      <div className="flex max-w-2xl items-start gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl border bg-white text-accent" aria-hidden="true"><Icon size={24}/></span>
        <div>
          <h2 className="text-xl font-semibold leading-7 tracking-tight">{active ? campaign.title : 'Your business could be here'}</h2>
          <p className="mt-2 text-base leading-7 text-muted">{active ? campaign.description : 'A space for paid ads from other businesses.'}</p>
          {!active && <p className="mt-2 text-sm leading-6 text-muted">No advertiser is connected yet.</p>}
        </div>
      </div>
      {active && <a href={destination} target="_blank" rel="sponsored noopener noreferrer" className="button-primary w-full shrink-0 sm:w-auto" aria-label={`${campaign.action} — ${campaign.advertiser} (opens a new tab)`}>{campaign.action}<ArrowUpRight size={18} aria-hidden="true"/></a>}
    </div>
  </aside>;
}
