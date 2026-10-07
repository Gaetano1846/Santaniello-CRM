import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { actions } from '../lib/hooks.js';
import { Card, IconButton, PageHead } from '../components/ui.jsx';
import { FileExplorer } from '../components/FileExplorer.jsx';
import { DocSearchResults } from '../components/DocSearch.jsx';

/**
 * Documenti: esplora l'intero archivio a partire da Explorer/Clienti.
 * La ricerca guarda dentro il testo dei documenti (PDF, Word, Excel, scansioni e foto
 * lette con OCR), negli allegati delle note e nei nomi dei file. ?q= apre una ricerca.
 */
export default function Documenti() {
  const roots = useQuery({ queryKey: ['roots'], queryFn: actions.roots, staleTime: Infinity });
  const [params, setParams] = useSearchParams();
  const [search, setSearchState] = useState(params.get('q') ?? '');
  const [jump, setJump] = useState(null);
  const setSearch = (v) => {
    setSearchState(v);
    setParams(v.trim() ? { q: v } : {}, { replace: true });
  };
  // ricerca avviata dalla barra in alto mentre la pagina è già aperta
  const urlQ = params.get('q') ?? '';
  useEffect(() => { setSearchState((cur) => (cur.trim() === urlQ.trim() ? cur : urlQ)); }, [urlQ]);

  return (
    <>
      <PageHead title="Documenti" sub="Archivio documentale dello studio: cartelle di clienti, consulenze e casi." />

      <Card style={{ marginBottom: 18 }}>
        <div className="card-pad row" style={{ padding: '14px 18px' }}>
          <div className="search-box" style={{ maxWidth: 520 }}>
            <Search size={15} />
            <input className="input" placeholder="Cerca nel testo dei documenti: parole, nomi, importi, numeri di pratica…" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus={!!search} />
          </div>
          {search && <IconButton icon={X} label="Annulla ricerca" onClick={() => setSearch('')} />}
        </div>
      </Card>

      {search.trim() ? (
        <ContentSearch q={search} onOpenFolder={(ref) => { setSearch(''); setJump({ ref }); }} />
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

function ContentSearch({ q, onOpenFolder }) {
  // attende una breve pausa nella digitazione prima di interrogare il server
  const [debounced, setDebounced] = useState(q.trim());
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const res = useQuery({
    queryKey: ['documenti-cerca', debounced],
    queryFn: () => actions.cercaDocumenti(debounced),
    enabled: !!debounced,
    placeholderData: keepPreviousData,
    // documenti ancora in lettura: aggiorna i risultati finché non sono pronti
    refetchInterval: (query) => (query.state.data?.indexing ? 5000 : false),
  });
  return <DocSearchResults q={debounced || q} data={res.data} isLoading={res.isLoading || res.isFetching && !res.data} onOpenFolder={onOpenFolder} />;
}
