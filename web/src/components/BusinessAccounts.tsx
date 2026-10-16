import {useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode} from 'react';
import {onIdTokenChanged} from 'firebase/auth';
import {Building2, CalendarClock, Check, ClipboardList, Copy, FileText, Plus, RefreshCw, ShieldCheck, Users} from 'lucide-react';
import {auth} from '../firebase';
import {money, operation} from '../services/operations';
import './business-accounts.css';

type Role = 'owner' | 'manager' | 'staff' | 'viewer';
type Account = {id: string; name: string; kind: 'business' | 'apartment'; role: Role};
type Property = {id: string; name: string; address: string; city: string; monthly_budget_paise: number; version: number; archived: boolean};
type Member = {user_id: string; name: string; role: Role; status: string; version: number};
type RecordKind = 'job' | 'home_plan' | 'contract' | 'retail';
type Request = {
  id: string; property_id: string; title: string; description: string; category: 'repair' | 'home' | 'contract' | 'retail';
  estimated_paise: number; status: string; requested_by: string; requested_name: string; needed_on: string; version: number;
  decision_reason?: string; record?: {kind: RecordKind; id: string}; can_decide?: boolean; can_cancel?: boolean; can_link?: boolean;
};
type Maintenance = {id: string; property_id: string; title: string; due_on: string; repeat_months: number; status: string; version: number; assigned_to?: string; completed_at?: number; can_complete?: boolean; can_cancel?: boolean};
type Invitation = {id: string; role: Role; status: string; expires_at: number | string};
type Invoice = {id: string; source_kind: string; source_id: string; property_id: string; label: string; status: string; amount_paise: number; paid_paise: number; issued_at: number | string; refunded_paise?: number; document_type?: string; source?: string; exceeds_approval?: boolean};
type Detail = {
  user_id: string; account: {id: string; name: string; kind: Account['kind']; version: number}; role: Role;
  members: Member[]; properties: Property[]; requests: Request[]; maintenance: Maintenance[]; invitations?: Invitation[];
  summary: {approved_estimate_paise: number; pending_estimate_paise: number};
  statement: {rows: Invoice[]; total_issued_paise: number; total_paid_paise: number; outstanding_paise: number; estimate_paise: number; note: string; refunded_paise?: number; unavailable_request_ids?: string[]};
};
type MutationOptions = {method?: 'POST' | 'PUT'; success: string; after?: (result: unknown) => void};
type Mutate = (path: string, body: object, options: MutationOptions) => Promise<boolean>;
const root = '/business-accounts';
const pathId = (id: string) => encodeURIComponent(id);
const words = (value: string) => value.replaceAll('_', ' ').replace(/^./, character => character.toUpperCase());
const recordNames: Record<RecordKind, string> = {job: 'Service booking', home_plan: 'Home plan', contract: 'Contract', retail: 'Market order'};
const categoryNames = {repair: 'Repair & service', home: 'Home service plan', contract: 'Custom contract', retail: 'Market purchase'};
const roleNotes: Record<Role, string> = {
  owner: 'Manage the account, team, properties and approvals.',
  manager: 'Manage properties, maintenance and other members’ requests.',
  staff: 'Request work and complete maintenance assigned to you.',
  viewer: 'View properties, requests, maintenance and the account statement.',
};
const today = () => new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
function date(value: string | number | undefined) {
  if (!value) return '—';
  const parsed = typeof value === 'number' ? new Date(value * 1000) : new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00+05:30` : value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleDateString('en-IN', {day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata'});
}
const fields = (event: FormEvent<HTMLFormElement>) => {event.preventDefault(); return Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;};
const rupees = (value: string) => Math.round(Number(value || 0) * 100);
const errorText = (error: unknown) => error instanceof Error ? error.message : 'This action could not finish. Please try again.';

function Badge({value}: {value: string}) {
  const tone = ['approved', 'active', 'completed', 'paid'].includes(value) ? 'positive' : ['pending', 'scheduled', 'overdue'].includes(value) ? 'warning' : ['rejected', 'revoked', 'cancelled'].includes(value) ? 'danger' : 'neutral';
  return <span className="ba-badge" data-tone={tone}>{words(value)}</span>;
}
function Empty({children}: {children: ReactNode}) {return <p className="ba-empty">{children}</p>;}
function useRequestKey() {
  const previous = useRef({payload: '', id: ''});
  return (payload: object) => {
    const encoded = JSON.stringify(payload);
    if (encoded !== previous.current.payload) previous.current = {payload: encoded, id: crypto.randomUUID()};
    return previous.current.id;
  };
}

export function BusinessAccounts({onSignIn}: {onSignIn?: () => void}) {
  const sawFirebase = useRef(!!auth.currentUser);
  const actorNow = () => auth.currentUser?.uid || (!sawFirebase.current ? localStorage.getItem('repaido.token') || '' : '');
  const [actor, setActor] = useState(actorNow);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const sync = () => {if (auth.currentUser) sawFirebase.current = true; setActor(actorNow());};
    const unsubscribe = onIdTokenChanged(auth, () => {sync(); setReady(true);});
    const storage = (event: StorageEvent) => {if (event.key === 'repaido.token' || event.key === null) sync();};
    window.addEventListener('storage', storage);
    window.addEventListener('repaido:identity-changed', sync);
    return () => {unsubscribe(); window.removeEventListener('storage', storage); window.removeEventListener('repaido:identity-changed', sync);};
  }, []);
  return <section className="business-accounts" aria-label="Business and apartment accounts">
    <header className="ba-header"><div><p className="ba-eyebrow">A shared place for your properties</p><h1>Business & apartment accounts</h1><p>Coordinate requests, approvals and maintenance with your team.</p></div><Building2 size={38} aria-hidden="true"/></header>
    {!ready ? <p className="ba-loading" role="status">Checking your account…</p> : !actor ? <div className="ba-panel"><h2>Your properties. One account.</h2><p>Sign in to manage a business, apartment association or a team invitation.</p>{onSignIn ? <button className="ba-button ba-primary" onClick={onSignIn}>Sign in to continue</button> : <p className="ba-help">Open Account and sign in to continue.</p>}</div> : <AccountWorkspace key={actor} actor={actor}/>}
  </section>;
}

function AccountWorkspace({actor}: {actor: string}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selected, setSelected] = useState('');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [accountForm, setAccountForm] = useState<'create' | 'join' | null>(null);
  const [tab, setTab] = useState('Requests');
  const mounted = useRef(true);
  const pending = useRef(false);
  const readSequence = useRef(0);
  const activeId = useRef(selected);
  activeId.current = selected;
  const actorMatches = () => (auth.currentUser?.uid || localStorage.getItem('repaido.token') || '') === actor;
  const loadAccounts = useCallback(async () => {
    const result = await operation<{accounts: Account[]}>(root, {}, {background: true, force: true, feedback: false});
    if (!mounted.current || !actorMatches()) return;
    setAccounts(result.accounts);
    setSelected(current => result.accounts.some(account => account.id === current) ? current : result.accounts[0]?.id || '');
  }, [actor]);
  const loadDetail = useCallback(async (id: string) => {
    const sequence = ++readSequence.current;
    setDetailLoading(true);
    try {
      const result = await operation<Detail>(`${root}/${pathId(id)}`, {}, {background: true, force: true, feedback: false});
      if (mounted.current && actorMatches() && sequence === readSequence.current && activeId.current === id) setDetail(result);
    } catch (caught) {
      if (mounted.current && sequence === readSequence.current) {setDetail(null); throw caught;}
    } finally {
      if (mounted.current && sequence === readSequence.current) setDetailLoading(false);
    }
  }, [actor]);
  useEffect(() => {
    mounted.current = true;
    void loadAccounts().catch(caught => {if (mounted.current) setError(errorText(caught));}).finally(() => {if (mounted.current) setLoading(false);});
    return () => {mounted.current = false; readSequence.current++;};
  }, [loadAccounts]);
  useEffect(() => {
    setDetail(null);
    setError('');
    setSuccess('');
    if (selected) void loadDetail(selected).catch(caught => {if (mounted.current) setError(errorText(caught));});
  }, [selected, loadDetail]);
  const refresh = async () => {
    setError('');
    setLoading(true);
    try {await loadAccounts(); if (selected) await loadDetail(selected);} catch (caught) {if (mounted.current) setError(errorText(caught));} finally {if (mounted.current) setLoading(false);}
  };
  const mutate: Mutate = async (path, body, options) => {
    if (pending.current || !actorMatches()) return false;
    pending.current = true;
    setBusy(true);
    setError('');
    setSuccess('');
    let saved = false;
    try {
      const result = await operation(path, {method: options.method || 'POST', body: JSON.stringify(body)}, {background: true, feedback: false});
      if (!mounted.current || !actorMatches()) return false;
      saved = true;
      options.after?.(result);
      setSuccess(options.success);
      await loadAccounts();
      if (activeId.current) await loadDetail(activeId.current);
      return true;
    } catch (caught) {
      if (mounted.current && actorMatches()) setError(saved ? `Saved, but the latest account data could not load. Refresh to see the change. ${errorText(caught)}` : errorText(caught));
      return saved;
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const data = detail?.account.id === selected ? detail : null;
  const choose = (id: string) => {setSelected(id); setAccountForm(null); setTab('Requests');};
  return <>
    <div className="ba-heading-actions"><div className="ba-workspace-picker"><label>Account<select aria-label="Account" value={selected} disabled={busy || loading || !accounts.length} onChange={event => choose(event.target.value)}>{!accounts.length && <option value="">No accounts yet</option>}{accounts.map(account => <option key={account.id} value={account.id}>{account.name} · {words(account.role)}</option>)}</select></label></div><button className="ba-button" disabled={busy} onClick={() => setAccountForm(accountForm === 'create' ? null : 'create')}><Plus size={17} aria-hidden="true"/> New account</button><button className="ba-button" disabled={busy} onClick={() => setAccountForm(accountForm === 'join' ? null : 'join')}>Join with a code</button><button className="ba-button ba-quiet" disabled={busy || loading || detailLoading} onClick={() => void refresh()} aria-label="Refresh business accounts"><RefreshCw size={17} aria-hidden="true"/> Refresh</button></div>
    {error && <div className="ba-error" role="alert"><p>{error}</p><button className="ba-button" disabled={busy || loading || detailLoading} onClick={() => void refresh()}>Reload account</button></div>}
    {success && <p className="ba-success" role="status"><Check size={17} aria-hidden="true"/>{success}</p>}
    {accountForm && <AccountForm key={accountForm} mode={accountForm} busy={busy} mutate={mutate} onCancel={() => setAccountForm(null)} onAccount={id => {activeId.current = id; setSelected(id); setAccountForm(null);}}/>}
    {loading && !accounts.length ? <p className="ba-loading" role="status">Loading your accounts…</p> : !accounts.length && !accountForm && !error ? <div className="ba-panel"><h2>Bring your properties and team together</h2><p>Create an account, add a property and set its monthly approval budget. Your team can then request work for independent approval.</p><p className="ba-help">Already invited? Use the invitation code shared by your account owner.</p><button className="ba-button ba-primary" onClick={() => setAccountForm('create')}>Create your first account</button></div> : null}
    {detailLoading && !data && <p className="ba-loading" role="status">Loading the account workspace…</p>}
    {data && <div className="ba-workspace" aria-busy={busy || detailLoading}>
      <div className="ba-panel-heading"><div><p className="ba-eyebrow">{data.account.kind === 'apartment' ? 'Apartment association' : 'Business account'}</p><h2>{data.account.name}</h2><p className="ba-muted">{roleNotes[data.role]}</p></div><Badge value={data.role}/></div>
      <div className="ba-summary-grid"><Stat label="Issued financial records" value={money(data.statement.total_issued_paise)} note="Service statements & verified receipts"/><Stat label="Recorded payments" value={money(data.statement.total_paid_paise)} note="Net confirmed payments after refunds"/><Stat label="Currently due" value={money(data.statement.outstanding_paise)} note="Pay within the original booking or order"/><Stat label="Awaiting approval" value={money(data.summary.pending_estimate_paise)} note="Internal estimates · no payment due"/></div>
      <nav className="ba-tabs" aria-label="Account workspace sections">{[{name: 'Requests', icon: ClipboardList}, {name: 'Properties', icon: Building2}, {name: 'Maintenance', icon: CalendarClock}, {name: 'Team', icon: Users}, {name: 'Statement', icon: FileText}].map(({name, icon: Icon}) => <button key={name} aria-current={tab === name ? 'page' : undefined} onClick={() => setTab(name)} disabled={busy}><Icon size={17} aria-hidden="true"/>{name}</button>)}</nav>
      <div key={`${selected}:${tab}`} className="ba-section">{tab === 'Requests' && <Requests data={data} busy={busy} mutate={mutate}/>} {tab === 'Properties' && <Properties data={data} busy={busy} mutate={mutate}/>} {tab === 'Maintenance' && <MaintenanceSection data={data} busy={busy} mutate={mutate}/>} {tab === 'Team' && <Team data={data} busy={busy} mutate={mutate}/>} {tab === 'Statement' && <Statement data={data}/>}</div>
    </div>}
  </>;
}

function Stat({label, value, note}: {label: string; value: string; note: string}) {return <div className="ba-stat"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;}

function AccountForm({mode, busy, mutate, onCancel, onAccount}: {mode: 'create' | 'join'; busy: boolean; mutate: Mutate; onCancel: () => void; onAccount: (id: string) => void}) {
  const requestKey = useRequestKey();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    const values = fields(event);
    const payload = mode === 'create' ? {name: values.name.trim(), kind: values.kind} : {token: values.token.trim()};
    await mutate(mode === 'create' ? root : `${root}/invitations/accept`, mode === 'create' ? {...payload, request_id: requestKey(payload)} : payload, {success: mode === 'create' ? 'Account created. Add your first property to get started.' : 'Invitation accepted. Your account is ready.', after: result => {
      const created = result as {account?: {id: string}; account_id?: string; id?: string};
      const id = created.account?.id || created.account_id || created.id;
      if (id) onAccount(id);
    }});
  };
  return <section className="ba-panel"><h2>{mode === 'create' ? 'Create an account' : 'Accept an invitation'}</h2><form className="ba-form" onSubmit={event => void submit(event)}><fieldset className="ba-fieldset" disabled={busy}>{mode === 'create' ? <div className="ba-form-grid"><label>Account name<input name="name" required minLength={2} maxLength={120} placeholder="Business or apartment association" autoComplete="organization"/></label><label>Account type<select aria-label="Account type" name="kind" defaultValue="business"><option value="business">Business</option><option value="apartment">Apartment association</option></select></label></div> : <label>Invitation code<input name="token" required minLength={30} maxLength={160} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="Paste the code shared with you"/></label>}<p className="ba-help">{mode === 'create' ? 'You will be the account owner. Add a manager for independent approval of your own requests.' : 'Join using your signed-in Repaido account. The owner controls the access attached to this code.'}</p><div className="ba-form-actions"><button className="ba-button ba-primary" type="submit">{busy ? 'Saving…' : mode === 'create' ? 'Create account' : 'Join account'}</button><button className="ba-button" type="button" onClick={onCancel}>Cancel</button></div></fieldset></form></section>;
}

type SectionProps = {data: Detail; busy: boolean; mutate: Mutate};
function Properties({data, busy, mutate}: SectionProps) {
  const [editing, setEditing] = useState<Property | 'new' | null>(null);
  const canManage = ['owner', 'manager'].includes(data.role);
  const month = today().slice(0, 7);
  return <><div className="ba-panel-heading"><div><h2>Properties & monthly budgets</h2><p className="ba-muted">Approval limits are tracked by the month work is needed.</p></div>{canManage && <button className="ba-button ba-primary" disabled={busy} onClick={() => setEditing('new')}><Plus size={17} aria-hidden="true"/>Add property</button>}</div>
    <p className="ba-notice">Budgets control internal approvals. They do not create a purchase, prepaid balance or payment. A ₹0 budget allows no new spend approval.</p>
    {editing && <PropertyForm key={editing === 'new' ? 'new' : `${editing.id}:${editing.version}`} property={editing === 'new' ? undefined : editing} accountId={data.account.id} busy={busy} mutate={mutate} onClose={() => setEditing(null)}/>}
    <div className="ba-property-grid">{data.properties.map(property => {
      const reserved = data.requests.filter(request => request.property_id === property.id && request.status === 'approved' && request.needed_on?.slice(0, 7) === month).reduce((sum, request) => sum + request.estimated_paise, 0);
      return <article className="ba-card" key={property.id}><div className="ba-card-heading"><h3>{property.name}</h3>{property.archived && <Badge value="archived"/>}</div><p className="ba-muted">{property.address}<br/>{property.city}</p><dl className="ba-meta"><div><dt>Monthly approval budget</dt><dd>{money(property.monthly_budget_paise)}</dd></div><div><dt>Approved estimates this month</dt><dd>{money(reserved)}</dd></div><div><dt>Remaining approval allowance</dt><dd>{money(Math.max(0, property.monthly_budget_paise - reserved))}</dd></div></dl>{canManage && <button className="ba-button" disabled={busy} onClick={() => setEditing(property)}>Edit property & budget</button>}</article>;
    })}</div>{!data.properties.length && <Empty>{canManage ? 'Add your first property and a monthly approval budget before requesting work.' : 'The account owner or a manager can add properties and approval budgets.'}</Empty>}
  </>;
}
function PropertyForm({property, accountId, busy, mutate, onClose}: {property?: Property; accountId: string; busy: boolean; mutate: Mutate; onClose: () => void}) {
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    const values = fields(event);
    const payload = {name: values.name.trim(), address: values.address.trim(), city: values.city.trim(), monthly_budget_paise: rupees(values.budget), ...(property ? {expected_version: property.version, archived: values.archived === 'on'} : {})};
    if (await mutate(`${root}/${pathId(accountId)}/properties${property ? `/${pathId(property.id)}` : ''}`, payload, {method: property ? 'PUT' : 'POST', success: property ? 'Property updated.' : 'Property added.'})) onClose();
  };
  return <div className="ba-panel"><h3>{property ? `Edit ${property.name}` : 'Add a property'}</h3><form className="ba-form" onSubmit={event => void submit(event)}><fieldset className="ba-fieldset" disabled={busy}><div className="ba-form-grid"><label>Property name<input name="name" required minLength={2} maxLength={120} defaultValue={property?.name}/></label><label>City<input name="city" required minLength={2} maxLength={80} defaultValue={property?.city} autoComplete="address-level2"/></label><label className="ba-span-all">Address<textarea name="address" required minLength={10} maxLength={500} rows={2} defaultValue={property?.address} autoComplete="street-address"/></label><label>Monthly approval budget (₹)<input name="budget" type="number" min="0" max="500000000" step="0.01" inputMode="decimal" required defaultValue={property ? property.monthly_budget_paise / 100 : ''}/></label>{property && <label className="ba-check"><input name="archived" type="checkbox" defaultChecked={property.archived}/>Archive this property</label>}</div>{property && <p className="ba-help">Archived properties keep their history and cannot receive new requests.</p>}<div className="ba-form-actions"><button className="ba-button ba-primary" type="submit">{busy ? 'Saving…' : 'Save property'}</button><button className="ba-button" type="button" onClick={onClose}>Cancel</button></div></fieldset></form></div>;
}

function Requests({data, busy, mutate}: SectionProps) {
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState('all');
  const [propertyFilter, setPropertyFilter] = useState('all');
  const canRequest = data.role !== 'viewer';
  const activeProperties = data.properties.filter(property => !property.archived);
  const requests = data.requests.filter(request => (filter === 'all' || request.status === filter) && (propertyFilter === 'all' || request.property_id === propertyFilter));
  return <><div className="ba-panel-heading"><div><h2>Requests & approvals</h2><p className="ba-muted">Plan the work, agree the estimate, then arrange it through Repaido.</p></div>{canRequest && <button className="ba-button ba-primary" disabled={busy || !activeProperties.length} onClick={() => setCreating(true)}><Plus size={17} aria-hidden="true"/>Request work</button>}</div>
    <p className="ba-notice"><ShieldCheck size={18} aria-hidden="true"/><span>Approval is an internal budget decision. It does not book a service, place an order or collect payment. Requests need approval from another owner or manager.</span></p>
    {canRequest && !activeProperties.length && <p className="ba-help">An owner or manager must add an active property before work can be requested.</p>}
    {creating && <RequestForm data={data} busy={busy} mutate={mutate} onClose={() => setCreating(false)}/>}
    <div className="ba-inline-form"><label>Request status<select aria-label="Request status" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All requests</option>{['pending', 'approved', 'rejected', 'cancelled'].map(value => <option value={value} key={value}>{words(value)}</option>)}</select></label><label>Property<select aria-label="Filter requests by property" value={propertyFilter} onChange={event => setPropertyFilter(event.target.value)}><option value="all">All properties</option>{data.properties.map(property => <option key={property.id} value={property.id}>{property.name}</option>)}</select></label></div>
    <div className="ba-card-list">{requests.map(request => <RequestCard key={`${request.id}:${request.version}`} request={request} data={data} busy={busy} mutate={mutate}/>)}</div>{!requests.length && <Empty>{data.requests.length ? 'No requests match these filters.' : 'No requests yet. Add a request to give your team a clear scope and estimate to approve.'}</Empty>}
  </>;
}
function RequestForm({data, busy, mutate, onClose}: SectionProps & {onClose: () => void}) {
  const requestKey = useRequestKey();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    const values = fields(event);
    const payload = {property_id: values.property_id, title: values.title.trim(), description: values.description.trim(), category: values.category, estimated_paise: rupees(values.estimate), needed_on: values.needed_on};
    if (await mutate(`${root}/${pathId(data.account.id)}/requests`, {...payload, request_id: requestKey(payload)}, {success: 'Request sent for independent approval.'})) onClose();
  };
  return <div className="ba-panel"><h3>Request work or a purchase</h3><form className="ba-form" onSubmit={event => void submit(event)}><fieldset className="ba-fieldset" disabled={busy}><div className="ba-form-grid"><label>Property<select aria-label="Property" name="property_id" required defaultValue=""><option value="" disabled>Choose a property</option>{data.properties.filter(property => !property.archived).map(property => <option value={property.id} key={property.id}>{property.name}</option>)}</select></label><label>Work type<select aria-label="Work type" name="category" defaultValue="repair">{Object.entries(categoryNames).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label className="ba-span-all">Request title<input name="title" required minLength={3} maxLength={150} placeholder="What needs to be done?"/></label><label className="ba-span-all">Scope & requirements<textarea name="description" required minLength={10} maxLength={2000} rows={3} placeholder="Describe the work, location details and any requirements."/></label><label>Estimated cost (₹)<input name="estimate" type="number" min="0.01" max="500000000" step="0.01" required inputMode="decimal"/></label><label>Needed on<input name="needed_on" type="date" required min={today()} defaultValue={today()}/></label></div><p className="ba-help">The estimate reserves approval allowance in the month of the needed date. Actual charges come from the booking, plan, contract or order you link after approval.</p><div className="ba-form-actions"><button className="ba-button ba-primary" type="submit">{busy ? 'Sending…' : 'Send for approval'}</button><button className="ba-button" type="button" onClick={onClose}>Cancel</button></div></fieldset></form></div>;
}
function RequestCard({request, data, busy, mutate}: SectionProps & {request: Request}) {
  const [action, setAction] = useState<'approve' | 'reject' | 'cancel' | 'link' | null>(null);
  const mine = request.requested_by === data.user_id;
  const canDecide = request.can_decide ?? (['owner', 'manager'].includes(data.role) && !mine && request.status === 'pending');
  const canCancel = request.can_cancel ?? (data.role !== 'viewer' && mine && ['pending', 'approved'].includes(request.status) && !request.record);
  const canLink = request.can_link ?? (data.role !== 'viewer' && mine && request.status === 'approved' && !request.record);
  const property = data.properties.find(item => item.id === request.property_id);
  const submitDecision = async (event: FormEvent<HTMLFormElement>) => {
    const values = fields(event);
    if (await mutate(`${root}/${pathId(data.account.id)}/requests/${pathId(request.id)}/decision`, {expected_version: request.version, action, reason: values.reason.trim()}, {success: action === 'approve' ? 'Request approved internally. The requester can now arrange and link the work.' : action === 'reject' ? 'Request rejected.' : 'Request cancelled.'})) setAction(null);
  };
  return <article className="ba-card"><div className="ba-card-heading"><div><p className="ba-eyebrow">{property?.name || 'Property'} · {categoryNames[request.category]}</p><h3>{request.title}</h3></div><Badge value={request.status}/></div><p className="ba-request-description">{request.description}</p><dl className="ba-meta"><div><dt>Requested by</dt><dd>{request.requested_name || 'Team member'}{mine ? ' (you)' : ''}</dd></div><div><dt>Needed on</dt><dd>{date(request.needed_on)}</dd></div><div><dt>Internal estimate</dt><dd>{money(request.estimated_paise)}</dd></div></dl>{request.decision_reason && <p className="ba-help">Decision note: {request.decision_reason}</p>}{request.record && <p className="ba-notice">Linked {recordNames[request.record.kind].toLowerCase()} · {request.record.id}. Invoices and recorded payments appear in Statement when available.</p>}{mine && request.status === 'pending' && <p className="ba-help">Another owner or manager must review this request. You cannot approve your own request.</p>}{canLink && <p className="ba-help">Arrange this approved work through Repaido, then link your own booking, plan, contract or order below.</p>}
    {!action && <div className="ba-card-actions">{canDecide && <><button className="ba-button ba-primary" disabled={busy} onClick={() => setAction('approve')}>Review & approve</button><button className="ba-button ba-danger" disabled={busy} onClick={() => setAction('reject')}>Reject request</button></>}{canLink && <button className="ba-button ba-primary" disabled={busy} onClick={() => setAction('link')}>Link Repaido record</button>}{canCancel && <button className="ba-button" disabled={busy} onClick={() => setAction('cancel')}>Cancel request</button>}</div>}
    {action && action !== 'link' && <form className="ba-form ba-decision" onSubmit={event => void submitDecision(event)}><fieldset className="ba-fieldset" disabled={busy}><h4>{action === 'approve' ? 'Approve this estimate' : action === 'reject' ? 'Reject this request' : 'Cancel this request'}</h4><p className="ba-help">{action === 'approve' ? `${money(request.estimated_paise)} will count against this property’s monthly approval budget. This does not authorize a payment.` : action === 'cancel' ? 'Cancelling releases this request’s internal budget reservation. It does not cancel any booking or order.' : 'The requester can see your reason for this decision.'}</p><label>Decision note<textarea name="reason" required minLength={5} maxLength={1000} rows={2}/></label><div className="ba-form-actions"><button className={`ba-button ${action === 'approve' ? 'ba-primary' : 'ba-danger'}`} type="submit">{busy ? 'Saving…' : action === 'approve' ? 'Confirm internal approval' : action === 'reject' ? 'Confirm rejection' : 'Confirm cancellation'}</button><button className="ba-button" type="button" onClick={() => setAction(null)}>Keep reviewing</button></div></fieldset></form>}
    {action === 'link' && <LinkRecord request={request} accountId={data.account.id} busy={busy} mutate={mutate} onClose={() => setAction(null)}/>}
  </article>;
}
function LinkRecord({request, accountId, busy, mutate, onClose}: {request: Request; accountId: string; busy: boolean; mutate: Mutate; onClose: () => void}) {
  const [records, setRecords] = useState<{kind: RecordKind; id: string; label: string; status: string; amount_paise: number | null}[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    void operation<{records: typeof records}>(`${root}/${pathId(accountId)}/linkable`, {signal: controller.signal}, {background: true, feedback: false}).then(result => {
      if (!controller.signal.aborted) setRecords(result.records);
    }).catch(caught => {if (!controller.signal.aborted) setError(errorText(caught));}).finally(() => {if (!controller.signal.aborted) setLoading(false);});
    return () => controller.abort();
  }, [accountId, retry]);
  const kind: RecordKind = {repair: 'job', home: 'home_plan', contract: 'contract', retail: 'retail'}[request.category] as RecordKind;
  const choices = records.filter(record => record.kind === kind);
  const eligible = (record: typeof records[number]) => typeof record.amount_paise === 'number' && record.amount_paise > 0 && record.amount_paise <= request.estimated_paise;
  const selectedRecord = choices.find(record => `${record.kind}:${record.id}` === selected);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedRecord || !eligible(selectedRecord)) return;
    if (await mutate(`${root}/${pathId(accountId)}/requests/${pathId(request.id)}/link`, {expected_version: request.version, kind: selectedRecord.kind, id: selectedRecord.id}, {success: 'Repaido record linked. Available invoices are included in the account statement.'})) onClose();
  };
  return <form className="ba-form ba-decision" onSubmit={event => void submit(event)}><fieldset className="ba-fieldset" disabled={busy}><h4>Link your {recordNames[kind].toLowerCase()}</h4><p className="ba-help">Choose a quoted record within the approved estimate. Linking adds its financial records to this account and does not change its price or payment terms.</p>{loading ? <p role="status">Loading your eligible records…</p> : error ? <div className="ba-error" role="alert"><p>{error}</p><button className="ba-button" type="button" onClick={() => setRetry(value => value + 1)}>Retry records</button></div> : choices.length ? <label>Repaido record<select aria-label="Repaido record" required value={selected} onChange={event => setSelected(event.target.value)}><option value="">Choose the matching record</option>{choices.map(record => <option key={`${record.kind}:${record.id}`} value={`${record.kind}:${record.id}`} disabled={!eligible(record)}>{record.label} · {words(record.status)} · {record.amount_paise == null ? 'Quote required' : money(record.amount_paise)}{record.amount_paise != null && record.amount_paise > request.estimated_paise ? ' · Exceeds approval' : ''}</option>)}</select></label> : <Empty>No eligible {recordNames[kind].toLowerCase()} is available. Arrange the approved work using your Repaido account, then return here to link it.</Empty>}{selectedRecord && <p className="ba-help">Record reference: {selectedRecord.id}</p>}<div className="ba-form-actions"><button className="ba-button ba-primary" type="submit" disabled={loading || !selectedRecord || !eligible(selectedRecord)}>{busy ? 'Linking…' : 'Link this record'}</button><button className="ba-button" type="button" onClick={onClose}>Close</button></div></fieldset></form>;
}

function MaintenanceSection({data, busy, mutate}: SectionProps) {
  const [creating, setCreating] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const canManage = ['owner', 'manager'].includes(data.role);
  const rows = [...data.maintenance].filter(row => showCompleted || !['completed', 'cancelled'].includes(row.status)).sort((a, b) => a.due_on.localeCompare(b.due_on));
  return <><div className="ba-panel-heading"><div><h2>Maintenance calendar</h2><p className="ba-muted">Keep recurring property care visible to your team.</p></div>{canManage && <button className="ba-button ba-primary" disabled={busy || !data.properties.some(property => !property.archived)} onClick={() => setCreating(true)}><Plus size={17} aria-hidden="true"/>Schedule maintenance</button>}</div><p className="ba-notice">Calendar items are team reminders. Request and approve any paid work separately; adding or completing a reminder does not create a service booking.</p>{creating && <MaintenanceForm data={data} busy={busy} mutate={mutate} onClose={() => setCreating(false)}/>}<label className="ba-check"><input type="checkbox" checked={showCompleted} onChange={event => setShowCompleted(event.target.checked)}/>Include completed & cancelled maintenance</label><div className="ba-card-list">{rows.map(item => <MaintenanceCard key={`${item.id}:${item.version}`} item={item} data={data} busy={busy} mutate={mutate}/>)}</div>{!rows.length && <Empty>{showCompleted ? 'No maintenance has been scheduled for this account.' : 'No upcoming maintenance. An owner or manager can add property reminders here.'}</Empty>}</>;
}
function MaintenanceForm({data, busy, mutate, onClose}: SectionProps & {onClose: () => void}) {
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    const values = fields(event);
    if (await mutate(`${root}/${pathId(data.account.id)}/maintenance`, {property_id: values.property_id, title: values.title.trim(), due_on: values.due_on, repeat_months: Number(values.repeat_months), assigned_to: values.assigned_to}, {success: 'Maintenance reminder scheduled.'})) onClose();
  };
  return <div className="ba-panel"><h3>Schedule maintenance</h3><form className="ba-form" onSubmit={event => void submit(event)}><fieldset className="ba-fieldset" disabled={busy}><div className="ba-form-grid"><label>Property<select aria-label="Property" name="property_id" required defaultValue=""><option value="" disabled>Choose a property</option>{data.properties.filter(property => !property.archived).map(property => <option key={property.id} value={property.id}>{property.name}</option>)}</select></label><label>Maintenance task<input name="title" required minLength={3} maxLength={150} placeholder="For example, inspect water pumps"/></label><label>Due on<input name="due_on" type="date" required defaultValue={today()}/></label><label>Repeat<select aria-label="Repeat" name="repeat_months" defaultValue="0"><option value="0">One time</option>{Array.from({length: 12}, (_, index) => index + 1).map(months => <option key={months} value={months}>{months === 1 ? 'Every month' : `Every ${months} months`}</option>)}</select></label><label>Responsible team member<select aria-label="Responsible team member" name="assigned_to" defaultValue=""><option value="">Unassigned</option>{data.members.filter(member => member.status === 'active' && member.role !== 'viewer').map(member => <option key={member.user_id} value={member.user_id}>{member.name || 'Team member'} · {words(member.role)}</option>)}</select></label></div><div className="ba-form-actions"><button className="ba-button ba-primary" type="submit">{busy ? 'Saving…' : 'Add reminder'}</button><button className="ba-button" type="button" onClick={onClose}>Cancel</button></div></fieldset></form></div>;
}
function MaintenanceCard({item, data, busy, mutate}: SectionProps & {item: Maintenance}) {
  const [maintenanceAction, setMaintenanceAction] = useState<'complete' | 'cancel' | null>(null);
  const canComplete = item.can_complete ?? (!['completed', 'cancelled'].includes(item.status) && (['owner', 'manager'].includes(data.role) || (data.role === 'staff' && item.assigned_to === data.user_id)));
  const canCancel = item.can_cancel ?? (item.status === 'open' && ['owner', 'manager'].includes(data.role));
  const overdue = !['completed', 'cancelled'].includes(item.status) && item.due_on < today();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    const values = fields(event);
    if (await mutate(`${root}/${pathId(data.account.id)}/maintenance/${pathId(item.id)}/${maintenanceAction}`, {expected_version: item.version, note: values.note.trim()}, {success: maintenanceAction === 'cancel' ? 'Maintenance reminder cancelled. No further reminder will be scheduled from this item.' : item.repeat_months ? 'Maintenance completed and the next reminder scheduled.' : 'Maintenance marked complete.'})) setMaintenanceAction(null);
  };
  return <article className="ba-card"><div className="ba-card-heading"><div><p className="ba-eyebrow">{data.properties.find(property => property.id === item.property_id)?.name || 'Property'}</p><h3>{item.title}</h3></div><Badge value={overdue ? 'overdue' : item.status}/></div><dl className="ba-meta"><div><dt>Due on</dt><dd>{date(item.due_on)}</dd></div><div><dt>Repeats</dt><dd>{item.repeat_months ? `Every ${item.repeat_months} month${item.repeat_months === 1 ? '' : 's'}` : 'One time'}</dd></div><div><dt>Assigned to</dt><dd>{data.members.find(member => member.user_id === item.assigned_to)?.name || 'Unassigned'}</dd></div>{item.completed_at && <div><dt>Completed on</dt><dd>{date(item.completed_at)}</dd></div>}</dl>{!maintenanceAction && <div className="ba-card-actions">{canComplete && <button className="ba-button" disabled={busy} onClick={() => setMaintenanceAction('complete')}>Mark completed</button>}{canCancel && <button className="ba-button ba-danger" disabled={busy} onClick={() => setMaintenanceAction('cancel')}>Cancel reminder</button>}</div>}{maintenanceAction && <form className="ba-form ba-decision" onSubmit={event => void submit(event)}><fieldset className="ba-fieldset" disabled={busy}><label>{maintenanceAction === 'cancel' ? 'Cancellation reason' : 'Completion note'}<textarea name="note" required minLength={5} maxLength={1000} rows={2} placeholder={maintenanceAction === 'cancel' ? 'Why is this reminder no longer needed?' : 'Record what was checked or completed.'}/></label><p className="ba-help">{maintenanceAction === 'cancel' ? 'This cancels the reminder and stops its recurrence. Previous maintenance history is kept. It does not cancel any service booking.' : item.repeat_months > 0 ? 'Completing this item schedules its next recurring reminder.' : 'This records completion of the team reminder.'}</p><div className="ba-form-actions"><button className="ba-button ba-primary" type="submit">{busy ? 'Saving…' : maintenanceAction === 'cancel' ? 'Confirm reminder cancellation' : 'Confirm completion'}</button><button className="ba-button" type="button" onClick={() => setMaintenanceAction(null)}>Keep reviewing</button></div></fieldset></form>}</article>;
}

function Team({data, busy, mutate}: SectionProps) {
  const [invitation, setInvitation] = useState<{token: string; expires_at: number | string; id: string} | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const invite = async (event: FormEvent<HTMLFormElement>) => {
    const values = fields(event);
    await mutate(`${root}/${pathId(data.account.id)}/invitations`, {role: values.role}, {success: 'Invitation created. Share the code with the intended team member.', after: result => {setInvitation(result as typeof invitation); setCopied(false); setCopyError('');}});
  };
  const copy = async () => {try {await navigator.clipboard.writeText(invitation?.token || ''); setCopied(true); setCopyError('');} catch {setCopyError('Copy is unavailable here. Select the invitation code and copy it manually.');}};
  return <><div className="ba-panel-heading"><div><h2>Team & access</h2><p className="ba-muted">Each person uses their own Repaido sign-in.</p></div><Badge value={data.role}/></div><div className="ba-panel ba-role-guide"><h3>Choose the right access</h3><dl className="ba-meta">{(['owner', 'manager', 'staff', 'viewer'] as Role[]).map(role => <div key={role}><dt>{words(role)}</dt><dd>{roleNotes[role]}</dd></div>)}</dl></div>
    {data.role === 'owner' && <div className="ba-panel"><h3>Invite a team member</h3><p className="ba-help">Create a single-use invitation code and share it directly with the intended person. Repaido does not send an invitation email.</p><form className="ba-inline-form" onSubmit={event => void invite(event)}><label>Invitation role<select aria-label="Invitation role" name="role" defaultValue="staff" disabled={busy}><option value="manager">Manager</option><option value="staff">Staff</option><option value="viewer">Viewer</option></select></label><button className="ba-button ba-primary" disabled={busy} type="submit">{busy ? 'Saving…' : 'Create invitation code'}</button></form>{invitation && <div className="ba-invitation-code"><label>Share this invitation code<input readOnly value={invitation.token} onFocus={event => event.currentTarget.select()} autoComplete="off"/></label><p className="ba-help">Expires {date(invitation.expires_at)}. Save it now; the full code is shown only when created.</p><button className="ba-button" onClick={() => void copy()}><Copy size={16} aria-hidden="true"/>{copied ? 'Copied' : 'Copy invitation code'}</button>{copied && <span className="ba-sr-only" role="status">Invitation code copied.</span>}{copyError && <p role="alert">{copyError}</p>}</div>}</div>}
    <h3>Members</h3><div className="ba-member-list">{data.members.map(member => <MemberCard key={`${member.user_id}:${member.version}`} member={member} data={data} busy={busy} mutate={mutate}/>)}</div>
    {data.role === 'owner' && <section className="ba-panel"><h3>Invitations</h3>{!data.invitations?.length ? <Empty>No invitations have been created.</Empty> : <div className="ba-card-list">{data.invitations.map(row => <article className="ba-card" key={row.id}><div className="ba-card-heading"><div><h4>{words(row.role)} invitation</h4><p className="ba-help">Expires {date(row.expires_at)}</p></div><Badge value={row.status}/></div>{['pending', 'active'].includes(row.status) && <button className="ba-button ba-danger" disabled={busy} onClick={() => void mutate(`${root}/${pathId(data.account.id)}/invitations/${pathId(row.id)}/revoke`, {}, {success: 'Invitation revoked.', after: () => {if (invitation?.id === row.id) setInvitation(null);}})}>Revoke invitation</button>}</article>)}</div>}</section>}
  </>;
}
function MemberCard({member, data, busy, mutate}: SectionProps & {member: Member}) {
  const [editing, setEditing] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    const values = fields(event);
    if (await mutate(`${root}/${pathId(data.account.id)}/members/${pathId(member.user_id)}`, {role: values.role, status: values.status, expected_version: member.version}, {method: 'PUT', success: values.status === 'revoked' ? 'Member access revoked.' : 'Member access updated.'})) setEditing(false);
  };
  return <article className="ba-card"><div className="ba-card-heading"><div><h4>{member.name || 'Team member'}{member.user_id === data.user_id ? ' (you)' : ''}</h4><p className="ba-help">{words(member.role)}</p></div><Badge value={member.status}/></div>{data.role === 'owner' && member.role !== 'owner' && !editing && <button className="ba-button" disabled={busy} onClick={() => setEditing(true)}>Manage access</button>}{editing && <form className="ba-form" onSubmit={event => void submit(event)}><fieldset className="ba-fieldset" disabled={busy}><div className="ba-form-grid"><label>Role<select aria-label="Role" name="role" defaultValue={member.role}><option value="manager">Manager</option><option value="staff">Staff</option><option value="viewer">Viewer</option></select></label><label>Access<select aria-label="Access" name="status" defaultValue={member.status}><option value="active">Active</option><option value="revoked">Revoked</option></select></label></div><p className="ba-help">Revoked members lose access to this account. Their previous requests remain in its history.</p><div className="ba-form-actions"><button className="ba-button ba-primary" type="submit">{busy ? 'Saving…' : 'Save access'}</button><button className="ba-button" type="button" onClick={() => setEditing(false)}>Cancel</button></div></fieldset></form>}</article>;
}

function Statement({data}: {data: Detail}) {
  const statement = data.statement;
  const [property, setProperty] = useState('all');
  const rows = statement.rows.filter(row => property === 'all' || row.property_id === property);
  const totals = rows.reduce((sum, row) => ({issued: sum.issued + row.amount_paise, paid: sum.paid + row.paid_paise}), {issued: 0, paid: 0});
  return <><div className="ba-panel-heading"><div><h2>Consolidated statement</h2><p className="ba-muted">Service statements and verified payment receipts from records linked to approved requests.</p></div><FileText size={25} aria-hidden="true"/></div><p className="ba-notice">{statement.note || 'This statement combines available invoice records. Review and pay each booking or order in its original Repaido workflow.'}</p><div className="ba-summary-grid ba-estimates"><Stat label="Approved internal estimates" value={money(data.summary.approved_estimate_paise)} note="Approval allowance reserved; not an invoice"/><Stat label="Pending internal estimates" value={money(data.summary.pending_estimate_paise)} note="Awaiting an independent decision"/></div>{!!statement.unavailable_request_ids?.length && <p className="ba-error" role="alert">Financial records for {statement.unavailable_request_ids.length} linked request(s) are unavailable. Their estimates remain separate; the totals below exclude missing records.</p>}<label className="ba-statement-filter">Statement property<select aria-label="Statement property" value={property} onChange={event => setProperty(event.target.value)}><option value="all">All properties</option>{data.properties.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    {!rows.length ? <Empty>{statement.rows.length ? 'No issued statements or payment receipts for this property.' : 'No issued financial records yet. Link an approved request to the matching Repaido record. Available service statements and verified payment receipts will appear here.'}</Empty> : <><div className="ba-table-scroll" role="region" aria-label="Account financial records" tabIndex={0}><table className="ba-table"><caption>{property === 'all' ? 'All account properties' : data.properties.find(item => item.id === property)?.name} · Statements & payment receipts</caption><thead><tr><th scope="col">Document / source</th><th scope="col">Property</th><th scope="col">Issued</th><th scope="col">Status</th><th scope="col">Issued amount</th><th scope="col">Net paid</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.source_kind}:${row.source_id}:${row.id}:${index}`}><th scope="row"><span>{row.label}</span><small>{words(row.document_type || row.source_kind)} · {row.id}</small>{row.source && <small>Record source: {words(row.source)}</small>}{row.exceeds_approval && <small className="ba-overrun">Exceeds approved estimate · review required</small>}</th><td>{data.properties.find(item => item.id === row.property_id)?.name || '—'}</td><td>{date(row.issued_at)}</td><td><Badge value={row.status}/>{!!row.refunded_paise && <small className="ba-refund">Refunded {money(row.refunded_paise)}</small>}</td><td>{money(row.amount_paise)}</td><td>{money(row.paid_paise)}</td></tr>)}</tbody><tfoot><tr><th scope="row" colSpan={4}>Displayed financial records</th><td>{money(totals.issued)}</td><td>{money(totals.paid)}</td></tr></tfoot></table></div><p className="ba-help">Estimates are excluded from the issued amounts above. Refunded or review amounts do not automatically become outstanding debt. Account totals at the top include all properties.</p></>}
  </>;
}
