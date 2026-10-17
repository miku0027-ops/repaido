import {Storefront} from '../icons';

/** Browsing the market uses a storefront, distinct from the add-shop action. */
export function StoresIcon({size=24,className}:{size?:number;className?:string}) {
  return <Storefront size={size} className={className} aria-hidden="true"/>;
}
