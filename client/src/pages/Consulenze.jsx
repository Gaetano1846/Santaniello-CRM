import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { FileText, MoreHorizontal, Pencil, Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import { db, useAction, useDialog, useIndex, useList, userName } from '../lib/hooks.js';
import { fmtDate, textMatch } from '../lib/format.js';
import { Avatar, Button, Card, CardHead, Empty, IconButton, Menu, MenuItem, PageHead, SkeletonRows, Missing } from '../components/ui.jsx';
import { EntityPicker } from '../components/pickers.jsx';
import { ConsulenzaDialog } from '../components/forms.jsx';
import { useFeedback } from '../components/feedback.jsx';

/** Consulenza_Aziendale: elenco consulenze (Data_Creazione desc), ricerca su Titolo e Descrizione */
export default function Consulenze() {
  const q = useList('Consulenze', { orderBy: [['Data_Creazione', 'desc']] });
  const { map: clienti } = useIndex('Clienti');
  const { map: users } = useIndex('Users');
  const [search, setSearch] = useState('');
  const [cliente, setCliente] = useState(null);
  const create = useDialog();
  const edit = useDialog();
  const navigate = useNavigate();
  const { confirm, toast } = useFeedback();
  const del = useAction((path) => db.remove(path), { onSuccess: () => toast('Consulenza eliminata') });

  const rows = useMemo(() => (q.data ?? []).filter((c) =>
    textMatch(search, c.Titolo, c.Descrizione) && (!cliente || c.Cliente === cliente)), [q.data, search, cliente]);

  const askDelete = async (c) => {
    if (await confirm({ message: `Una volta eliminata, la consulenza “${c.Titolo}” non sarà più disponibile.` })) del.mutate(c.path);
  };

  return (
    <>
      <PageHead
        title="Consulenza aziendale"
        sub="Gestisci i casi di consulenza aziendale e le attività correlate."
        actions={<Button variant="primary" icon={Plus} onClick={() => create.open()}>Nuova consulenza</Button>}
      />
      <Card>
        <CardHead icon={FileText} title="Consulenze" sub={`${rows.length} di ${q.data?.length ?? 0} consulenze`}>
          <div className="search-box filter-search" style={{ width: 260 }}>
            <Search size={15} />
            <input className="input" style={{ height: 36 }} placeholder="Cerca per titolo o descrizione…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="filter-select" style={{ width: 210 }}><EntityPicker col="Clienti" value={cliente} onChange={setCliente} placeholder="Tutti i clienti" /></div>
          {(search || cliente) && <IconButton icon={RotateCcw} label="Azzera filtri" onClick={() => { setSearch(''); setCliente(null); }} />}
        </CardHead>
        {q.isLoading ? <SkeletonRows rows={6} /> : rows.length === 0 ? (
          <Empty icon={FileText} title="Nessuna consulenza" action={!search && <Button icon={Plus} onClick={() => create.open()}>Nuova consulenza</Button>}>
            {search || cliente ? 'Nessun risultato per i filtri impostati.' : 'Crea la prima consulenza aziendale.'}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead><tr><th>Titolo</th><th>Cliente</th><th>Data inizio</th><th>Avvocati</th><th /></tr></thead>
              <tbody>
                {rows.map((c) => {
                  const team = [c.Avvocato_Principale, ...(c.Avvocati_Supporto ?? [])].filter(Boolean);
                  return (
                    <tr key={c.id} className="clickable" onClick={() => navigate(`/consulenze/${c.id}`)}>
                      <td>
                        <div className="row">
                          <span className="file-icon doc"><FileText size={17} /></span>
                          <div style={{ minWidth: 0 }}>
                            <div className="truncate" style={{ fontWeight: 600 }}>{c.Titolo || 'Senza titolo'}</div>
                            <div className="faint small">Creata il {fmtDate(c.Data_Creazione)}</div>
                          </div>
                        </div>
                      </td>
                      <td className="muted">{clienti.get(c.Cliente)?.Nome || <Missing />}</td>
                      <td className="muted tnum hide-sm">{c.Data_Inizio || <Missing />}</td>
                      <td className="hide-sm">
                        <div className="avatar-stack">{team.slice(0, 4).map((u) => <Avatar key={u} size="sm" name={userName(users, u)} />)}</div>
                      </td>
                      <td className="actions" onClick={(e) => e.stopPropagation()}>
                        <Menu trigger={<IconButton size="sm" icon={MoreHorizontal} label="Opzioni" />}>
                          <MenuItem icon={Pencil} onClick={() => edit.open(c)}>Modifica</MenuItem>
                          <div className="menu-sep" />
                          <MenuItem icon={Trash2} danger onClick={() => askDelete(c)}>Elimina</MenuItem>
                        </Menu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <ConsulenzaDialog open={create.isOpen} onClose={create.close} />
      <EditConsulenza dialog={edit} />
    </>
  );
}

/** Il dialog di modifica carica anche la cartella radice per poterla rinominare */
export function EditConsulenza({ dialog }) {
  const c = dialog.data;
  const root = useList('Folder', { where: [['Consulenza', '==', c?.path]], limit: 1 }, { enabled: !!c });
  return <ConsulenzaDialog open={dialog.isOpen && !root.isLoading} onClose={dialog.close} consulenza={c} rootFolder={root.data?.[0]} />;
}
