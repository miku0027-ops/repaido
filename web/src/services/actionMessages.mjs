// HTTP POST also carries reads and automatic receipts. Neither is a saved form.
export function quietRequest(path, init = {}) {
 const method = (init.method || 'GET').toUpperCase(), route = path.split('?')[0];
 if (['GET','HEAD','OPTIONS'].includes(method)) return true;
 if (/\/campaigns\/[^/]+\/events$/.test(route)) return true;
 if (/\/scrap\/capture-sessions(?:\/|$)/.test(route)) return true;
 if (/\/(search|leaderboard|feed|agent-opportunities|view|seen|read|read-all|heartbeat|position|telemetry|tracking-session)(\/|$)/.test(route) || /\/(devices|activity|presence)(\/|$)/.test(route)) return true;
 if (/\/(hiring\/recommendations|discovery\/events|coupons\/launch|auth\/session|community\/usage|community\/work\/behavior)$/.test(route)) return true;
 let body = {}; try { if (typeof init.body === 'string') body = JSON.parse(init.body); } catch { /* Binary uploads. */ }
 return /\/worker\/availability$/.test(route) && body.heartbeat === true;
}
export function changesAccountData(path, init = {}) {
 if (quietRequest(path, init)) return false;
 // Estimates and validation acknowledge a user action without changing bookings.
 return !/\/(quotes?|validate|coupons\/check)$/.test(path.split('?')[0]);
}
// Only intentional changes announce completion. Background receipts stay quiet.
export function actionMessages(path, init = {}) {
 const method = (init.method || 'GET').toUpperCase();
 const route = path.split('?')[0];
 if (quietRequest(path, init)) return null;
 let body = {}; try { if (typeof init.body === 'string') body = JSON.parse(init.body); } catch { /* Non-JSON uploads. */ }
 const action = body.action || '';
 const upload = /\/(photos?|attachments|documents|media|evidence|portrait)(\/|$)/.test(route) || typeof Blob !== 'undefined' && init.body instanceof Blob;
 const pending = upload ? 'Uploading…' : /payment|checkout|refund|payout|razorpay|subscription\/(order|check)/.test(route) ? 'Checking payment…' : /decision|commands/.test(route) ? 'Saving…' : 'Saving…';
 return {pending, result(data = {}) {
  data = data || {};
  const status = data.status || data.state || data.listing?.status || data.rfq?.status;
  const note = (title, message, tone = 'success') => ({title, message, tone});
  if (data.ok === false || data.success === false) return note('Action needs attention', data.message || 'The server did not confirm this action. Review the details before trying again.', 'error');
  if (/\/local-business\/scrap(?:$|\/[^/]+\/(?:evaluation|commands)$)/.test(route)) {
   if (!data.id || !status) return note('Collection not confirmed','Check your collection records before retrying.','error');
   if (/\/evaluation$/.test(route)) return note('Weighing quote sent',status==='evaluated'?'The customer can now review the net weights and prices.':'The saved quote is available in this collection.');
   if (/\/scrap$/.test(route)) return note('Collection requested','Follow the collector’s response in your collections.');
   const messages={accept:['Collection accepted','Pickup details are now available.'],depart:['Journey started','Your shared location appears in the customer’s collection.'],arrive:['Arrival confirmed','You can now inspect and weigh the scrap.'],agree:['Quote accepted','The collector can proceed with the agreed payment.'],paid:['Payment recorded','The customer still needs to confirm receipt.'],received:['Receipt confirmed','Your collection is complete.'],cancel:['Collection cancelled','The collection record has been updated.'],dispute:['Concern sent','Your collection is available for support review.'],decline:['Collection declined','Your decision is recorded.']};
   return note(...(messages[action]||['Collection updated','Your collection record is up to date.']));
  }
  if (/\/captain\/profile$/.test(route)) return note('Profile updated','Your photo and leaderboard privacy choice are saved.');
  if (/\/cleanup\/(reports|admin)\/[^/]+\/actions$/.test(route)) {
   if (!data.id || !status) return note('Update not confirmed','Refresh the cleanup report before trying again.','error');
   if (action === 'record_cash' || action === 'resolve_payment') return note('Cash record updated','The reporter still needs to confirm cash receipt.','info');
   if (action === 'received') return data.payment_state === 'received' ? note('Cash receipt confirmed','Your receipt is saved with the cleanup report.') : note('Receipt not confirmed','Check the latest payment status.','info');
   const messages = {self_accept:['Cleanup accepted','Submit your after photos and disposal details when the approved work is finished.'],release:['Task released','Another approved collector can accept this cleanup.'],reassign:['Cleanup reopened','Another approved collector can accept this cleanup.'],approve:['Collection approved','The authorised cleanup is ready for a nearby collector.'], accept:['Cleanup accepted','You can now manage this site from Community cleanup.'], submit:['Evidence submitted','Your cleanup is ready for independent review.'], verify:['Cleanup verified','The reporter’s earned points are now recorded.'], rework:['Follow-up requested','The collector can review your notes and submit fresh evidence.'], cancel:['Report cancelled','No points or cash reward were issued.'], reject:['Report closed','Your review reason is saved with the report.'], refer:['Referral recorded','The authority case reference is saved with the report.'], payment_concern:['Payment concern sent','Repaido will review the cash payment record.']};
   return note(...(messages[action] || ['Report updated','Open the report for its current status.']));
  }
  if (/payment|checkout|refund|payout|razorpay|subscription\/(order|check)|\/prime\/(order|check)/.test(route)) return note('Payment status updated', 'Check the payment status below. Payment is complete only when confirmed.', 'info');
  if (upload) return data.id || data.image_url || data.url || data.media?.id || data.document_id || data.photo_id ? note('Upload complete', 'Your file is ready. Save the form to attach it.') : note('Upload response received','Check the file preview or saved attachment before submitting the form.','info');
  if (/\/market\/listings$/.test(route) && (!data.id || !status)) return note('Listing not confirmed','Check My listings before submitting again.','error');
  if (/\/market\/listings$/.test(route)) return note(status === 'published' ? 'Listing published' : 'Listing saved', status === 'published' ? 'Your item is now listed. You can manage it in My listings.' : status === 'awaiting_fee' ? 'Your draft is saved. Review and pay the listing fee to publish it.' : 'Check My listings for its current publication status.');
  if (/\/publish-free$/.test(route)) return note('Listing published', 'Your free listing is now available in My listings.');
  if (/\/market\/[^/]+\/close$/.test(route)) return note('Listing closed', 'This item is no longer available for new enquiries.');
  if (/\/hiring\/requests$/.test(route)) return note('Hire request sent', 'Follow the professional’s response and full quote in Bookings → Hiring.');
  if (/\/hiring\/requests\/[^/]+\/decision$/.test(route)) {
   const messages = {confirm:['Visit confirmed','Open your task to follow the visit.'], cancel:['Hire request cancelled','Your cancellation was saved.'], accept:['Quote sent','Wait for the customer to confirm the full price before travelling.'], decline:['Request declined','Your decision was saved.'], wait:['Waiting time extended','The professional has five more minutes to respond.'], rematch:['Matching request updated','Check your Hire request for the next professional’s response.']};
   return note(...(messages[action] || ['Decision saved','Your Hire request has been updated.']));
  }
  if (/\/hire-membership\/accept$/.test(route)) return note('Availability saved','Your Hire service range has been updated.');
  if (/\/b2b\/rfq$/.test(route)) return note('Quote request sent','The supplier can now review your request. Follow it in My requests.');
  if (/\/b2b\/rfq\/[^/]+\/decision$/.test(route)) return note(action === 'accept' ? 'Quotation accepted' : 'Quotation declined','Your decision is saved. No payment was collected and stock was not reserved.');
  if (/\/b2b\/quotation$/.test(route)) return note('Quotation sent','The buyer can review the saved quotation.');
  if (/\/b2b\/listings/.test(route)) return note(method === 'DELETE' ? 'Listing removed' : 'Wholesale listing saved','Your catalogue has been updated.');
  if (/\/custom-contracts\/queries$/.test(route)) return note('Requirement published','Review proposals in My contract requests. Choose a contractor before work begins.');
  if (/\/(bids|apply|interest)$/.test(route)) return note('Submission sent','Your submission is ready for review. You’ll be notified of the response.');
  if (/\/hiring$/.test(route)) return note('Hiring notice saved','Your project’s hiring details have been updated.');
  if (/\/(report|reports)$/.test(route)) return note('Report submitted','Your report was sent for review.');
  if (/\/(messages|comments|enquiries|agent-messages)$/.test(route)) return note('Message sent','Your message has been saved.');
  if (/\/support-tickets$/.test(route)) return note('Support request sent','Your request has been saved for the support team.');
  if (/\/(profile|settings|preferences|hiring-policy)$/.test(route)) return note('Changes saved','Your settings are up to date.');
  if (/\/quotes?$/.test(route)) return note('Quote ready','Review the estimate and terms before confirming.', 'info');
  if (/\/coupons\/check$/.test(route)) return note('Offer checked','The eligible offer is shown in your price summary.', 'info');
  if (/\/bookings$/.test(route)) return data.id ? note('Booking request sent','Follow the professional’s response in Bookings.') : note('Request not confirmed','Check Bookings before trying again.','error');
  if (/\/validate$/.test(route)) return note('Details checked','Review the validation result shown in this view.', 'info');
  if (status === 'pending' || status === 'pending_review' || status === 'submitted') return note('Submitted for review','Your submission was received. Approval is still pending.');
  return note('Update saved', 'Your changes are saved.');
 }};
}
