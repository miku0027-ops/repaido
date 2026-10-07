const ist = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'});
export function contractDayKey(seconds){
 if(!Number.isFinite(seconds)||seconds<=0)return '';
 const parts=Object.fromEntries(ist.formatToParts(new Date(seconds*1000)).map(p=>[p.type,p.value]));
 return `${parts.year}-${parts.month}-${parts.day}`;
}
export function contractMonthDays(month){
 if(!/^\d{4}-\d{2}$/.test(month))return [];
 const [year,number]=month.split('-').map(Number);
 if(number<1||number>12)return [];
 const start=new Date(Date.UTC(year,number-1,1)),offset=(start.getUTCDay()+6)%7;
 const length=new Date(Date.UTC(year,number,0)).getUTCDate(),cells=Math.ceil((offset+length)/7)*7;
 return Array.from({length:cells},(_,i)=>{const day=i-offset+1;return day<1||day>length?null:`${month}-${String(day).padStart(2,'0')}`;});
}
export function shiftContractMonth(month,delta){
 const [year,number]=month.split('-').map(Number),date=new Date(Date.UTC(year,number-1+delta,1));
 return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}`;
}
export function contractCalendarEvents(record){
 const events=[];
 const add=(id,at,kind,title,detail='',amount=null)=>{const day=contractDayKey(at);if(day)events.push({id,at,day,kind,title,detail,amount});};
 const status=s=>String(s||'recorded').replaceAll('_',' ');
 add('award',record.project.awarded_at,'work','Contract awarded');
 add('start',record.project.starts_at,'work','Planned work starts');
 add('end',record.project.ends_at,'work','Planned contract deadline');
 for(const m of record.milestones||[]){add('due:'+m.id,m.due_at,'work',m.title+' · deadline',status(m.status));add('submitted:'+m.id,m.submitted_at,'work',m.title+' · submitted');add('review:'+m.id,m.reviewed_at,'work',m.title+' · reviewed',status(m.status));}
 for(const r of record.progress||[]){add('progress:'+r.id,r.created_at,'work',r.percent+'% reported progress',r.note+' · '+status(r.status));add('progress-review:'+r.id,r.reviewed_at,'work','Progress reviewed',status(r.status)+(r.review_note?' · '+r.review_note:''));}
 for(const p of record.payments||[]){add('payment:'+p.id,p.created_at,'payment','Payment requested',status(p.status)+' · '+String(p.method).toUpperCase(),p.amount_paise);add('payment-approved:'+p.id,p.approved_at,'payment','Payment request decision',status(p.status));add('payment-reported:'+p.id,p.reported_at,'payment','Bank transfer reported','Awaiting independent verification');add('paid:'+p.id,p.confirmed_at,'payment','Payment confirmed',String(p.method).toUpperCase()+' · '+(p.source||'Recorded confirmation'),p.amount_paise);}
 for(const p of record.purchases||[]){add('purchase:'+p.id,p.purchased_at,'purchase',p.title,[p.vendor,'Receipt '+p.receipt_reference,status(p.status)].filter(Boolean).join(' · '),p.amount_paise);add('purchase-review:'+p.id,p.reviewed_at,'purchase','Purchase reviewed · '+p.title,status(p.status));}
 const names=new Map((record.team||[]).map(m=>[m.worker_id,m.name||'Team member']));
 for(const m of record.team||[])add('team:'+m.worker_id,m.accepted_at,'work',(m.name||'Team member')+' joined the team',status(m.role));
 (record.attendance||[]).forEach((a,i)=>{add('arrival:'+i,a.in_at,'work',(names.get(a.worker_id)||'Team member')+' · check-in','Member-reported attendance');add('departure:'+i,a.out_at,'work',(names.get(a.worker_id)||'Team member')+' · check-out','Member-reported attendance');});
 (record.timeline||[]).forEach((e,i)=>add('event:'+i,e.at||e.occurred_at_server_time,'work',status(e.action||e.event_type),e.note||''));
 return events.sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id));
}
