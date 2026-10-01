import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileSearch, FolderOpen, Search, X } from 'lucide-react';
import { actions, useIndex, useList } from '../lib/hooks.js';
import { fileKind, fmtShort, textMatch } from '../lib/format.js';
import { Button, Card, CardHead, Empty, IconButton, PageHead } from '../components/ui.jsx';
import { FileExplorer } from '../components/FileExplorer.jsx';

/**
 * Documenti: esplora l'intero archivio a partire da Explorer/Clienti.
 * La ricerca trova i file per nome in tutte le cartelle.
 */
export default function Documenti() {
  const roots = useQuery({ queryKey: ['roots'], queryFn: actions.roots, staleTime: Infinity });
  const [search, setSearch] = useState('');
  const [jump, setJump] = useState(null);

  return (
    <>
      <PageHead title="Documenti" sub="Archivio documentale dello studio: cartelle di clienti, consulenze e casi." />

      <Card style={{ marginBottom: 18 }}>
        <div className="card-pad row" style={{ padding: '14px 18px' }}>
          <div className="search-box" style={{ maxWidth: 520 }}>
            <Search size={15} />
            <input className="input" placeholder="Cerca un file per nome in tutto l'archivio…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {search && <IconButton icon={X} label="Annulla ricerca" onClick={() => setSearch('')} />}
        </div>
      </Card>

      {search.trim() ? (
        <FileSearchResults q={search} onOpenFolder={(ref) => { setSearch(''); setJump({ ref }); }} />
      ) : roots.data ? (
        <FileExplorer
          rootRef={null}
          rootLabel="Archivio"
          rootChildren={[roots.data.explorerRef, roots.data.clientiRef]}
          folderTipo="generale"
          editLinks
          jumpTo={jump}
          sub="Trascina i file su una cartella aperta per caricarli."
        />
      ) : <FileExplorer rootRef={undefined} />}
    </>
  );
}

function FileSearchResults({ q, onOpenFolder }) {
  const files = useList('Files');
  const { map: folders } = useIndex('Folder');
  const hits = useMemo(() => (files.data ?? []).filter((f) => textMatch(q, f.Nome)).slice(0, 200), [files.data, q]);
  return (
    <Card>
      <CardHead icon={FileSearch} title="Risultati della ricerca" sub={`${hits.length} file trovati`} />
      {hits.length === 0 ? <Empty icon={FileSearch} title="Nessun file trovato">Prova con un altro nome.</Empty> : (
        <div className="list">
          {hits.map((f) => (
            <div key={f.id} className="list-item">
              <span className={`file-icon ${fileKind(f.Nome)}`}><FileSearch size={17} /></span>
              <div className="grow">
                <div className="truncate" style={{ fontWeight: 550 }}>{f.Nome}</div>
                <div className="faint small">in “{folders.get(f.Folder_Ref)?.Titolo ?? '—'}” · {fmtShort(f.Data_Caricamento)}</div>
              </div>
              <Button size="sm" variant="ghost" icon={FolderOpen} onClick={() => onOpenFolder(f.Folder_Ref)}>Apri cartella</Button>
              <IconButton size="sm" icon={Download} label="Scarica" onClick={() => window.open(f.File, '_blank', 'noopener')} />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
