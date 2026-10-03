import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  Briefcase, CalendarClock, CalendarDays, FolderOpen, LayoutGrid, ListChecks, NotebookPen, Pencil, Tag, Timer,
  Trash2, UserRound, Users,
} from 'lucide-react';
import { actions, db, useAction, useDialog, useDoc, useIndex, useList, useMe, userName } from '../lib/hooks.js';
import { T } from '../lib/activity.js';
import { AREA_COLOR } from '../lib/constants.js';
import { fmtDate, parseItDate } from '../lib/format.js';
import { Avatar, Badge, Button, Card, CardHead, KV, PageHead, Tabs } from '../components/ui.jsx';
import { BackButton, Crumbs, DocState, MissingRoot } from '../components/EntityPage.jsx';
import { ActivityFeed } from '../components/ActivityFeed.jsx';
import { ContactsSection } from '../components/Contacts.jsx';
import { FileExplorer } from '../components/FileExplorer.jsx';
import { NoteSection, noteCol } from '../components/Note.jsx';
import { CasoDialog } from '../components/forms.jsx';
import { useFeedback } from '../components/feedback.jsx';

/** Pagina_Caso: Panoramica, Documenti, Contatti, Attività (nell'originale non era raggiungibile) */
export default function Caso() {
  const { id } = useParams();
  const ref = `Casi/${id}`;
  const q = useDoc(ref);
  const me = useMe();
  const [tab, setTab] = useState('panoramica');
  const edit = useDialog();
  const navigate = useNavigate();
  const { confirm, toast } = useFeedback();
  const { map: users } = useIndex('Users');
  const { map: clienti } = useIndex('Clienti');
  const contatti = useList(`${ref}/Contatti_Caso`);
  const note = useList(noteCol(ref));
  // cartella radice: Folder con Caso == caso e Cliente == cliente del caso
  // (senza cliente la cartella non esiste: le sottocartelle del caso non hanno Cliente)
  const root = useList('Folder', { where: [['Caso', '==', ref], ['Cliente', '==', q.data?.Cliente ?? null]], limit: 1 }, { enabled: !!q.data?.Cliente });

  const del = useAction(() => db.remove(ref), { onSuccess: () => { toast('Caso eliminato'); navigate('/casi'); } });

  if (!q.data) return <DocState q={q} backTo="/casi" label="Caso" />;
  const c = q.data;
  const rootFolder = root.data?.[0];
  const scad = parseItDate(c.Scadenza);
  const days = scad ? Math.ceil((scad - new Date()) / 864e5) : null;

  const askDelete = async () => {
    if (await confirm({ message: 'Una volta eliminato questo documento non sarà più reperibile.' })) del.mutate();
  };

  return (
    <>
      <PageHead
        crumbs={<Crumbs items={[{ to: '/casi', label: 'Casi' }, { label: c.Titolo || 'Non indicato' }]} />}
        before={<BackButton to="/casi" />}
        title={c.Titolo || 'Non indicato'}
        sub={<span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {c.Area_Pratica && <Badge tone={AREA_COLOR[c.Area_Pratica]}>{c.Area_Pratica}</Badge>}
          {c.Cliente && <Link className="small muted" to={`/clienti/${c.Cliente.split('/')[1]}`}>{clienti.get(c.Cliente)?.Nome}</Link>}
          {scad && <Badge tone={days < 0 ? 'red' : days <= 7 ? 'amber' : 'green'} dot>{days < 0 ? `Scaduto da ${-days} gg` : days === 0 ? 'Scade oggi' : `Scade tra ${days} gg`}</Badge>}
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
          <Card>
            <CardHead icon={Briefcase} title="Dettagli caso" />
            <div className="card-pad kv">
              <KV label="Descrizione" full>{c.Descrizione}</KV>
              <KV label="Area pratica" icon={Tag}>{c.Area_Pratica}</KV>
              <KV label="Cliente" icon={UserRound}>{c.Cliente && <Link to={`/clienti/${c.Cliente.split('/')[1]}`}>{clienti.get(c.Cliente)?.Nome}</Link>}</KV>
              <KV label="Data inizio" icon={CalendarDays}>{c.Data_Inizio}</KV>
              <KV label="Scadenza" icon={Timer}>{c.Scadenza}</KV>
              <KV label="Consulente principale" icon={UserRound}>{c.Avvocato_Principale && <span className="row" style={{ gap: 8 }}><Avatar size="sm" name={userName(users, c.Avvocato_Principale)} />Avv. {userName(users, c.Avvocato_Principale)}</span>}</KV>
              <KV label="Creato il" icon={CalendarClock}>{fmtDate(c.Data_Creazione)}</KV>
              <KV label="Team di supporto" icon={Users} full>
                {(c.Avvovati_Supporto ?? []).length ? (
                  <div className="row" style={{ flexWrap: 'wrap', gap: 14 }}>
                    {c.Avvovati_Supporto.map((u) => <span key={u} className="row" style={{ gap: 8 }}><Avatar size="sm" name={userName(users, u)} />Avv. {userName(users, u)}</span>)}
                  </div>
                ) : null}
              </KV>
            </div>
          </Card>
          <ActivityFeed title="Attività recenti" sub="Ultimi 2 giorni" recentDays={2} where={[['Caso', '==', ref]]} compact />
        </div>
      )}

      {tab === 'note' && (
        <NoteSection parent={ref} sub="Appunti, documenti e immagini relativi al caso." label={`il caso ${c.Titolo}`} logLink={{ caso: ref, cliente: c.Cliente }} />
      )}

      {tab === 'documenti' && (
        root.isLoading ? <FileExplorer rootRef={undefined} /> : rootFolder ? (
          <FileExplorer
            rootRef={rootFolder.path}
            rootLabel={rootFolder.Titolo || 'Caso'}
            folderTipo="Caso"
            links={{ caso: ref, cliente: c.Cliente }}
            sub="Gestisci i documenti del caso."
          />
        ) : <CreateCasoRoot c={c} />
      )}

      {tab === 'contatti' && (
        <ContactsSection parent={ref} sub="Contatti_Caso" logs={{ create: T.creaContattoCaso, edit: T.modificaContatto }} logLink={{ caso: ref }} />
      )}

      {tab === 'attivita' && <ActivityFeed sub="Cronologia delle attività relative al caso." where={[['Caso', '==', ref]]} />}

      <CasoDialog open={edit.isOpen} onClose={edit.close} caso={c} />
    </>
  );
}

function CreateCasoRoot({ c }) {
  const create = useAction(() => actions.newCustomAction({ titolo: `Cartella del caso: ${c.Titolo}`, tipo: 'caso', cliente: c.Cliente, caso: c.path }));
  return <MissingRoot
    onCreate={c.Cliente ? () => create.mutate() : undefined}
    busy={create.isPending}
    reason={c.Cliente ? undefined : 'Collega un cliente al caso per poter creare la cartella documenti.'}
  />;
}
