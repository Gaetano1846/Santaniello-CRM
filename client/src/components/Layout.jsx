import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import {
  Briefcase, CalendarDays, FileText, FolderOpen, LogOut, Mail, Menu as MenuIcon, Moon,
  Phone, ScrollText, Search, Sun, User, UserRound, Users, X,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth, useInvalidate } from '../lib/hooks.js';
import { Avatar, Field, FormModal, IconButton, Input } from './ui.jsx';
import { useFeedback } from './feedback.jsx';

/* Voci del MenuWidget originale (Casi era nascosto: ora è visibile e raggiungibile) */
const NAV = [
  { to: '/calendario', label: 'Calendario', icon: CalendarDays },
  { to: '/clienti', label: 'Clienti', icon: Users },
  { to: '/consulenze', label: 'Consulenza Aziendale', icon: FileText },
  { to: '/casi', label: 'Casi', icon: Briefcase },
  { to: '/documenti', label: 'Documenti', icon: FolderOpen },
  { to: '/log', label: 'Log Attività', icon: ScrollText },
];

export function Brand() {
  return (
    <div className="brand">
      <div className="brand-bar" />
      <div>
        <div className="brand-name">Santaniello</div>
        <div className="brand-sub">Studio legale · CRM</div>
      </div>
    </div>
  );
}

function useTheme() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme
    || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('crm-theme', next); } catch { /* storage non disponibile */ }
    setTheme(next);
  };
  return [theme, toggle];
}

export function Layout() {
  const [navOpen, setNavOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const { user, logout } = useAuth();
  const [theme, toggleTheme] = useTheme();
  const location = useLocation();

  useEffect(() => { setNavOpen(false); }, [location.pathname]);

  return (
    <div className="app">
      <a className="skip-link" href="#contenuto">Vai al contenuto</a>
      <aside className={`sidebar ${navOpen ? 'open' : ''}`}>
        <Brand />
        <nav className="nav">
          <div className="nav-label">Studio</div>
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <Icon size={18} strokeWidth={1.9} /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <button className="nav-item" onClick={() => setAccountOpen(true)}>
            <UserRound size={18} strokeWidth={1.9} /> Account
          </button>
          <button className="nav-item" onClick={logout}>
            <LogOut size={18} strokeWidth={1.9} /> Esci
          </button>
          <div className="user-chip">
            <Avatar name={user.display_name || user.email} size="sm" />
            <div style={{ minWidth: 0 }}>
              <div className="truncate" style={{ fontWeight: 600, fontSize: 13 }}>{user.display_name || 'Utente'}</div>
              <div className="truncate user-mail">{user.email}</div>
            </div>
          </div>
        </div>
      </aside>
      {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} />}

      <div className="main">
        <header className="topbar">
          <IconButton className="menu-btn" icon={MenuIcon} label="Apri menu" onClick={() => setNavOpen(true)} />
          <GlobalSearch />
          <div className="grow" />
          <IconButton icon={theme === 'dark' ? Sun : Moon} label="Cambia tema" onClick={toggleTheme} />
          <button className="icon-btn" onClick={() => setAccountOpen(true)} aria-label="Account" title="Account">
            <Avatar name={user.display_name || user.email} size="sm" />
          </button>
        </header>
        <main className="content" id="contenuto" tabIndex={-1}>
          <Outlet />
        </main>
      </div>

      <AccountDialog open={accountOpen} onClose={() => setAccountOpen(false)} />
    </div>
  );
}

/* ---------------------------------------------------------------- ricerca */

/**
 * Ricerca globale della AppBar: Clienti + Consulenze (Algolia lato server).
 * Un solo popover che si chiude navigando (l'originale ne apriva uno nuovo a ogni ricerca).
 */
function GlobalSearch() {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const input = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!q.trim()) { setRes(null); return; }
    setLoading(true);
    const t = setTimeout(async () => {
      try { setRes(await api(`/search?q=${encodeURIComponent(q)}`)); setOpen(true); } finally { setLoading(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const h = (e) => !box.current?.contains(e.target) && setOpen(false);
    const k = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); input.current?.focus(); } };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, []);

  const go = (to) => { setOpen(false); setQ(''); navigate(to); };
  const empty = res && !res.clienti.length && !res.consulenze.length;

  return (
    <div className="search-box" ref={box}>
      <Search size={16} />
      <input
        ref={input}
        className="input"
        placeholder="Cerca clienti e consulenze…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => res && setOpen(true)}
        onKeyDown={(e) => e.key === 'Escape' && (setQ(''), setOpen(false))}
        aria-label="Ricerca globale"
      />
      <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)' }}>
        {loading ? <span className="spinner" style={{ width: 14, height: 14, display: 'block' }} />
          : q ? <X size={15} className="faint" style={{ cursor: 'pointer' }} onClick={() => { setQ(''); setOpen(false); }} />
          : <span className="kbd">Ctrl K</span>}
      </span>
      {open && res && (
        <div className="popover" style={{ left: 0, right: 0, top: 'calc(100% + 8px)', maxHeight: 420, overflowY: 'auto' }}>
          {empty && <div className="faint" style={{ padding: 14 }}>Nessun risultato per “{q}”</div>}
          {res.clienti.length > 0 && <div className="menu-heading">Clienti</div>}
          {res.clienti.map((c) => (
            <button key={c.id} className="menu-item" onClick={() => go(`/clienti/${c.id}`)}>
              <Avatar name={c.Nome} size="sm" />
              <span className="grow truncate">{c.Nome || 'Senza nome'}</span>
              {c.Email && <span className="faint small truncate" style={{ maxWidth: 140 }}>{c.Email}</span>}
            </button>
          ))}
          {res.consulenze.length > 0 && <div className="menu-heading">Consulenze</div>}
          {res.consulenze.map((c) => (
            <button key={c.id} className="menu-item" onClick={() => go(`/consulenze/${c.id}`)}>
              <span className="file-icon doc" style={{ width: 28, height: 28, borderRadius: 8 }}><FileText size={14} /></span>
              <span className="grow truncate">{c.Titolo || 'Senza titolo'}</span>
              {c.Data_Inizio && <span className="faint small">{c.Data_Inizio}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- account */

/** AccountWidget: aggiorna Users (email, display_name, phone_number) */
function AccountDialog({ open, onClose }) {
  const { user, setUser } = useAuth();
  const { toast } = useFeedback();
  const invalidate = useInvalidate();
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setF({ nome: user.display_name ?? '', email: user.email ?? '', telefono: user.phone_number ?? '' });
  }, [open, user]);

  const submit = async () => {
    setBusy(true);
    try {
      const u = await api('/account', { method: 'PATCH', body: f });
      setUser((prev) => ({ ...prev, ...u }));
      invalidate();
      toast('Operazione effettuata', { body: 'Account aggiornato con successo.' });
      onClose();
    } catch (e) {
      toast('Aggiornamento non riuscito', { body: e.message, tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormModal open={open} onClose={onClose} title="Account" icon={User} size="sm" onSubmit={submit} busy={busy}>
      <Field label="Nome"><Input icon={UserRound} value={f.nome ?? ''} onChange={(e) => setF({ ...f, nome: e.target.value })} /></Field>
      <Field label="Email" hint="Aggiorna solo il profilo, non l'email di accesso."><Input icon={Mail} type="email" value={f.email ?? ''} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
      <Field label="Telefono"><Input icon={Phone} value={f.telefono ?? ''} onChange={(e) => setF({ ...f, telefono: e.target.value })} /></Field>
    </FormModal>
  );
}
