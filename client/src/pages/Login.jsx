import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, Eye, EyeOff, KeyRound, Mail, Phone, UserRound } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/hooks.js';
import { Brand } from '../components/Layout.jsx';
import { Button, Field, Input } from '../components/ui.jsx';

/**
 * Registrazione_Login: una sola card che alterna Registrazione e Accesso.
 * Dopo il successo si va al Calendario (come l'originale).
 */
export default function Login() {
  const [mode, setMode] = useState('login'); // 'login' | 'register' | 'reset'
  const [f, setF] = useState({ nome: '', email: '', telefono: '', password: '' });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(''); setInfo('');
    try {
      if (mode === 'reset') {
        await api('/auth/reset', { method: 'POST', body: { email: f.email } });
        setInfo('Se l\'indirizzo è registrato riceverai un\'email per reimpostare la password.');
        return;
      }
      const user = await api(mode === 'login' ? '/auth/login' : '/auth/register', { method: 'POST', body: f });
      setUser(user);
      navigate('/calendario', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const switchTo = (m) => { setMode(m); setError(''); setInfo(''); };
  const titles = { login: 'Bentornato', register: 'Crea il tuo account', reset: 'Recupera password' };
  const subs = {
    login: 'Accedi per gestire clienti, casi e consulenze dello studio.',
    register: 'Registrati per iniziare a usare il gestionale dello studio.',
    reset: 'Inserisci la tua email: ti invieremo un link di reimpostazione.',
  };

  return (
    <div className="auth">
      <aside className="auth-aside">
        <Brand />
        <div>
          <div className="auth-quote">Ogni pratica, ogni scadenza, ogni documento — in un unico posto.</div>
          <p className="auth-lead">
            Clienti, casi, consulenze aziendali, calendario e archivio documentale dello Studio Santaniello & Associati.
          </p>
          <div className="auth-bands" aria-hidden="true">
            {['civile', 'penale', 'commerciale', 'lavoro', 'famiglia', 'tributario', 'ip', 'immobiliare'].map((a) => (
              <i key={a} style={{ background: `var(--area-${a})` }} />
            ))}
          </div>
        </div>
        <div className="auth-foot">© {new Date().getFullYear()} Santaniello & Associati</div>
      </aside>

      <main className="auth-main">
        <form className="auth-card stack" onSubmit={submit} style={{ gap: 18 }}>
          <div>
            <h1 className="page-title" style={{ fontSize: 28 }}>{titles[mode]}</h1>
            <p className="page-sub">{subs[mode]}</p>
          </div>

          {mode === 'register' && (
            <Field required label="Nome"><Input icon={UserRound} value={f.nome} onChange={set('nome')} autoComplete="name" required /></Field>
          )}
          <Field required label="Email">
            <Input icon={Mail} type="email" value={f.email} onChange={set('email')} autoComplete="email" required autoFocus />
          </Field>
          {mode === 'register' && (
            <Field label="Telefono"><Input icon={Phone} type="tel" value={f.telefono} onChange={set('telefono')} autoComplete="tel" /></Field>
          )}
          {mode !== 'reset' && (
            <Field required label="Password">
              <Input
                icon={KeyRound}
                type={show ? 'text' : 'password'}
                value={f.password}
                onChange={set('password')}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                minLength={6}
                required
                suffix={
                  <button type="button" className="icon-btn sm" onClick={() => setShow(!show)} aria-label={show ? 'Nascondi password' : 'Mostra password'}>
                    {show ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                }
              />
            </Field>
          )}

          {error && <div className="notice red" role="alert">{error}</div>}
          {info && <div className="notice green" role="status">{info}</div>}

          <Button type="submit" variant="primary" size="cta" block loading={busy}>
            {mode === 'login' ? 'Accedi' : mode === 'register' ? 'Registrati' : 'Invia link'} <ArrowRight size={16} />
          </Button>

          <div className="small muted" style={{ textAlign: 'center' }}>
            {mode === 'login' && (
              <>
                Non hai un account? <a href="#" onClick={(e) => { e.preventDefault(); switchTo('register'); }} className="accent">Registrati</a>
                <span style={{ margin: '0 8px' }}>·</span>
                <a href="#" onClick={(e) => { e.preventDefault(); switchTo('reset'); }}>Password dimenticata?</a>
              </>
            )}
            {mode !== 'login' && (
              <>Hai già un account? <a href="#" onClick={(e) => { e.preventDefault(); switchTo('login'); }} className="accent">Accedi</a></>
            )}
          </div>
        </form>
      </main>
    </div>
  );
}
