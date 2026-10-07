import {Fragment,useCallback,useEffect,useRef,useState,useMemo} from 'react';
import {Bookmark,BriefcaseBusiness,Clapperboard,Crown,Bell,Home,MessageCircle,Plus,Search,User,X,Clock3,Infinity,LockKeyhole,ArrowRight,ThumbsUp,Menu,ShieldCheck,Building2,FileCheck2,ArrowLeft,Users} from 'lucide-react';
import {Modal} from '../ui';
import {
  snapshot,subscribe,chargeBrowsing,feed,memberProfile,publicationDetails,follow,toggleActivity,trades,
  bid,sendMessage,tenderContact,deletePublication,reportPublication,blockMember,CommunityError,opportunityDetails,
} from '../../services/repaidiansService';
import type {CommunityMember,CommunityPost,CommunityReel,CommunitySnapshot,CommunityTab,CommunityTender,CommunityOpportunity,OpportunityReference,OpportunitySource,StudioKind,Trade} from '../../types/repaidians';
import {Feed} from './Feed';
import {Opportunities} from './Opportunities';
import {OpportunityCard} from './OpportunityCard';
import {StoriesTray,StoryViewer} from './Stories';
import {Reels} from './Reels';
import {Tenders} from './Tenders';
import {Profile} from './Profile';
import {ProfileSettings} from './ProfileSettings';
import {ProfessionalNetwork,NetworkPreferencesPanel} from './ProfessionalNetwork';
import {ProfessionalVisibilityPrivacy} from './ProfessionalProfile';
import {WorkHub,WorkPreferences} from './WorkHub';
import {CustomContractHub} from '../CustomContracts';
import {workInterests,peekWorkInterests,trackWorkBehavior,subscribeWorkReads} from '../../services/repaidiansWorkService';
import {PublishingStudio} from './PublishingStudio';
import {CommentsDrawer,MessageDrawer} from './CommentsDrawer';
import {SubscriptionModal} from './SubscriptionModal';
import {CommunityInbox,CommunityNotifications,PeopleSearch} from './CommunityDiscovery';
import {Avatar,EmptyState} from './common';
import './repaidians.css';
import './social-navigation.css';

type TimelineItem=CommunityPost|CommunityReel|CommunityTender;
type ProfileResult=Awaited<ReturnType<typeof memberProfile>>;
type Confirm={kind:'delete'|'block'|'report';id:string};
const navigation=[{id:'feed',label:'Home',icon:Home},{id:'search',label:'Search',icon:Search},{id:'network',label:'My network',icon:Users},{id:'reels',label:'Works',icon:Clapperboard},{id:'opportunities',label:'Work & market',icon:BriefcaseBusiness},{id:'tenders',label:'Tenders',icon:BriefcaseBusiness},{id:'contracts',label:'Contracts',icon:BriefcaseBusiness},{id:'profile',label:'My profile',icon:User}] as const;
const uniqueIds=(ids:string[])=>[...new Set(ids)];
const unique=<T extends {id:string}>(items:T[])=>[...new Map(items.map(item=>[item.id,item])).values()];

export default function RepaidiansModal({account,name,city,onClose,onBook,onSignIn,initialProfileId,initialPublicationId,initialTab='feed',initialReference,onDestination,onManage,onProject}:{account:string;name:string;city:string;onClose:()=>void;onBook:(trade:Trade)=>void;onSignIn?:()=>void;initialProfileId?:string;initialPublicationId?:string;initialTab?:CommunityTab;initialReference?:OpportunityReference;onDestination?:(card:CommunityOpportunity)=>void;onManage?:(source:OpportunitySource|'applications')=>void;onProject?:(id:string)=>void}) {
  const [cachedState,setState]=useState<CommunitySnapshot|null>(null),[stateAccount,setStateAccount]=useState(account),[tab,setTab]=useState<CommunityTab>(initialTab),[genre,setGenre]=useState<Trade|'all'>('all'),[mode,setMode]=useState<'all'|'saved'|'liked'|'jobs'|'applications'>('all');
  const [profileId,setProfileId]=useState<string|null>(null),[profileData,setProfileData]=useState<ProfileResult|null>(null),[profileBusy,setProfileBusy]=useState(false),[storyId,setStoryId]=useState<string|null>(null),[comments,setComments]=useState<string|null>(null),[recipient,setRecipient]=useState<CommunityMember|null>(null);
  const [studio,setStudio]=useState<StudioKind|null>(null),[upgrade,setUpgrade]=useState(''),[notice,setNotice]=useState(''),[error,setError]=useState(''),[revision,setRevision]=useState(0),[confirm,setConfirm]=useState<Confirm|null>(null),[reason,setReason]=useState('spam'),[confirmBusy,setConfirmBusy]=useState(false),[detail,setDetail]=useState<CommunityPost|null>(null);
  const [members,setMembers]=useState<Record<string,CommunityMember>>({}),[timeline,setTimeline]=useState<{key:string;items:TimelineItem[];cursor:string|null}>({key:'',items:[],cursor:null}),[feedBusy,setFeedBusy]=useState(false),[moreBusy,setMoreBusy]=useState(false),[remaining,setRemaining]=useState(15*60000),[clockNow,setClockNow]=useState(Date.now());
  const [attachedReference,setAttachedReference]=useState<OpportunityReference|undefined>(initialReference);
  const [options,setOptions]=useState<'menu'|'settings'|null>(null),[suiteView,setSuiteView]=useState<'market'|'companies'>('market');
  const [applicationTarget,setApplicationTarget]=useState<string|undefined>();
  const [contractTarget,setContractTarget]=useState<string|undefined>();
  const [interests,setInterests]=useState(()=>peekWorkInterests(account));
  const initialReferenceOpened=useRef(false),initialProfileOpened=useRef<string|undefined>(undefined),initialPublicationOpened=useRef<string|undefined>(undefined);
  const alive=useRef(true),authAccount=useRef(account),busyActions=useRef(new Set<string>()),remainingAt=useRef({ms:15*60000,at:performance.now()}),serverClock=useRef({ms:Date.now(),at:performance.now()});
  const timelineWindow=useRef(timeline);timelineWindow.current=timeline;
  const state=stateAccount===account?cachedState:null;
  const orderedTrades=useMemo(()=>{if(!interests?.personalized)return trades;const positions=new Map(interests.trades.map((item,index)=>[item.trade,index]));return [...trades].sort((a,b)=>(positions.get(a.id)??trades.length)-(positions.get(b.id)??trades.length));},[interests]);
  useEffect(()=>{
    if(!state?.authenticated){setInterests(null);return;}let active=true,timer:ReturnType<typeof setTimeout>|undefined;const controller=new AbortController();
    const load=()=>{void workInterests(account,false,controller.signal).then(result=>{if(active&&authAccount.current===account)setInterests(result);}).catch(()=>{});};
    const update=()=>{clearTimeout(timer);timer=setTimeout(load,500);};
    load();window.addEventListener('repaidians:work-interests',update);const unsubscribe=subscribeWorkReads(update);
    return()=>{active=false;controller.abort();clearTimeout(timer);window.removeEventListener('repaidians:work-interests',update);unsubscribe();};
  },[account,state?.authenticated]);
  const selectGenre=(trade:Trade|'all')=>{setGenre(trade);if(trade!=='all'&&state?.authenticated&&interests?.personalized)void trackWorkBehavior(account,{trade,type:'view',sourceId:'community-trade'}).catch(()=>{});};
  const professional=state?.capabilities?.professional===true;
  const communityNavigation=navigation.filter(item=>professional||!['network','profile'].includes(item.id));
  const subscription=state?.subscription;
  const hasAccess=!!subscription&&subscription.startsAt<=clockNow&&subscription.endsAt>clockNow;
  const paid=hasAccess&&subscription?.plan==='pro',trialActive=hasAccess&&subscription?.plan==='trial';
  const trialDays=trialActive?Math.max(1,Math.ceil((subscription!.endsAt-clockNow)/86400000)):0;
  const trialEnded=!!state?.authenticated&&!hasAccess&&!!state.trial;
  const locked=!!state&&(state.authenticated?!hasAccess:remaining<=0);
  const exactExpiry=subscription?new Date(subscription.endsAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})+' IST':'';
  const addMembers=useCallback((incoming:CommunityMember[])=>setMembers(old=>({...old,...Object.fromEntries(incoming.map(m=>[m.id,m]))})),[]);
  const refresh=useCallback(async()=>{
    const requestAccount=account;
    const next=await snapshot(account,name);
    if(!alive.current||authAccount.current!==requestAccount)return;
    setState(next);setStateAccount(requestAccount);addMembers([...next.data.members,next.member]);
    const receivedAt=performance.now();serverClock.current={ms:next.serverNow??Date.now(),at:receivedAt};setClockNow(serverClock.current.ms);
    remainingAt.current={ms:next.remainingMs,at:receivedAt};setRemaining(next.remainingMs);setError('');
  },[account,name,addMembers]);
  useEffect(()=>{
    const switched=authAccount.current!==account;
    alive.current=true;authAccount.current=account;setState(null);setMembers({});setTimeline({key:'',items:[],cursor:null});
    setOptions(null);setSuiteView('market');setMode('all');setApplicationTarget(undefined);setContractTarget(undefined);setGenre('all');setInterests(peekWorkInterests(account));
    setProfileId(null);setProfileData(null);setProfileBusy(false);setStoryId(null);setComments(null);setRecipient(null);setStudio(null);setDetail(null);setConfirm(null);setUpgrade('');setNotice('');setAttachedReference(switched?undefined:initialReference);
    if(switched){initialReferenceOpened.current=true;initialProfileOpened.current=undefined;initialPublicationOpened.current=undefined;}
    void refresh().catch(e=>{if(alive.current)setError((e as Error).message);});
    const changed=()=>{void refresh().catch(e=>{if(alive.current)setNotice((e as Error).message);});setRevision(v=>v+1);};
    const unsubscribe=subscribe(changed);
    const heartbeat=async()=>{
      try{const usage=await chargeBrowsing(!document.hidden);if(!alive.current||authAccount.current!==account)return;const receivedAt=performance.now();serverClock.current={ms:usage.serverNow??Date.now(),at:receivedAt};setClockNow(serverClock.current.ms);remainingAt.current={ms:usage.remainingMs,at:receivedAt};setRemaining(usage.remainingMs);setState(old=>old?{...old,remainingMs:usage.remainingMs,subscription:usage.subscription||null,trial:usage.trial??null,serverNow:serverClock.current.ms}:old);}catch(e){if(alive.current)setNotice((e as Error).message);}
    };
    const visibility=()=>{remainingAt.current={ms:remainingAt.current.ms,at:performance.now()};void heartbeat();};
    const timer=setInterval(()=>{if(!document.hidden)void heartbeat();},10000);
    const clock=setInterval(()=>{if(!document.hidden){const elapsed=performance.now();setClockNow(serverClock.current.ms+elapsed-serverClock.current.at);setRemaining(Math.max(0,remainingAt.current.ms-(elapsed-remainingAt.current.at)));}},1000);
    const poll=setInterval(()=>{if(!document.hidden){void refresh().catch(()=>{});setRevision(v=>v+1);}},30000);
    document.addEventListener('visibilitychange',visibility);
    return()=>{alive.current=false;unsubscribe();clearInterval(timer);clearInterval(clock);clearInterval(poll);document.removeEventListener('visibilitychange',visibility);void chargeBrowsing(false,true).catch(()=>{});};
  },[refresh,account]);
  useEffect(()=>{if(!subscription)return;const until=subscription.endsAt-(serverClock.current.ms+performance.now()-serverClock.current.at);if(until<=0){void refresh().catch(()=>{});return;}const timer=setTimeout(()=>{setClockNow(serverClock.current.ms+performance.now()-serverClock.current.at);void refresh().catch(()=>{});},Math.min(until+50,2147483647));return()=>clearTimeout(timer);},[subscription?.endsAt,subscription?.plan,refresh]);
  useEffect(()=>{if(!locked)return;setStoryId(null);setComments(null);setRecipient(null);setStudio(null);setDetail(null);setConfirm(null);},[locked]);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),6000);return()=>clearTimeout(timer);},[notice]);
  const handleError=(e:unknown)=>{
    const problem=e as CommunityError;
    if(problem.status===401){if(onSignIn)onSignIn();else setNotice('Sign in through your Repaido account to continue.');}
    else if(problem.status===402||problem.code==='PRO_REQUIRED'){setUpgrade(problem.message);void refresh().catch(()=>{});}
    else {setNotice(problem.message||'Please retry.');if(problem.code?.includes('QUOTA'))void refresh().catch(()=>{});}
  };
  const signed=()=>{if(state?.authenticated)return true;if(onSignIn)onSignIn();else setNotice('Sign in through your Repaido account to continue.');return false;};
  const act=async(key:string,action:()=>Promise<unknown>):Promise<boolean>=>{
    const requestAccount=authAccount.current;
    if(!signed()||busyActions.current.has(key))return false;busyActions.current.add(key);
    try{await action();return alive.current&&authAccount.current===requestAccount;}catch(e){if(alive.current&&authAccount.current===requestAccount)handleError(e);return false;}finally{busyActions.current.delete(key);}
  };
  const proAction=(reason:string,action:()=>void)=>{if(!professional)return false;if(!signed())return false;if(!hasAccess){setUpgrade(reason);return false;}action();return true;};
  const create=(kind:StudioKind='post')=>proAction('Share your work, build a portfolio and find your next collaboration.',()=>{if(!state?.mediaReady&&(kind==='story'||kind==='reel')){setNotice('Media uploads are temporarily unavailable. Please retry later.');return;}setAttachedReference(undefined);setStudio(kind);});
  const shareListing=(reference:OpportunityReference)=>proAction('Share a published listing and connect with your community.',()=>{setAttachedReference(reference);setStudio('post');});
  const destination=(card:CommunityOpportunity)=>{if(onDestination)onDestination(card);else setNotice('Open this listing from the Repaido app to continue.');};
  const manage=(source:OpportunitySource|'applications')=>{if(!signed())return;if(onManage){setStudio(null);onManage(source);}else setNotice('Open your Repaido workspace to manage listings and applications.');};
  const attachment=(post:CommunityPost)=>post.referenceCard?<OpportunityCard card={post.referenceCard} compact onDestination={destination} onShare={reference=>shareListing(reference)} allowSave={!!state?.authenticated&&hasAccess}/>:post.referenceUnavailable?<p className="rp-link-unavailable">This listing is no longer available. Your publication stays in your portfolio.</p>:null;
  useEffect(()=>{if(!initialReference||initialReferenceOpened.current||!state)return;if(shareListing(initialReference))initialReferenceOpened.current=true;},[initialReference?.source,initialReference?.id,!!state,hasAccess]);
  const memberFor=(id:string):CommunityMember=>members[id]||(state?.member.id===id?state.member:{id,name:'Community member',handle:'member',trade:'cleaning',role:'Member',avatarUrl:'',bio:''});
  const openProfile=(id:string)=>{if(!professional&&id===state?.member.id){setProfileId(null);setTab('contracts');return;}setProfileId(id);setProfileData(null);setTab('profile');};
  useEffect(()=>{if(state&&!locked&&initialProfileId&&initialProfileOpened.current!==initialProfileId){initialProfileOpened.current=initialProfileId;openProfile(initialProfileId);}},[!!state,locked,initialProfileId]);
  useEffect(()=>{
    if(tab!=='profile'||!state||locked)return;
    let active=true;setProfileBusy(true);
    const id=profileId||state.member.id;
    if(id==='guest'){setProfileBusy(false);return;}
    void memberProfile(id).then(data=>{if(active){setProfileData(data);addMembers([data.member]);}}).catch(e=>{if(active)handleError(e);}).finally(()=>{if(active)setProfileBusy(false);});return()=>{active=false;};
  },[profileId,tab,state?.member.id,revision,locked]);
  const openDetail=useCallback(async(id:string)=>{
    const requestAccount=authAccount.current;
    try{
      const data=await publicationDetails(id);
      if(!alive.current||authAccount.current!==requestAccount)return false;
      addMembers(data.members);
      const item=Array.isArray(data.item.media)?data.item as CommunityPost:{...data.item as CommunityReel,media:[(data.item as CommunityReel).media]};
      setDetail(item);return true;
    }catch(e){if(alive.current&&authAccount.current===requestAccount){setDetail(old=>old?.id===id?null:old);setNotice((e as Error).message);}return false;}
  },[addMembers]);
  useEffect(()=>{if(!state||locked||!initialPublicationId||initialPublicationOpened.current===initialPublicationId)return;void openDetail(initialPublicationId).then(opened=>{if(opened)initialPublicationOpened.current=initialPublicationId;});},[!!state,locked,initialPublicationId,openDetail]);
  useEffect(()=>{if(state&&!locked&&detail?.id)void openDetail(detail.id);},[revision,locked,account]);
  const kind=tab==='reels'?'reel':tab==='tenders'?'tender':'post';
  const sourceKey=kind+':'+genre+':'+(kind==='post'?mode:'all');
  useEffect(()=>{
    if(!state||locked||!['feed','reels','tenders'].includes(tab)||(tab==='feed'&&['jobs','applications'].includes(mode)))return;
    const controller=new AbortController();setFeedBusy(true);
    const extent=Math.max(12,timelineWindow.current.key===sourceKey?timelineWindow.current.items.length:12);
    void (async()=>{
      let items:TimelineItem[]=[],incoming:CommunityMember[]=[],cursor:string|null=null,pages=0;
      do{
        const page=await feed(kind,genre,kind==='post'?mode:'all',cursor||'',controller.signal,Math.min(50,extent-items.length));
        if(controller.signal.aborted)return null;
        items=unique([...items,...page.items as TimelineItem[]]);incoming=unique([...incoming,...page.members]);cursor=page.nextCursor;
      }while(cursor&&items.length<extent&&++pages<Math.ceil(extent/12));
      return {items,members:incoming,nextCursor:cursor};
    })().then(data=>{
      if(controller.signal.aborted||!data)return;addMembers(data.members);
      setTimeline({key:sourceKey,items:data.items,cursor:data.nextCursor});
      setError('');
    }).catch(e=>{if(!controller.signal.aborted)setError((e as Error).message);}).finally(()=>{if(!controller.signal.aborted)setFeedBusy(false);});
    return()=>controller.abort();
  },[!!state,tab,genre,mode,revision,locked]);
  const loadMore=async()=>{
    if(!timeline.cursor||moreBusy||feedBusy)return;const requestAccount=authAccount.current;setMoreBusy(true);
    try{const page=await feed(kind,genre,kind==='post'?mode:'all',timeline.cursor);if(!alive.current||authAccount.current!==requestAccount)return;addMembers(page.members);setTimeline(old=>old.key===sourceKey?{...old,items:unique([...old.items,...page.items as TimelineItem[]]),cursor:page.nextCursor}:old);}catch(e){handleError(e);}finally{setMoreBusy(false);}
  };
  const share=async(post:CommunityPost)=>{
    const data={title:memberFor(post.authorId).name+' on Repaidians',text:post.caption,url:location.origin+'/?repaidians='+encodeURIComponent(post.id)};
    try{if(navigator.share)await navigator.share(data);else{await navigator.clipboard.writeText(data.text+' '+data.url);setNotice('Link copied. Your publication’s visibility rules still apply.');}}catch(e){if((e as Error).name!=='AbortError')setNotice('Sharing is unavailable in this browser.');}
  };
  const like=(id:string)=>void act('like:'+id,async()=>{
    const item=timeline.items.find(item=>item.id===id) as CommunityPost|undefined;
    const active=!(item?.liked??state?.activity.likes.includes(id));
    const result=await toggleActivity(account,'likes',id,active);
    if(!alive.current||authAccount.current!==account)return;
    setTimeline(old=>({...old,items:old.items.map(item=>item.id===id?{...item,liked:active,likeCount:result.likeCount}:item)}));
    setDetail(old=>old?.id===id?{...old,liked:active,likeCount:result.likeCount}:old);
    if(active&&interests?.personalized&&(item?.trade||detail?.trade))void trackWorkBehavior(account,{trade:(item?.trade||detail!.trade),type:'view',sourceId:id}).catch(()=>{});
    setState(old=>old?{...old,activity:{...old.activity,likes:active?uniqueIds([...old.activity.likes,id]):old.activity.likes.filter(value=>value!==id)}}:old);
  });
  const save=(id:string)=>void act('save:'+id,async()=>{
    const item=timeline.items.find(item=>item.id===id) as CommunityPost|undefined;
    const active=!(item?.saved??state?.activity.saved.includes(id));
    await toggleActivity(account,'saved',id,active);
    if(!alive.current||authAccount.current!==account)return;
    setTimeline(old=>({...old,items:old.items.map(item=>item.id===id?{...item,saved:active}:item)}));
    setDetail(old=>old?.id===id?{...old,saved:active}:old);
    if(active&&interests?.personalized&&(item?.trade||detail?.trade))void trackWorkBehavior(account,{trade:(item?.trade||detail!.trade),type:'save',sourceId:id}).catch(()=>{});
    setState(old=>old?{...old,activity:{...old.activity,saved:active?uniqueIds([...old.activity.saved,id]):old.activity.saved.filter(value=>value!==id)}}:old);
  });
  const chooseFeed=(next:typeof mode)=>{if(['jobs','applications','liked'].includes(next)&&!professional)return;if(next!=='all'&&!signed())return;setTab('feed');setMode(next);setApplicationTarget(undefined);setError('');setOptions(null);};
  const chooseTab=(id:CommunityTab)=>{if(['inbox','network'].includes(id)&&!professional)return;if((id==='inbox'||id==='notifications'||id==='network')&&!signed())return;setTab(id);setOptions(null);setError('');if(id==='profile'){setProfileId(null);setProfileData(null);}};
  const confirmAction=async()=>{
    if(!confirm)return;setConfirmBusy(true);
    try{
      if(confirm.kind==='delete'){await deletePublication(confirm.id);setTimeline(old=>({...old,items:old.items.filter(i=>i.id!==confirm.id)}));setDetail(null);setNotice('Publication deleted.');}
      else if(confirm.kind==='block'){await blockMember(confirm.id);setTimeline({key:'',items:[],cursor:null});setTab('feed');setProfileId(null);setNotice('Member blocked. Their content and messages are hidden.');}
      else {await reportPublication(confirm.id,reason);setNotice('Report submitted for review.');}
      setConfirm(null);
    }catch(e){handleError(e);}finally{setConfirmBusy(false);}
  };
  const stories=state?.data.stories.filter(story=>story.expiresAt>clockNow)||[];
  const activeItems=timeline.key===sourceKey?timeline.items:[];
  const currentProfile=profileData?.member||(profileId?memberFor(profileId):state?.member);
  const profilePosts=profileData?[...profileData.posts,...profileData.reels.map(reel=>({...reel,media:[reel.media]}))]:[];
  const profileWithStats=currentProfile?{...currentProfile,postsCount:profileData?profileData.stats.posts+profileData.stats.reels:currentProfile.postsCount}:null;
  const onMessage=(member:CommunityMember)=>{if(professional&&signed())setRecipient(member);};
  const quotaLabel=trialActive?'Free trial · '+trialDays+' '+(trialDays===1?'day':'days'):paid?'Pro':state?.authenticated?'Membership required':`${Math.floor(remaining/60000)}:${String(Math.floor(remaining/1000)%60).padStart(2,'0')} today`;
  const showContent=!!state&&!locked;
  return <Modal title="Repaidians community" frameless className="rp-shell" onClose={onClose}>
    <div className="rp-shell-inner">
      <header className="rp-header"><div className="rp-wordmark"><span>THE PEOPLE BEHIND THE WORK</span><h1>Repaidians<span className="rp-wordmark-dot"/></h1></div><div className="rp-header-actions">{professional&&<><button aria-label="Your interests" aria-pressed={tab==='feed'&&mode==='liked'} onClick={()=>chooseFeed('liked')}><ThumbsUp size={23}/></button><button aria-label="Open messages" onClick={()=>chooseTab('inbox')}><MessageCircle size={24}/></button></>}<button className="rp-close" aria-label="Close Repaidians" data-autofocus onClick={onClose}><X size={24}/></button></div></header>
      <aside className="rp-desktop-sidebar" aria-label="Community navigation"><nav>{communityNavigation.map(item=><button key={item.id} aria-current={tab===item.id?'page':undefined} onClick={()=>chooseTab(item.id)}><item.icon size={25}/>{item.label}</button>)}{professional&&<><button onClick={()=>create()}><Plus size={25}/>Create</button><button onClick={()=>chooseTab('inbox')}><MessageCircle size={25}/>Messages</button></>}<button onClick={()=>chooseTab('notifications')}><Bell size={25}/>Notifications{state?.unreadCount?<span className="rp-menu-count">{state.unreadCount}</span>:null}</button><button onClick={()=>signed()&&setOptions('menu')}><Menu size={25}/>Tools & settings</button></nav><button className="rp-sidebar-pro" onClick={()=>signed()&&setUpgrade('Make room for your next chapter.')}><Crown size={22}/>{trialActive?'Your free trial':'Your membership'}</button></aside>
      <div className="rp-toolbar"><button className="rp-quota" aria-label={trialActive?'Free trial: '+trialDays+' '+(trialDays===1?'day':'days')+' remaining. Ends '+exactExpiry+'. Browsing access included.':paid?'Repaidians Pro membership. Active until '+exactExpiry:state?.authenticated?'Repaidians membership required':'Daily browsing time remaining'} title={hasAccess?'Membership ends '+exactExpiry:undefined} onClick={()=>signed()&&setUpgrade('A little more room to grow your craft and your connections.')}><span>{hasAccess?<Infinity size={16}/>:<Clock3 size={16}/>}</span>{quotaLabel}</button><div><button className="rp-toolbar-notifications" aria-label="Notifications" aria-pressed={tab==='notifications'} onClick={()=>chooseTab('notifications')}><Bell size={19}/>{!!state?.unreadCount&&<i className="rp-notification-dot"/>}</button><button className="rp-tender-shortcut" aria-label="Tenders" aria-pressed={tab==='tenders'} onClick={()=>chooseTab('tenders')}><BriefcaseBusiness size={18}/><span className="rp-action-label">Tenders</span></button>{professional&&<button className="rp-create" aria-label="Create" onClick={()=>create()}><Plus size={20}/><span className="rp-action-label">Create</span></button>}</div></div>
      <main className="rp-content" data-reels={tab==='reels'}>
        {!state&&<div className="rp-loading" role="status"><span className="rp-story-ring"><Avatar member={{id:'loading',name:'',handle:'',trade:'cleaning',role:'',avatarUrl:'',bio:''}}/></span><h2>Your community is coming into view.</h2><p>Connecting to Repaidians…</p></div>}
        {error&&<div className="rp-error" role="alert"><p>{error}</p><button className="rp-secondary" onClick={()=>{if(!state)void refresh().catch(e=>setError((e as Error).message));else setRevision(v=>v+1);}}>Retry</button></div>}
        {locked&&<div className="rp-locked"><LockKeyhole size={36}/><h2>{state.authenticated?(trialEnded?'Your free trial has ended.':'Continue with Repaidians Pro.'):'That’s today’s 15 minutes.'}</h2><p>{state.authenticated?'Your 60 days of free access from first joining Repaidians have ended. Continue browsing for ₹199 per month. Your existing work stays saved. No automatic charge.':'Your guest preview resets at midnight IST. Sign in to start 60 days of free browsing from first joining.'}</p><button className="rp-primary" onClick={()=>state.authenticated?setUpgrade('Your free trial has ended. Repaidians Pro is required to continue.'):signed()}>{state.authenticated?'Continue with Pro · ₹199/month':'Sign in · 60 days free'}</button><button className="rp-secondary" onClick={onClose}>Back to Repaido</button></div>}
        {locked&&state.authenticated&&<div className="rp-expired-settings"><button className="rp-secondary" onClick={()=>setOptions('settings')}><ShieldCheck size={18}/>Privacy & notifications</button></div>}
        {showContent&&<>
          {!state.authenticated&&<div className="rp-auth-banner"><span>Explore work, professional portfolios and contract progress. Sign in to manage your private contracts and proposals.</span><button onClick={()=>signed()}>Sign in · 60 days free</button></div>}
          {tab==='feed'&&<>{mode!=='jobs'&&mode!=='applications'&&<StoriesTray stories={stories} memberFor={memberFor} onOpen={setStoryId} onCreate={professional?()=>create('story'):undefined}/>}<div className="rp-feed-modes" role="tablist" aria-label="Feed source">{([{id:'all',label:'For you',icon:Home},...(professional?[{id:'jobs',label:'My jobs',icon:BriefcaseBusiness},{id:'applications',label:'Apply Status',icon:FileCheck2}] as const:[]),{id:'saved',label:'Saved',icon:Bookmark},...(mode==='liked'?[{id:'liked',label:'Interests',icon:ThumbsUp}] as const:[])] as const).map(item=><button key={item.id} role="tab" id={'rp-feed-tab-'+item.id} aria-controls="rp-feed-panel" aria-selected={mode===item.id} tabIndex={mode===item.id?0:-1} onKeyDown={event=>{const buttons=Array.from(event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>('[role=tab]'));const index=buttons.indexOf(event.currentTarget);const next=event.key==='ArrowRight'?(index+1)%buttons.length:event.key==='ArrowLeft'?(index+buttons.length-1)%buttons.length:event.key==='Home'?0:event.key==='End'?buttons.length-1:-1;if(next>=0){event.preventDefault();buttons[next].click();buttons[next].focus();}}} onClick={()=>chooseFeed(item.id)}><item.icon size={16}/><span>{item.label}</span></button>)}</div></>}
          {['feed','reels','tenders'].includes(tab)&&!(tab==='feed'&&['jobs','applications'].includes(mode))&&<div className="rp-genres" role="group" aria-label="Filter by trade"><button aria-pressed={genre==='all'} onClick={()=>selectGenre('all')}>All trades</button>{orderedTrades.map(trade=><button key={trade.id} aria-pressed={genre===trade.id} onClick={()=>selectGenre(trade.id)}>{trade.name}</button>)}</div>}
          {feedBusy&&activeItems.length===0&&['feed','reels','tenders'].includes(tab)&&!(tab==='feed'&&['jobs','applications'].includes(mode))&&<div id={tab==='feed'?'rp-feed-panel':undefined} role={tab==='feed'?'tabpanel':undefined} aria-labelledby={tab==='feed'?'rp-feed-tab-'+mode:undefined}><p className="rp-loading" role="status">Finding the latest work…</p></div>}
          {tab==='feed'&&!['jobs','applications'].includes(mode)&&(!feedBusy||activeItems.length>0)&&<div id="rp-feed-panel" role="tabpanel" aria-labelledby={'rp-feed-tab-'+mode}><Feed professionalActions={professional} renderAttachment={attachment} suspended={!!(recipient||comments||storyId||studio||upgrade||detail||confirm)} posts={activeItems as CommunityPost[]} activity={state.activity} memberFor={memberFor} currentMemberId={state.member.id} onProfile={openProfile} onLike={like} onSave={save} onComments={id=>{if(professional&&signed())setComments(id);}} onShare={post=>void share(post)} onCreate={()=>create()} onDelete={id=>setConfirm({kind:'delete',id})} onReport={id=>{if(signed())setConfirm({kind:'report',id});}}/></div>}
          {tab==='feed'&&['jobs','applications'].includes(mode)&&<div id="rp-feed-panel" role="tabpanel" aria-labelledby={'rp-feed-tab-'+mode}><WorkHub key={account+':'+mode} accountKey={account} view={mode==='jobs'?'jobs':'applications'} applicationId={mode==='applications'?applicationTarget:undefined} revision={revision} onOpenMember={openProfile} onOpenProject={mode==='applications'?onProject:undefined} onManage={()=>manage('applications')}/></div>}
          {tab==='reels'&&(!feedBusy||activeItems.length>0)&&<Reels professionalActions={professional} suspended={!!(recipient||comments||storyId||studio||upgrade||detail||confirm)} reels={activeItems as CommunityReel[]} likes={state.activity.likes} memberFor={memberFor} onLike={like} onComments={id=>{if(professional&&signed())setComments(id);}} onProfile={openProfile} onBook={reel=>onBook(reel.trade)} onCreate={()=>create('reel')}/>}
          {tab==='tenders'&&(!feedBusy||activeItems.length>0)&&<Tenders professionalActions={professional} paid={hasAccess} selfId={state.member.id} tenders={activeItems as CommunityTender[]} bids={state.activity.bids} memberFor={memberFor} onProfile={openProfile} onBid={async id=>{if(!proAction('Send tender interest and connect with the right crew.',()=>{}))return false;const ok=await act('bid:'+id,()=>bid(account,id));if(ok)setNotice('Your interest was sent to the tender owner.');return ok;}} onContact={async tender=>{if(!proAction('Connect directly with tender owners.',()=>{}))return null;try{return (await tenderContact(tender.id)).contact;}catch(e){handleError(e);return null;}}} onCreate={()=>create('tender')}/>}
          {['feed','reels','tenders'].includes(tab)&&!(tab==='feed'&&['jobs','applications'].includes(mode))&&timeline.key===sourceKey&&timeline.cursor&&<button className="rp-load-more" disabled={moreBusy||feedBusy} onClick={()=>void loadMore()}>{moreBusy?'Loading…':'Load more'}</button>}
          {tab==='search'&&<PeopleSearch onProfile={openProfile} onMembers={addMembers}/>}
          {tab==='opportunities'&&suiteView==='market'&&<Opportunities city={city} revision={revision} onDestination={destination} onManage={manage} onShare={reference=>shareListing(reference)}/>}
          {tab==='opportunities'&&suiteView==='companies'&&<WorkHub key={account+':companies'} accountKey={account} view="companies" revision={revision} onOpenMember={openProfile}/>}
          {tab==='contracts'&&<CustomContractHub key={account+':contracts'} accountKey={account} authenticated={!!state.authenticated} mode={state.capabilities?.role||'customer'} onOpenMember={openProfile} focusContractId={contractTarget} onSignIn={onSignIn} onOpenProject={onProject}/>}
          {tab==='inbox'&&professional&&<CommunityInbox selfId={state.member.id} onMembers={addMembers} onOpen={id=>onMessage(memberFor(id))}/>}
          {tab==='network'&&professional&&<ProfessionalNetwork key={account} accountKey={account} authenticated={!!state.authenticated} onOpenMember={openProfile} onDiscover={()=>chooseTab('search')} onJobs={()=>chooseFeed('jobs')} onCompanies={()=>{setSuiteView('companies');chooseTab('opportunities');}}/>}
          {tab==='notifications'&&<CommunityNotifications key={account} accountKey={account} onMembers={addMembers} onProfile={openProfile} onApplications={id=>{chooseFeed('applications');setApplicationTarget(id);}} onCustomContract={id=>{setContractTarget(id);chooseTab('contracts');}} onPublication={id=>void openDetail(id)} onContract={id=>{const requestedAccount=account;void opportunityDetails({source:'contract',id}).then(card=>{if(alive.current&&authAccount.current===requestedAccount)destination(card);}).catch(e=>{if(alive.current&&authAccount.current===requestedAccount)setError((e as Error).message);});}}/>}
          {tab==='profile'&&(state.authenticated||profileId)&&profileBusy&&!profileData&&<p role="status" className="rp-loading">Opening the portfolio…</p>}
          {tab==='profile'&&!state.authenticated&&!profileId&&<EmptyState title="A profile that grows with your craft.">Explore published work and professional portfolios.<button className="rp-primary" onClick={()=>signed()}>Sign in to Repaido</button><button className="rp-business-suite" aria-label="Open Work and market business suite" onClick={()=>{setSuiteView('market');chooseTab('opportunities');}}><BriefcaseBusiness size={19}/><span><strong>Work & market</strong><small>Explore published projects and products</small></span><ArrowRight size={17}/></button></EmptyState>}
          {tab==='profile'&&(professional||!!profileId)&&(!profileBusy||!!profileData)&&profileWithStats&&profileWithStats.id!=='guest'&&<Profile key={account+':'+profileWithStats.id} account={account} member={profileWithStats} self={profileWithStats.id===state.member.id} posts={profilePosts} following={state.activity.following.includes(profileWithStats.id)} followingCount={profileWithStats.followingCount||0} followersCount={profileWithStats.followersCount||0} authenticated={!!state.authenticated} professionalActions={professional} onOpenMember={openProfile} onNetwork={()=>chooseTab('network')} onJobs={()=>chooseFeed('jobs')} onCompanies={()=>{setSuiteView('companies');chooseTab('opportunities');}} onBack={()=>setTab('feed')} onFollow={()=>void act('follow:'+profileWithStats.id,()=>follow(account,profileWithStats.id,!state.activity.following.includes(profileWithStats.id)))} onMessage={()=>onMessage(profileWithStats)} onBook={()=>onBook(profileWithStats.trade)} onCreate={()=>create()} onPublication={id=>void openDetail(id)} onOptions={()=>setOptions('menu')} onWork={()=>{setSuiteView('market');chooseTab('opportunities');}} onStatusChanged={member=>{addMembers([member]);setProfileData(old=>old?.member.id===member.id?{...old,member}:old);setState(old=>old?.member.id===member.id?{...old,member}:old);}} onBlock={()=>{if(signed())setConfirm({kind:'block',id:profileWithStats.id});}}/>}
        </>}
      </main>
      <aside className="rp-desktop-aside">{showContent&&<><div className="rp-aside-identity"><Avatar member={state.member}/><span><strong>{state.authenticated?state.member.name:'Welcome to Repaidians'}</strong><small>{professional?'@'+state.member.handle:'Discover the people behind the work'}</small></span></div>{professional&&<section className="rp-pro-card"><Crown size={26}/><h2>Make something worth sharing.</h2><p>Join a community built around your craft.</p><button className="rp-primary" onClick={()=>create()}>Share your work</button></section>}<p className="rp-fine">Your feed shows real publications. Trade-only posts stay within their selected community.</p></>}</aside>
      <nav className="rp-bottom-nav" aria-label="Repaidians sections">{communityNavigation.filter(item=>item.id!=='tenders'&&item.id!=='opportunities'&&item.id!=='network').map((item,index)=><Fragment key={item.id}>{index===2&&professional&&<button className="rp-nav-create" aria-label="Create publication" onClick={()=>create()} disabled={locked}><Plus size={25}/><span>Create</span></button>}<button aria-current={tab===item.id?'page':undefined} disabled={locked} onClick={()=>chooseTab(item.id)}><item.icon size={25}/><span>{item.label}</span></button></Fragment>)}</nav>

      {options&&state?.authenticated&&<Modal title={options==='settings'?'Privacy and notifications':'Profile tools and settings'} frameless className="rp-dialog rp-options-drawer" onClose={()=>setOptions(null)}><header className="rp-options-header">{options==='settings'&&<button aria-label="Back to profile tools" onClick={()=>setOptions('menu')}><ArrowLeft size={20}/></button>}<h2>{options==='settings'?'Privacy & notifications':'Your workspace'}</h2><button aria-label="Close profile tools" data-autofocus onClick={()=>setOptions(null)}><X size={22}/></button></header><div className="rp-options-body">{options==='menu'&&!professional?<nav aria-label="Your tools"><button onClick={()=>chooseTab('contracts')}><BriefcaseBusiness size={20}/><span><strong>Your contracts</strong><small>Private proposals, team and progress</small></span></button><button onClick={()=>setOptions('settings')}><ShieldCheck size={20}/><span><strong>Privacy & notifications</strong></span></button></nav>:options==='menu'?<><div className="rp-options-identity"><Avatar member={state.member}/><span><strong>{state.member.name}</strong><small>@{state.member.handle}</small></span></div><nav aria-label="Profile tools"><button onClick={()=>{setSuiteView('market');chooseTab('opportunities');}}><BriefcaseBusiness size={20}/><span><strong>Work & market</strong><small>Projects, jobs, products and your listings</small></span><ArrowRight size={17}/></button><button onClick={()=>chooseTab('network')}><Users size={20}/><span><strong>My network</strong><small>Connections, invitations and recommendations</small></span><ArrowRight size={17}/></button><button onClick={()=>chooseFeed('jobs')}><Search size={20}/><span><strong>My jobs</strong><small>Opportunities matched to your work</small></span><ArrowRight size={17}/></button><button onClick={()=>chooseFeed('applications')}><FileCheck2 size={20}/><span><strong>Apply Status</strong><small>Your applications, reviews and offers</small></span><ArrowRight size={17}/></button><button onClick={()=>{setSuiteView('companies');chooseTab('opportunities');}}><Building2 size={20}/><span><strong>Companies</strong><small>Business pages and your connections</small></span><ArrowRight size={17}/></button><button onClick={()=>chooseTab('notifications')}><Bell size={20}/><span><strong>Notifications</strong><small>Updates from your community</small></span>{state.unreadCount?<span className="rp-menu-count">{state.unreadCount}</span>:<ArrowRight size={17}/>}</button><button onClick={()=>chooseFeed('liked')}><ThumbsUp size={20}/><span><strong>Interests</strong><small>Publications you have liked</small></span><ArrowRight size={17}/></button><button onClick={()=>setOptions('settings')}><ShieldCheck size={20}/><span><strong>Privacy & notifications</strong><small>Messages, preferences and blocked members</small></span><ArrowRight size={17}/></button></nav></>:<ProfileSettings key={account}><ProfessionalVisibilityPrivacy accountKey={account}/>{professional&&<><NetworkPreferencesPanel accountKey={account}/><WorkPreferences accountKey={account}/></>}</ProfileSettings>}</div></Modal>}
      {notice&&<div className="rp-toast" role="status">{notice}</div>}
      {storyId&&state&&!locked&&<StoryViewer stories={stories} initialId={storyId} memberFor={memberFor} onClose={()=>setStoryId(null)} suspended={!!upgrade} onReply={async(member,text)=>{if(!proAction('Reply to stories and start real conversations.',()=>{}))return false;const ok=await act('reply:'+member.id,()=>sendMessage(account,member.id,text));if(ok)setNotice('Reply sent.');return ok;}}/>}
      {comments&&state&&!locked&&<CommentsDrawer account={account} targetId={comments} memberFor={memberFor} onMembers={addMembers} onClose={()=>setComments(null)}/>}
      {recipient&&professional&&!locked&&state&&<MessageDrawer account={account} selfId={state.member.id} recipient={recipient} canSend={hasAccess} onMembers={addMembers} onUpgrade={()=>setUpgrade('Send messages and build lasting connections with Pro.')} onClose={()=>setRecipient(null)}/>}
      {studio&&professional&&hasAccess&&!locked&&state&&<PublishingStudio account={account} initialKind={studio} initialReference={attachedReference} onDestination={destination} onManage={manage} defaultTrade={state.member.trade} city={city} onClose={()=>{setStudio(null);setAttachedReference(undefined);}} onPublished={kind=>{setStudio(null);setAttachedReference(undefined);setTab(kind==='reel'?'reels':kind==='tender'?'tenders':'feed');setGenre('all');setMode('all');setNotice('Published to Repaidians.');setRevision(v=>v+1);}}/>}
      {detail&&!locked&&state&&<Modal title="Publication" className="rp-dialog rp-publication-detail" onClose={()=>setDetail(null)}><Feed professionalActions={professional} renderAttachment={attachment} suspended={!!(recipient||comments||studio||upgrade||confirm)} posts={[detail]} activity={state.activity} memberFor={memberFor} currentMemberId={state.member.id} onProfile={id=>{setDetail(null);openProfile(id);}} onLike={like} onSave={save} onComments={id=>{if(professional&&signed())setComments(id);}} onShare={post=>void share(post)} onCreate={()=>create()} onDelete={id=>setConfirm({kind:'delete',id})} onReport={id=>{if(signed())setConfirm({kind:'report',id});}}/></Modal>}
      {upgrade&&state?.authenticated&&<SubscriptionModal reason={upgrade} onClose={()=>setUpgrade('')} onActivated={()=>{void refresh();setUpgrade('');setNotice('Repaidians Pro is active.');}}/>}
      {confirm&&<Modal title={confirm.kind==='delete'?'Delete publication':confirm.kind==='block'?'Block member':'Report publication'} className="rp-dialog" onClose={()=>!confirmBusy&&setConfirm(null)}><p>{confirm.kind==='delete'?'This publication and its media will be removed from the community.':confirm.kind==='block'?'This member’s content and messages will be hidden. They cannot interact with you while blocked.':'Tell us why this publication needs a review.'}</p>{confirm.kind==='report'&&<label>Reason<select value={reason} onChange={e=>setReason(e.target.value)}>{['spam','harassment','unsafe','fraud','other'].map(value=><option key={value} value={value}>{value[0].toUpperCase()+value.slice(1)}</option>)}</select></label>}<button className="rp-primary" disabled={confirmBusy} onClick={()=>void confirmAction()}>{confirmBusy?'Saving…':confirm.kind==='delete'?'Delete publication':confirm.kind==='block'?'Block member':'Submit report'}</button><button className="rp-secondary" disabled={confirmBusy} onClick={()=>setConfirm(null)}>Cancel</button></Modal>}
    </div>
  </Modal>;
}
