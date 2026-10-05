import {test} from 'node:test';
import assert from 'node:assert/strict';
import {taskStage,taskNextAction,taskProgress} from '../src/services/taskStages.mjs';
const job=(state,allowed_actions,extra={})=>({state,allowed_actions,visit_id:'v',procurement_version:3,...extra});
test('arrival gates use separate OTP and before-camera actions before work',()=>{
 const j=job('arrived',['start']);assert.equal(taskNextAction(j).tool,'otp');
 j.arrival_verified_visit='v';assert.equal(taskNextAction(j).tool,'photos');
 j.evidence_summary={has_before:true};assert.equal(taskNextAction(j).action,'start');
 j.visit_id='next';assert.equal(taskNextAction(j).tool,'otp');
});
test('completion requires after evidence and cannot bypass blocked parts',()=>{
 assert.equal(taskNextAction(job('in_progress',['propose_parts'])),null);
 assert.equal(taskNextAction(job('in_progress',['submit_completion'])).tool,'photos');
 assert.equal(taskNextAction(job('in_progress',['submit_completion'],{evidence_summary:{has_after:true}})).tool,'complete');
});
test('stages reflect follow-up reminders, parts trips and disputes without granting actions',()=>{
 assert.equal(taskStage(job('follow_up_scheduled',['ack_reminder'])),0);
 assert.equal(taskStage(job('follow_up_scheduled',['depart'])),1);
 assert.equal(taskStage(job('collecting_parts',['return_to_site'])),3);
 assert.equal(taskStage(job('disputed',[])),3);
 assert.equal(taskNextAction(job('completed',[])),null);
});
test('visit progress counts confirmed milestones and waits for customer confirmation',()=>{
 for(const [state,percent] of [['offered',0],['accepted',20],['en_route',20],['arrived',40],['in_progress',60],['collecting_parts',60],['completion_pending',80],['completed',100]]){
  assert.equal(taskProgress(job(state,[])).percent,percent,state);
 }
 assert.equal(taskProgress(job('completed',[],{payment_status:'pay_after_service',payout_status:'held'})).percent,100,'payment is separate from visit completion');
 assert.equal(taskProgress(job('in_progress',[],{evidence_summary:{has_after:true}})).percent,60,'an uploaded photo is not confirmed completion');
});
test('follow-up progress does not reuse the earlier visit achievements',()=>{
 const followup=job('follow_up_scheduled',['ack_reminder'],{is_follow_up:true,completion_notes:'older record',started_at:100,events:[{event_type:'accept_completion'}]});
 assert.equal(taskProgress(followup).percent,20);
 assert.equal(taskProgress(followup).tone,'warning');
 assert.equal(taskProgress(job('offered',['accept'],{started_at:100})).percent,0,'reassignment resets stage progress');
});
test('interrupted tasks preserve recorded milestones and never turn fully complete',()=>{
 assert.equal(taskProgress(job('cancelled',[])).percent,0);
 assert.equal(taskProgress(job('cancelled',[],{accepted_at:100})).percent,20);
 assert.equal(taskProgress(job('stop_requested',[],{started_at:100})).percent,60);
 const dispute=taskProgress(job('disputed',[],{completion_notes:'Work submitted',completed_at:200}));
 assert.equal(dispute.percent,80);assert.equal(dispute.tone,'danger');
 assert.equal(taskProgress(job('completed',[])).tone,'success');
});
