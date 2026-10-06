import type {CommunityActivity, CommunityData, CommunityItem, CommunityMedia, CommunityMember, CommunitySnapshot, CommunitySubscription, DailyUsage, PublicationDraft, Trade} from '../types/repaidians';

export const FREE_BROWSE_MS = 15 * 60 * 1000;
export const PRO_PRICE_RUPEES = 199;
const PREFIX = 'repaidians.v1.';
const UPDATE = 'repaidians:update';
export const trades: {id: Trade; name: string}[] = [
  {id:'cleaning',name:'Cleaning'}, {id:'electrician',name:'Electrical'}, {id:'plumber',name:'Plumbing'},
  {id:'ac',name:'AC'}, {id:'pest',name:'Pest'}, {id:'carpenter',name:'Carpentry'},
  {id:'civil',name:'Civil'}, {id:'spares',name:'Shop Spares'},
];
const members: CommunityMember[] = [
  {id:'basanti',name:'Basanti Behera',handle:'basanti_cleaning_pro',trade:'cleaning',role:'Cleaning',avatarUrl:'/images/specialists/basanti_behera.jpg',bio:'A community portfolio preview. Open the Repaido profile for approved skills and work records.'},
  {id:'tushar',name:'Tushar Ranjan Das',handle:'tushar_electrical_contractor',trade:'electrician',role:'Electrical',avatarUrl:'/images/specialists/tushar_das.jpg',bio:'A community portfolio preview. Approved role and work records come from the live Repaido directory.'},
  {id:'paramesh',name:'Paramesh Prasad Mohapatra',handle:'paramesh_pest_solutions',trade:'pest',role:'Pest control',avatarUrl:'/images/specialists/paramesh_mohapatra.jpg',bio:'A community portfolio preview with the original profile portrait.'},
  {id:'sipun',name:'Sipun Mahanta',handle:'sipun_wiring_balasore',trade:'electrician',role:'Electrical',avatarUrl:'/images/specialists/sipun_mahanta.jpg',bio:'A community portfolio preview. Use Repaido hiring to check current service coverage.'},
];
const emptyActivity = (): CommunityActivity => ({likes:[],saved:[],following:[],bids:[],messages:[]});
function read<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(PREFIX + key) || 'null') ?? fallback; } catch { return fallback; }
}
function write(key: string, value: unknown) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); }
  catch { throw new Error('This device could not save the change. Free some browser storage and retry.'); }
  if(typeof window !== 'undefined') window.dispatchEvent(new Event(UPDATE));
}
const accountKey = (id: string) => encodeURIComponent(id || 'guest');
export const localMemberId = (account: string) => 'local:' + accountKey(account);
const uid = () => crypto.randomUUID();
export function localDay(now = Date.now()): string {
  const d = new Date(now);
  return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
}
function dayStart(now: number) { const d=new Date(now); d.setHours(0,0,0,0); return d.getTime(); }
function seed(now: number): CommunityData {
  const captions = [
    'A tidy finish starts with a clear scope. A sample cleaning portfolio for the Repaidians preview.',
    'Inspect, isolate, then repair. A sample electrical work carousel for the community preview.',
    'Share prevention tips and the agreed treatment scope. A sample pest-care portfolio.',
    'Good wiring is organised wiring. A sample site update for the Repaidians preview.',
  ];
  const images = ['/images/cleaning.jpg','/images/electrical.jpg','/images/bathroom.jpg','/images/home-project-planning.jpg'];
  return {version:1,members,comments:[],reels:[],follows:[],
    posts:members.map((m,i)=>({id:'sample-post-'+m.id,authorId:m.id,trade:m.trade,visibility:'public',sample:true,createdAt:now-i*3600000,caption:captions[i],
      media:[{url:images[i],kind:'image',alt:'Sample portfolio image, not a documented job'} as CommunityMedia,...(i===1?[{url:'/images/home-project-planning.jpg',kind:'image',alt:'Sample project planning image'} as CommunityMedia]:[])]})),
    stories:members.map((m,i)=>({id:'sample-story-'+m.id,authorId:m.id,trade:m.trade,visibility:'public',sample:true,createdAt:now,expiresAt:now+86400000,
      caption:'Sample work update • ' + trades.find(t=>t.id===m.trade)?.name,media:{url:images[i],kind:'image',alt:'Sample community story'}})),
    tenders:[
      {id:'sample-tender-electrical',authorId:'tushar',trade:'electrician',visibility:'public',sample:true,createdAt:now,title:'Electrical crew for a site visit',details:'Example crew request: three helpers for an agreed one-day site scope. This is a sample, not an open paid job.',location:'ITI Chhak, Balasore',budgetRupees:650,slots:3,deadline:now+3*86400000,contact:''},
      {id:'sample-tender-civil',authorId:'tushar',trade:'civil',visibility:'public',sample:true,createdAt:now-3600000,title:'Tile laying subcontract',details:'Example tender for a 2,000 sq ft layout. Confirm measurements, materials and a written scope before quoting.',location:'Balasore',budgetRupees:45000,slots:1,deadline:now+7*86400000,contact:''},
    ],
  };
}
export function communityData(): CommunityData {
  const stored=read<CommunityData|null>('community',null);
  if(stored?.version===1 && [stored.posts,stored.members,stored.stories,stored.reels,stored.tenders,stored.comments].every(Array.isArray)) return {...stored,follows:Array.isArray(stored.follows)?stored.follows:[]};
  const data=seed(Date.now()); write('community',data); return data;
}
export function usage(account: string, now=Date.now()): DailyUsage {
  const day=localDay(now), stored=read<DailyUsage|null>('usage.'+accountKey(account),null);
  if(stored?.day===day && Number.isFinite(stored.usedMs)) return {...stored,usedMs:Math.max(0,Math.min(FREE_BROWSE_MS,stored.usedMs)),chargedUntil:Number.isFinite(stored.chargedUntil)?stored.chargedUntil:dayStart(now)};
  return {day,usedMs:0,chargedUntil:dayStart(now)};
}
export function subscription(account: string, now=Date.now()): CommunitySubscription|null {
  const value=read<CommunitySubscription|null>('subscription.'+accountKey(account),null);
  return value?.plan==='demo-pro' && value.provider==='mock' && value.startsAt<=now && value.endsAt>now ? value : null;
}
export function chargeBrowsing(account: string, from: number, now=Date.now()): number {
  if(subscription(account,now)) return FREE_BROWSE_MS;
  const value=usage(account,now);
  const elapsed=Math.max(0,now-Math.max(from,value.chargedUntil,dayStart(now)));
  value.usedMs=Math.min(FREE_BROWSE_MS,value.usedMs+elapsed);value.chargedUntil=now;
  write('usage.'+accountKey(account),value);
  return FREE_BROWSE_MS-value.usedMs;
}
export function activateMockPro(account: string, now=Date.now()): CommunitySubscription {
  const ends=new Date(now),day=ends.getDate();ends.setDate(1);ends.setMonth(ends.getMonth()+1);
  const lastDay=new Date(ends.getFullYear(),ends.getMonth()+1,0).getDate();ends.setDate(Math.min(day,lastDay));
  const value: CommunitySubscription={plan:'demo-pro',amountPaise:19900,provider:'mock',startsAt:now,endsAt:ends.getTime()};
  write('subscription.'+accountKey(account),value);return value;
}
function requireBrowse(account: string) {
  if(!subscription(account) && usage(account).usedMs>=FREE_BROWSE_MS) throw new Error('Your free browsing time has ended for today.');
}
function requirePro(account: string) {
  if(!subscription(account)) throw new Error('Repaidians Pro is required for this action.');
}
export function snapshot(account: string, name='You'): CommunitySnapshot {
  const activity=read<CommunityActivity>('activity.'+accountKey(account),emptyActivity());
  const member: CommunityMember={id:localMemberId(account),name:activity.profile?.name||name||'You',handle:'my_repaidians',trade:activity.profile?.trade||'electrician',role:'Community member',avatarUrl:'',bio:activity.profile?.bio||'Add your trade and a little about your work.'};
  return {data:communityData(),activity,member,subscription:subscription(account),remainingMs:FREE_BROWSE_MS-usage(account).usedMs};
}
function activityChange(account: string, change: (value: CommunityActivity)=>void) {
  const value=read<CommunityActivity>('activity.'+accountKey(account),emptyActivity());change(value);write('activity.'+accountKey(account),value);
}
export function toggleActivity(account: string, kind: 'likes'|'saved'|'following', id: string) {
  requireBrowse(account);activityChange(account,value=>{value[kind]=value[kind].includes(id)?value[kind].filter(x=>x!==id):[...value[kind],id];});
}
export function visibleItems<T extends CommunityItem>(items: T[], member: CommunityMember, genre: Trade|'all'='all'): T[] {
  return items.filter(x=>(x.visibility==='public'||x.trade===member.trade||x.authorId===member.id) && (genre==='all'||x.trade===genre)).sort((a,b)=>b.createdAt-a.createdAt);
}
export function comment(account: string, targetId: string, text: string) {
  requireBrowse(account);const body=text.trim();if(!body||body.length>500)throw new Error('Write a comment of 1–500 characters.');
  const data=communityData();data.comments.push({id:uid(),targetId,authorId:localMemberId(account),text:body,createdAt:Date.now()});write('community',data);
}
export function follow(account: string, memberId: string) {
  requireBrowse(account);
  const from=localMemberId(account),data=communityData();
  const existing=data.follows.some(edge=>edge.from===from&&edge.to===memberId);
  data.follows=existing?data.follows.filter(edge=>edge.from!==from||edge.to!==memberId):[...data.follows,{from,to:memberId}];
  write('community',data);
  activityChange(account,value=>{value.following=existing?value.following.filter(id=>id!==memberId):[...new Set([...value.following,memberId])];});
}
export function bid(account: string, tenderId: string) {
  requirePro(account);const tender=communityData().tenders.find(t=>t.id===tenderId);
  if(!tender || tender.deadline<=Date.now())throw new Error('This tender has closed.');
  activityChange(account,value=>{if(!value.bids.includes(tenderId))value.bids.push(tenderId);});
}
export function sendMessage(account: string, recipientId: string, text: string) {
  requirePro(account);const body=text.trim();if(!body||body.length>1000)throw new Error('Write a message of 1–1,000 characters.');
  activityChange(account,value=>{value.messages.push({id:uid(),recipientId,text:body,createdAt:Date.now()});});
}
export function updateProfile(account: string, name: string, trade: Trade, bio: string) {
  requireBrowse(account);if(!name.trim()||name.length>80||bio.length>500)throw new Error('Add a name and keep your bio under 500 characters.');
  activityChange(account,value=>{value.profile={name:name.trim(),trade,bio:bio.trim()};});
}
export function publish(account: string, draft: PublicationDraft): string {
  requirePro(account);
  if(!trades.some(t=>t.id===draft.trade))throw new Error('Choose a trade.');
  if(!draft.caption.trim()||draft.caption.length>2000)throw new Error('Add a caption or scope of up to 2,000 characters.');
  const data=communityData(),id=uid(),now=Date.now();
  const base={id,authorId:localMemberId(account),createdAt:now,trade:draft.trade,visibility:draft.visibility,sample:false};
  if(draft.kind==='tender'){
    if(!draft.title?.trim()||!draft.location?.trim()||!draft.budgetRupees||draft.budgetRupees<=0||!draft.slots||draft.slots<1||!draft.deadline||draft.deadline<=now)throw new Error('Add the title, location, budget, crew size and a future deadline.');
    data.tenders.unshift({...base,title:draft.title.trim(),details:draft.caption.trim(),location:draft.location.trim(),budgetRupees:Math.round(draft.budgetRupees),slots:Math.round(draft.slots),deadline:draft.deadline,contact:draft.contact?.trim()||''});
  } else {
    if(!draft.media.length)throw new Error('Add a photo or video.');
    if(draft.kind==='post'){
      if(draft.media.length>4||draft.media.some(m=>m.kind!=='image'))throw new Error('Posts support up to four photos.');
      data.posts.unshift({...base,caption:draft.caption.trim(),media:draft.media});
    }else if(draft.kind==='story'){
      data.stories.unshift({...base,caption:draft.caption.trim(),media:draft.media[0],expiresAt:now+86400000});
    }else{
      if(draft.media[0].kind!=='video')throw new Error('Choose a video for your reel.');
      data.reels.unshift({...base,caption:draft.caption.trim(),media:draft.media[0]});
    }
  }
  write('community',data);return id;
}
export function subscribe(listener: ()=>void): ()=>void {
  const onStorage=(e: StorageEvent)=>{if(e.key?.startsWith(PREFIX))listener();};
  window.addEventListener(UPDATE,listener);window.addEventListener('storage',onStorage);
  return ()=>{window.removeEventListener(UPDATE,listener);window.removeEventListener('storage',onStorage);};
}
function mediaDb(): Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('repaidians-media',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('media');
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('Media storage is unavailable on this device.'));
  });
}
export async function storeMedia(files: File[]): Promise<CommunityMedia[]> {
  if(!files.length||files.length>4)throw new Error('Choose one to four media files.');
  if(files.some(f=>!(/^(image\/(jpeg|png|webp)|video\/(mp4|webm))$/.test(f.type))||f.size>25*1024*1024))throw new Error('Use JPG, PNG, WebP, MP4 or WebM files up to 25 MB each.');
  const db=await mediaDb();
  try {
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction('media','readwrite'),store=tx.objectStore('media');
      const result=files.map(file=>{const id=uid();store.put(file,id);return {url:'local-media:'+id,kind:file.type.startsWith('video')?'video' as const:'image' as const,alt:file.name};});
      tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(new Error('This device could not save the media.'));tx.onabort=()=>reject(new Error('Media saving was interrupted.'));
    });
  }finally{db.close();}
}
export async function loadMedia(url: string): Promise<Blob|null> {
  if(!url.startsWith('local-media:'))return null;
  const db=await mediaDb();
  try{return await new Promise((resolve,reject)=>{const request=db.transaction('media').objectStore('media').get(url.slice(12));request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>reject(new Error('Media could not be opened.'));});}
  finally{db.close();}
}
