with open('web/src/components/OperationalJobs.tsx', 'r') as f:
    content = f.read()

import re

# Find the start of the Modal div
start_idx = content.find('{detail&&<Modal title={detail.service_name} onClose={()=>setSelected(null)}><div className="operations ops-detail">')
if start_idx == -1:
    print("Could not find start")
    exit(1)

# Find the end of the Modal div
end_idx = content.find('</div></Modal>}', start_idx)
if end_idx == -1:
    print("Could not find end")
    exit(1)

old_modal = content[start_idx:end_idx+len('</div></Modal>}')]

new_modal = """{detail&&<Modal title={detail.service_name} onClose={()=>setSelected(null)}><div className="operations ops-detail">
        <div className="ops-card" style={{marginTop:0, paddingBottom: 16}}>
          <span className="ops-badge">{labels[detail.state]}</span>
          {!worker&&<CustomerTaskProgress job={detail}/>}
          <p style={{marginBottom:0}}><Clock3 size={16}/> {new Date(detail.starts_at).toLocaleString('en-IN')}</p>
          {detail.address&&<p><MapPin size={16}/> {detail.address}</p>}
          {detail.offer_expires_at&&detail.state==='offered'&&<p role="timer" style={{color:'#70120b',fontWeight:700}}>Offer expires in {Math.max(0,Math.ceil((detail.offer_expires_at-now)/60))} minutes</p>}
        </div>

        {(detail.allowed_actions.length > 0 || (worker && ['accepted','follow_up_scheduled'].includes(detail.state))) && (
          <div className="ops-card" style={{borderColor:'var(--op-blue)',borderWidth:'2px', padding:'24px 20px'}}>
            <h3 style={{marginTop:0, color:'var(--op-blue)'}}>Current Step</h3>
            {worker&&['accepted','follow_up_scheduled'].includes(detail.state)&&<p>Reminder: {now<detail.reminder_at?`in ${Math.ceil((detail.reminder_at-now)/60)} mins`:'due now; acknowledge within 10 mins'}. {detail.is_follow_up?'Follow-up reminders are sent 24 hours ahead. Acknowledge before departure; departure opens 1 hour before the visit.':'Depart at least 30 minutes before the appointment.'}</p>}
            
            <div className="ops-actions" style={{marginBottom:0}}>
              {detail.allowed_actions.filter(a=>actionLabels[a]&&!(a==='collect_parts'&&(detail.procurement_version||1)>=2)).map(a=><button key={a} disabled={!!busy} className={['decline','stop_tracking'].includes(a)?'ops-secondary':'ops-primary'} onClick={()=>{if(a==='stop_tracking'){stopWatch();if(nativeAvailable())void nativeCall('stopTracking').catch(e=>setError(e.message));}if(a==='depart'){void run(detail,a).then(updated=>{if(updated)void share(updated);});}else void run(detail,a);}}>{busy===detail.id?'Saving…':actionLabels[a]}</button>)}
            </div>

            {detail.allowed_actions.includes('position')&&<button className="ops-secondary" disabled={!!busy} onClick={()=>void share(detail)} style={{width:'100%',marginTop:12}}>{nativeAvailable()?'Share location during this visit, including in background':'Share GPS while this task is open'}</button>}
            
            {detail.allowed_actions.includes('submit_completion')&&<label style={{marginTop:16}}>Work completed and safety checks<textarea value={note} onChange={e=>setNote(e.target.value)} maxLength={2000}/><button className="ops-primary" disabled={!!busy||!note.trim()} onClick={()=>{stopWatch();void run(detail,'submit_completion',{notes:note});}} style={{marginTop:8}}>Ask customer to review the work</button></label>}
            {detail.allowed_actions.includes('dispute')&&<label style={{marginTop:16}}>Something needs attention<textarea value={note} onChange={e=>setNote(e.target.value)}/><button disabled={!!busy||note.trim().length<5} onClick={()=>void run(detail,'dispute',{reason:note})} style={{marginTop:8}}>Report an issue and hold settlement</button></label>}
          </div>
        )}

        {detail.notes&&<div className="ops-notice"><strong>Customer instructions:</strong> {detail.notes}</div>}
        {detail.completion_notes&&<div className="ops-notice"><strong>Completion report:</strong> {detail.completion_notes}</div>}
        {detail.follow_up_reason&&<p><strong>Next visit:</strong> {detail.follow_up_purpose} · {detail.follow_up_reason}. Same task and professional; no automatic extra charge.</p>}

        {(worker && (detail.location || detail.phone || detail.pickup_locations?.length)) ? (
          <div className="ops-card">
            <h3 style={{marginTop:0}}>Contact & Navigation</h3>
            <div className="ops-grid" style={{marginBottom: detail.distance_metres!==null?12:0}}>
              {detail.location&&<a className="ops-secondary" href={`https://www.google.com/maps/dir/?api=1&destination=${detail.location.lat},${detail.location.lng}`} target="_blank" rel="noreferrer" style={{margin:0}}><Navigation size={18}/>Open Directions</a>}
              {detail.phone&&<a className="ops-secondary" href={`tel:${detail.phone}`} style={{margin:0}}>Call customer</a>}
            </div>
            {detail.distance_metres!==null&&<p>{detail.distance_metres} m straight-line distance. GPS accuracy is checked before start.</p>}
            {detail.pickup_locations?.map(s=><a key={s.name} className="ops-secondary" href={`https://www.google.com/maps/dir/?api=1&destination=${s.location.lat},${s.location.lng}`} target="_blank" rel="noreferrer" style={{marginTop:12}}>Directions to {s.name}</a>)}
          </div>
        ) : null}

        <details><summary>Equipment & Parts</summary>
          <RentalManager jobId={detail.id} onChange={()=>void load()} onSignIn={onSignIn}/>
          {worker&&detail.state==='in_progress'&&<details><summary>Rent equipment for this task</summary><RentalMarket jobId={detail.id} onChange={()=>void load()}/></details>}
          {(detail.procurement_version||1)>=2&&<TaskProcurement key={detail.id} job={detail} worker={worker} onRefresh={load} onCollect={()=>run(detail,'collect_parts',{return_policy:'pickup-return-v1'})}/>}
          {detail.allowed_actions.includes('propose_parts')&&<PartsRequest busy={!!busy} onSubmit={items=>run(detail,'propose_parts',{items})}/>}
          {['pending','awaiting_payment'].includes(detail.proposal?.status||'')&&detail.proposal&&<div className="ops-notice"><h3>Additional parts need approval</h3>{detail.proposal.items.map((i,index)=><p key={index}>{i.quantity} × {i.name} · {money(i.quantity*i.unit_price_paise)}</p>)}{detail.allowed_actions.includes('approve_parts')&&<><button disabled={!!busy} className="ops-primary" onClick={()=>void run(detail,'approve_parts',{proposal_id:detail.proposal!.id})}>Approve {money(detail.proposal.amount_paise)}{(detail.procurement_version||1)>=3?' & continue to payment':''}</button><button disabled={!!busy} onClick={()=>void run(detail,'reject_parts',{proposal_id:detail.proposal!.id})}>Decline extra parts</button></>}</div>}
          {detail.proposal?.status==='awaiting_payment'&&<><p role="status">Customer payment is required before sending this order to the shop.</p>{!worker&&<><PaymentPanel job={detail} parts onRefresh={load}/><button disabled={!!busy} onClick={()=>void run(detail,'reject_parts',{proposal_id:detail.proposal!.id})}>Cancel unpaid parts request</button></>}</>}
          {detail.parts_refund_hold&&<p className="ops-notice">A parts payment needs refund review. No further collection or payout is allowed until it is resolved. Contact booking support below.</p>}
        </details>

        <VisitEvidence job={detail} worker={worker} onRefresh={load}/>

        <details><summary>Billing details</summary>
          <div className="ops-bill"><div>Approved service <strong>{money(detail.base_price_paise)}</strong></div><div>All approved extras (parts & returned rentals)<strong>{money(detail.total_paise-detail.base_price_paise)}</strong></div><div>Approved total<strong>{money(detail.total_paise)}</strong></div>{!!detail.parts_paid_paise&&<><div>Parts already paid<strong>−{money(detail.parts_paid_paise)}</strong></div><div>Remaining balance<strong>{money(Math.max(0,detail.total_paise-detail.parts_paid_paise))}</strong></div></>}{detail.scopes?.filter(s=>s.credit_paise).map(s=><div key={s.version}>Cancelled parts credit <strong>−{money(s.credit_paise||0)}</strong></div>)}<p>Parts and extra work require approval. Payment: {detail.payment_status.replaceAll('_',' ')}. Payout: {detail.payout_status}.</p>{detail.scopes?.filter(s=>s.quote).map(s=><div key={s.version}><span>Scope {s.version}: {s.quote!.items.map(i=>`${i.quantity} × ${i.name}`).join(', ')}</span></div>)}</div>
          {!worker&&detail.state==='completed'&&detail.payment_status!=='no_payment_due'&&<PaymentPanel job={detail} onRefresh={load}/>}
        </details>

        <details><summary>Manage task</summary>
          {worker&&detail.allowed_actions.includes('schedule_follow_up')&&<div className="ops-notice"><h4 style={{marginTop:0}}>Schedule another visit</h4><p>This task stays pending with you. Agree the next time with the customer. The same approved scope and price remain; a reminder is sent 24 hours before the visit.</p><label>Visit purpose<select value={followupPurpose} onChange={e=>setFollowupPurpose(e.target.value)}>{['repair','inspection','update','parts','other'].map(p=><option key={p}>{p}</option>)}</select></label><label>Why is another visit needed?<textarea value={note} minLength={10} maxLength={1000} onChange={e=>setNote(e.target.value)}/></label><label>Next visit date and time<input type="datetime-local" value={date} onChange={e=>setDate(e.target.value)}/></label><button disabled={!!busy||!date||note.trim().length<10} onClick={()=>void run(detail,'schedule_follow_up',{starts_at:new Date(date).toISOString(),purpose:followupPurpose,reason:note})}>Schedule next visit</button></div>}
          
          {detail.allowed_actions.includes('cancel')&&<div className="ops-notice"><h4 style={{marginTop:0}}>Cancel or change appointment</h4><p>Cancellation before work starts has no fee in this booking’s terms.</p><button disabled={!!busy} onClick={()=>void run(detail,'cancel')}>Cancel this booking</button><label>New date and time<input type="datetime-local" value={date} onChange={e=>setDate(e.target.value)}/></label><button disabled={!!busy||!date} onClick={()=>void run(detail,'reschedule',{starts_at:new Date(date).toISOString()})}>Request a new appointment</button></div>}
          
          {detail.allowed_actions.includes('review')&&<label>Rate your completed service<select value={rating} onChange={e=>setRating(e.target.value)}><option value="">Choose rating</option>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n} out of 5</option>)}</select><textarea aria-label="Review comments" value={note} onChange={e=>setNote(e.target.value)}/><button disabled={!!busy||!rating} onClick={()=>void run(detail,'review',{rating:Number(rating),text:note})}>Post review</button></label>}
          
          {!!detail.penalties.length&&<div><h4>Policy assessments ({detail.penalties.length})</h4>{detail.penalties.map(p=><p key={p.code}>{p.code.replaceAll('_',' ')}: {p.current_percent}% on this task{p.next_task_percent?`, ${p.next_task_percent}% on the next task`:''}. Pending settlement review; no bank deduction made.</p>)}</div>}
          
          {!worker&&onRebook&&['completed','cancelled'].includes(detail.state)&&<button disabled={!!busy} onClick={async()=>{setBusy(detail.id);try{const draft=await operation<{service_id:string;category:string;city:string;address:string;phone:string;location:object;notes:string}>(`/jobs/${detail.id}/rebook-draft`);sessionStorage.setItem(`repaido.booking-draft.${draft.service_id}`,JSON.stringify({...draft,pin:draft.location,date:''}));onRebook(draft);}catch(e){setError((e as Error).message);}finally{setBusy('');}}}>Book this service again</button>}
          
          <BookingRecovery job={detail} worker={worker} onRefresh={load}/>
          
          <details><summary>Task history</summary>{detail.events.map(e=><p key={e.event_id}>{e.event_type.replaceAll('_',' ')} · {new Date(e.occurred_at_server_time*1000).toLocaleTimeString()}</p>)}</details>
        </details>

        {detail.service_terms?.version&&<details><summary>Accepted service terms · v{detail.service_terms.version}</summary><p style={{whiteSpace:'pre-wrap'}}>{detail.service_terms.text}</p></details>}
        
        {error&&<p role="alert" className="ops-error">{error}</p>}
        <p className="ops-help">{detail.blockers.includes('FRESH_ACCURATE_LOCATION_WITHIN_100M_REQUIRED')?'An accurate GPS reading within 100 m is required. If GPS fails, contact support for manual review.':''}</p>
      </div></Modal>}"""

new_content = content[:start_idx] + new_modal + content[end_idx+len('</div></Modal>}'):]

with open('web/src/components/OperationalJobs.tsx', 'w') as f:
    f.write(new_content)

print("Updated OperationalJobs.tsx successfully!")
