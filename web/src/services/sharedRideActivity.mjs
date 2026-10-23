/** Passenger-only facts. Departure events do not identify a passenger, so an
 * arbitrary accept/board/payment event must never become this person's event. */
export function sharedRideActivity(row,mine){
 const terminal=['cancelled','declined','expired'].includes(mine.state)||row.state==='cancelled';
 const completed=mine.state==='completed';
 const boarded=!!mine.boarded_at||mine.state==='boarded'||completed;
 const accepted=boarded||mine.state==='accepted'||!!mine.accepted_at;
 const travelling=boarded&&(row.state==='in_progress'||completed);
 const steps=[{label:'Requested',done:true},{label:'Confirmed',done:accepted},{label:'On board',done:boarded},{label:'Arrived',done:completed}];
 const current=completed?3:boarded?2:accepted?1:0;
 const activity=[];
 const add=(label,at)=>{if(Number.isFinite(at)&&at>0)activity.push({label,at});};
 add('Seat requested',mine.created_at);add('Seat confirmed',mine.accepted_at);add('Boarding recorded',mine.boarded_at);
 for(const e of row.events||[]){if(e.action==='start'&&boarded)add('Journey started',e.at);}
 add('Departure changed',row.reschedule?.changed_at);add('Drop-off recorded',mine.completed_at);
 add('Payment reported by you',mine.payment_reported_at);add('Receipt confirmed by owner',mine.payment_received_at);
 const note=terminal?'This request is closed.':completed?'Your drop-off has been recorded.':travelling?'Follow your journey and share it with family.':boarded?'Boarding recorded. Waiting for the journey to start.':accepted?row.state==='in_progress'?'The journey has started. Your boarding is not recorded yet.':'Meet at your agreed pickup pin.':'The owner needs to accept your seat request.';
 return {steps,current,terminal,note,activity:activity.sort((a,b)=>b.at-a.at)};
}
