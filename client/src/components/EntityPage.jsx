import { Link, useNavigate } from 'react-router';
import { ArrowLeft, ChevronRight, FolderPlus, FolderX } from 'lucide-react';
import { Button, Card, Empty, IconButton, Loader } from './ui.jsx';

/** Briciole di pane: Calendario › Sezione › Elemento */
export function Crumbs({ items }) {
  return (
    <nav className="crumbs" aria-label="Percorso">
      <Link to="/calendario">Calendario</Link>
      {items.map((it, i) => (
        <span key={i} className="row" style={{ gap: 6 }}>
          <ChevronRight size={13} />
          {it.to ? <Link to={it.to}>{it.label}</Link> : <span className="current" aria-current="page">{it.label}</span>}
        </span>
      ))}
    </nav>
  );
}

export function BackButton({ to }) {
  const navigate = useNavigate();
  return <IconButton bordered icon={ArrowLeft} label="Indietro" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate(to))} style={{ marginTop: 4 }} />;
}

/** Stato di caricamento / documento non trovato per le pagine di dettaglio */
export function DocState({ q, backTo, label }) {
  if (q.isLoading) return <Loader />;
  return (
    <Card>
      <Empty icon={FolderX} title={`${label} non trovato`} action={<Link to={backTo}><Button>Torna all'elenco</Button></Link>}>
        Potrebbe essere stato eliminato.
      </Empty>
    </Card>
  );
}

/** Mostrato quando l'entità non ha una cartella radice (l'app originale andava in errore) */
export function MissingRoot({ onCreate, busy, reason }) {
  return (
    <Card>
      <Empty icon={FolderX} title="Cartella documenti assente" action={onCreate && <Button variant="primary" icon={FolderPlus} loading={busy} onClick={onCreate}>Crea cartella</Button>}>
        {reason ?? 'Non esiste ancora una cartella documenti collegata.'}
      </Empty>
    </Card>
  );
}
