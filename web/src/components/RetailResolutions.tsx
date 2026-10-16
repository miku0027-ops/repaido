import {useCallback, useEffect, useRef, useState, type FormEvent} from 'react';
import {onIdTokenChanged} from 'firebase/auth';
import {Check, ChevronDown, FileImage, MessageSquare, RefreshCw, RotateCcw, ShieldCheck} from 'lucide-react';
import {auth} from '../firebase';
import {operation, money} from '../services/operations';
import {apiFetch} from '../services/api';
import {businessAmount, businessDocument} from '../services/localBusiness';
import {Modal} from './ui';
import './retail-resolutions.css';

type Mode = 'customer' | 'shop' | 'admin';
type Item = {product_id: string; name: string; quantity: number};
type CaseAction = 'reply' | 'authorize_return' | 'return_sent' | 'return_received' | 'appeal';
type Decision = 'approve_refund' | 'reject' | 'resolve';
type Policy = string | {return_terms?: string; warranty_terms?: string; warranty_days?: number | null; terms?: string; text?: string; window_days?: number; return_days?: number | null; accepted?: boolean; policy?: string; returnable?: boolean} | null;
type CaseEvent = {id: string; role: 'customer' | 'shop' | 'operator'; text: string; action: string; document_ids: string[]; at: number};
type ResolutionCase = {
  id: string; order_id: string; product_id: string; shop_id: string; version: number; state: string; kind: 'return' | 'refund' | 'complaint'; quantity: number;
  item: {name: string; quantity: number; return_policy?: Policy}; reason: string; max_refund_paise: number;
  policy_window: {deadline_at: number | null; status: 'within_window' | 'outside_window' | 'manual_review' | 'not_received'};
  response_target_at?: number; resolution_target_at?: number; target_note?: string; return_by?: number; return_receipt_at?: number;
  refund_amount_paise?: number; refund_status?: string; decision_note?: string; appeal_reason?: string; events: CaseEvent[]; created_at: number; updated_at: number;
  allowed_actions?: CaseAction[]; allowed_decisions?: Decision[]; can_refund?: boolean; viewer_role?: string; recovery?: string;
};
type List = {cases: ResolutionCase[]; shops?: {id: string; name: string}[]; selected_shop_id?: string; next_cursor?: string | null};
const root = '/retail';
const key = (value: string) => encodeURIComponent(value);
const words = (value: string) => value.replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase());
const date = (value?: number | null) => value ? new Date(value * 1000).toLocaleString('en-IN', {day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata', timeZoneName: 'short'}) : 'Not set';
const message = (error: unknown) => error instanceof Error ? error.message : 'This request could not finish. Please try again.';
const actorNow = () => auth.currentUser?.uid || localStorage.getItem('repaido.token') || '';
const isFinal = (row: ResolutionCase) => ['resolved', 'rejected'].includes(row.state);
const states = ['open', 'merchant_replied', 'return_authorized', 'return_sent', 'return_received', 'refund_approved', 'refund_pending', 'resolved', 'rejected', 'appealed'];
const actionNames: Record<CaseAction, string> = {reply: 'Add a reply', authorize_return: 'Authorise a return', return_sent: 'Record return sent', return_received: 'Confirm return received', appeal: 'Appeal the decision'};

export function RetailOrderResolution({orderId, items}: {orderId: string; items: Item[]}) {return <ResolutionEntry mode="customer" orderId={orderId} items={items}/>;}
export function RetailShopResolutions() {return <ResolutionEntry mode="shop"/>;}
export function RetailResolutionAdmin() {return <ResolutionEntry mode="admin"/>;}

function ResolutionEntry({mode, orderId, items}: {mode: Mode; orderId?: string; items?: Item[]}) {
  const sawFirebase = useRef(!!auth.currentUser);
  const current = () => auth.currentUser?.uid || (!sawFirebase.current ? localStorage.getItem('repaido.token') || '' : '');
  const [actor, setActor] = useState(current);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const sync = () => {if (auth.currentUser) sawFirebase.current = true; setActor(current());};
    const unsubscribe = onIdTokenChanged(auth, () => {sync(); setReady(true);});
    const storage = (event: StorageEvent) => {if (event.key === null || event.key === 'repaido.token') sync();};
    window.addEventListener('storage', storage); window.addEventListener('repaido:identity-changed', sync);
    return () => {unsubscribe(); window.removeEventListener('storage', storage); window.removeEventListener('repaido:identity-changed', sync);};
  }, []);
  return <section className="retail-resolutions" aria-label={mode === 'customer' ? 'Order returns and resolution' : mode === 'shop' ? 'Shop returns and resolution' : 'Retail resolution administration'}>
    {!ready ? <p className="rr-loading" role="status">Checking your account…</p> : actor ? <ResolutionWorkspace key={`${actor}:${mode}:${orderId || ''}`} actor={actor} mode={mode} orderId={orderId} items={items || []}/> : <p className="rr-notice">Sign in to view returns, refunds and order support.</p>}
  </section>;
}

function ResolutionWorkspace({actor, mode, orderId, items}: {actor: string; mode: Mode; orderId?: string; items: Item[]}) {
  const [rows, setRows] = useState<ResolutionCase[]>([]);
  const [shops, setShops] = useState<{id: string; name: string}[]>([]);
  const [shop, setShop] = useState('');
  const [filter, setFilter] = useState(mode === 'admin' ? 'open' : '');
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [locked, setLocked] = useState(false);
  const [caseLocks, setCaseLocks] = useState<Set<string>>(() => new Set());
  const blocked = locked || caseLocks.size > 0;
  const sequence = useRef(0);
  const mounted = useRef(true);
  const load = useCallback(async (cursor = '') => {
    const generation = ++sequence.current;
    setLoading(true); setError('');
    const query = new URLSearchParams();
    if (cursor) query.set('cursor', cursor);
    if (shop && mode === 'shop') query.set('shop_id', shop);
    if (filter && mode === 'admin') query.set('state', filter);
    const path = mode === 'customer' ? `${root}/orders/${key(orderId || '')}/resolutions` : mode === 'shop' ? `${root}/resolutions/shop?${query}` : `${root}/admin/resolutions?${query}`;
    try {
      const response = await operation<List>(path, {}, {background: true, force: true, feedback: false});
      if (!mounted.current || actorNow() !== actor || generation !== sequence.current) return;
      setRows(previous => cursor ? [...new Map([...previous, ...response.cases].map(row => [row.id, row])).values()] : response.cases);
      setShops(response.shops || []); setNext(response.next_cursor || null); setLoaded(true);
      if (mode === 'shop' && !shop && response.selected_shop_id) setShop(response.selected_shop_id);
    } catch (caught) {if (mounted.current && actorNow() === actor && generation === sequence.current) setError(message(caught));}
    finally {if (mounted.current && generation === sequence.current) setLoading(false);}
  }, [actor, mode, orderId, shop, filter]);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {mounted.current = false; sequence.current++;};
  }, [load]);
  const saved = (row: ResolutionCase) => {if (actorNow() !== actor) return; setRows(previous => [row, ...previous.filter(item => item.id !== row.id)]); if (mode === 'admin' && row.state !== filter) setFilter(row.state);};
  const newItems = items.filter(item => !rows.some(row => row.product_id === item.product_id));
  const visible = mode === 'admin' && filter ? rows.filter(row => row.state === filter) : rows;
  return <>
    <header className="rr-header"><div><p className="rr-eyebrow">{mode === 'customer' ? 'After your purchase' : mode === 'shop' ? 'Customer care' : 'Company review'}</p><h2>{mode === 'customer' ? 'Returns, refunds & order help' : mode === 'shop' ? 'Shop returns & resolution' : 'Retail returns & refund review'}</h2><p className="rr-help">{mode === 'customer' ? 'Raise an item issue, share evidence and follow the response here.' : mode === 'shop' ? 'Respond to item issues, arrange agreed returns and record received goods.' : 'Review the purchase terms and evidence before deciding a case or releasing an approved refund.'}</p></div><RotateCcw size={25} aria-hidden="true"/></header>
    <p className="rr-notice"><ShieldCheck size={17} aria-hidden="true"/><span>Seller terms saved at purchase guide each review. Older orders without saved terms need manual review. Requesting or approving a refund does not mean money has been sent.</span></p>
    <div className="rr-toolbar">{mode === 'shop' && shops.length > 0 && <label>Shop<select aria-label="Shop" disabled={loading || blocked} value={shop} onChange={event => {setRows([]); setLoaded(false); setShop(event.target.value);}}>{shops.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}{mode === 'admin' && <label>Case state<select aria-label="Case state" value={filter} disabled={blocked} onChange={event => {setRows([]); setLoaded(false); setFilter(event.target.value);}}>{states.map(state => <option key={state} value={state}>{words(state)}</option>)}</select></label>}<div className="rr-actions"><button className="rr-button" disabled={loading || blocked} onClick={() => void load()}><RefreshCw size={16} aria-hidden="true"/>{loading && loaded ? 'Refreshing…' : 'Refresh cases'}</button>{mode === 'customer' && <button className="rr-button rr-primary" disabled={blocked || loading || !newItems.length || creating} onClick={() => setCreating(true)}>Raise an item issue</button>}</div></div>
    {error && <p className="rr-error" role="alert">{error}</p>}
    {creating && orderId && <NewCaseForm actor={actor} orderId={orderId} items={newItems} blocked={caseLocks.size > 0} onLock={setLocked} onSaved={row => {saved(row); setCreating(false);}} onClose={() => setCreating(false)}/>}
    {loading && !loaded && <p className="rr-loading" role="status">Loading resolution cases…</p>}
    {!loading && loaded && !visible.length && <p className="rr-empty">{mode === 'customer' ? 'No item issues have been raised for this order.' : filter ? 'No cases match this state.' : mode === 'shop' && !shops.length ? 'No shop workspace is available for this account.' : 'No resolution cases to review.'}</p>}
    <div className="rr-card-list">{visible.map(row => <CaseCard key={row.id} row={row} actor={actor} mode={mode} onSaved={saved} onLock={value => setCaseLocks(previous => {const updated = new Set(previous); if (value) updated.add(row.id); else updated.delete(row.id); return updated;})} blocked={locked || [...caseLocks].some(id => id !== row.id)}/>)}</div>
    {next && <div className="rr-pagination"><button className="rr-button" disabled={loading || blocked} onClick={() => void load(next)}>{loading ? 'Loading more…' : 'Load more cases'}</button></div>}
  </>;
}

type Command = {path: string; body: Record<string, unknown>};
function useCommand(actor: string, onLock?: (locked: boolean) => void) {
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<Command | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const lockCallback = useRef(onLock);
  lockCallback.current = onLock;
  useEffect(() => {mounted.current = true; return () => {mounted.current = false; lockCallback.current?.(false);};}, []);
  const assertActor = () => {if (!mounted.current || actorNow() !== actor) throw new Error('Your account changed. Reopen this case before continuing.');};
  const run = async (path: string, build: (check: () => void) => Promise<Record<string, unknown>> | Record<string, unknown>, onSaved: (row: ResolutionCase) => void, includeKey = true) => {
    if (inFlight.current) return false;
    inFlight.current = true; setBusy(true); setError(''); lockCallback.current?.(true);
    try {
      assertActor();
      if (!pending.current) {
        const payload = await build(assertActor); assertActor();
        pending.current = {path, body: includeKey ? {...payload, request_id: crypto.randomUUID()} : payload};
      }
      const command = pending.current;
      const result = await operation<ResolutionCase>(command.path, {method: 'POST', body: JSON.stringify(command.body)}, {background: true, feedback: false});
      assertActor();
      pending.current = null; setUncertain(false); lockCallback.current?.(false); onSaved(result);
      return true;
    } catch (caught) {
      if (!mounted.current || actorNow() !== actor) return false;
      const status = (caught as {status?: number}).status;
      const unknownOutcome = !!pending.current && (!status || status >= 500 || status === 408);
      if (!unknownOutcome) pending.current = null;
      setUncertain(unknownOutcome); lockCallback.current?.(unknownOutcome);
      setError(unknownOutcome ? `${message(caught)} The outcome is unconfirmed. Retry the same request below; your original details and request key are preserved.` : message(caught));
      return false;
    } finally {inFlight.current = false; if (mounted.current) setBusy(false);}
  };
  return {busy, uncertain, error, run};
}
async function uploadEvidence(files: File[], cache: Map<File, string>, check: () => void, required = false) {
  if (files.length > 3 || required && !files.length) throw new Error(required ? 'Add one to three receipt photos before confirming returned goods.' : 'Choose up to three evidence photos.');
  const ids: string[] = [];
  for (const file of files) {
    check();
    if (!cache.has(file)) {const uploaded = await businessDocument(file, false); check(); cache.set(file, uploaded.id);}
    ids.push(cache.get(file)!);
  }
  return ids;
}
function PhotoInput({files, onChange, required = false, disabled = false}: {files: File[]; onChange: (files: File[]) => void; required?: boolean; disabled?: boolean}) {
  const [error, setError] = useState('');
  const change = (chosen: File[]) => {
    if (chosen.length > 3) {setError('Choose up to three photos.'); return;}
    if (chosen.some(file => !['image/jpeg', 'image/png'].includes(file.type) || file.size > 5 * 1024 * 1024)) {setError('Each photo must be JPEG or PNG and no larger than 5 MB.'); return;}
    setError(''); onChange(chosen);
  };
  return <div className="rr-photo-input"><label>{required ? 'Receipt evidence photos (required)' : 'Evidence photos (optional)'}<input type="file" accept="image/jpeg,image/png" multiple disabled={disabled} onChange={event => change(Array.from(event.target.files || []))}/></label><p className="rr-help">Up to 3 JPEG or PNG photos, 5 MB each. Visible to the case participants and authorised Repaido reviewers.</p>{!!files.length && <ul className="rr-photo-list">{files.map((file, index) => <li key={`${file.name}:${file.lastModified}:${index}`}><span>{file.name}</span><button className="rr-button" disabled={disabled} type="button" onClick={() => change(files.filter((_, position) => position !== index))} aria-label={`Remove ${file.name}`}>Remove</button></li>)}</ul>}{error && <p className="rr-error" role="alert">{error}</p>}</div>;
}
function CommandError({error, uncertain}: {error: string; uncertain: boolean}) {return error ? <div className="rr-error" role="alert"><p>{error}</p>{uncertain && <p className="rr-help">Keep this form open until the saved result is confirmed. Its details are locked to prevent a different request being sent during retry.</p>}</div> : null;}

function NewCaseForm({actor, orderId, items, onSaved, onClose, onLock, blocked}: {actor: string; orderId: string; items: Item[]; onSaved: (row: ResolutionCase) => void; onClose: () => void; onLock: (locked: boolean) => void; blocked: boolean}) {
  const [product, setProduct] = useState(items[0]?.product_id || '');
  const [quantity, setQuantity] = useState('1');
  const [kind, setKind] = useState('return');
  const [reason, setReason] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const uploads = useRef(new Map<File, string>());
  const command = useCommand(actor, onLock);
  const selected = items.find(item => item.product_id === product);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await command.run(`${root}/orders/${key(orderId)}/resolutions`, async check => {
      if (!selected || !Number.isInteger(Number(quantity)) || Number(quantity) < 1 || Number(quantity) > Math.min(50, selected.quantity)) throw new Error('Choose an item and a quantity from this order.');
      if (reason.trim().length < 20) throw new Error('Describe the issue in at least 20 characters.');
      return {product_id: product, quantity: Number(quantity), kind, reason: reason.trim(), document_ids: await uploadEvidence(files, uploads.current, check)};
    }, onSaved);
  };
  return <section className="rr-panel"><h3>Raise an item issue</h3><form className="rr-form" onSubmit={event => void submit(event)}><fieldset className="rr-fieldset" disabled={command.busy || command.uncertain || blocked}><div className="rr-form-grid"><label>Item<select aria-label="Item" value={product} onChange={event => {setProduct(event.target.value); setQuantity('1');}} required>{items.map(item => <option key={item.product_id} value={item.product_id}>{item.name} · ordered {item.quantity}</option>)}</select></label><label>Quantity affected<input type="number" min="1" max={Math.min(50, selected?.quantity || 1)} step="1" required value={quantity} onChange={event => setQuantity(event.target.value)}/></label><label>Request type<select aria-label="Request type" value={kind} onChange={event => setKind(event.target.value)}><option value="return">Return an item</option><option value="refund">Request a refund</option><option value="complaint">Report an order issue</option></select></label><label className="rr-span-all">Describe the issue<textarea required minLength={20} maxLength={2000} rows={4} value={reason} onChange={event => setReason(event.target.value)} placeholder="Explain what happened, which items are affected and the resolution you are requesting."/></label></div><PhotoInput files={files} onChange={setFiles}/><p className="rr-help">A case opens for review against the item terms saved at purchase. Wait for return instructions before sending goods. This request does not cancel the order or start a refund.</p></fieldset><CommandError error={command.error} uncertain={command.uncertain}/><div className="rr-actions"><button className="rr-button rr-primary" type="submit" disabled={command.busy || blocked}>{command.busy ? 'Uploading & submitting…' : command.uncertain ? 'Retry original request' : 'Submit issue for review'}</button><button className="rr-button" type="button" disabled={command.busy || command.uncertain || blocked} onClick={onClose}>Cancel</button></div></form></section>;
}

function Badge({value}: {value: string}) {
  const tone = ['resolved', 'processed', 'refunded', 'return_received'].includes(value) ? 'positive' : ['rejected', 'failed', 'outside_window', 'appealed'].includes(value) ? 'danger' : ['refund_pending', 'refund_approved', 'open', 'return_authorized'].includes(value) ? 'warning' : 'neutral';
  return <span className="rr-badge" data-tone={tone}>{words(value)}</span>;
}
function availableActions(row: ResolutionCase, mode: Mode): CaseAction[] {
  if (mode === 'admin') return [];
  if (row.allowed_actions) return row.allowed_actions;
  const actions: CaseAction[] = [];
  if (!isFinal(row) && !['refund_approved', 'refund_pending'].includes(row.state)) actions.push('reply');
  if (mode === 'customer') {
    if (row.state === 'return_authorized' && (!row.return_by || row.return_by > Date.now() / 1000)) actions.push('return_sent');
    if (row.state === 'rejected') actions.push('appeal');
  } else {
    if (['open', 'merchant_replied', 'appealed'].includes(row.state)) actions.push('authorize_return');
    if (row.state === 'return_sent') actions.push('return_received');
  }
  return actions;
}
function CaseCard({row, actor, mode, onSaved, onLock, blocked}: {row: ResolutionCase; actor: string; mode: Mode; onSaved: (row: ResolutionCase) => void; onLock: (locked: boolean) => void; blocked: boolean}) {
  const [action, setAction] = useState<CaseAction | 'decision' | null>(null);
  const [loading, setLoading] = useState(false);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const mounted = useRef(true);
  useEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);
  const reload = async () => {
    setLoading(true); setError('');
    try {
      const response = await operation<ResolutionCase>(`${root}/${mode === 'admin' ? 'admin/' : ''}resolutions/${key(row.id)}`, {}, {background: true, force: true, feedback: false});
      if (mounted.current && actorNow() === actor) onSaved(response);
    } catch (caught) {if (mounted.current && actorNow() === actor) setError(message(caught));}
    finally {if (mounted.current) setLoading(false);}
  };
  const done = (updated: ResolutionCase) => {onSaved(updated); setAction(null); setSuccess('The case was updated. Review its latest status and history below.');};
  const changeLock = (value: boolean) => {setLocked(value); onLock(value);};
  const actions = availableActions(row, mode);
  const decisions = row.allowed_decisions || (!['resolved', 'refund_approved', 'refund_pending'].includes(row.state) ? ['approve_refund', 'reject', 'resolve'] as Decision[] : []);
  return <article className="rr-card" aria-busy={loading}>
    <div className="rr-card-heading"><div><p className="rr-eyebrow">{words(row.kind)} request · {row.quantity} item{row.quantity === 1 ? '' : 's'}</p><h3>{row.item?.name || 'Order item'}</h3><p className="rr-help">Order {row.order_id} · Case {row.id}</p></div><Badge value={row.state}/></div>
    <p className="rr-request-description">{row.reason}</p>
    <dl className="rr-meta"><div><dt>Opened</dt><dd>{date(row.created_at)}</dd></div><div><dt>Latest update</dt><dd>{date(row.updated_at)}</dd></div>{row.return_by && <div><dt>Return by</dt><dd>{date(row.return_by)}</dd></div>}{row.return_receipt_at && <div><dt>Seller received return</dt><dd>{date(row.return_receipt_at)}</dd></div>}</dl>
    <PolicySummary row={row}/>
    {(row.response_target_at || row.resolution_target_at) && <div className="rr-targets"><dl className="rr-meta">{row.response_target_at && <div><dt>Response target</dt><dd>{date(row.response_target_at)}</dd></div>}{row.resolution_target_at && <div><dt>Resolution review target</dt><dd>{date(row.resolution_target_at)}</dd></div>}</dl><p className="rr-help">{row.target_note || 'These are review targets. Case progress and confirmed outcomes appear in the history.'}</p></div>}
    {row.decision_note && <p className="rr-notice"><strong>Review decision: </strong>{row.decision_note}</p>}{row.appeal_reason && <p className="rr-notice"><strong>Appeal: </strong>{row.appeal_reason}</p>}
    {(row.refund_amount_paise != null || row.refund_status || ['refund_approved', 'refund_pending'].includes(row.state)) && <RefundStatus row={row}/>}
    {success && <p className="rr-success" role="status"><Check size={16} aria-hidden="true"/>{success}</p>}{error && <p className="rr-error" role="alert">{error}</p>}
    {!action && <div className="rr-actions">{actions.map(command => <button className={`rr-button ${command === 'reply' ? '' : 'rr-primary'}`} key={command} disabled={loading || locked || blocked} onClick={() => {setSuccess(''); setAction(command);}}>{actionNames[command]}</button>)}{mode === 'admin' && decisions.length > 0 && <button className="rr-button rr-primary" disabled={loading || locked || blocked} onClick={() => setAction('decision')}>Review & decide</button>}<button className="rr-button" disabled={loading || locked || blocked} onClick={() => void reload()}><RefreshCw size={15} aria-hidden="true"/>{loading ? 'Refreshing…' : 'Refresh this case'}</button></div>}
    {action && action !== 'decision' && <CaseActionForm key={action} row={row} actor={actor} action={action} onSaved={done} onClose={() => setAction(null)} onLock={changeLock} blocked={blocked}/>}
    {action === 'decision' && <DecisionForm row={row} actor={actor} decisions={decisions} onSaved={done} onClose={() => setAction(null)} onLock={changeLock} blocked={blocked}/>}
    {mode === 'admin' && !action && (row.can_refund ?? ['refund_approved', 'refund_pending'].includes(row.state)) && <RefundAction row={row} actor={actor} onSaved={done} onLock={changeLock} blocked={blocked}/>}
    <details className="rr-history"><summary><MessageSquare size={16} aria-hidden="true"/>Case history & evidence <ChevronDown size={16} aria-hidden="true"/></summary>{!row.events?.length ? <p className="rr-empty">No case history is available yet.</p> : <ol className="rr-event-list">{row.events.map(event => <li className="rr-event" key={event.id}><div className="rr-event-heading"><strong>{event.role === 'shop' ? 'Seller' : event.role === 'operator' ? 'Repaido review' : 'Customer'} · {words(event.action)}</strong><time dateTime={new Date(event.at * 1000).toISOString()}>{date(event.at)}</time></div><p className="rr-request-description">{event.text}</p>{!!event.document_ids?.length && <div className="rr-photos">{event.document_ids.map((id, index) => <EvidencePhoto key={id} caseId={row.id} id={id} actor={actor} admin={mode === 'admin'} label={`${event.role === 'shop' ? 'Seller' : event.role === 'operator' ? 'Review' : 'Customer'} evidence photo ${index + 1}`}/>)}</div>}</li>)}</ol>}</details>
  </article>;
}
function PolicySummary({row}: {row: ResolutionCase}) {
  const policy = row.item?.return_policy;
  const text = typeof policy === 'string' ? policy : policy?.return_terms || policy?.terms || policy?.text || policy?.policy;
  const days = typeof policy === 'object' && policy ? policy.window_days ?? policy.return_days : undefined;
  const state = row.policy_window?.status || 'manual_review';
  const descriptions = {within_window: 'The request is within the recorded policy window. Eligibility still needs review.', outside_window: 'The recorded policy window has passed. Your case needs an individual review.', manual_review: 'Saved return terms or a reliable delivery date are unavailable. Repaido must review this case individually.', not_received: 'Receipt of the goods has not been recorded. Delivery and return eligibility need review.'};
  return <div className="rr-policy"><h4>Terms saved at purchase</h4>{text ? <p>{text}</p> : <p>No return terms are available in this purchase record.</p>}{days != null && <p className="rr-help">Recorded policy window: {days} day{days === 1 ? '' : 's'}.</p>}{typeof policy === 'object' && policy?.warranty_terms && <p className="rr-help">Warranty terms: {policy.warranty_terms}{policy.warranty_days != null ? ` · ${policy.warranty_days} days` : ''}</p>}<p className="rr-help">{descriptions[state]}</p>{row.policy_window?.deadline_at && <p className="rr-help">Recorded window ends {date(row.policy_window.deadline_at)}.</p>}</div>;
}
function RefundStatus({row}: {row: ResolutionCase}) {
  const confirmed = row.refund_status === 'processed';
  return <div className="rr-refund"><div className="rr-panel-heading"><h4>{confirmed ? 'Refund confirmed by payment provider' : row.refund_status === 'failed' ? 'Refund failed · another review is required' : row.state === 'refund_approved' ? 'Refund approved for processing' : 'Refund status'}</h4>{row.refund_status && <Badge value={row.refund_status}/>}</div>{row.refund_amount_paise != null && <strong className="rr-refund-amount">{money(row.refund_amount_paise)}</strong>}<p className="rr-help">{row.recovery || (row.refund_status === 'failed' ? 'The provider marked this attempt as failed. Repaido must review a new approval before another refund attempt.' : confirmed ? 'The provider has confirmed this refund. Your bank or payment app determines when the credit is visible.' : 'Approval and a processing request are separate from a completed refund. Money is treated as refunded only after provider verification.')}</p></div>;
}

type FormProps = {row: ResolutionCase; actor: string; onSaved: (row: ResolutionCase) => void; onClose: () => void; onLock: (locked: boolean) => void; blocked: boolean};
function CaseActionForm({row, actor, action, onSaved, onClose, onLock, blocked}: FormProps & {action: CaseAction}) {
  const [note, setNote] = useState('');
  const [returnBy, setReturnBy] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const uploads = useRef(new Map<File, string>());
  const command = useCommand(actor, onLock);
  const notes: Record<CaseAction, string> = {
    reply: 'Add relevant details or evidence for the other case participants.',
    authorize_return: 'Give the customer clear return instructions and a future return deadline. Authorising a return does not approve or issue a refund.',
    return_sent: 'Record when and how you returned the item. Include a tracking number, handover receipt or the agreed return reference.',
    return_received: 'Confirm the returned quantity and condition. Add at least one receipt photo. Receipt confirmation does not send a refund.',
    appeal: 'Explain why this decision should be reconsidered and include any new supporting evidence.',
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await command.run(`${root}/resolutions/${key(row.id)}/actions`, async check => {
      if (note.trim().length < 10) throw new Error('Add at least 10 characters explaining this update.');
      const deadline = returnBy ? new Date(returnBy).getTime() / 1000 : null;
      if (action === 'authorize_return' && (!deadline || deadline <= Date.now() / 1000 || deadline > Date.now() / 1000 + 90 * 86400)) throw new Error('Choose a return deadline within the next 90 days.');
      return {expected_version: row.version, action, note: note.trim(), document_ids: await uploadEvidence(files, uploads.current, check, action === 'return_received'), ...(action === 'authorize_return' ? {return_by: deadline} : {})};
    }, onSaved);
  };
  return <form className="rr-form rr-action-form" onSubmit={event => void submit(event)}><h4>{actionNames[action]}</h4><p className="rr-help">{notes[action]}</p><fieldset className="rr-fieldset" disabled={command.busy || command.uncertain || blocked}><label>{action === 'appeal' ? 'Reason for appeal' : action === 'authorize_return' ? 'Return instructions & conditions' : action === 'return_received' ? 'Received goods & condition' : action === 'return_sent' ? 'Return dispatch or handover details' : 'Your reply'}<textarea required minLength={10} maxLength={2000} rows={3} value={note} onChange={event => setNote(event.target.value)}/></label>{action === 'authorize_return' && <label>Return deadline (your local time)<input type="datetime-local" required value={returnBy} onChange={event => setReturnBy(event.target.value)}/></label>}<PhotoInput files={files} onChange={setFiles} required={action === 'return_received'}/></fieldset><CommandError error={command.error} uncertain={command.uncertain}/><div className="rr-actions"><button className="rr-button rr-primary" type="submit" disabled={command.busy || blocked}>{command.busy ? 'Uploading & saving…' : command.uncertain ? 'Retry original update' : action === 'reply' ? 'Send reply' : actionNames[action]}</button><button className="rr-button" type="button" disabled={command.busy || command.uncertain || blocked} onClick={onClose}>Cancel</button></div></form>;
}
function DecisionForm({row, actor, decisions, onSaved, onClose, onLock, blocked}: FormProps & {decisions: Decision[]}) {
  const [decision, setDecision] = useState<Decision>(decisions[0] || 'resolve');
  const [note, setNote] = useState('');
  const [reference, setReference] = useState('');
  const [amount, setAmount] = useState('');
  const command = useCommand(actor, onLock);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await command.run(`${root}/admin/resolutions/${key(row.id)}/decision`, () => {
      if (note.trim().length < 20 || reference.trim().length < 8) throw new Error('Provide a review reason of at least 20 characters and an evidence reference of at least 8 characters.');
      const refundAmount = decision === 'approve_refund' ? businessAmount(amount) : 0;
      if (decision === 'approve_refund' && (refundAmount <= 0 || refundAmount > row.max_refund_paise)) throw new Error('Enter a positive refund amount within the current case ceiling.');
      return {expected_version: row.version, decision, note: note.trim(), evidence_reference: reference.trim(), ...(decision === 'approve_refund' ? {refund_amount_paise: refundAmount} : {})};
    }, onSaved);
  };
  return <form className="rr-form rr-action-form" onSubmit={event => void submit(event)}><h4>Record a review decision</h4><p className="rr-help">Review the saved seller terms, delivery record, case history and evidence. Refund approval is followed by a separate payment-provider action.</p><fieldset className="rr-fieldset" disabled={command.busy || command.uncertain || blocked}><div className="rr-form-grid"><label>Decision<select aria-label="Decision" value={decision} onChange={event => setDecision(event.target.value as Decision)}>{decisions.map(value => <option key={value} value={value}>{value === 'approve_refund' ? 'Approve a refund amount' : value === 'reject' ? 'Reject with explanation' : 'Resolve without a refund'}</option>)}</select></label>{decision === 'approve_refund' && <label>Approved refund amount (₹)<input type="number" min="0.01" max={row.max_refund_paise / 100} step="0.01" required value={amount} onChange={event => setAmount(event.target.value)} inputMode="decimal"/><span className="rr-help">Current review ceiling: {money(row.max_refund_paise)}. This is not a promised refund.</span></label>}<label className="rr-span-all">Review reason<textarea required minLength={20} maxLength={2000} rows={3} value={note} onChange={event => setNote(event.target.value)}/></label><label className="rr-span-all">Evidence or investigation reference<input required minLength={8} maxLength={300} value={reference} onChange={event => setReference(event.target.value)}/></label></div></fieldset><CommandError error={command.error} uncertain={command.uncertain}/><div className="rr-actions"><button className={`rr-button ${decision === 'reject' ? 'rr-danger' : 'rr-primary'}`} type="submit" disabled={command.busy || blocked}>{command.busy ? 'Saving decision…' : command.uncertain ? 'Retry original decision' : 'Save review decision'}</button><button className="rr-button" type="button" disabled={command.busy || command.uncertain || blocked} onClick={onClose}>Cancel</button></div></form>;
}
function RefundAction({row, actor, onSaved, onLock, blocked}: Omit<FormProps, 'onClose'>) {
  const [confirmed, setConfirmed] = useState(false);
  const command = useCommand(actor, onLock);
  const reconcile = row.state === 'refund_pending' || ['submitting', 'pending', 'processed'].includes(row.refund_status || '');
  const submit = async (event: FormEvent<HTMLFormElement>) => {event.preventDefault(); await command.run(`${root}/admin/resolutions/${key(row.id)}/refund`, () => {if (!reconcile && !confirmed) throw new Error('Confirm the approved amount before submitting the refund.'); return {};}, onSaved, false);};
  return <form className="rr-form rr-refund-action" onSubmit={event => void submit(event)}><h4>{reconcile ? 'Check the refund outcome' : 'Process the approved refund'}</h4><p className="rr-help">{reconcile ? 'Check this existing refund with the payment provider. An uncertain result must be reconciled before another refund can be considered.' : `Submit the approved ${money(row.refund_amount_paise || 0)} refund through the payment provider. The provider must confirm the result before this case shows a completed refund.`}</p>{!reconcile && <label className="rr-check"><input type="checkbox" required checked={confirmed} disabled={command.busy || command.uncertain || blocked} onChange={event => setConfirmed(event.target.checked)}/>I checked the approved amount and authorise this refund submission.</label>}<CommandError error={command.error} uncertain={command.uncertain}/><button className="rr-button rr-primary" type="submit" disabled={command.busy || blocked || !reconcile && !confirmed}>{command.busy ? 'Checking payment provider…' : reconcile || command.uncertain ? 'Check existing refund with provider' : 'Submit approved refund'}</button></form>;
}

function EvidencePhoto({caseId, id, actor, admin, label}: {caseId: string; id: string; actor: string; admin: boolean; label: string}) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const objectUrl = useRef('');
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {mounted.current = true; return () => {mounted.current = false; controller.current?.abort(); if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);};}, []);
  const close = () => {if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); objectUrl.current = ''; setUrl('');};
  const open = async () => {
    if (loading) return;
    setLoading(true); setError(''); controller.current = new AbortController();
    try {
      await auth.authStateReady();
      const user = auth.currentUser;
      const token = user ? await user.getIdToken() : localStorage.getItem('repaido.token');
      if (!token || actorNow() !== actor) throw new Error('Your account changed. Reopen the case to view its evidence.');
      const response = await apiFetch(`/api/operations${root}/${admin ? 'admin/' : ''}resolutions/${key(caseId)}/evidence/${key(id)}`, {headers: {Authorization: `Bearer ${token}`}, signal: controller.current.signal}, {background: true, feedback: false});
      if (!response.ok) throw new Error(response.status === 403 || response.status === 404 ? 'This evidence is unavailable for your account.' : 'Evidence could not load. Please retry.');
      const blob = await response.blob();
      if (!['image/jpeg', 'image/png'].includes(blob.type.split(';')[0])) throw new Error('The server did not return a supported evidence photo.');
      if (!mounted.current || actorNow() !== actor || controller.current.signal.aborted) return;
      objectUrl.current = URL.createObjectURL(blob); setUrl(objectUrl.current);
    } catch (caught) {if (mounted.current && actorNow() === actor && !controller.current.signal.aborted) setError(message(caught));}
    finally {if (mounted.current) setLoading(false);}
  };
  return <div className="rr-photo"><button className="rr-button rr-photo-button" disabled={loading} onClick={() => void open()}><FileImage size={17} aria-hidden="true"/>{loading ? 'Loading photo…' : label}</button>{error && <p className="rr-error" role="alert">{error}</p>}{url && <Modal title={label} onClose={close}><img className="rr-modal-image" src={url} alt={label}/><p className="rr-help">Private evidence for this resolution case.</p></Modal>}</div>;
}
