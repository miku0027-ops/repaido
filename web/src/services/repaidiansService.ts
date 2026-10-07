import {auth} from '../firebase';
import {onAuthStateChanged} from 'firebase/auth';
import {createReadCache} from './readCache.mjs';
import type {
  CommunityComment, CommunityMedia, CommunityMember, CommunityMessage, CommunityPage,
  CommunityPost, CommunityReel, CommunitySnapshot, CommunityStory, CommunityTender,
  CommunityNotification, CommunityThread, PublicationDraft, SubscriptionStatus, Trade,
  ProfessionalFields,ProfessionalFilters,OpportunityFilters,OpportunityPage,OpportunityReference,CommunityOpportunity,
} from '../types/repaidians';

export const FREE_BROWSE_MS = 15 * 60 * 1000;
export const PRO_PRICE_RUPEES = 199;
export const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
export const trades: {id: Trade; name: string}[] = [
  {id:'cleaning',name:'Cleaning'}, {id:'electrician',name:'Electrical'}, {id:'plumber',name:'Plumbing'},
  {id:'ac',name:'AC'}, {id:'pest',name:'Pest'}, {id:'carpenter',name:'Carpentry'},
  {id:'civil',name:'Civil'}, {id:'spares',name:'Shop Spares'},
];
const UPDATE = 'repaidians:update';
const IDENTITY_UPDATE = 'repaidians:identity-update';
const MEDIA_UPDATE = 'repaidians:media-update';
export const CONTENT_FRESH_MS = 15000;
export const MEDIA_FRESH_MS = 60000;
const MEDIA_CACHE_BYTES = 32 * 1024 * 1024;
const cacheNow=()=>performance.now();
const contentReads = createReadCache({maxEntries:48,now:cacheNow});
const pendingReads = new Map<string, Promise<unknown>>();
const mediaCache = new Map<string, {blob: Blob; at: number}>();
const mediaDeadlines = new WeakMap<Blob,{key:string;epoch:number;freshUntil:number}>();
const pendingMedia = new Map<string, Promise<Blob>>();
const mutationKeys = new Map<string, string>();
let identityScope='',identityGeneration=0,contentGeneration=0,mediaGeneration=0,mediaBytes=0,sawFirebase=false;

export class CommunityError extends Error {
  constructor(message: string, public status: number, public code = '') {super(message);}
}
export const PROFILE_HANDLE_PATTERN='[a-z0-9][a-z0-9._]{2,29}';
export const normalizeProfileHandle=(value:string)=>value.trim().toLowerCase().replace(/^@/,'');
export function profileHandleError(value:string):string {
  const handle=normalizeProfileHandle(value);
  if(/\s/.test(handle))return 'Handles cannot contain spaces. Use dots or underscores between words.';
  if(handle.length<3||handle.length>30)return 'Use 3–30 characters for your handle.';
  if(!/^[a-z0-9]/.test(handle))return 'Start your handle with a lowercase letter or number.';
  if(!new RegExp('^'+PROFILE_HANDLE_PATTERN+'$').test(handle))return 'Use only lowercase letters, numbers, dots or underscores.';
  return '';
}
export function suggestProfileHandle(value:string):string {
  const suggestion=normalizeProfileHandle(value).replace(/\s+/g,'_').replace(/[^a-z0-9._]/g,'').replace(/^[._]+/,'').slice(0,30);
  return suggestion&&!profileHandleError(suggestion)&&suggestion!==normalizeProfileHandle(value)?suggestion:'';
}
export function communityIdentityKey(){
  if(auth.currentUser)sawFirebase=true;
  return auth.currentUser?.uid||(!sawFirebase?localStorage.getItem('repaido.token'):null)||'guest';
}
function clearMedia(){
  mediaGeneration++;mediaBytes=0;mediaCache.clear();pendingMedia.clear();
  const generation=mediaGeneration;queueMicrotask(()=>{if(generation===mediaGeneration)window.dispatchEvent(new Event(MEDIA_UPDATE));});
}
export const communityMediaScope=()=>communityIdentityKey()+':'+mediaGeneration;
export function subscribeCommunityMedia(listener:()=>void){window.addEventListener(MEDIA_UPDATE,listener);return()=>window.removeEventListener(MEDIA_UPDATE,listener);}
function clearContent(){
  contentGeneration++;contentReads.invalidate();
  // A new generation must not join a pre-mutation transport request.
  for(const key of pendingReads.keys())if(/:\/(feed\?|members\/|publications\/)/.test(key))pendingReads.delete(key);
}
// Authoritative access/profile changes also retire pending work and decoded
// assets, without dispatching another content mutation or refresh loop.
export function retireCommunityContent(){clearContent();clearMedia();}
function syncIdentity(){
  const next=communityIdentityKey();
  if(next!==identityScope){identityScope=next;identityGeneration++;clearContent();clearMedia();pendingReads.clear();mutationKeys.clear();
    const generation=identityGeneration;queueMicrotask(()=>{if(generation===identityGeneration)window.dispatchEvent(new Event(IDENTITY_UPDATE));});}
  return next;
}
onAuthStateChanged(auth,()=>{syncIdentity();});
window.addEventListener('repaido:identity-changed',()=>{syncIdentity();});
window.addEventListener('storage',event=>{if((event as StorageEvent).key==='repaido.token'||(event as StorageEvent).key===null)syncIdentity();});
export function subscribeCommunityIdentity(listener:()=>void){window.addEventListener(IDENTITY_UPDATE,listener);return()=>window.removeEventListener(IDENTITY_UPDATE,listener);}
async function identity() {
  await auth.authStateReady();
  const user=auth.currentUser,key=syncIdentity(),epoch=identityGeneration;
  const token = user ? await user.getIdToken() : !sawFirebase?localStorage.getItem('repaido.token'):null;
  if(auth.currentUser?.uid!==user?.uid||syncIdentity()!==key||epoch!==identityGeneration)
    throw new CommunityError('Your account changed. Reopen this view.',409,'ACCOUNT_CHANGED');
  return {token,key,epoch};
}
function assertIdentity(owner:Awaited<ReturnType<typeof identity>>){
  if(syncIdentity()!==owner.key||owner.epoch!==identityGeneration)throw new CommunityError('Your account changed. Reopen this view.',409,'ACCOUNT_CHANGED');
}
function observeAbort<T>(request:Promise<T>,signal?:AbortSignal):Promise<T>{
  if(!signal)return request;
  if(signal.aborted)return Promise.reject(new DOMException('Request cancelled.','AbortError'));
  return new Promise((resolve,reject)=>{
    const cancel=()=>reject(new DOMException('Request cancelled.','AbortError'));signal.addEventListener('abort',cancel,{once:true});
    request.then(value=>{signal.removeEventListener('abort',cancel);if(!signal.aborted)resolve(value);},error=>{signal.removeEventListener('abort',cancel);if(!signal.aborted)reject(error);});
  });
}
async function contentRead<T>(path:string,force=false,signal?:AbortSignal):Promise<T>{
  if(signal?.aborted)throw new DOMException('Request cancelled.','AbortError');
  const owner=await identity(),epoch=contentGeneration;
  const request=contentReads.read(owner.key+':'+path,async()=>{
    const value=await communityRequest<T>(path);assertIdentity(owner);
    if(epoch!==contentGeneration)throw new CommunityError('The community changed. Refresh this view.',409,'CONTENT_CHANGED');
    return value;
  },{freshMs:CONTENT_FRESH_MS,force}) as Promise<T>;
  try{
    const value=await observeAbort(request,signal);assertIdentity(owner);
    if(epoch!==contentGeneration)throw new CommunityError('The community changed. Refresh this view.',409,'CONTENT_CHANGED');
    return value;
  }catch(error){
    if(error instanceof CommunityError&&[401,402,403,404].includes(error.status)&&epoch===contentGeneration)retireCommunityContent();
    throw error;
  }
}
function peekContent<T>(path:string):T|null{return contentReads.peek(syncIdentity()+':'+path,CONTENT_FRESH_MS) as T|null;}
window.addEventListener(UPDATE,()=>{clearContent();});
export async function communityRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!path.startsWith('/') || path.startsWith('//') || /[?#].*https?:/i.test(path)) throw new Error('Expected a Repaidians API path.');
  const owner=await identity(),{token,key}=owner;
  const read = (init.method || 'GET') === 'GET';
  const cacheKey = key + ':' + path;
  const prior = read ? pendingReads.get(cacheKey) : undefined;
  if (prior) return prior as Promise<T>;
  const request = (async () => {
    const headers = new Headers(init.headers);
    if (token) headers.set('Authorization', 'Bearer ' + token);
    if (typeof init.body === 'string') headers.set('Content-Type', 'application/json');
    headers.set('Accept', 'application/json');
    const response = await fetch('/api/repaidians' + path, {
      ...init, headers, credentials:'same-origin', signal:init.signal || AbortSignal.timeout(30000),
    });
    const body = await response.json().catch(() => ({}));
    assertIdentity(owner);
    if (!response.ok) {
      const detail = body.detail;
      const invalidHandle=path==='/profile'&&Array.isArray(detail)&&detail.some((d:{loc?:unknown[]})=>d.loc?.[1]==='handle');
      const message = invalidHandle ? 'Use a handle with 3–30 lowercase letters, numbers, dots or underscores, starting with a letter or number. Spaces are not allowed.' : typeof detail === 'string' ? detail : detail?.message ||
        (Array.isArray(detail) ? detail.map((d:{msg:string}) => d.msg).join('. ') : '') ||
        (response.status === 401 ? 'Sign in to join the conversation.' : 'Could not connect. Please retry.');
      throw new CommunityError(message, response.status, invalidHandle?'INVALID_HANDLE':detail?.code || '');
    }
    return body as T;
  })();
  if (read) pendingReads.set(cacheKey, request);
  try {return await request;} finally {if (pendingReads.get(cacheKey) === request) pendingReads.delete(cacheKey);}
}
export interface CommunityChange {path?:string;contentChanged:boolean;}
const changed = (path:string) => window.dispatchEvent(new CustomEvent<CommunityChange>(UPDATE,{detail:{path,contentChanged:!/^\/(activity\/|messages\/|notifications\/read$)/.test(path)}}));
async function mutate<T>(path: string, method: string, body?: unknown): Promise<T> {
  const value = await communityRequest<T>(path, {method, ...(body === undefined ? {} : {body:JSON.stringify(body)})});
  if(path==='/profile'||path==='/settings'||path.startsWith('/blocks/')||method==='DELETE'&&path.startsWith('/publications/'))clearMedia();
  changed(path); return value;
}
async function command<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const key = syncIdentity()+':'+path+':'+JSON.stringify(body);
  const clientId = mutationKeys.get(key) || crypto.randomUUID();
  mutationKeys.set(key, clientId);
  while(mutationKeys.size>64)mutationKeys.delete(mutationKeys.keys().next().value!);
  const value = await mutate<T>(path, 'POST', {...body, clientId});
  mutationKeys.delete(key); return value;
}
// The account arguments keep component callers consistent. The server resolves
// the owner from the verified bearer token, never from these browser arguments.
export const snapshot = (_account?: string, _name?: string, compact=false) => communityRequest<CommunitySnapshot>('/state'+(compact?'?content=compact':''));
export const chargeBrowsing = (active: boolean, keepalive = false) => communityRequest<{remainingMs:number;subscription:CommunitySnapshot['subscription'];trial:CommunitySnapshot['trial'];serverNow:number}>('/usage', {method:'POST', body:JSON.stringify({active}), keepalive});
export function subscribe(listener: (change?:CommunityChange) => void): () => void {
  const receive=(event:Event)=>listener((event as CustomEvent<CommunityChange>).detail||{contentChanged:true});
  window.addEventListener(UPDATE, receive);return () => window.removeEventListener(UPDATE, receive);
}
type FeedKind='post'|'story'|'reel'|'tender';
type FeedPage=CommunityPage<CommunityPost|CommunityStory|CommunityReel|CommunityTender>;
function feedPath(kind:FeedKind,trade:Trade|'all',mode:string,cursor:string,limit:number){
  const params = new URLSearchParams({kind,trade,mode,limit:String(Math.max(1,Math.min(50,Math.floor(limit))))});
  if(cursor)params.set('cursor',cursor);
  return '/feed?'+params;
}
export const feed=(kind:FeedKind,trade:Trade|'all'='all',mode='all',cursor='',signal?:AbortSignal,limit=12,force=false)=>contentRead<FeedPage>(feedPath(kind,trade,mode,cursor,limit),force,signal);
export const peekFeed=(kind:FeedKind,trade:Trade|'all'='all',mode='all',cursor='',limit=12)=>peekContent<FeedPage>(feedPath(kind,trade,mode,cursor,limit));
export const feedFreshUntil=(kind:FeedKind,trade:Trade|'all'='all',mode='all',cursor='',limit=12)=>contentReads.freshUntil(syncIdentity()+':'+feedPath(kind,trade,mode,cursor,limit),CONTENT_FRESH_MS);
export const searchMembers = (query:string,signal?:AbortSignal,filters:ProfessionalFilters={},cursor='') => {
  const params=new URLSearchParams({search:query.replace(/^@/,''),limit:'20'});
  for(const key of ['trade','city','workStatus','professionalType'] as const)if(filters[key]&&filters[key]!=='all')params.set(key,filters[key]!);
  if(cursor||filters.cursor)params.set('cursor',cursor||filters.cursor!);
  return communityRequest<{members:CommunityMember[];nextCursor?:string|null;indexing?:boolean}>('/members?'+params,{signal});
};
export const opportunities=(filters:OpportunityFilters={},signal?:AbortSignal)=>{
  const params=new URLSearchParams();
  for(const [key,value] of Object.entries(filters))if(value!==undefined&&value!=='')params.set(key,String(value));
  return communityRequest<OpportunityPage>('/opportunities?'+params,{signal});
};
export const opportunityDetails=(reference:OpportunityReference)=>communityRequest<CommunityOpportunity>('/opportunities/'+encodeURIComponent(reference.source)+'/'+encodeURIComponent(reference.id));
export const saveOpportunity=(reference:OpportunityReference,active:boolean)=>mutate<{saved:boolean}>('/opportunities/'+encodeURIComponent(reference.source)+'/'+encodeURIComponent(reference.id)+'/saved','PUT',{active});
export const memberProfile = (id: string, force=false) => contentRead<{member:CommunityMember;posts:CommunityPost[];reels:CommunityReel[];stories:CommunityStory[];viewerFollowing?:boolean;stats:{followers:number;following:number;posts:number;reels:number}}>('/members/'+encodeURIComponent(id),force);
export const toggleActivity = (_account: string, kind: 'likes'|'saved', id: string, active: boolean) => mutate<{active:boolean;likeCount?:number}>('/activity/'+kind+'/'+encodeURIComponent(id), 'PUT', {active});
export const follow = (_account: string, id: string, active: boolean) => mutate('/follow/'+encodeURIComponent(id), 'PUT', {active});
export const comment = (_account: string, id: string, text: string) => command('/comments/'+encodeURIComponent(id), {text:text.trim()});
export const commentsPage = (id: string, cursor = '') => communityRequest<{comments:CommunityComment[];members:CommunityMember[];nextCursor:string|null}>('/comments/'+encodeURIComponent(id)+'?limit=30&cursor='+encodeURIComponent(cursor));
export const sendMessage = (_account: string, id: string, text: string) => command<{message:CommunityMessage}>('/messages/'+encodeURIComponent(id), {text:text.trim()});
export const messagesPage = (id: string, cursor = '') => communityRequest<{messages:CommunityMessage[];members:CommunityMember[];nextCursor:string|null}>('/messages/'+encodeURIComponent(id)+'?limit=30&cursor='+encodeURIComponent(cursor));
export const threadsPage = (cursor = '') => communityRequest<{threads:CommunityThread[];members:CommunityMember[];nextCursor:string|null}>('/threads?limit=30'+(cursor?'&cursor='+encodeURIComponent(cursor):''));
export const bid = (_account: string, id: string) => command('/bids/'+encodeURIComponent(id), {});
export const tenderContact = (id: string) => communityRequest<{contact:string;tenderId:string}>('/tenders/'+encodeURIComponent(id)+'/contact');
export const updateProfile = async (_account:string,name:string,trade:Trade,bio:string,professional:ProfessionalFields&{handle?:string}={})=>{
  const fields={...professional};
  if(fields.handle!==undefined){
    const issue=profileHandleError(fields.handle);
    if(issue)throw new CommunityError(issue,422,'INVALID_HANDLE');
    fields.handle=normalizeProfileHandle(fields.handle);
  }
  return mutate('/profile','PATCH',{name,trade,bio,...fields});
};
export interface CommunitySettings {messagePrivacy:'everyone'|'following'|'nobody';likeNotifications:boolean;commentNotifications:boolean;followNotifications:boolean;messageNotifications:boolean;placementNotifications:boolean;applicationNotifications:boolean;}
export const updatePartialProfile = (fields:ProfessionalFields) => mutate<{member:CommunityMember}>('/profile','PATCH',fields);
export const profileSettings=()=>communityRequest<{settings:CommunitySettings}>('/settings');
export const updateSettings=(settings:Partial<CommunitySettings>)=>mutate<{settings:CommunitySettings}>('/settings','PATCH',settings);
export const blockedMembers=()=>communityRequest<{members:{id:string;name:string}[]}>('/blocks');
export const updateAvatar = (avatarUrl: string) => mutate('/profile', 'PATCH', {avatarUrl});
export const publish = (_account: string, draft: PublicationDraft) => command<{item:{id:string}}>('/publications', draft as unknown as Record<string,unknown>);
export const deletePublication = (id: string) => mutate('/publications/'+encodeURIComponent(id), 'DELETE');
export const notificationsPage = (cursor='') => communityRequest<{notifications:CommunityNotification[];members:CommunityMember[];nextCursor:string|null;unreadCount?:number}>('/notifications?limit=30'+(cursor?'&cursor='+encodeURIComponent(cursor):''));
export const readNotifications = (ids: string[]) => mutate('/notifications/read', 'POST', {ids});
export const reportPublication = (targetId: string, reason: string, details = '') => mutate('/reports', 'POST', {targetId,reason,details});
export const blockMember = (id: string, active = true) => mutate('/blocks/'+encodeURIComponent(id), 'PUT', {active});
export const subscriptionStatus = (check = false) => communityRequest<SubscriptionStatus>('/subscription'+(check?'/check':''), check?{method:'POST'}:{});
export const subscriptionOrder = () => communityRequest<{settled?:boolean;key_id:string;order_id:string;amount:number;currency:string;attempt_id:string}>('/subscription/order', {method:'POST'});

export async function storeMedia(files: File[]): Promise<CommunityMedia[]> {
  if(!files.length || files.length > 4) throw new Error('Choose one to four media files.');
  if(files.some(f => !/^(image\/(jpeg|png|webp)|video\/(mp4|webm))$/.test(f.type) || f.size > MAX_MEDIA_BYTES))
    throw new Error('Use JPG, PNG, WebP, MP4 or WebM files up to 8 MB each.');
  const output:CommunityMedia[] = [];
  for(const file of files) {
    const value = await communityRequest<CommunityMedia>('/media', {method:'POST',headers:{'Content-Type':file.type},body:file});
    output.push({url:value.url,kind:value.kind,alt:file.name.replace(/\.[^.]+$/, '').slice(0,200)});
  }
  return output;
}
export const publicationDetails = (id: string, force=false) => contentRead<{item:CommunityPost|CommunityReel;members:CommunityMember[]}>('/publications/'+encodeURIComponent(id),force);
function removeMedia(key:string){const entry=mediaCache.get(key);if(entry){mediaBytes-=entry.blob.size;mediaCache.delete(key);}}
export function mediaFreshUntil(url:string,blob?:Blob){
  const key=syncIdentity()+':'+url,deadline=blob?mediaDeadlines.get(blob):undefined;
  if(blob)return deadline&&deadline.key===key&&deadline.epoch===mediaGeneration&&cacheNow()<deadline.freshUntil?deadline.freshUntil:0;
  const entry=mediaCache.get(key);
  return entry&&cacheNow()-entry.at<MEDIA_FRESH_MS?entry.at+MEDIA_FRESH_MS:0;
}
export async function loadMedia(url: string,signal?:AbortSignal): Promise<Blob|null> {
  if(!/^\/api\/repaidians\/media\/[A-Za-z0-9_-]+$/.test(url)) return null;
  if(signal?.aborted)throw new DOMException('Request cancelled.','AbortError');
  const owner=await identity(),{token,key}=owner,epoch=mediaGeneration;
  if(signal?.aborted)throw new DOMException('Request cancelled.','AbortError');
  const cacheKey = key + ':' + url;
  for(const [key,entry] of mediaCache)if(cacheNow()-entry.at>=MEDIA_FRESH_MS)removeMedia(key);
  const stored = mediaCache.get(cacheKey);
  if(stored){mediaCache.delete(cacheKey);mediaCache.set(cacheKey,stored);}
  let request=stored?Promise.resolve(stored.blob):pendingMedia.get(cacheKey);
  if(!request){
    request=(async()=>{
      const response=await fetch(url,{credentials:'same-origin',headers:token?{Authorization:'Bearer '+token}:{},signal:AbortSignal.timeout(30000)});
      assertIdentity(owner);
      if(epoch!==mediaGeneration)throw new CommunityError('Media access changed. Reopen this view.',409,'MEDIA_CHANGED');
      if(!response.ok){
        if([401,402,403,404].includes(response.status))removeMedia(cacheKey);
        throw new CommunityError('Media is unavailable. Retry or check your access.',response.status);
      }
      const mime=(response.headers.get('Content-Type')||'').split(';')[0].toLowerCase(),length=Number(response.headers.get('Content-Length')||0);
      if(!/^(image\/(jpeg|png|webp)|video\/(mp4|webm))$/.test(mime)||length>MAX_MEDIA_BYTES){await response.body?.cancel();throw new CommunityError('This media could not be loaded.',422,'INVALID_MEDIA');}
      const blob=await response.blob();assertIdentity(owner);
      if(epoch!==mediaGeneration)throw new CommunityError('Media access changed. Reopen this view.',409,'MEDIA_CHANGED');
      if(blob.size>MAX_MEDIA_BYTES)throw new CommunityError('This media exceeds the supported size.',413,'MEDIA_TOO_LARGE');
      const at=cacheNow();mediaDeadlines.set(blob,{key:cacheKey,epoch,freshUntil:at+MEDIA_FRESH_MS});
      removeMedia(cacheKey);mediaCache.set(cacheKey,{blob,at});mediaBytes+=blob.size;
      while(mediaCache.size>64||mediaBytes>MEDIA_CACHE_BYTES)removeMedia(mediaCache.keys().next().value!);
      return blob;
    })();
    pendingMedia.set(cacheKey,request);
    void request.finally(()=>{if(pendingMedia.get(cacheKey)===request)pendingMedia.delete(cacheKey);}).catch(()=>{});
  }
  const blob=await observeAbort(request,signal);assertIdentity(owner);
  if(epoch!==mediaGeneration)throw new CommunityError('Media access changed. Reopen this view.',409,'MEDIA_CHANGED');
  return blob;
}
