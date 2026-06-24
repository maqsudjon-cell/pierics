import React, { useEffect, useState } from 'react';
import Pricing from './pages/Pricing.jsx';
import Dashboard from './pages/Dashboard.jsx';
import { api } from './lib/api.js';

function useHashRoute() {
  const parse = () => (window.location.hash.replace(/^#\//, '').split('?')[0] || 'pricing');
  const [route, setRoute] = useState(parse());
  useEffect(() => {
    const h = () => setRoute(parse());
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  return route;
}

function Nav({ route, apiLive }) {
  const link = (id, label) => (
    <a href={`#/${id}`} className={route === id ? 'active' : ''}>{label}</a>
  );
  return (
    <nav className="nav">
      <div className="wrap nav-inner">
        <a href="#/pricing" className="brand"><span className="sq" />PIERICS</a>
        <div className="nav-links">
          {link('pricing', 'Pricing')}
          {link('dashboard', 'Dashboard')}
          <span className={`api-dot ${apiLive === true ? 'live' : apiLive === false ? 'off' : ''}`}>
            <i />{apiLive === true ? 'API live' : apiLive === false ? 'API offline' : '···'}
          </span>
        </div>
      </div>
    </nav>
  );
}

function Footer() {
  return (
    <footer className="footer wrap">
      <span>// PIERICS — UNIFIED AI API AGGREGATOR</span>
      <span>STRIPE TEST MODE · BUILD 0.1.0</span>
    </footer>
  );
}

export default function App() {
  const route = useHashRoute();
  const [apiLive, setApiLive] = useState(null);
  useEffect(() => {
    api.health().then(() => setApiLive(true)).catch(() => setApiLive(false));
  }, []);

  return (
    <>
      <Nav route={route} apiLive={apiLive} />
      {route === 'dashboard' ? <Dashboard /> : <Pricing />}
      <Footer />
    </>
  );
}
