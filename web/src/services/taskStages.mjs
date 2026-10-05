export const taskStages = ['Request', 'Travel', 'Arrival', 'Work', 'Finish'];
// Exact count of five server-confirmed visit milestones, not a time/effort estimate.
// A follow-up is a new visit; old task events must not turn its stages green.
export function taskProgress(job) {
  const stagesByState = {searching:0,offered:0,accepted:1,follow_up_scheduled:1,en_route:1,arrived:2,in_progress:3,collecting_parts:3,completion_pending:4,completed:5};
  const recorded = job.completion_notes ? 4 : job.started_at ? 3 :
    ((job.arrival_verified_visit && job.arrival_verified_visit === job.visit_id) || job.manual_arrival || job.evidence_summary?.has_before) ? 2 : job.accepted_at ? 1 : 0;
  const completed = stagesByState[job.state] ?? recorded;
  const status = {searching:'Finding an agent',offered:'Response needed',accepted:'Visit accepted',follow_up_scheduled:'Next visit booked',en_route:'On the way',arrived:'At the customer',in_progress:'Work in progress',collecting_parts:'Collecting parts',completion_pending:'Awaiting confirmation',completed:'Task completed',cancelled:'Cancelled',disputed:'Under review',stop_requested:'Work paused',follow_up_required:'Another visit needed'}[job.state] || 'Check task status';
  const tone = ['cancelled','disputed'].includes(job.state) ? 'danger' : job.state==='completed' ? 'success' :
    ['offered','searching','accepted','follow_up_scheduled','completion_pending','collecting_parts','stop_requested','follow_up_required'].includes(job.state) ? 'warning' : 'brand';
  return {completed,percent:completed*20,tone,status};
}
export function taskStage(job) {
  if (['completion_pending','completed'].includes(job.state)) return 4;
  if (['in_progress','collecting_parts','follow_up_required','stop_requested','disputed'].includes(job.state)) return 3;
  if (job.state === 'arrived') return 2;
  if (job.state === 'en_route' || (['accepted','follow_up_scheduled'].includes(job.state) && job.allowed_actions.includes('depart'))) return 1;
  return 0;
}
export function taskNextAction(job) {
  const can = action => job.allowed_actions.includes(action);
  if (can('accept')) return {action:'accept', label:'Accept task'};
  if (can('ack_reminder')) return {action:'ack_reminder', label:'Acknowledge visit'};
  if (can('depart')) return {action:'depart', label:'Start travel'};
  if (can('start')) {
    if (job.procurement_version >= 2 && job.arrival_verified_visit !== job.visit_id) return {tool:'otp',label:'Verify customer OTP'};
    if (job.home_log_required&&!job.home_arrival_log?.hygiene) return {tool:'daily',label:'Arrival & hygiene checks'};
    if (!job.home_log_required&&!job.evidence_summary?.has_before) return {tool:'photos',label:'Take before photo'};
    return {action:'start',label:'Start work'};
  }
  if (can('return_to_site')) return {action:'return_to_site',label:'Confirm return to site'};
  if (can('collect_parts')) return {tool:'parts',label:'Collect approved parts'};
  if (can('install_parts')) return {action:'install_parts',label:'Confirm parts installed'};
  if (can('submit_completion')) {
    if (job.home_log_required&&(!job.home_daily_log?.hygiene||job.home_daily_log.checked.length!==job.home_checklist?.length)) return {tool:'daily',label:'Complete daily checklist'};
    if (!job.home_log_required&&!job.evidence_summary?.has_after) return {tool:'photos',label:'Take after photo'};
    return {tool:'complete',label:'Submit completed work'};
  }
  return null;
}
