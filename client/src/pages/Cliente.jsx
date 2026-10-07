import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Briefcase, FileText, FolderOpen, Hash, Home, LayoutGrid, ListChecks, Mail, NotebookPen, NotebookText, Pencil,
  Phone, Tag, Trash2, UserRound, Users,
} from 'lucide-react';
import { actions, db, useAction, useDialog, useDoc, useList, useMe } from '../lib/hooks.js';
import { T } from '../lib/activity.js';
import { AREA_COLOR } from '../lib/constants.js';
import { Avatar, Badge, Button, Card, CardHead, Empty, KV, PageHead, Tabs } from '../components/ui.jsx';
import { BackButton, Crumbs, DocState, MissingRoot } from '../components/EntityPage.jsx';
import { ActivityFeed } from '../components/ActivityFeed.jsx';
import { ContactsSection } from '../components/Contacts.jsx';
import { FileExplorer } from '../components/FileExplorer.jsx';
import { NoteSection, noteCol } from '../components/Note.jsx';
import { ClienteDialog } from '../components/forms.jsx';
import { useFeedback } from '../components/feedback.jsx';

/** Pagina Cliente: Panoramica, Note, Documenti, Contatti, Attività */
export default function Cliente() {
  const { id } = useParams();
  const ref = `Clienti/${id}`;
  const q = useDoc(ref);
  const me = useMe();
  const [params] = useSearchParams();
  // ?tab=note: dalla ricerca documenti si arriva direttamente alla scheda
  const [tab, setTab] = useState(params.get('tab') ?? 'panoramica');
  const edit = useDialog();
  const navigate = useNavigate();
  const { confirm, toast } = useFeedback();
  const contatti = useList(`${ref}/Contatti`);
  const note = useList(noteCol(ref));

  const del = useAction(() => db.remove(ref), { onSuccess: () => { toast('Cliente eliminato'); navigate('/clienti'); } });

  if (!q.data) return <DocState q={q} backTo="/clienti" label="Cliente" />;
  const c = q.data;

  const askDelete = async () => {
    if (await confirm({ message: 'Una volta eliminato questo documento non sarà più reperibile.' })) del.mutate();
  };

  return (
    <>
      <PageHead
        crumbs={<Crumbs items={[{ to: '/clienti', label: 'Clienti' }, { label: c.Nome || 'Non disponibile' }]} />}
        before={<><BackButton to="/clienti" /><Avatar name={c.Nome} size="lg" square /></>}
        title={c.Nome || 'Non disponibile'}
        sub={<span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {c.Categoria && <Badge tone={AREA_COLOR[c.Categoria]}>{c.Categoria}</Badge>}
          {c.Caso_Aperto && <Badge tone="green" dot>Caso aperto</Badge>}
          {c.Partita_IVA && <span className="faint small tnum">P. IVA {c.Partita_IVA}</span>}
        </span>}
        actions={<>
          <Button icon={Pencil} onClick={() => edit.open()}>Modifica</Button>
          <Button variant="danger" icon={Trash2} onClick={askDelete}>Elimina</Button>
        </>}
      />

      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'panoramica', label: 'Panoramica', icon: LayoutGrid },
        { value: 'note', label: 'Note', icon: NotebookPen, count: note.data?.length },
        { value: 'documenti', label: 'Documenti', icon: FolderOpen },
        { value: 'contatti', label: 'Contatti', icon: Users, count: contatti.data?.length },
        { value: 'attivita', label: 'Attività', icon: ListChecks },
      ]} />

      {tab === 'panoramica' && (
        <div className="split">
          <div className="stack">
            <Card>
              <CardHead icon={UserRound} title="Informazioni cliente" />
              <div className="card-pad kv">
                <KV label="Nome / Ragione sociale" icon={UserRound}>{c.Nome}</KV>
                <KV label="Partita IVA" icon={Hash}>{c.Partita_IVA}</KV>
                <KV label="Email" icon={Mail}>{c.Email && <a href={`mailto:${c.Email}`}>{c.Email}</a>}</KV>
                <KV label="Telefono" icon={Phone}>{c.Telefono ? <a href={`tel:${c.Telefono}`}>{c.Telefono}</a> : null}</KV>
                <KV label="Indirizzo" icon={Home}>{c.indirizzo}</KV>
                <KV label="Categoria" icon={Tag}>{c.Categoria}</KV>
                <KV label="Note" icon={NotebookText} full>{c.Note}</KV>
              </div>
            </Card>
            <RelatedWork cliente={ref} />
          </div>
          <ActivityFeed title="Attività recenti" sub="Ultimi 2 giorni" recentDays={2} where={[['Utente', '==', me.ref], ['Cliente', '==', ref]]} compact />
        </div>
      )}

      {tab === 'note' && (
        <NoteSection parent={ref} sub="Appunti, documenti e immagini relativi al cliente." label={`il cliente ${c.Nome}`} logLink={{ cliente: ref }} />
      )}

      {tab === 'documenti' && <ClienteDocs cliente={c} />}

      {tab === 'contatti' && (
        <ContactsSection
          parent={ref}
          sub="Contatti"
          logs={{ create: (n) => T.creaContattoCliente(n, c.Nome), edit: T.modificaContatto }}
          logLink={{ cliente: ref }}
        />
      )}

      {tab === 'attivita' && (
        <ActivityFeed sub="Cronologia delle attività relative al cliente." where={[['Cliente', '==', ref], ['Utente', '==', me.ref]]} />
      )}

      <ClienteDialog open={edit.isOpen} onClose={edit.close} cliente={c} />
    </>
  );
}

function ClienteDocs({ cliente }) {
  const root = useQuery({ queryKey: ['clienteRoot', cliente.path], queryFn: () => actions.clienteRoot(cliente.path, false) });
  const create = useAction(() => actions.newCustomAction({ titolo: `Cartella di ${cliente.Nome}`, tipo: 'Cliente', cliente: cliente.path }));
  if (root.isLoading) return <FileExplorer rootRef={undefined} />;
  if (!root.data?.root) return <MissingRoot onCreate={() => create.mutate()} busy={create.isPending} />;
  return (
    <FileExplorer
      rootRef={root.data.root}
      rootLabel={cliente.Nome}
      folderTipo="Cliente"
      links={{ cliente: cliente.path }}
      sub="Gestisci i documenti del cliente. Trascina i file sulla scheda per caricarli."
    />
  );
}

/** Consulenze e casi del cliente (collegamenti rapidi, sola lettura) */
function RelatedWork({ cliente }) {
  const cons = useList('Consulenze', { where: [['Cliente', '==', cliente]] });
  const casi = useList('Casi', { where: [['Cliente', '==', cliente]] });
  const items = [
    ...(cons.data ?? []).map((d) => ({ ...d, kind: 'consulenza', to: `/consulenze/${d.id}` })),
    ...(casi.data ?? []).map((d) => ({ ...d, kind: 'caso', to: `/casi/${d.id}` })),
  ];
  return (
    <Card>
      <CardHead icon={Briefcase} title="Pratiche collegate" sub="Consulenze aziendali e casi del cliente" />
      {items.length === 0 ? <Empty>Nessuna pratica collegata.</Empty> : (
        <div className="list">
          {items.map((d) => (
            <Link key={d.path} to={d.to} className="list-item clickable">
              <span className={`file-icon ${d.kind === 'caso' ? 'folder' : 'doc'}`}>{d.kind === 'caso' ? <Briefcase size={17} /> : <FileText size={17} />}</span>
              <div className="grow">
                <div className="truncate" style={{ fontWeight: 550 }}>{d.Titolo || 'Senza titolo'}</div>
                <div className="faint small">{d.kind === 'caso' ? `Caso${d.Area_Pratica ? ` · ${d.Area_Pratica}` : ''}` : `Consulenza${d.Data_Inizio ? ` · dal ${d.Data_Inizio}` : ''}`}</div>
              </div>
              <Badge tone={d.kind === 'caso' ? 'amber' : 'blue'}>{d.kind === 'caso' ? 'Caso' : 'Consulenza'}</Badge>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}
