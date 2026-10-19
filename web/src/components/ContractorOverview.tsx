import {useState} from 'react';
import {CalendarDays,ChevronRight,Folder,Gavel,Handshake,Target,Users} from '../icons';

type Row=Record<string,any>;
type Goal=Row&{project:Row};
const open=(project:Row)=>!['completed','cancelled'].includes(project.status);
const members=(project:Row)=>new Set(project.team.filter((member:Row)=>member.status==='accepted').map((member:Row)=>member.worker_id)).size;
const day=(value:number)=>new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',timeZone:'Asia/Kolkata'}).format(value*1000);
const time=(value:number)=>new Intl.DateTimeFormat('en-IN',{hour:'numeric',minute:'2-digit',timeZone:'Asia/Kolkata'}).format(value*1000);
const sameDay=(a:number,b:number)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(a*1000)===new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(b*1000);
export const contractorGoals=(projects:Row[]):Goal[]=>projects.filter(open).flatMap(project=>project.goals.filter((goal:Row)=>goal.status!=='approved').map((goal:Row)=>({...goal,project}))).sort((a,b)=>a.due_at-b.due_at);

function Deadline({goal,now,onOpen}:{goal:Goal;now:number;onOpen:(id:string)=>void}){
 const overdue=goal.due_at<now;
 return <button className="contractor-agenda-row" onClick={()=>onOpen(goal.project.id)}>
  <span className="contractor-date-tile" aria-hidden="true"><CalendarDays size={18}/><span>{day(goal.due_at)}</span></span>
  <span className="contractor-row-copy"><strong>{goal.title}</strong><small>{goal.project.title}</small><span className="contractor-row-time" data-overdue={overdue||undefined}>{overdue?'Overdue · ':sameDay(goal.due_at,now)?'Today · ':''}<time dateTime={new Date(goal.due_at*1000).toISOString()}>{day(goal.due_at)}, {time(goal.due_at)} IST</time>{goal.status==='submitted'?' · Needs review':''}</span></span>
  <ChevronRight size={18} aria-hidden="true"/>
 </button>;
}

export function ContractorOverview({projects,tenders,uid,canContract,now,onNavigate,onProject}:{projects:Row[];tenders:Row[];uid:string;canContract:boolean;now:number;onNavigate:(tab:string,filter?:string)=>void;onProject:(id:string)=>void}){
 const ownedOpen=projects.filter(project=>project.owner_id===uid&&open(project));
 const goals=contractorGoals(projects);
 const stats=[
  {label:'Projects',name:'Open projects',value:ownedOpen.length,action:()=>onNavigate('Projects','open')},
  {label:'Team',name:'Current team placements',value:ownedOpen.reduce((count,project)=>count+members(project),0),action:()=>onNavigate('Team & HR')},
  {label:'Bids',name:'Pending tender bids',value:tenders.filter(tender=>tender.status==='open'&&tender.bids.some((bid:Row)=>bid.contractor_id===uid&&bid.status==='submitted')).length,action:()=>onNavigate('Tenders','bids')},
  {label:'Due',name:'Due milestones',value:goals.length,action:()=>onNavigate('Team & HR')}
 ];
 return <div className="contractor-overview">
  <div className="contractor-stat-rail" role="group" aria-label="Workspace summary">{stats.map(stat=><button key={stat.label} aria-label={`${stat.name}: ${stat.value}`} onClick={stat.action}><strong>{stat.value}</strong><span>{stat.label}</span></button>)}</div>
  <section className="contractor-action-panel" aria-labelledby="contractor-actions-title">
   <h2 id="contractor-actions-title">Quick access</h2>
   <div className="contractor-shortcuts">{[
    {label:'Projects',icon:Folder,tone:'blue',action:()=>onNavigate('Projects')},
    {label:'Team hiring',icon:Users,tone:'green',action:()=>onNavigate('Hiring')},
    {label:'Customer matches',icon:Handshake,tone:'green',action:()=>onNavigate('Customer contracts'),disabled:!canContract},
    {label:'Tenders',icon:Gavel,tone:'amber',action:()=>onNavigate('Tenders')}
   ].map(item=><button className="contractor-shortcut" key={item.label} disabled={item.disabled} aria-describedby={item.disabled?'contractor-matches-locked':undefined} onClick={item.action}><span className="contractor-shortcut-icon" data-tone={item.tone}><item.icon size={21} aria-hidden="true"/></span><span>{item.label}</span><ChevronRight size={16} aria-hidden="true"/></button>)}</div>
   {!canContract&&<p id="contractor-matches-locked" className="contractor-access-note">Customer matches unlock after contractor approval.</p>}
  </section>
  <section className="contractor-agenda-panel" aria-labelledby="contractor-next-title">
   <div className="contractor-section-heading"><h2 id="contractor-next-title">Next deadline</h2><button onClick={()=>onNavigate('Team & HR')}><CalendarDays size={17} aria-hidden="true"/>Calendar<ChevronRight size={16} aria-hidden="true"/></button></div>
   {goals.length?<Deadline goal={goals[0]} now={now} onOpen={onProject}/>:<div className="contractor-agenda-empty"><CalendarDays size={20} aria-hidden="true"/><p>No upcoming deadlines</p></div>}
  </section>
 </div>;
}

/** An actual agenda, using the same authorized project snapshot as the workspace. */
export function ContractorAgenda({projects,now,onProject}:{projects:Row[];now:number;onProject:(id:string)=>void}){
 const [kind,setKind]=useState('all'),[page,setPage]=useState(0);
 const milestones=contractorGoals(projects).map(goal=>({id:`goal-${goal.project.id}-${goal.id}`,at:goal.due_at,goal}));
 const work=projects.filter(open).map(project=>({id:`work-${project.id}`,at:project.starts_at>now?project.starts_at:project.ends_at,project}));
 const entries=[...(kind==='work'?[]:milestones),...(kind==='milestones'?[]:work)].sort((a,b)=>a.at-b.at);
 const last=Math.max(0,Math.ceil(entries.length/8)-1),current=Math.min(page,last);
 return <section className="contractor-agenda-panel contractor-full-agenda" aria-label="Project calendar">
  <div className="contractor-section-heading"><h2>Schedule</h2><select aria-label="Calendar entries" value={kind} onChange={event=>{setKind(event.target.value);setPage(0);}}><option value="all">All dates</option><option value="milestones">Milestones</option><option value="work">Work dates</option></select></div>
  <p className="contractor-schedule-zone">India time · IST</p>
  {entries.slice(current*8,current*8+8).map(entry=>'goal' in entry?<Deadline key={entry.id} goal={entry.goal} now={now} onOpen={onProject}/>:<button className="contractor-agenda-row" key={entry.id} onClick={()=>onProject(entry.project.id)}><span className="contractor-date-tile" aria-hidden="true"><Folder size={18}/><span>{day(entry.at)}</span></span><span className="contractor-row-copy"><strong>{entry.project.title}</strong><small>{entry.project.starts_at>now?'Work starts':entry.project.ends_at<now?'Work window ended':'Work ends'} · <time dateTime={new Date(entry.at*1000).toISOString()}>{day(entry.at)}, {time(entry.at)} IST</time></small></span><ChevronRight size={18} aria-hidden="true"/></button>)}
  {!entries.length&&<div className="contractor-agenda-empty"><Target size={20} aria-hidden="true"/><p>{kind==='milestones'?'No unfinished milestones':kind==='work'?'No open work dates':'No scheduled work yet'}</p></div>}
  {last>0&&<nav className="contractor-pagination" aria-label="Calendar pages"><button disabled={!current} onClick={()=>setPage(current-1)}>Previous</button><span>{current*8+1}–{Math.min(current*8+8,entries.length)} of {entries.length}</span><button disabled={current===last} onClick={()=>setPage(current+1)}>Next</button></nav>}
 </section>;
}
