// Synthetic identity control exists only in this disposable local harness.
import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {auth} from '../src/firebase';
import {SparePartsShop} from '../src/components/SparePartsShop';
import {Marketplace} from '../src/components/Marketplace';
import {MarketInbox} from '../src/components/MarketInbox';
import PublicSellerProfile from '../src/components/PublicSellerProfile';
import {ShopStorefront} from '../src/components/ShopStorefront';
import {ShopAccessPanel} from '../src/components/ShopAccessPanel';
import {AppExperience} from '../src/components/AppExperience';
import '../src/styles.css';import '../src/design-system.css';import '../src/customer-layout.css';import '../src/components/compact-market.css';import '../src/spacing.css';
function Preview(){
 const [uid,setUid]=useState(auth.currentUser?.uid||''),[view,setView]=useState<'spares'|'market'|'access'>('spares'),[inbox,setInbox]=useState<{listing?:string;chat?:string}|null>(null),[profile,setProfile]=useState<{listing?:string;chat?:string}|null>(null),[shop,setShop]=useState(''),[action,setAction]=useState('');
 useEffect(()=>{(window as any).__storefrontFixture={account:(id:string|null)=>{(window as any).__fixtureAccount(id);setUid(id||'');setInbox(null);setProfile(null);setShop('');},view:setView,openChat:(chat:string)=>setInbox({chat}),openListingChat:(listing:string)=>setInbox({listing}),closeChat:()=>setInbox(null),profile:(listing:string)=>setProfile({listing}),shop:setShop};},[]);
 return <div className="repaido-customer-shell"><header style={{padding:12}}><strong>Local native storefront checks</strong></header><main style={{maxWidth:980,margin:'auto',padding:12}}>{view==='spares'?<SparePartsShop key={uid} initialSection="spares" authToken={uid} onSignIn={()=>setAction('sign-in')}/>:view==='market'?<div className="market-experience"><Marketplace mode="second_hand" initialLocation={{lat:21.4934,lng:86.9135}} onSignIn={()=>setAction('sign-in')}/></div>:<div className="operations portal-shop" style={{display:'block',width:'100%'}}><ShopAccessPanel onUpdated={()=>setAction('shop-updated')}/></div>}</main>{inbox&&<MarketInbox key={'chat:'+uid} initialChatId={inbox.chat} initialListingId={inbox.listing} onClose={()=>setInbox(null)} onSignIn={()=>setAction('sign-in')} onOpenProfile={chat=>setProfile({chat})}/>} {profile&&<PublicSellerProfile key={JSON.stringify(profile)+uid} listingId={profile.listing} chatId={profile.chat} onClose={()=>setProfile(null)} onOpenShop={id=>{setProfile(null);setShop(id);}} onOpenListing={(id,mode)=>setAction('listing:'+mode+':'+id)} onOpenRental={id=>setAction('rental:'+id)}/>} {shop&&<ShopStorefront shopId={shop} onClose={()=>setShop('')} onShop={setShop} onProduct={id=>setAction('product:'+id)} onRental={id=>setAction('rental:'+id)}/>}<output aria-label="Last fixture action">{action}</output><AppExperience/></div>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
