import {discoveryFocus} from './discoveryFocus.mjs';

export const marketplaceModes = ['refurbished', 'preowned', 'rentals', 'sell'];
export const marketplaceCategory = mode => marketplaceModes.includes(mode) ? 'market_' + mode : '';
export function marketplaceIntent(categories) {
  return Array.isArray(categories) ? marketplaceModes.find(mode => categories.includes(marketplaceCategory(mode))) || null : null;
}

function hash(value) {
  let result = 2166136261;
  for (const char of value) result = Math.imul(result ^ char.charCodeAt(0), 16777619) >>> 0;
  return result;
}

/** A public, stable rotation. Account IDs, search text and precise location are not seeds.
 * @param {{now?:Date,city?:string,personalised?:boolean,marketPersonalised?:boolean,
 * preferredFocus?:'transport'|'repair'|'marketplace'|null,preferredMarketMode?:'refurbished'|'preowned'|'rentals'|'sell'|null,
 * transportInterest?:boolean,repairInterest?:boolean,repairVisits?:number}} [options]
 */
export function homeDiscoveryPlan({now = new Date(), city = '', personalised = false, marketPersonalised = false,
  preferredFocus = null, preferredMarketMode = null, transportInterest = false, repairInterest = false,
  repairVisits = 0} = {}) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23'}).formatToParts(now).map(p => [p.type, p.value]));
  const hour = Number(parts.hour), slot = Math.floor(hour / 2);
  const seed = hash(`${parts.year}-${parts.month}-${parts.day}:${city.toLocaleLowerCase()}`);
  const peak = (hour >= 7 && hour < 9) || (hour >= 17 && hour < 19) ? 'transport' : hour >= 10 && hour < 12 ? 'repair' : null;
  const permittedFocus = preferredFocus === 'marketplace' ? marketPersonalised : personalised;
  const preference = permittedFocus && ['transport', 'repair', 'marketplace'].includes(preferredFocus) ? preferredFocus : null;
  const rotation = ['transport', 'marketplace', 'repair', 'marketplace'];
  const focus = peak || preference || (personalised && (transportInterest || repairInterest)
    ? discoveryFocus({now, personalised, transportInterest, repairInterest}) : rotation[(seed + slot) % rotation.length]);
  // A preference stays meaningful; fresh public slots still let every marketplace mode appear.
  const marketMode = marketPersonalised && marketplaceModes.includes(preferredMarketMode)
    ? preferredMarketMode : marketplaceModes[(Math.floor(seed / 4) + Math.floor(slot / 2)) % marketplaceModes.length];
  const servicesFirst = peak === 'transport' ? false : focus === 'repair' && personalised && repairVisits >= 2
    ? true : (seed + slot) % 3 === 0;
  return {focus, marketMode, servicesFirst, slot: `${parts.year}-${parts.month}-${parts.day}:${slot}`, basis: peak ? 'peak' : preference ? 'interest' : 'rotation'};
}
