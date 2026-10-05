export function customerNeedsAction(job) {
  return job.state === 'arrived' || job.proposal?.status === 'awaiting_payment' ||
    (job.allowed_actions || []).some(action => ['approve_parts', 'accept_completion', 'review'].includes(action));
}
export function customerOnSite(job) {
  return ['arrived', 'in_progress'].includes(job.state);
}
export function customerCardState(job) {
  if (job.state === 'cancelled') return {tone:'closed',label:'Cancelled',action:'View booking record',hint:'This booking is closed.',moving:false};
  if (job.state === 'completed') return {tone:'success',label:'Completed',action:job.allowed_actions?.includes('review')?'Leave a review':'View receipt & records',hint:'Work confirmed complete. Payment status is shown separately.',moving:false};
  if (['disputed','stop_requested'].includes(job.state)) return {tone:'review',label:job.state==='disputed'?'Under review':'Work paused',action:'View updates & support',hint:'Check your booking for the latest resolution.',moving:false};
  if (job.allowed_actions?.includes('approve_parts')) return {tone:'attention',label:'Approval needed',action:'Review parts quote',hint:'Review the proposed cost before approving.',moving:true};
  if (job.proposal?.status === 'awaiting_payment') return {tone:'attention',label:'Parts payment needed',action:'Review approved parts',hint:'View the approved quote and payment status.',moving:true};
  if (job.state === 'completion_pending') return {tone:'attention',label:'Review completed work',action:'Review & confirm work',hint:'Check the work before confirming completion.',moving:true};
  if (customerOnSite(job)) return {tone:'onsite',label:job.state==='arrived'?'Agent arrived':'Work in progress',action:'Manage this visit',hint:job.state==='arrived'?'Your professional has reached the service area.':'Follow work updates, photos and approved extras.',moving:true};
  const labels={searching:'Finding your professional',offered:'Awaiting agent response',accepted:'Visit accepted',en_route:'On the way',collecting_parts:'Collecting parts',follow_up_scheduled:'Next visit scheduled',follow_up_required:'Follow-up needed'};
  return {tone:'active',label:labels[job.state]||'Booking update',action:job.state==='en_route'?'Track & manage visit':'Open booking controls',hint:job.state==='searching'||job.state==='offered'?'Your visit is confirmed when a professional accepts.':'Schedule, tracking, records and help in one place.',moving:true};
}
