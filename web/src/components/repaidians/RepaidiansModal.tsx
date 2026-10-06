import {useEffect,useState,type CSSProperties} from 'react';
import {Bookmark,BriefcaseBusiness,Clapperboard,Clock3,Infinity,LayoutGrid,LockKeyhole,Plus,User,Users,X} from 'lucide-react';
import {Modal} from '../ui';
import type {Professional} from '../Hiring';
import {apiAssetUrl} from '../../services/api';
import {hireProfiles} from '../../services/hireProfileCache';
import {chargeBrowsing,follow,snapshot,subscribe,toggleActivity,trades,visibleItems,bid,sendMessage} from '../../services/repaidiansService';
import type {CommunityMember,CommunityPost,CommunitySnapshot,CommunityTab,StudioKind,Trade} from '../../types/repaidians';
import {tokens} from '../../tokens';
import {Feed} from './Feed';
import {StoriesTray,StoryViewer} from './Stories';
import {Reels} from './Reels';
import {Tenders} from './Tenders';
import {Profile} from './Profile';
import {PublishingStudio} from './PublishingStudio';
import {CommentsDrawer,MessageDrawer} from './CommentsDrawer';
import {SubscriptionModal} from './SubscriptionModal';
import './repaidians.css';

export default function RepaidiansModal({account,name,city,onClose,onBook}:{account:string;name:string;city:string;onClose:()=>void;onBook:(trade:Trade)=>void}) {
  const [state,setState]=useState<CommunitySnapshot>(()=>snapshot(account,name)),[tab,setTab]=useState<CommunityTab>('feed'),[genre,setGenre]=useState<Trade|'all'>('all'),[mode,setMode]=useState<'explore'|'following'|'saved'>('explore');
  const [profiles,setProfiles]=useState<Professional[]>([]),[profileId,setProfileId]=useState<string|null>(null),[storyId,setStoryId]=useState<string|null>(null),[comments,setComments]=useState<string|null>(null),[recipient,setRecipient]=useState<CommunityMember|null>(null);
  const [studio,setStudio]=useState<StudioKind|null>(null),[upgrade,setUpgrade]=useState(''),[notice,setNotice]=useState('');
  const paid=!!state.subscription,locked=!paid&&state.remainingMs<=0;
  useEffect(()=>{
    const refresh=()=>setState(snapshot(account,name));refresh();
    const unsubscribe=subscribe(refresh);
    let last=Date.now(),visible=!document.hidden;
    const tick=()=>{const now=Date.now();try{if(visible)chargeBrowsing(account,last,now);refresh();}catch(e){setNotice((e as Error).message);}last=now;};
    const onVisibility=()=>{tick();visible=!document.hidden;};
    const timer=setInterval(tick,1000);document.addEventListener('visibilitychange',onVisibility);
    return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',onVisibility);unsubscribe();if(visible)try{chargeBrowsing(account,last,Date.now());}catch{}};
  },[account,name]);
  useEffect(()=>{let active=true;void hireProfiles<{professionals:Professional[]}>({city}).then(data=>{if(active)setProfiles(data.professionals);}).catch(()=>{});return()=>{active=false;};},[city]);
  useEffect(()=>{if(locked){setStoryId(null);setComments(null);setRecipient(null);setStudio(null);setUpgrade('Your 15 minutes of free browsing are used for today. Come back after midnight or try Pro.');}},[locked]);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),5000);return()=>clearTimeout(timer);},[notice]);
  const normalize=(value:string)=>value.toLocaleLowerCase().replace(/[^a-z]/g,'');
  const memberFor=(id:string):CommunityMember=>{
    if(id===state.member.id)return state.member;
    const member=state.data.members.find(m=>m.id===id)||{...state.member,id,name:'Community member',handle:'local_member'};
    const live=profiles.find(p=>normalize(p.name)===normalize(member.name));
    return live?{...member,registeredId:live.id,reviewed:true,role:live.contractor_verified?'Contractor':live.role,completedTasks:live.completed_tasks,rating:live.rating,avatarUrl:live.portrait_url?apiAssetUrl(live.portrait_url):member.avatarUrl,bio:live.bio||member.bio}:member;
  };
  const act=(action:()=>void)=>{try{action();}catch(e){setNotice((e as Error).message);}};
  const proAction=(reason:string,action:()=>void):boolean=>{if(!paid){setUpgrade(reason);return false;}try{action();return true;}catch(e){setNotice((e as Error).message);return false;}};
  const create=(kind:StudioKind='post')=>proAction('Publish posts, work reels, stories and tender requirements with Repaidians Pro.',()=>setStudio(kind));
  const message=(member:CommunityMember)=>proAction('Direct message previews are available with Repaidians Pro.',()=>{setStoryId(null);setRecipient(member);});
  const openProfile=(id:string)=>{setProfileId(id);setTab('profile');};
  const share=async(post:CommunityPost)=>{
    const data={title:'Repaidians · '+memberFor(post.authorId).name,text:post.caption+' (Repaidians local preview)',url:location.origin+'/?repaidians='+encodeURIComponent(post.id)};
    try{if(navigator.share)await navigator.share(data);else{await navigator.clipboard.writeText(data.text+' '+data.url);setNotice('Preview link copied. Local posts are available only on this device.');}}catch(e){if((e as Error).name!=='AbortError')setNotice('Sharing is unavailable in this browser.');}
  };
  const stories=visibleItems(state.data.stories.filter(s=>s.expiresAt>Date.now()),state.member);
  let posts=visibleItems(state.data.posts,state.member,genre);
  if(mode==='following')posts=posts.filter(p=>state.activity.following.includes(p.authorId));
  if(mode==='saved')posts=posts.filter(p=>state.activity.saved.includes(p.id));
  const profile=memberFor(profileId||state.member.id);
  return <Modal title="Repaidians community" frameless className="rp-shell" onClose={onClose}>
    <div className="rp-shell-inner" style={{'--rp-panel-radius':tokens.radius.container+'px'} as CSSProperties}>
      <header className="rp-header"><div className="rp-wordmark"><span><Users size={16}/> REPAIDO COMMUNITY</span><h1>Repaidians<span className="rp-wordmark-dot"/></h1></div><button className="rp-close" aria-label="Close Repaidians" data-autofocus onClick={onClose}><X size={22}/></button></header>
      <div className="rp-toolbar"><button className="rp-quota" onClick={()=>setUpgrade(paid?'Your demo Pro preview is active until '+new Date(state.subscription!.endsAt).toLocaleDateString('en-IN')+'.':'Explore Repaidians Pro for unlimited browsing and more.')}><span>{paid?<Infinity size={15}/>:<Clock3 size={15}/>}</span>{paid?'Demo Pro':Math.ceil(state.remainingMs/60000)+'m left today'}</button><button className="rp-create" onClick={()=>create()}><Plus size={18}/>Create</button></div>
      <main className="rp-content" data-reels={tab==='reels'}>{locked?<div className="rp-locked"><LockKeyhole size={34}/><h2>See you after midnight?</h2><p>You’ve used today’s 15 minutes. Your saved items and profile will be here when you return.</p><button className="rp-primary" onClick={()=>setUpgrade('Try Repaidians Pro for unlimited browsing and community tools.')}>Explore Pro · ₹199/month</button><button className="rp-secondary" onClick={onClose}>Back to Repaido</button></div>:<>
        {tab==='feed'&&<><StoriesTray stories={stories} memberFor={memberFor} onOpen={setStoryId} onCreate={()=>create('story')}/><div className="rp-feed-intro"><div><span className="rp-kicker">CRAFT. CARE. COMMUNITY.</span><h2>Made by people who care.</h2></div></div><div className="rp-preview-note">Community preview · sample posts and local interactions.</div><div className="rp-feed-modes" role="group" aria-label="Feed source">{([{id:'explore',label:'Explore',icon:LayoutGrid},{id:'following',label:'Following',icon:Users},{id:'saved',label:'Saved',icon:Bookmark}] as const).map(item=><button key={item.id} aria-pressed={mode===item.id} onClick={()=>setMode(item.id)}><item.icon size={15}/>{item.label}</button>)}</div></>}
        {(tab==='feed'||tab==='tenders'||tab==='reels')&&<div className="rp-genres" role="group" aria-label="Filter by trade"><button aria-pressed={genre==='all'} onClick={()=>setGenre('all')}>All trades</button>{trades.map(trade=><button key={trade.id} aria-pressed={genre===trade.id} onClick={()=>setGenre(trade.id)}>{trade.name}</button>)}</div>}
        {tab==='feed'&&<Feed posts={posts} activity={state.activity} memberFor={memberFor} onProfile={openProfile} onLike={id=>act(()=>toggleActivity(account,'likes',id))} onSave={id=>act(()=>toggleActivity(account,'saved',id))} onComments={setComments} onShare={post=>void share(post)} onCreate={()=>create()}/>}
        {tab==='reels'&&<Reels reels={visibleItems(state.data.reels,state.member,genre)} likes={state.activity.likes} memberFor={memberFor} onLike={id=>act(()=>toggleActivity(account,'likes',id))} onComments={setComments} onProfile={openProfile} onBook={reel=>onBook(reel.trade)} onCreate={()=>create('reel')}/>}
        {tab==='tenders'&&<Tenders paid={paid} tenders={visibleItems(state.data.tenders,state.member,genre)} bids={state.activity.bids} memberFor={memberFor} onProfile={openProfile} onBid={id=>proAction('Bid on crew requirements and tenders with Repaidians Pro.',()=>{bid(account,id);setNotice('Interest saved on this device. No bid has been sent.');})} onContact={()=>proAction('Tender contact details are available with Repaidians Pro.',()=>{})} onCreate={()=>create('tender')}/>}
        {tab==='profile'&&<Profile key={profile.id} account={account} member={profile} self={profile.id===state.member.id} posts={visibleItems(state.data.posts,state.member)} following={state.activity.following.includes(profile.id)} followingCount={state.data.follows.filter(edge=>edge.from===profile.id).length} followersCount={state.data.follows.filter(edge=>edge.to===profile.id).length} onBack={()=>setTab('feed')} onFollow={()=>act(()=>follow(account,profile.id))} onMessage={()=>message(profile)} onBook={()=>onBook(profile.trade)} onCreate={()=>create()}/>}
      </>}</main>
      <nav className="rp-bottom-nav" aria-label="Repaidians sections">{([{id:'feed',label:'Feed',icon:LayoutGrid},{id:'reels',label:'Reels',icon:Clapperboard},{id:'tenders',label:'Tenders',icon:BriefcaseBusiness},{id:'profile',label:'My profile',icon:User}] as const).map(item=><button key={item.id} aria-current={tab===item.id?'page':undefined} disabled={locked} onClick={()=>{setTab(item.id);if(item.id==='profile')setProfileId(null);}}><item.icon size={20}/><span>{item.label}</span></button>)}</nav>
      {notice&&<div className="rp-toast" role="status">{notice}</div>}
      {storyId&&!locked&&<StoryViewer stories={stories} initialId={storyId} memberFor={memberFor} onClose={()=>setStoryId(null)} suspended={!!upgrade} onReply={(member,text)=>proAction('Story replies are available with Repaidians Pro.',()=>{sendMessage(account,member.id,text);setNotice('Reply saved locally. It has not been delivered.');})}/>}
      {comments&&!locked&&<CommentsDrawer account={account} targetId={comments} comments={state.data.comments} memberFor={memberFor} onClose={()=>setComments(null)}/>}
      {recipient&&paid&&!locked&&<MessageDrawer account={account} recipient={recipient} messages={state.activity.messages} onClose={()=>setRecipient(null)}/>}
      {studio&&paid&&!locked&&<PublishingStudio account={account} initialKind={studio} defaultTrade={state.member.trade} city={city} onClose={()=>setStudio(null)} onPublished={kind=>{setStudio(null);setTab(kind==='reel'?'reels':kind==='tender'?'tenders':'feed');setGenre('all');setMode('explore');setNotice('Published on this device.');}}/>}
      {upgrade&&<SubscriptionModal account={account} reason={upgrade} onClose={()=>setUpgrade('')} onActivated={()=>{setState(snapshot(account,name));setUpgrade('');setNotice('Demo Pro activated. No payment was taken.');}}/>}
    </div>
  </Modal>;
}
