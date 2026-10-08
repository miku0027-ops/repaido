// Only user mutations announce completion. Search, telemetry and background receipts stay quiet.
export function actionMessages(path, init = {}) {
 const method = (init.method || 'GET').toUpperCase();
 const route = path.split('?')[0];
 if (['GET','HEAD','OPTIONS'].includes(method) || /\/hiring\/recommendations$/.test(route) || /\/(search|leaderboard|feed|agent-opportunities|view|seen|read|heartbeat|position|telemetry|tracking-session)(\/|$)/.test(route) || /\/(devices|activity|presence)(\/|$)/.test(route)) return null;
 let body = {}; try { if (typeof init.body === 'string') body = JSON.parse(init.body); } catch { /* Non-JSON uploads. */ }
 const action = body.action || '';
 const upload = /\/(photos?|attachments|documents|media|evidence|portrait)(\/|$)/.test(route) || typeof Blob !== 'undefined' && init.body instanceof Blob;
 const pending = upload ? 'Uploading your file…' : /payment|checkout|refund|payout|razorpay|subscription\/(order|check)/.test(route) ? 'Checking payment details…' : /decision|commands/.test(route) ? 'Saving your decision…' : 'Submitting your changes…';
 return {pending, result(data = {}) {
  data = data || {};
  const status = data.status || data.state || data.listing?.status || data.rfq?.status;
  const note = (title, message, tone = 'success') => ({title, message, tone});
  if (data.ok === false || data.success === false) return note('Action needs attention', data.message || 'The server did not confirm this action. Review the details before trying again.', 'error');
  if (/payment|checkout|refund|payout|razorpay|subscription\/(order|check)|\/prime\/(order|check)/.test(route)) return note('Payment status updated', 'Review the payment status shown in this view. A checkout opening or closing does not confirm payment.', 'info');
  if (upload) return data.id || data.image_url || data.url || data.media?.id || data.document_id || data.photo_id ? note('Upload complete', 'Your file reached Repaido. Complete any remaining form steps to submit it.') : note('Upload response received','Check the file preview or saved attachment before submitting the form.','info');
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
  if (/\/custom-contracts\/queries$/.test(route)) return note('Requirement published','Review proposals in My contract requests. Work begins after you accept an award.');
  if (/\/(bids|apply|interest)$/.test(route)) return note('Submission sent','Your proposal or application is saved for review. Acceptance is a separate step.');
  if (/\/hiring$/.test(route)) return note('Hiring notice saved','Your project’s hiring details have been updated.');
  if (/\/(report|reports)$/.test(route)) return note('Report submitted','Your report was sent for review.');
  if (/\/(messages|comments|enquiries|agent-messages)$/.test(route)) return note('Message sent','Your message has been saved.');
  if (/\/support-tickets$/.test(route)) return note('Support request sent','Your request has been saved for the support team.');
  if (/\/(profile|settings|preferences|hiring-policy)$/.test(route)) return note('Changes saved','Your latest settings have been saved.');
  if (/\/quote$/.test(route)) return note('Quote ready','Review the estimate and terms before confirming.', 'info');
  if (/\/validate$/.test(route)) return note('Details checked','Review the validation result shown in this view.', 'info');
  if (status === 'pending' || status === 'pending_review' || status === 'submitted') return note('Submitted for review','Your submission was received. Approval is still pending.');
  return note('Update saved', 'Your action was recorded. The latest details are shown in this view.');
 }};
}
