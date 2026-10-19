import {useEffect, useId, useRef, useState} from 'react';
import {Payments, RefreshCw, Users} from '../icons';
import {useOperationResource} from '../hooks/useOperationResource';
import {money, operation} from '../services/operations';
import {AdminStatus, AdminTable} from './AdminTable';
import {earningStatus, type EarningAccount, type EarningPolicy, type IndependentEarnings} from './BikeIndependentEarnings';

type Application = {
  id: string; name: string; version: number; terms_version: number; status: string;
  profile_approved: boolean; account: EarningAccount;
};
type Overview = {
  items: Application[]; next_cursor: string | null; policy: EarningPolicy;
  fund: {funded_paise: number; reserved_paise: number; committed_paise: number};
  available_promo_fund_paise: number;
};
type Evidence = {reference: string; evidence: string};
const emptyEvidence = (): Evidence => ({reference: '', evidence: ''});
const requestKey = () => crypto.randomUUID();
function hundredths(value: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw new Error('Enter a positive number with up to two decimal places.');
  const parsed = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(parsed)) throw new Error('This amount exceeds the supported limit.');
  return parsed;
}

function EvidenceFields({value, onChange}: {value: Evidence; onChange: (value: Evidence) => void}) {
  return <>
    <label>External reference<input required minLength={8} maxLength={200} value={value.reference} onChange={e => onChange({...value, reference: e.target.value})}/></label>
    <label>Verification evidence<textarea required minLength={10} maxLength={1000} value={value.evidence} onChange={e => onChange({...value, evidence: e.target.value})}/></label>
  </>;
}

/** Load the financial workspace only when an operator deliberately opens it. */
export function BikeIndependentAdmin() {
  const [open, setOpen] = useState(false);
  return <details className="bike-admin-panel bike-independent-admin" onToggle={e => setOpen(e.currentTarget.open)}>
    <summary><Users size={18} aria-hidden="true"/>Independent riders<span>Per-ride earnings</span></summary>
    {open && <IndependentWorkspace/>}
  </details>;
}

function IndependentWorkspace() {
  const [cursor, setCursor] = useState('');
  const resource = useOperationResource<Overview>('/bike-rides/earnings/admin' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''), 30000);
  const data = resource.data;
  const refresh = () => resource.refresh();
  return <>
    <header className="bike-admin-heading"><div><h3>Independent earning plan</h3><p>A paid-fare share and a company-funded launch payment. Separate from the three salaried riders.</p></div><button disabled={resource.busy} onClick={() => void refresh()}><RefreshCw size={16} aria-hidden="true"/>Refresh earnings</button></header>
    {resource.error && <p className="ops-error" role="alert">{resource.error}{data ? ' Showing the last loaded snapshot.' : ''}</p>}
    {!data && !resource.error && <p role="status">Loading independent riders…</p>}
    {data && <div key={resource.uid}>
      <dl className="bike-admin-ledger">
        <div><dt>Earning plan</dt><dd>{data.policy.enabled && data.policy.reviewed ? 'Active' : 'Paused'}</dd></div>
        <div><dt>Available launch funding</dt><dd>{money(data.available_promo_fund_paise)}</dd></div>
        <div><dt>Reserved for accepted offers</dt><dd>{money(data.fund.reserved_paise)}</dd></div>
        <div><dt>Committed launch earnings</dt><dd>{money(data.fund.committed_paise)}</dd></div>
      </dl>
      <IndependentPolicy key={resource.uid} policy={data.policy} onRefresh={refresh}/>
      <details className="bike-earning-subpanel"><summary>Record company launch funding</summary><PromotionFunding onRefresh={refresh}/></details>
      <p>Changing the share, launch payment or agreement requires riders to accept the new terms before new bookings. Accepted rides keep their agreed earnings.</p>
      <AdminTable label="Independent rider applications" rows={data.items} rowKey={row => row.id} rowLabel={row => 'independent rider ' + row.name} empty="No independent rider applications in this page." columns={[
        {key: 'rider', label: 'Rider', value: row => row.name, render: row => <><strong>{row.name}</strong><small>{row.id}</small></>},
        {key: 'state', label: 'Agreement', value: row => row.status, render: row => <><AdminStatus value={row.status}/><small>{row.terms_version === data.policy.terms_version ? 'Current terms accepted' : 'New consent needed'}</small></>},
        {key: 'profile', label: 'Documents', value: row => row.profile_approved ? 'Approved' : 'Review needed'},
        {key: 'payable', label: 'Ready for payout', numeric: true, value: row => row.account.payable_paise, render: row => money(row.account.payable_paise)},
      ]} renderDetail={row => <IndependentRiderReview key={row.id + ':' + row.version} application={row} termsVersion={data.policy.terms_version} onRefresh={refresh}/>}/>
      <div className="bike-earning-pages"><span>Applications · 50 per server page</span>{cursor && <button disabled={resource.busy} onClick={() => setCursor('')}>First page</button>}{data.next_cursor && <button disabled={resource.busy} onClick={() => setCursor(data.next_cursor!)}>Next application page</button>}</div>
    </div>}
  </>;
}

function IndependentPolicy({policy, onRefresh}: {policy: EarningPolicy; onRefresh: () => Promise<void>}) {
  const hintId = useId();
  const [base, setBase] = useState(policy);
  const from = (p: EarningPolicy) => ({share: String(p.paid_payout_bps / 100), launch: String(p.promo_payout_paise / 100), terms: p.terms, reference: p.reference || '', reviewed: p.reviewed, enabled: p.enabled});
  const [draft, setDraft] = useState(() => from(policy));
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const dirty = JSON.stringify(draft) !== JSON.stringify(from(base)), stale = policy.version > base.version;
  useEffect(() => {if (!dirty && policy.version > base.version) {setBase(policy); setDraft(from(policy));}}, [policy, base.version, dirty]);
  const save = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      const saved = await operation<EarningPolicy>('/bike-rides/earnings/policy', {method: 'PUT', body: JSON.stringify({expected_version: base.version, enabled: draft.enabled, reviewed: draft.reviewed, paid_payout_bps: hundredths(draft.share), promo_payout_paise: hundredths(draft.launch), terms: draft.terms, reference: draft.reference})});
      setBase(saved); setDraft(from(saved)); setMessage('Earning policy saved.'); await onRefresh();
    } catch (e) {setError((e as Error).message); void onRefresh();} finally {setBusy(false);}
  };
  return <details className="bike-earning-subpanel"><summary>Earning policy <small>{dirty ? 'Unsaved changes' : 'Terms v' + base.terms_version}</small></summary>
    {stale && <div className="ops-notice" role="alert">A newer policy is available. Your draft is preserved.<button disabled={busy} onClick={() => {setBase(policy); setDraft(from(policy)); setError('');}}>Discard draft & load current policy</button></div>}
    <form onSubmit={e => {e.preventDefault(); void save();}}>
      <fieldset disabled={busy || stale}><legend>Company-reviewed agreement</legend>
        <div className="bike-admin-fields"><label>Paid-fare share · %<input aria-label="Paid-fare share · %" aria-describedby={hintId+'-share'} required type="number" min="0" max="100" step="0.01" value={draft.share} onChange={e => setDraft({...draft, share: e.target.value})}/><small id={hintId+'-share'}>Of the fare before tax, including the agreed demand surcharge.</small></label><label>Free-ride earning · ₹<input aria-label="Free-ride earning · ₹" aria-describedby={hintId+'-launch'} required type="number" min="0" max="1000" step="0.01" value={draft.launch} onChange={e => setDraft({...draft, launch: e.target.value})}/><small id={hintId+'-launch'}>Reserved from company funds before assignment.</small></label></div>
        <label>Rider agreement<textarea required minLength={20} maxLength={2000} value={draft.terms} onChange={e => setDraft({...draft, terms: e.target.value})}/></label>
        <label>Review reference<input required minLength={8} maxLength={200} value={draft.reference} onChange={e => setDraft({...draft, reference: e.target.value})}/></label>
        <label className="bike-admin-check"><input type="checkbox" checked={draft.reviewed} onChange={e => setDraft({...draft, reviewed: e.target.checked})}/>I reviewed these amounts and earning terms.</label>
        <label className="bike-admin-check"><input type="checkbox" checked={draft.enabled} onChange={e => setDraft({...draft, enabled: e.target.checked})}/>Enable independent riders with approved profiles and current consent.</label>
      </fieldset>
      {error && <p className="ops-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
      <button disabled={busy || stale || !dirty}>{busy ? 'Saving…' : 'Save earning policy'}</button>
    </form>
  </details>;
}

function PromotionFunding({onRefresh}: {onRefresh: () => Promise<void>}) {
  const [amount, setAmount] = useState(''), [proof, setProof] = useState(emptyEvidence), [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false), [saved, setSaved] = useState(false), [error, setError] = useState('');
  const attempt = useRef({body: '', key: ''});
  const save = async () => {
    setBusy(true); setError('');
    try {
      const value = {amount_paise: hundredths(amount), ...proof, received: true};
      const body = JSON.stringify(value);
      if (attempt.current.body !== body) attempt.current = {body, key: requestKey()};
      await operation('/bike-rides/earnings/funding', {method: 'POST', body: JSON.stringify({...value, request_id: attempt.current.key})});
      setSaved(true); await onRefresh();
    } catch (e) {setError((e as Error).message);} finally {setBusy(false);}
  };
  return <form className="bike-admin-resolution" onSubmit={e => {e.preventDefault(); void save();}}>
    <p>Record funds already received and reserved for launch earnings. This action does not move money.</p>
    <fieldset disabled={busy || saved}><label>Received funding · ₹<input required type="number" min="0.01" max="10000000" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}/></label><EvidenceFields value={proof} onChange={setProof}/><label className="bike-admin-check"><input required type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)}/>I verified receipt and availability of this exact company funding.</label></fieldset>
    {error && <p className="ops-error" role="alert">{error}</p>}{saved && <p role="status">Funding recorded. The launch balance has been refreshed.</p>}
    <button disabled={busy || saved || !checked}>{busy ? 'Recording…' : 'Record received funding'}</button>
  </form>;
}

function IndependentRiderReview({application, termsVersion, onRefresh}: {application: Application; termsVersion: number; onRefresh: () => Promise<void>}) {
  const [status, setStatus] = useState(''), [proof, setProof] = useState(emptyEvidence);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const save = async () => {
    setBusy(true); setError('');
    try {await operation('/bike-rides/earnings/riders/' + encodeURIComponent(application.id) + '/review', {method: 'POST', body: JSON.stringify({expected_version: application.version, status, ...proof})}); setSaved(true); await onRefresh();}
    catch (e) {setError((e as Error).message); void onRefresh();} finally {setBusy(false);}
  };
  return <>
    <form className="bike-admin-resolution" onSubmit={e => {e.preventDefault(); void save();}}>
      <h4>Review {application.name}</h4><p>Profile approval and current earning consent are both required. Reopen lets a rider accept revised terms; it does not approve them.</p>
      <fieldset disabled={busy || saved}><label>Decision<select aria-label="Decision" required value={status} onChange={e => setStatus(e.target.value)}><option value="">Choose a decision</option><option value="approved" disabled={!application.profile_approved || application.terms_version !== termsVersion}>Approve independent agreement</option><option value="pending">Reopen for review</option><option value="suspended">Pause future assignments</option><option value="rejected">Reject application</option></select></label><EvidenceFields value={proof} onChange={setProof}/></fieldset>
      {error && <p className="ops-error" role="alert">{error}</p>}{saved && <p role="status">Rider review recorded.</p>}
      <button disabled={busy || saved || !status}>{busy ? 'Recording…' : 'Record rider decision'}</button>
    </form>
    <IndependentRiderLedger driverId={application.id}/>
  </>;
}

function IndependentRiderLedger({driverId}: {driverId: string}) {
  const [cursor, setCursor] = useState(''), [transferCursor, setTransferCursor] = useState('');
  const params = new URLSearchParams(); if (cursor) params.set('cursor', cursor); if (transferCursor) params.set('transfer_cursor', transferCursor);
  const resource = useOperationResource<IndependentEarnings>('/bike-rides/earnings/riders/' + encodeURIComponent(driverId) + (params.size ? '?' + params : ''), 30000);
  const [selected, setSelected] = useState<string[]>([]), [proof, setProof] = useState(emptyEvidence), [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const attempt = useRef({body: '', key: ''}), data = resource.data;
  const payable = (data?.credits || []).filter(row => row.status === 'payable');
  const exact = payable.filter(row => selected.includes(row.id));
  const amount = exact.reduce((total, row) => total + row.amount_paise, 0);
  useEffect(() => {setSelected([]); setChecked(false); setSaved(false);}, [cursor, resource.uid]);
  const save = async () => {
    if (!selected.length || exact.length !== selected.length || !checked) return;
    setBusy(true); setError('');
    try {
      const value = {driver_id: driverId, credit_ids: selected.slice().sort(), amount_paise: amount, ...proof};
      const body = JSON.stringify(value); if (attempt.current.body !== body) attempt.current = {body, key: requestKey()};
      await operation('/bike-rides/earnings/transfers', {method: 'POST', body: JSON.stringify({...value, request_id: attempt.current.key})});
      setSaved(true); setSelected([]); setChecked(false); await resource.refresh();
    } catch (e) {setError((e as Error).message); void resource.refresh();} finally {setBusy(false);}
  };
  return <section className="bike-independent-ledger" aria-label="Independent rider ledger">
    <header className="bike-admin-heading"><h4>Earning ledger</h4><button disabled={busy || resource.busy} onClick={() => void resource.refresh()}>Refresh rider ledger</button></header>
    {(error || resource.error) && <p className="ops-error" role="alert">{error || resource.error}</p>}
    {data && <>
      <dl className="bike-admin-ledger">{[{label: 'Ready for payout', value: data.account.payable_paise}, {label: 'Awaiting company cash', value: data.account.awaiting_remittance_paise}, {label: 'Transfer reported', value: data.account.transfer_reported_paise}, {label: 'Receipt confirmed', value: data.account.received_paise}].map(row => <div key={row.label}><dt>{row.label}</dt><dd>{money(row.value)}</dd></div>)}</dl>
      <AdminTable label="Independent ride earnings" rows={data.credits} rowKey={row => row.id} rowLabel={row => 'earning ' + row.ride_id.slice(-6)} empty="No completed earning credits in this page." columns={[
        {key: 'ride', label: 'Ride', value: row => row.ride_id, render: row => <><strong>#{row.ride_id.slice(-6).toUpperCase()}</strong><small>{row.free ? 'Funded launch ride' : 'Paid trip'}</small></>},
        {key: 'amount', label: 'Earning', numeric: true, value: row => row.amount_paise, render: row => money(row.amount_paise)},
        {key: 'state', label: 'Stage', value: row => earningStatus(row.status)},
      ]}/>
      <div className="bike-earning-pages">{cursor && <button disabled={busy || resource.busy} onClick={() => setCursor('')}>Latest earnings</button>}{data.next_cursor && <button disabled={busy || resource.busy} onClick={() => setCursor(data.next_cursor!)}>Older earning page</button>}</div>
      <details className="bike-earning-subpanel"><summary><Payments size={16} aria-hidden="true"/>Record external earning transfer</summary>
        <form className="bike-admin-resolution" onSubmit={e => {e.preventDefault(); void save();}}>
          <p>Select exact payable credits from this page. Record an external transfer already completed; this form does not send money.</p>
          <fieldset disabled={busy || saved || resource.busy}><legend>Payable credits · up to 50 per transfer</legend>
            {!payable.length && <p>No payable credits in this page.</p>}
            <div className="bike-earning-credit-picker">{payable.map(row => <label className="bike-admin-check" key={row.id}><input type="checkbox" checked={selected.includes(row.id)} onChange={e => {setSelected(prior => e.target.checked ? [...prior, row.id] : prior.filter(id => id !== row.id)); setChecked(false);}}/>#{row.ride_id.slice(-6).toUpperCase()}<strong>{money(row.amount_paise)}</strong></label>)}</div>
            <p>Exact selected transfer: <strong>{money(amount)}</strong></p><EvidenceFields value={proof} onChange={setProof}/>
            <label className="bike-admin-check"><input required type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)}/>I verified this exact transfer with the provider.</label>
          </fieldset>
          {saved && <p role="status">Transfer recorded. Rider receipt confirmation is pending.</p>}
          <button disabled={busy || saved || !checked || !amount || exact.length !== selected.length}>{busy ? 'Recording…' : 'Record verified transfer'}</button>
          {saved && <button type="button" onClick={() => {setSaved(false); setProof(emptyEvidence());}}>Record another transfer</button>}
        </form>
      </details>
      <AdminTable label="Independent earning transfers" rows={data.transfers} rowKey={row => row.id} rowLabel={row => 'transfer ' + row.reference} empty="No earning transfers in this page." columns={[
        {key: 'ref', label: 'Reference', value: row => row.reference}, {key: 'amount', label: 'Amount', numeric: true, value: row => row.amount_paise, render: row => money(row.amount_paise)}, {key: 'state', label: 'Stage', value: row => earningStatus(row.status)},
      ]}/>
      <div className="bike-earning-pages">{transferCursor && <button disabled={busy || resource.busy} onClick={() => setTransferCursor('')}>Latest transfers</button>}{data.transfers_next_cursor && <button disabled={busy || resource.busy} onClick={() => setTransferCursor(data.transfers_next_cursor!)}>Older transfer page</button>}</div>
    </>}
  </section>;
}
