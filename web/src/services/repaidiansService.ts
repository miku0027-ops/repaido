import {auth} from '../firebase';
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
const pendingReads = new Map<string, Promise<unknown>>();
const mediaCache = new Map<string, {blob: Blob; at: number}>();
const mutationKeys = new Map<string, string>();

export class CommunityError extends Error {
  constructor(message: string, public status: number, public code = '') {super(message);}
}
async function identity() {
  await auth.authStateReady();
  const token = auth.currentUser ? await auth.currentUser.getIdToken() : localStorage.getItem('repaido.token');
  return {token, key: auth.currentUser?.uid || token || 'guest'};
}
export async function communityRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!path.startsWith('/') || path.startsWith('//') || /[?#].*https?:/i.test(path)) throw new Error('Expected a Repaidians API path.');
  const {token, key} = await identity();
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
    if (!response.ok) {
      const detail = body.detail;
      const message = typeof detail === 'string' ? detail : detail?.message ||
        (Array.isArray(detail) ? detail.map((d:{msg:string}) => d.msg).join('. ') : '') ||
        (response.status === 401 ? 'Sign in to join the conversation.' : 'Could not connect. Please retry.');
      throw new CommunityError(message, response.status, detail?.code || '');
    }
    return body as T;
  })();
  if (read) pendingReads.set(cacheKey, request);
  try {return await request;} finally {if (pendingReads.get(cacheKey) === request) pendingReads.delete(cacheKey);}
}
const changed = () => window.dispatchEvent(new Event(UPDATE));
async function mutate<T>(path: string, method: string, body?: unknown): Promise<T> {
  const value = await communityRequest<T>(path, {method, ...(body === undefined ? {} : {body:JSON.stringify(body)})});
  changed(); return value;
}
async function command<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const key = path + ':' + JSON.stringify(body);
  const clientId = mutationKeys.get(key) || crypto.randomUUID();
  mutationKeys.set(key, clientId);
  const value = await mutate<T>(path, 'POST', {...body, clientId});
  mutationKeys.delete(key); return value;
}
// The account arguments keep component callers consistent. The server resolves
// the owner from the verified bearer token, never from these browser arguments.
export const snapshot = (_account?: string, _name?: string) => communityRequest<CommunitySnapshot>('/state');
export const chargeBrowsing = (active: boolean, keepalive = false) => communityRequest<{remainingMs:number;subscription:CommunitySnapshot['subscription'];trial:CommunitySnapshot['trial'];serverNow:number}>('/usage', {method:'POST', body:JSON.stringify({active}), keepalive});
export function subscribe(listener: () => void): () => void {
  window.addEventListener(UPDATE, listener);return () => window.removeEventListener(UPDATE, listener);
}
export function feed(kind: 'post'|'story'|'reel'|'tender', trade: Trade|'all' = 'all', mode = 'all', cursor = '', signal?:AbortSignal, limit = 12) {
  const params = new URLSearchParams({kind,trade,mode,limit:String(Math.max(1,Math.min(50,Math.floor(limit))))});
  if(cursor)params.set('cursor',cursor);
  return communityRequest<CommunityPage<CommunityPost|CommunityStory|CommunityReel|CommunityTender>>('/feed?' + params, {signal});
}
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
export const memberProfile = (id: string) => communityRequest<{member:CommunityMember;posts:CommunityPost[];reels:CommunityReel[];stories:CommunityStory[];stats:{followers:number;following:number;posts:number;reels:number}}>('/members/'+encodeURIComponent(id));
export const toggleActivity = (_account: string, kind: 'likes'|'saved', id: string, active: boolean) => mutate<{active:boolean;likeCount?:number}>('/activity/'+kind+'/'+encodeURIComponent(id), 'PUT', {active});
export const follow = (_account: string, id: string, active: boolean) => mutate('/follow/'+encodeURIComponent(id), 'PUT', {active});
export const comment = (_account: string, id: string, text: string) => command('/comments/'+encodeURIComponent(id), {text:text.trim()});
export const commentsPage = (id: string, cursor = '') => communityRequest<{comments:CommunityComment[];members:CommunityMember[];nextCursor:string|null}>('/comments/'+encodeURIComponent(id)+'?limit=30&cursor='+encodeURIComponent(cursor));
export const sendMessage = (_account: string, id: string, text: string) => command('/messages/'+encodeURIComponent(id), {text:text.trim()});
export const messagesPage = (id: string, cursor = '') => communityRequest<{messages:CommunityMessage[];members:CommunityMember[];nextCursor:string|null}>('/messages/'+encodeURIComponent(id)+'?limit=30&cursor='+encodeURIComponent(cursor));
export const threadsPage = () => communityRequest<{threads:CommunityThread[];members:CommunityMember[];nextCursor:string|null}>('/threads?limit=30');
export const bid = (_account: string, id: string) => command('/bids/'+encodeURIComponent(id), {});
export const tenderContact = (id: string) => communityRequest<{contact:string;tenderId:string}>('/tenders/'+encodeURIComponent(id)+'/contact');
export const updateProfile = (_account:string,name:string,trade:Trade,bio:string,professional:ProfessionalFields&{handle?:string}={})=>mutate('/profile','PATCH',{name,trade,bio,...professional});
export interface CommunitySettings {messagePrivacy:'everyone'|'following'|'nobody';likeNotifications:boolean;commentNotifications:boolean;followNotifications:boolean;messageNotifications:boolean;}
export const profileSettings=()=>communityRequest<{settings:CommunitySettings}>('/settings');
export const updateSettings=(settings:Partial<CommunitySettings>)=>mutate<{settings:CommunitySettings}>('/settings','PATCH',settings);
export const blockedMembers=()=>communityRequest<{members:{id:string;name:string}[]}>('/blocks');
export const updateAvatar = (avatarUrl: string) => mutate('/profile', 'PATCH', {avatarUrl});
export const publish = (_account: string, draft: PublicationDraft) => command<{item:{id:string}}>('/publications', draft as unknown as Record<string,unknown>);
export const deletePublication = (id: string) => mutate('/publications/'+encodeURIComponent(id), 'DELETE');
export const notificationsPage = () => communityRequest<{notifications:CommunityNotification[];members:CommunityMember[];nextCursor:string|null;unreadCount?:number}>('/notifications?limit=30');
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
export const publicationDetails = (id: string) => communityRequest<{item:CommunityPost|CommunityReel;members:CommunityMember[]}>('/publications/'+encodeURIComponent(id));
export async function loadMedia(url: string): Promise<Blob|null> {
  if(!/^\/api\/repaidians\/media\/[A-Za-z0-9_-]+$/.test(url)) return null;
  const {token,key} = await identity();
  const cacheKey = key + ':' + url;
  const stored = mediaCache.get(cacheKey);
  if(stored && Date.now()-stored.at < 60000) return stored.blob;
  const response = await fetch(url, {credentials:'same-origin',headers:token?{Authorization:'Bearer '+token}:{},signal:AbortSignal.timeout(30000)});
  if(!response.ok) throw new CommunityError('Media is unavailable. Retry or check your access.',response.status);
  const blob = await response.blob();
  // Bound memory to four uploaded media objects; never persist protected copies.
  if(mediaCache.size >= 4)mediaCache.delete(mediaCache.keys().next().value!);
  mediaCache.set(cacheKey,{blob,at:Date.now()});return blob;
}
