import {onIdTokenChanged} from 'firebase/auth';
import {auth} from '../firebase';
import {apiFetch} from './api';
import {createReadCache} from './readCache.mjs';
import type {Professional} from '../components/Hiring';

export type HiringComparison={
  category:string;category_name:string;
  verified_work:{completed:number;review_count:number;rating:number|null;confidence:number};
  attributes:{id:string;label:string;value:string[]|number|null;source:string}[];
  catalogue_references:{id:string;name:string;price_paise:number;duration_minutes:number;included:string[];excluded:string[];basis:string}[];
  budget_status:'unknown'|'within_catalogue_reference'|'above_catalogue_reference'|'mixed_catalogue_references';
  price_note:string;offers_note:string;
  home_service?:{id:string;name:string;description:string;recurring:boolean}|null;
  hire_readiness:{enabled:boolean;policy_version:string;day_hours:number|null;base_paise:number|null;quote_required:boolean;routing_ready:boolean;payments_ready:boolean};
};
export type RecommendedProfessional=Professional&{
  comparison:HiringComparison;
  recommendation:{score:number;score_is_probability:boolean;components:{id:string;label:string;points:number;maximum:number;source:string}[];reasons:string[];evidence_scope:{kind:string;record_limit:number;complete:boolean}};
};
export type HiringRecommendations={
  personalised:boolean;consent_required:boolean;cold_start:boolean;generated_at:number;refresh_after_seconds:number;
  categories:{id:string;name:string;personalised:boolean;reason:string;last_explored_at:number|null}[];
  selected_category:string;professionals:RecommendedProfessional[];comparisons:RecommendedProfessional[];missing_compare_ids:string[];
  comparison_fields:{id:string;label:string;source:string}[];
  candidate_window:{limit:number;examined:number;has_more:boolean;note:string};method:string;
};

// Read-only POST: isolated from command invalidation and from the public directory cache.
// A short memory cache deduplicates opening/closing a shortlist; nothing is persisted.
const cache=createReadCache({maxEntries:24});
let account='',epoch=0;
export function clearHiringRecommendations(){epoch++;cache.invalidate();}
onIdTokenChanged(auth,user=>{if(account!==(user?.uid||'')){account=user?.uid||'';clearHiringRecommendations();}});
window.addEventListener('repaido:interests',clearHiringRecommendations);
window.addEventListener('repaido:operations-updated',clearHiringRecommendations);

export async function hiringRecommendations(body:Record<string,unknown>,force=false):Promise<HiringRecommendations> {
  await auth.authStateReady();
  const user=auth.currentUser;if(!user)throw Error('Sign in to see your shortlist.');
  if(account!==user.uid){account=user.uid;clearHiringRecommendations();}
  const version=epoch;
  const key=user.uid+':'+JSON.stringify(Object.keys(body).sort().map(k=>[k,body[k]]));
  return cache.read(key,async()=>{
    const token=await user.getIdToken();
    if(auth.currentUser?.uid!==user.uid||epoch!==version)throw Error('Your account or preferences changed. Refresh your shortlist.');
    const response=await apiFetch('/api/operations/hiring/recommendations',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)},{background:true});
    const data=await response.json().catch(()=>({}));
    if(auth.currentUser?.uid!==user.uid||epoch!==version)throw Error('Your account or preferences changed. Refresh your shortlist.');
    if(!response.ok)throw Error(data.detail?.message||(typeof data.detail==='string'?data.detail:'Your shortlist could not refresh. You can still browse all listed professionals.'));
    return data as HiringRecommendations;
  },{freshMs:20_000,force:force||!!body.location||!!body.available_only}) as Promise<HiringRecommendations>;
}
