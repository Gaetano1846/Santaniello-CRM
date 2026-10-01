import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  AlarmClock, CalendarClock, CalendarDays, Download, FileText, FolderOpen, LayoutGrid, ListChecks,
  MapPin, Pencil, Plus, StickyNote, Trash2, UserRound, Users,
} from 'lucide-react';
import { actions, db, useAction, useDialog, useDoc, useIndex, useList, useMe, userName } from '../lib/hooks.js';
import { fileKind, fmtDate, fmtShort, parseItDateTime, toDate } from '../lib/format.js';
import { Avatar, Badge, Button, Card, CardHead, Empty, IconButton, KV, PageHead, Tabs } from '../components/ui.jsx';
import { BackButton, Crumbs, DocState, MissingRoot } from '../components/EntityPage.jsx';
import { ActivityFeed } from '../components/ActivityFeed.jsx';
import { FileExplorer } from '../components/FileExplorer.jsx';
import { CalendarView } from '../components/Calendar.jsx';
import { PromemoriaDialog } from '../components/forms.jsx';
import { EditConsulenza } from './Consulenze.jsx';
import { useFeedback } from '../components/feedback.jsx';

/** Pagina_Consulenza: Panoramica, Documenti, Calendario, Attività, Promemoria */
export default function Consulenza() {
  const { id } = useParams();
  const ref = `Consulenze/${id}`;
  const q = useDoc(ref);
  const me = useMe();
  const [tab, setTab] = useState('panoramica');
  const edit = useDialog();
  const navigate = useNavigate();
  const { confirm, toast } = useFeedback();
  const { map: users } = useIndex('Users');
  const { map: clienti } = useIndex('Clienti');
  const root = useList('Folder', { where: [['Consulenza', '==', ref]], limit: 1 });
  // promemoria della consulenza assegnati all'utente (l'originale non filtrava per consulenza)
  const prom = useList('Promemoria', { where: [['Consulenza_Ref', '==', ref], ['Utente', '==', me.ref]] });

  const del = useAction(() => db.remove(ref), { onSuccess: () => { toast('Consulenza eliminata'); navigate('/consulenze'); } });
  const promemoria = useMemo(() => [...(prom.data ?? [])].sort((a, b) => toDate(b.Data_Creazione) - toDate(a.Data_Creazione)), [prom.data]);

  if (!q.data) return <DocState q={q} backTo="/consulenze" label="Consulenza" />;
  const c = q.data;
  const rootFolder = root.data?.[0];

  const askDelete = async () => {
    if (await confirm({ message: 'Una volta eliminato questo documento non sarà più reperibile.' })) del.mutate();
  };

  return (
    <>
      <PageHead
        crumbs={<Crumbs items={[{ to: '/consulenze', label: 'Consulenze' }, { label: c.Titolo || 'Non indicato' }]} />}
        before={<BackButton to="/consulenze" />}
        title={c.Titolo || 'Non indicato'}
        sub={<span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Badge tone="blue">Consulenza aziendale</Badge>
          {c.Cliente && <Link to={`/clienti/${c.Cliente.split('/')[1]}`} className="small muted">{clienti.get(c.Cliente)?.Nome}</Link>}
          {c.Data_Inizio && <span className="faint small">dal {c.Data_Inizio}</span>}
        </span>}
        actions={<>
          <Button icon={Pencil} onClick={() => edit.open(c)}>Modifica</Button>
          <Button variant="danger" icon={Trash2} onClick={askDelete}>Elimina</Button>
        </>}
      />

      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'panoramica', label: 'Panoramica', icon: LayoutGrid },
        { value: 'documenti', label: 'Documenti', icon: FolderOpen },
        { value: 'calendario', label: 'Calendario', icon: CalendarDays },
        { value: 'attivita', label: 'Attività', icon: ListChecks },
        { value: 'promemoria', label: 'Promemoria', icon: StickyNote, count: promemoria.length },
      ]} />

      {tab === 'panoramica' && (
        <div className="split">
          <div className="stack">
            <Card>
              <CardHead icon={FileText} title="Dettagli consulenza" />
              <div className="card-pad kv">
                <KV label="Descrizione" full>{c.Descrizione}</KV>
                <KV label="Cliente" icon={UserRound}>{c.Cliente && <Link to={`/clienti/${c.Cliente.split('/')[1]}`}>{clienti.get(c.Cliente)?.Nome}</Link>}</KV>
                <KV label="Data inizio" icon={CalendarDays}>{c.Data_Inizio}</KV>
                <KV label="Consulente principale" icon={UserRound}>{c.Avvocato_Principale && <Lawyer name={userName(users, c.Avvocato_Principale)} />}</KV>
                <KV label="Creato il" icon={CalendarClock}>{fmtDate(c.Data_Creazione)}</KV>
                <KV label="Altri consulenti" icon={Users} full>
                  {(c.Avvocati_Supporto ?? []).length ? (
                    <div className="row" style={{ flexWrap: 'wrap', gap: 14 }}>{c.Avvocati_Supporto.map((u) => <Lawyer key={u} name={userName(users, u)} />)}</div>
                  ) : null}
                </KV>
              </div>
            </Card>
            <RecentDocs root={rootFolder?.path} />
          </div>
          <div className="stack">
            <NextAppointments consulenza={ref} onCalendar={() => setTab('calendario')} />
            <Card>
              <CardHead icon={AlarmClock} title="Ultimo promemoria" />
              {promemoria[0] ? (
                <div className="card-pad">
                  <div style={{ fontWeight: 600 }}>{promemoria[0].Titolo || 'Non indicato'}</div>
                  <div className="muted small">{promemoria[0].Data_Promemoria} {promemoria[0].Ora_Promemoria}</div>
                  <div className="faint small" style={{ marginTop: 6 }}>Creato il {fmtShort(promemoria[0].Data_Creazione)}</div>
                </div>
              ) : <Empty>Nessun promemoria.</Empty>}
            </Card>
          </div>
        </div>
      )}

      {tab === 'documenti' && (
        root.isLoading ? <FileExplorer rootRef={undefined} /> : rootFolder ? (
          <FileExplorer
            rootRef={rootFolder.path}
            rootLabel={rootFolder.Titolo || 'Consulenza'}
            folderTipo="Cliente"
            links={{ cliente: c.Cliente }}
            sub="Gestisci i documenti della consulenza."
          />
        ) : <CreateConsRoot c={c} />
      )}

      {tab === 'calendario' && <CalendarView user={me.ref} consulenza={ref} consulenzaDoc={c} title="Calendario Utente - Consulenza" />}

      {tab === 'attivita' && <ActivityFeed sub="Cronologia delle attività relative alla consulenza." where={[['Consulenza', '==', ref], ['Utente', '==', me.ref]]} />}

      {tab === 'promemoria' && <PromemoriaTab items={promemoria} consulenza={c} loading={prom.isLoading} users={users} />}

      <EditConsulenza dialog={edit} />
    </>
  );
}

const Lawyer = ({ name }) => <span className="row" style={{ gap: 8 }}><Avatar name={name} size="sm" />Avv. {name || '—'}</span>;

function CreateConsRoot({ c }) {
  const create = useAction(() => actions.newCustomAction({ titolo: `Cartella per ${c.Titolo}`, tipo: 'Consulenza', consulenza: c.path, cliente: c.Cliente }));
  return <MissingRoot
    onCreate={c.Cliente ? () => create.mutate() : undefined}
    busy={create.isPending}
    reason={c.Cliente ? undefined : 'Collega un cliente alla consulenza per poter creare la cartella documenti.'}
  />;
}

/** calcolaAppuntamentiRecenti: i 2 appuntamenti più vicini ad adesso */
function NextAppointments({ consulenza, onCalendar }) {
  const q = useQuery({ queryKey: ['list', 'appRecenti', consulenza], queryFn: () => actions.appuntamentiRecenti(consulenza), refetchInterval: 60_000 });
  return (
    <Card>
      <CardHead icon={CalendarClock} title="Appuntamenti più vicini">
        <Button size="sm" variant="ghost" onClick={onCalendar}>Calendario</Button>
      </CardHead>
      {!q.data?.length ? <Empty>Nessun appuntamento.</Empty> : q.data.map((a) => {
        const d = parseItDateTime(a.Data_Appuntamento, a.Ora_Appuntamento);
        const past = d && d < new Date();
        return (
          <div key={a.id} className="agenda-item">
            <div className="agenda-bar" style={{ background: past ? 'var(--border-strong)' : 'var(--text)' }} />
            <div className="grow">
              <div style={{ fontWeight: 600 }}>{a.Titolo || 'Non indicato'}</div>
              <div className="muted small tnum">{a.Data_Appuntamento} · {a.Ora_Appuntamento}</div>
              {a.Luogo && <div className="faint small row" style={{ gap: 4 }}><MapPin size={12} />{a.Luogo}</div>}
            </div>
            {past ? <Badge>Passato</Badge> : <Badge tone="blue">In arrivo</Badge>}
          </div>
        );
      })}
    </Card>
  );
}

/** Documenti recenti: file caricati negli ultimi 2 giorni nella cartella della consulenza */
function RecentDocs({ root }) {
  const q = useList('Files', { where: [['Folder_Ref', '==', root]], orderBy: [['Data_Caricamento', 'desc']] }, { enabled: !!root });
  const from = Date.now() - 2 * 864e5;
  const files = (q.data ?? []).filter((f) => toDate(f.Data_Caricamento) > from);
  return (
    <Card>
      <CardHead icon={FolderOpen} title="Documenti recenti" sub="Caricati negli ultimi 2 giorni" />
      {files.length === 0 ? <Empty>Nessun documento recente.</Empty> : (
        <div className="list">
          {files.map((f) => (
            <div key={f.id} className="list-item">
              <span className={`file-icon ${fileKind(f.Nome)}`}><FileText size={17} /></span>
              <div className="grow"><div className="truncate" style={{ fontWeight: 550 }}>{f.Nome}</div><div className="faint small">Caricato il {fmtDate(f.Data_Caricamento)}</div></div>
              <IconButton size="sm" icon={Download} label="Scarica" onClick={() => window.open(f.File, '_blank', 'noopener')} />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function PromemoriaTab({ items, consulenza, loading, users }) {
  const create = useDialog();
  const edit = useDialog();
  const { confirm, toast } = useFeedback();
  const del = useAction((path) => db.remove(path), { onSuccess: () => toast('Promemoria eliminato') });
  const askDelete = async (p) => {
    if (await confirm({ title: 'Elimina promemoria', message: `Eliminare il promemoria “${p.Titolo || 'senza titolo'}”? Questa azione non può essere annullata.` })) del.mutate(p.path);
  };
  return (
    <Card>
      <CardHead icon={StickyNote} title="Promemoria" sub="Promemoria della consulenza assegnati a te">
        <Button size="sm" variant="primary" icon={Plus} onClick={() => create.open()}>Nuovo promemoria</Button>
      </CardHead>
      {!loading && items.length === 0 ? <Empty icon={StickyNote} title="Nessun promemoria">Crea un promemoria per non perdere le scadenze.</Empty> : (
        <div className="table-wrap">
          <table className="table responsive">
            <thead><tr><th>Titolo</th><th>Scadenza</th><th>Assegnato a</th><th /></tr></thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id}>
                  <td><div style={{ fontWeight: 550 }}>{p.Titolo || 'Senza titolo'}</div>{p.Descrizione && <div className="faint small truncate" style={{ maxWidth: 380 }}>{p.Descrizione}</div>}</td>
                  <td className="tnum muted">{p.Data_Promemoria} {p.Ora_Promemoria}</td>
                  <td className="hide-sm"><span className="row" style={{ gap: 8 }}><Avatar size="sm" name={userName(users, p.Utente)} />{userName(users, p.Utente)}</span></td>
                  <td className="actions">
                    <IconButton size="sm" icon={Pencil} label="Modifica" onClick={() => edit.open(p)} />
                    <IconButton size="sm" danger icon={Trash2} label="Elimina" onClick={() => askDelete(p)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <PromemoriaDialog open={create.isOpen} onClose={create.close} consulenza={consulenza} />
      <PromemoriaDialog open={edit.isOpen} onClose={edit.close} consulenza={consulenza} promemoria={edit.data} />
    </Card>
  );
}
