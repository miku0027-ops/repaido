import { BrowserEvidenceCamera } from './BrowserEvidenceCamera';
import { apiFetch } from '../services/api';
import { useEffect, useRef, useState } from 'react';
import { auth } from '../firebase';
import { operation, type Job } from '../services/operations';
import { nativeAvailable, nativeCall } from '../services/native';
import { Modal } from './ui';
import { Camera, CheckCircle2, AlertTriangle, Eye, RefreshCw, Sparkles } from 'lucide-react';

type Proof = {
  id: string;
  kind: string;
  visit_id: string;
  captured_at: number;
  server_received_at: number;
  lat: number;
  lng: number;
  accuracy: number;
  task_name: string;
  customer_name: string;
  expires_at: number;
  provenance: string;
};

type Photo = {
  session: { id: string };
  jpeg: Uint8Array;
  metadata: Record<string, unknown>;
};

export function VisitEvidence({
  job,
  worker = false,
  admin = false,
  onRefresh,
  onEvidenceSummary,
}: {
  job: Job;
  worker?: boolean;
  admin?: boolean;
  onRefresh: () => Promise<void>;
  onEvidenceSummary?: (summary: { hasBefore: boolean; hasAfter: boolean; count: number }) => void;
}) {
  const [items, setItems] = useState<Proof[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [webCamera, setWebCamera] = useState<'before' | 'after' | null>(null);
  const photo = useRef<Photo | null>(null);

  const load = async () => {
    try {
      const data = await operation<{ evidence: Proof[] }>(`${admin ? '/admin' : ''}/jobs/${job.id}/evidence`);
      setItems(data.evidence);
      const bPhoto = data.evidence.find(e => e.kind === 'before' && e.visit_id === job.visit_id);
      const aPhoto = data.evidence.find(e => e.kind === 'after' && e.visit_id === job.visit_id);
      onEvidenceSummary?.({
        hasBefore: !!bPhoto,
        hasAfter: !!aPhoto,
        count: data.evidence.length,
      });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    void load();
  }, [job.id, job.version]);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const upload = async () => {
    const p = photo.current;
    if (!p) return;
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw Error('Sign in again before retrying this upload.');
    const response = await apiFetch(`/api/operations/capture-sessions/${p.session.id}/photo`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'image/jpeg',
        'X-Capture-Metadata': JSON.stringify(p.metadata),
      },
      body: new Blob([new Uint8Array(p.jpeg)], { type: 'image/jpeg' }),
      signal: AbortSignal.timeout(60000),
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.detail?.message || 'Photo upload failed. Retry the same photo or retake it.');
    photo.current = null;
    setPending(false);
    setMessage('Photo uploaded to this visit.');
    await onRefresh();
    await load();
  };

  const capture = async (kind: 'before' | 'after') => {
    const session = await operation<{ id: string }>(`/jobs/${job.id}/capture-session`, {
      method: 'POST',
      body: JSON.stringify({ kind }),
    });
    const result = JSON.parse(await nativeCall('captureEvidence', { session }));
    photo.current = {
      session,
      jpeg: Uint8Array.from(atob(result.jpeg), (c: string) => c.charCodeAt(0)),
      metadata: result.metadata,
    };
    setPending(true);
    await upload();
  };

  const handleStartCapture = (kind: 'before' | 'after') => {
    if (nativeAvailable()) {
      void run(() => capture(kind));
    } else {
      setWebCamera(kind);
    }
  };

  const view = async (id: string) => {
    const token = await auth.currentUser?.getIdToken();
    const response = await apiFetch(`/api/operations${admin ? '/admin' : ''}/evidence/${id}/photo`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw Error('Photo unavailable or expired. Retry later.');
    setPreview(URL.createObjectURL(await response.blob()));
  };

  const beforePhoto = items.find(e => e.kind === 'before' && e.visit_id === job.visit_id);
  const afterPhoto = items.find(e => e.kind === 'after' && e.visit_id === job.visit_id);

  return (
    <div style={{ background: '#ffffff', borderRadius: 20, border: '1px solid #e2e8f0', padding: '20px', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2563eb' }}>
            <Camera size={20} />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#0f172a' }}>Visit Photos & Work Evidence</h3>
            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>GPS, customer reference & timestamped verification</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={busy}
          style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: '0.8rem', fontWeight: 700, color: '#475569', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {error && <p className="ops-error" role="alert" style={{ marginBottom: 14 }}>{error}</p>}
      {message && <p role="status" style={{ padding: '8px 12px', background: '#f0fdf4', border: '1px solid #86efac', color: '#166534', borderRadius: 10, fontSize: '0.85rem', fontWeight: 700, marginBottom: 14 }}>{message}</p>}

      {/* Two-Card Visual Grid for Before and After Inspection */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: 14, margin: '14px 0' }}>
        {/* Card 1: Initial Inspection (Before Work) */}
        <div
          style={{
            background: beforePhoto ? '#f0fdf4' : '#fffbeb',
            border: `1.5px solid ${beforePhoto ? '#86efac' : '#fde68a'}`,
            borderRadius: 16,
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <strong style={{ fontSize: '0.95rem', color: beforePhoto ? '#166534' : '#92400e', fontWeight: 800 }}>
                1. Initial Inspection (Before)
              </strong>
              <span
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 800,
                  padding: '3px 8px',
                  borderRadius: 999,
                  background: beforePhoto ? '#dcfce7' : '#fef3c7',
                  color: beforePhoto ? '#15803d' : '#b45309',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                {beforePhoto ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                {beforePhoto ? 'VERIFIED' : 'OPTIONAL / OMITTED'}
              </span>
            </div>
            <p style={{ fontSize: '0.82rem', color: beforePhoto ? '#166534' : '#78350f', margin: 0, lineHeight: 1.4 }}>
              {beforePhoto
                ? `Captured ${new Date(beforePhoto.captured_at * 1000).toLocaleTimeString()} (GPS ±${Math.round(beforePhoto.accuracy)}m)`
                : 'Condition on arrival. If skipped earlier, you can still take it now or provide the compulsory forgotten note on submission.'}
            </p>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            {beforePhoto && (
              <button
                type="button"
                className="agent-utility-btn"
                style={{ flex: 1, padding: '8px 12px', fontSize: '0.82rem' }}
                onClick={() => void run(() => view(beforePhoto.id))}
              >
                <Eye size={14} color="#059669" /> View Photo
              </button>
            )}
            {worker && ['arrived', 'in_progress'].includes(job.state) && (
              <button
                type="button"
                className={beforePhoto ? 'agent-utility-btn' : 'agent-cta-primary'}
                style={{ flex: 1, padding: '8px 12px', fontSize: '0.82rem' }}
                disabled={busy}
                onClick={() => handleStartCapture('before')}
              >
                <Camera size={14} /> {beforePhoto ? 'Retake Before' : 'Take Before Photo'}
              </button>
            )}
          </div>
        </div>

        {/* Card 2: Completed Repair (After Work) */}
        <div
          style={{
            background: afterPhoto ? '#f0fdf4' : '#eff6ff',
            border: `1.5px solid ${afterPhoto ? '#86efac' : '#bfdbfe'}`,
            borderRadius: 16,
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <strong style={{ fontSize: '0.95rem', color: afterPhoto ? '#166534' : '#1e40af', fontWeight: 800 }}>
                2. Completed Repair (After)
              </strong>
              <span
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 800,
                  padding: '3px 8px',
                  borderRadius: 999,
                  background: afterPhoto ? '#dcfce7' : '#dbeafe',
                  color: afterPhoto ? '#15803d' : '#1d4ed8',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                {afterPhoto ? <CheckCircle2 size={12} /> : <Sparkles size={12} />}
                {afterPhoto ? 'VERIFIED' : 'REQUIRED FOR SIGN-OFF'}
              </span>
            </div>
            <p style={{ fontSize: '0.82rem', color: afterPhoto ? '#166534' : '#1e3a8a', margin: 0, lineHeight: 1.4 }}>
              {afterPhoto
                ? `Captured ${new Date(afterPhoto.captured_at * 1000).toLocaleTimeString()} (GPS ±${Math.round(afterPhoto.accuracy)}m)`
                : 'Show the finished repair, tested parts and cleaned workspace before customer review.'}
            </p>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            {afterPhoto && (
              <button
                type="button"
                className="agent-utility-btn"
                style={{ flex: 1, padding: '8px 12px', fontSize: '0.82rem' }}
                onClick={() => void run(() => view(afterPhoto.id))}
              >
                <Eye size={14} color="#059669" /> View Photo
              </button>
            )}
            {worker && job.state === 'in_progress' && (
              <button
                type="button"
                className={afterPhoto ? 'agent-utility-btn' : 'agent-cta-primary'}
                style={{ flex: 1, padding: '8px 12px', fontSize: '0.82rem', background: afterPhoto ? undefined : '#2563eb' }}
                disabled={busy}
                onClick={() => handleStartCapture('after')}
              >
                <Camera size={14} /> {afterPhoto ? 'Retake After' : 'Take After Photo'}
              </button>
            )}
          </div>
        </div>
      </div>

      {pending && (
        <div className="ops-notice" style={{ background: '#fffbeb', borderColor: '#fde68a', color: '#92400e', borderRadius: 12, marginTop: 10 }}>
          <p style={{ margin: '0 0 8px', fontWeight: 600 }}>Keep this screen open while photo upload completes.</p>
          <button disabled={busy} onClick={() => void run(upload)} style={{ padding: '6px 14px', fontSize: '0.85rem' }}>Retry photo upload</button>
        </div>
      )}

      {/* History of captured proofs */}
      {items.length > 2 && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ fontSize: '0.82rem', color: '#64748b', cursor: 'pointer' }}>
            Earlier visit photos & audit history ({items.length})
          </summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            {items.map(e => (
              <div key={e.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: '#f8fafc', borderRadius: 8, fontSize: '0.8rem', color: '#475569' }}>
                <span><strong>{e.kind === 'before' ? 'Before photo' : 'After photo'}</strong> · {new Date(e.captured_at * 1000).toLocaleString()}</span>
                <button type="button" onClick={() => void run(() => view(e.id))} style={{ background: 'none', border: 'none', color: '#2563eb', fontWeight: 700, cursor: 'pointer' }}>View</button>
              </div>
            ))}
          </div>
        </details>
      )}

      {webCamera && (
        <BrowserEvidenceCamera
          job={job}
          kind={webCamera}
          onClose={() => setWebCamera(null)}
          onPhoto={p => {
            photo.current = p;
            setPending(true);
            setWebCamera(null);
            void run(upload);
          }}
        />
      )}

      {preview && (
        <Modal title="Private visit evidence" onClose={() => setPreview(null)}>
          <img src={preview} alt="Timestamped work evidence for this task" style={{ width: '100%', height: 'auto', borderRadius: 12 }} />
        </Modal>
      )}
    </div>
  );
}
