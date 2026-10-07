import { Fragment } from 'react';
import { Link } from 'react-router';
import {
  Briefcase, Download, File, FileImage, FileSearch, FileSpreadsheet, FileText, FolderOpen, NotebookPen, ScanText, UserRound,
} from 'lucide-react';
import { fileKind, fmtShort } from '../lib/format.js';
import { Badge, Button, Card, CardHead, Empty, IconButton, SkeletonRows } from './ui.jsx';

const KIND_ICON = { pdf: FileText, img: FileImage, doc: FileText, xls: FileSpreadsheet, other: File };

/** Estratto del server: i termini trovati sono tra \u0001 e \u0002 (testo semplice, nessun HTML) */
export function Highlight({ text }) {
  const parts = String(text ?? '').split(/(\u0001[^\u0002]*\u0002)/);
  return parts.map((p, i) => (p.startsWith('\u0001')
    ? <mark key={i}>{p.slice(1, -1)}</mark>
    : <Fragment key={i}>{p}</Fragment>));
}

const idOf = (ref) => ref.split('/')[1];

/** Pagina dell'entità a cui appartiene un allegato di nota, aperta sulla scheda Note */
const notaHref = (entita) => {
  const [col, id] = entita.split('/');
  return `/${{ Clienti: 'clienti', Consulenze: 'consulenze', Casi: 'casi' }[col]}/${id}?tab=note`;
};

/**
 * Risultati della ricerca documenti per contenuto.
 * onOpenFolder(ref): apre la cartella del file nell'esplora documenti
 */
export function DocSearchResults({ q, data, isLoading, onOpenFolder }) {
  const results = data?.results ?? [];
  const exact = results.filter((r) => !r.simile);
  const sub = isLoading && !data ? 'Ricerca in corso…'
    : `${exact.length} document${exact.length === 1 ? 'o' : 'i'} trovat${exact.length === 1 ? 'o' : 'i'}`
      + (data?.indexing ? ` · ${data.indexing} ancora in lettura, riprova tra poco` : '');

  return (
    <Card>
      <CardHead icon={FileSearch} title="Risultati della ricerca" sub={sub} />
      {isLoading && !data ? <SkeletonRows /> : results.length === 0 ? (
        <Empty icon={FileSearch} title={`Nessun documento contiene “${q}”`}>
          La ricerca guarda dentro il testo dei documenti e nei nomi dei file. Prova con meno parole o con un termine diverso.
        </Empty>
      ) : (
        <div className="list doc-results">
          {results.map((r, i) => (
            <Fragment key={r.url}>
              {r.simile && !results[i - 1]?.simile && (
                <div className="menu-heading" style={{ padding: '12px 12px 4px' }}>Documenti con parole simili</div>
              )}
              <DocResult r={r} onOpenFolder={onOpenFolder} />
            </Fragment>
          ))}
        </div>
      )}
    </Card>
  );
}

function DocResult({ r, onOpenFolder }) {
  const kind = fileKind(r.nome);
  const Icon = KIND_ICON[kind];
  return (
    <article className="list-item doc-result">
      <span className={`file-icon ${kind}`}><Icon size={18} /></span>
      <div className="grow" style={{ minWidth: 0 }}>
        <a href={r.url} target="_blank" rel="noopener" className="truncate doc-result-name">{r.nome}</a>
        {r.estratto && <p className="doc-snippet">{r.simile ? r.estratto : <Highlight text={r.estratto} />}</p>}
        <div className="doc-context">
          {r.cliente && <Link to={`/clienti/${idOf(r.cliente.path)}`} className="badge"><UserRound size={12} />{r.cliente.nome || 'Cliente'}</Link>}
          {r.consulenza && <Link to={`/consulenze/${idOf(r.consulenza.path)}`} className="badge"><FileText size={12} />{r.consulenza.titolo || 'Consulenza'}</Link>}
          {r.caso && <Link to={`/casi/${idOf(r.caso.path)}`} className="badge"><Briefcase size={12} />{r.caso.titolo || 'Caso'}</Link>}
          {r.nota && <Link to={notaHref(r.nota.entita)} className="badge"><NotebookPen size={12} />Nota “{r.nota.titolo}”</Link>}
          {r.ocr && <span title="Testo letto da una scansione o da un'immagine"><Badge tone="violet"><ScanText size={12} />Scansione</Badge></span>}
          {r.data && <span className="faint small">{fmtShort(r.data)}</span>}
        </div>
      </div>
      {r.folder && onOpenFolder && (
        <Button size="sm" variant="ghost" icon={FolderOpen} onClick={() => onOpenFolder(r.folder.path)}>
          <span className="hide-sm">{r.folder.titolo ? `In “${r.folder.titolo}”` : 'Apri cartella'}</span>
        </Button>
      )}
      <IconButton size="sm" icon={Download} label="Apri il documento" onClick={() => window.open(r.url, '_blank', 'noopener')} />
    </article>
  );
}
