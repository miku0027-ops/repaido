// Local-only QA gallery: production components and every application icon export.
import {createRoot} from 'react-dom/client';
import {useState, type ComponentType, type SVGProps} from 'react';
import * as Icons from '../src/icons';
import {CustomerSearchField, Modal} from '../src/components/ui';
import {BusinessTabs, InlineNotice} from '../src/components/BusinessUI';
import ServiceStories from '../src/components/ServiceStories';
import {StoresIcon} from '../src/components/StoresIcon';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/components/customer-bookings.css';
import '../src/spacing.css';
import '../src/strokes.css';
import '../src/customer-layout.css';
import '../src/components/support-workspace.css';
import '../src/components/captain-club.css';

type LabIcon=ComponentType<SVGProps<SVGSVGElement>&{size?:number;filled?:boolean;strokeWidth?:number;absoluteStrokeWidth?:boolean;title?:string}>;
const exports=Object.entries(Icons).filter(([name,value])=>/^[A-Z]/.test(name)&&(typeof value==='function'||(value&&typeof value==='object'&&'$$typeof' in value))) as [string,LabIcon][];
const icon=(...names:string[]):LabIcon=>{const found=names.map(name=>(Icons as unknown as Record<string,LabIcon>)[name]).find(Boolean);if(!found)throw Error('Missing QA icon: '+names.join('/'));return found;};
const Search=icon('Search'),Close=icon('X'),Mail=icon('Mail'),Grid=icon('LayoutGrid'),Wrench=icon('Wrench'),Calendar=icon('CalendarDays'),Briefcase=icon('BriefcaseBusiness'),Bell=icon('Bell'),Cart=icon('ShoppingCart'),Account=icon('UserRound'),Chevron=icon('ChevronDown'),Heart=icon('Heart'),Bookmark=icon('Bookmark'),Star=icon('Star');
function Lab(){
 const [search,setSearch]=useState('AC service'),[tab,setTab]=useState('services'),[modal,setModal]=useState(false),[category,setCategory]=useState('all'),[selected,setSelected]=useState<Record<string,boolean>>({});
 const navigation=[{id:'explore',label:'Explore',Icon:Grid},{id:'services',label:'Services',Icon:Wrench},{id:'bookings',label:'Bookings',Icon:Calendar},{id:'market',label:'Market',Icon:StoresIcon},{id:'hire',label:'Hire',Icon:Briefcase}];
 return <main className="repaido-customer-shell" id="icon-lab" style={{maxWidth:1200,margin:'auto',padding:'16px 16px 110px'}}>
  <style>{`.icon-lab-section{margin:0 0 24px;padding:16px;border:1px solid var(--ui-line);border-radius:16px;background:var(--ui-surface);min-width:0}.icon-lab-section h2{font-size:1rem;margin:0 0 14px}.icon-lab-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,110px),1fr));gap:8px}.icon-lab-cell{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:10px 4px;min-height:80px;background:var(--ui-subtle);border-radius:10px}.icon-lab-cell code{font-size:10px;max-width:100%;overflow-wrap:anywhere;text-align:center}.icon-lab-inline{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.icon-lab-inline button{min-height:44px;min-width:44px}.icon-lab-pair{display:inline-flex;align-items:center;gap:6px}.icon-lab-size{display:inline-flex;align-items:center;justify-content:center;min-width:40px;min-height:44px}.icon-lab-controls{display:flex;align-items:center;flex-wrap:wrap;gap:10px}.icon-lab-controls>*{min-width:0}.icon-lab-actions{position:static!important}.icon-lab-nav{position:relative!important;bottom:auto!important;left:auto!important;width:100%!important;display:flex!important;margin-top:30px}.icon-lab-nav .android-nav-item{display:flex;flex-direction:column;align-items:center;justify-content:center}.icon-lab-nav .customer-support-fab{position:absolute}.icon-lab-section .business-tabs button{min-height:44px}.icon-lab-section [data-expected-size]{flex-shrink:0}`}</style>
  <h1 style={{fontSize:'1.25rem',marginBottom:20}}>Icon system</h1>
  <section className="icon-lab-section" aria-labelledby="control-heading"><h2 id="control-heading">Production controls</h2>
   <CustomerSearchField label="Search services" value={search} onChange={setSearch} placeholder="Search services"/>
   <div className="icon-lab-controls" style={{marginTop:16}}>
    <div className="repaido-header-actions icon-lab-actions"><button aria-label="Shopping cart" className="repaido-cart-btn"><Cart size={24}/></button><button aria-label="Notifications" className="repaido-bell-btn"><Bell size={24}/></button><button aria-label="Your account" className="repaido-header-signin-btn"><Account size={24}/></button></div>
    <button className="button-secondary" onClick={()=>setModal(true)}><Mail size={18}/>Message seller</button><button className="button-secondary" aria-label="Search catalogue"><Search size={20}/></button>
   </div>
   <BusinessTabs label="Icon tabs" value={tab} items={navigation.map(({id,label,Icon})=>({id,label,icon:<Icon size={18}/>}))} onChange={setTab}/>
   <ServiceStories compact services={[]} selected={category} onSelect={setCategory} title="Service filters" sort="recommended" onSort={()=>{}}/>
   <InlineNotice>Icons accompany text without duplicate spoken labels.</InlineNotice>
   <nav className="android-bottom-nav icon-lab-nav" aria-label="Icon dock" data-captain-gold="false">{navigation.map(({id,label,Icon})=><button key={id} className={'android-nav-item'+(id===tab?' active':'')} aria-current={id===tab?'page':undefined} onClick={()=>setTab(id)}><Icon size={20}/><span>{label}</span></button>)}</nav>
  </section>
  <section className="icon-lab-section" aria-labelledby="size-heading"><h2 id="size-heading">Small glyphs retain large controls</h2><div className="icon-lab-inline" id="icon-size-scale">{[14,16,18,20,24,28,32].map(size=><span key={size} className="icon-lab-size"><Search size={size} data-expected-size={size}/><span className="sr-only">{size} pixels</span></span>)}</div><p className="icon-lab-inline"><span className="icon-lab-pair"><Search size={14}/>Inline search</span><span className="icon-lab-pair"><Chevron className="w-3.5 h-3.5" data-expected-size="14"/>Menu</span><span className="icon-lab-pair"><Calendar className="size-5" data-expected-size="20"/>Booking</span></p></section>
  <section className="icon-lab-section" aria-labelledby="accessibility-heading"><h2 id="accessibility-heading">Accessible labels</h2><div className="icon-lab-inline"><span data-lab="decorative"><Search size={24}/></span><span data-lab="title"><Mail title="Seller messages"/></span><span data-lab="title"><Mail title="Support messages"/></span><span data-lab="aria"><Account aria-label="Your public profile"/></span><span data-lab="legacy"><Wrench size={24} strokeWidth={8} absoluteStrokeWidth/></span></div></section>
  <section className="icon-lab-section" aria-labelledby="selected-heading"><h2 id="selected-heading">Saved and rated states</h2><div className="icon-lab-inline" id="icon-state-controls">{[{id:'heart',label:'Like item',Icon:Heart},{id:'bookmark',label:'Save item',Icon:Bookmark},{id:'star',label:'Rate item',Icon:Star}].map(({id,label,Icon})=><button key={id} className="button-secondary" aria-label={label} aria-pressed={Boolean(selected[id])} onClick={()=>setSelected(old=>({...old,[id]:!old[id]}))}><Icon size={24} filled={Boolean(selected[id])}/></button>)}</div><div className="icon-lab-inline" data-lab="legacy-selected"><Heart size={24} fill="none"/><Heart size={24} fill="currentColor"/><Bookmark size={24} fill="none"/><Bookmark size={24} fill="currentColor"/><Star size={24} fill="none"/><Star size={24} fill="currentColor"/></div></section>
  <section className="icon-lab-section" aria-labelledby="gallery-heading"><h2 id="gallery-heading">Application symbols ({exports.length})</h2><div className="icon-lab-grid" id="all-application-icons">{exports.map(([name,Icon])=><div className="icon-lab-cell" data-export-name={name} key={name}><Icon size={24}/><code>{name}</code></div>)}</div></section>
  {modal&&<Modal title="Contact seller" onClose={()=>setModal(false)}><p>Your message stays with the listed item.</p><button className="button-primary" onClick={()=>setModal(false)}><Mail size={18}/>Continue to messages</button><button className="button-secondary" onClick={()=>setModal(false)}><Close size={16}/>Cancel</button></Modal>}
 </main>;
}
createRoot(document.getElementById('root')!).render(<Lab/>);
