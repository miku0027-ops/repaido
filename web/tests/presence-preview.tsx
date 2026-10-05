// Local visual fixture only: Vite's production entry does not import this file.
import React from 'react';
import {createRoot} from 'react-dom/client';
import {CustomerTaskProgress,taskMessage} from '../src/components/CustomerTaskProgress';
import RepaidoBrand from '../src/components/RepaidoBrand';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/components/operations.css';
import type {Job} from '../src/services/operations';
const j={id:'test-only',state:'accepted',worker_role:'technician',reminder_ack_at:1790371000} as Job;
createRoot(document.getElementById('root')!).render(<main className="operations ops-worker"><header className="ops-heading"><RepaidoBrand size="sm"/><div className="worker-header-actions"><button>Customer app</button><button className="worker-presence is-online" role="switch" aria-checked={true} aria-label="Available for new task requests"><span className="presence-dot"/>Online</button></div></header><p>Local visual fixture · no real bookings or location</p><article className="ops-card reference-booking-card task-searching"><span className="ops-badge">Finding a professional</span><h3>Pest control</h3><p>{taskMessage({...j,state:'searching'})}</p><button className="ops-primary">View task details</button></article><article className="ops-card reference-booking-card task-assigned"><span className="ops-badge">Visit accepted</span><h3>Pest control</h3><p>{taskMessage(j)}</p><button className="ops-primary">View task details</button></article><CustomerTaskProgress job={j}/></main>);
