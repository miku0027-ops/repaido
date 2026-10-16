import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {auth} from '../src/firebase';
import {ScrapCollectorSuite} from '../src/components/BusinessSuites';
import {CaptainRewardSettings} from '../src/components/CaptainRewardSettings';
import {CaptainClub} from '../src/components/CaptainClub';
import {CouponField,type Coupon} from '../src/components/Coupons';
import {Feed} from '../src/components/repaidians/Feed';
import {communityRequest} from '../src/services/repaidiansService';
import {couponSavings} from '../src/services/rewardPresentation.mjs';
import {AppExperience} from '../src/components/AppExperience';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/components/operations.css';
import '../src/components/repaidians/repaidians.css';
const view=new URLSearchParams(location.search).get('view')||'buyer';
const subscribers=new Set<any>();
await auth.authStateReady();
function setActor(uid:string){
 (auth as any).currentUser={uid,getIdToken:async()=>uid,getIdTokenResult:async()=>({claims:{}})};
 localStorage.setItem('repaido.token',uid);
 for(const next of subscribers)(typeof next==='function'?next:next.next)(auth.currentUser);
}
setActor(view==='buyer'?'worker':view==='policy'?'admin':'customer');
(auth as any).onIdTokenChanged=(next:any)=>{subscribers.add(next);queueMicrotask(()=>(typeof next==='function'?next:next.next)(auth.currentUser));return()=>subscribers.delete(next);};
function Checkout(){
 const [coupon,setCoupon]=useState<Coupon|null>(null),[uid,setUid]=useState('customer');
 return <section className="coupon-checkout-preview"><h2>Service quote</h2><p>Account: {uid}</p><button onClick={()=>{const next=uid==='customer'?'worker2':'customer';setActor(next);setUid(next);}}>Switch account</button><CouponField scope="hire" base={49900} value={coupon} onChange={setCoupon}/><p>Saving: <strong data-testid="saving">{couponSavings(49900,coupon)}</strong> paise</p></section>;
}
function Community(){
 const [data,setData]=useState<any>(null),[error,setError]=useState('');
 useEffect(()=>{void communityRequest('/feed?kind=post&trade=recycling').then(setData).catch(problem=>setError(problem.message));},[]);
 return <section className="rp-shell-inner">{error&&<p role="alert">{error}</p>}{data&&<Feed posts={data.items} activity={{likes:[],saved:[]} as any} memberFor={id=>data.members?.find((member:any)=>member.id===id)||({id,name:'Fixture collector',handle:'fixture-collector',trade:'recycling',role:'agent',bio:'',avatarUrl:''})} onProfile={()=>{}} onLike={()=>{}} onSave={()=>{}} onComments={()=>{}} onShare={()=>{}} onCreate={()=>{}}/>}</section>;
}
createRoot(document.getElementById('root')!).render(<main className="repaido-customer-shell" style={{maxWidth:960,margin:'auto',padding:16}}><AppExperience/><h1>Scrap ecosystem</h1>{view==='buyer'?<ScrapCollectorSuite partner={{name:'Fixture collector',city:'Balasore',address:'Fixture business base 123',valid_until:Date.now()/1000+86400}}/>:view==='policy'?<CaptainRewardSettings/>:view==='checkout'?<Checkout/>:view==='feed'?<Community/>:<CaptainClub/>}</main>);
