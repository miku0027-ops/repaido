import test from 'node:test';
import assert from 'node:assert/strict';
import {customerNeedsAction,customerOnSite,customerCardState} from '../src/services/customerBookings.mjs';
const job=(state,allowed_actions=[],extra={})=>({state,allowed_actions,...extra});
test('travelling or collecting parts is not described as on site',()=>{
 for(const state of ['en_route','collecting_parts','searching','accepted','completed','cancelled','completion_pending'])assert.equal(customerOnSite(job(state)),false);
 for(const state of ['arrived','in_progress'])assert.equal(customerOnSite(job(state)),true);
});
test('Needs you includes the server-authorized customer decisions',()=>{
 for(const a of ['approve_parts','accept_completion','review'])assert.equal(customerNeedsAction(job('in_progress',[a])),true);
 assert.equal(customerNeedsAction(job('in_progress',[],{proposal:{status:'awaiting_payment'}})),true);
 assert.equal(customerNeedsAction(job('en_route',['reschedule','cancel'])),false);
});
test('completed and disputed cards do not suggest active work or fabricate settlement',()=>{
 const completed=customerCardState(job('completed',['review']));assert.equal(completed.tone,'success');assert.equal(completed.moving,false);assert.equal(completed.action,'Leave a review');assert.match(completed.hint,/Payment status.*separately/);
 assert.equal(customerCardState(job('disputed')).tone,'review');assert.equal(customerCardState(job('cancelled')).moving,false);
});
test('approval and completion review are clearly differentiated from work in progress',()=>{
 assert.equal(customerCardState(job('in_progress',['approve_parts'])).action,'Review parts quote');
 assert.equal(customerCardState(job('completion_pending',['accept_completion'])).tone,'attention');
 assert.equal(customerCardState(job('in_progress')).tone,'onsite');
 assert.equal(customerCardState(job('offered')).label,'Awaiting agent response');
});
