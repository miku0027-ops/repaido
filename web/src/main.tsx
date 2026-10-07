import {AppExperience} from './components/AppExperience';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import './design-system.css';
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /><AppExperience /></React.StrictMode>);
if (import.meta.env.DEV && new URLSearchParams(location.search).has('uiAudit')) {
  void import('./dev/uiAudit').then(({startUiAudit}) => startUiAudit());
}

import "./components/premium-discovery.css";

import './components/customer-bookings.css';

import './spacing.css';

import './strokes.css';

import './customer-layout.css';

import "./components/compact-market.css";
import "./components/market-controls.css";
