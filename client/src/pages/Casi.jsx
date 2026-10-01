import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Briefcase, MoreHorizontal, Pencil, Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import { db, useAction, useDialog, useIndex, useList, userName } from '../lib/hooks.js';
import { parseItDate, textMatch } from '../lib/format.js';
import { AREA_COLOR, AREE_PRATICA } from '../lib/constants.js';
import { Avatar, Badge, Button, Card, CardHead, Empty, IconButton, Menu, MenuItem, PageHead, Select, SkeletonRows, Missing } from '../components/ui.jsx';
import { CasoDialog } from '../components/forms.jsx';
import { useFeedback } from '../components/feedback.jsx';

/** Casi: elenco con ricerca per titolo e filtro per area pratica (indipendenti tra loro) */
export default function Casi() {
  const q = useList('Casi');
  const { map: clienti } = useIndex('Clienti');
  const { map: users } = useIndex('Users');
  const [search, setSearch] = useState('');
  const [area, setArea] = useState(null);
  const create = useDialog();
  const edit = useDialog();
  const navigate = useNavigate();
  const { confirm, toast } = useFeedback();
  const del = useAction((path) => db.remove(path), { onSuccess: () => toast('Caso eliminato') });

  const rows = useMemo(() => (q.data ?? [])
    .filter((c) => textMatch(search, c.Titolo) && (!area || c.Area_Pratica === area))
    .sort((a, b) => new Date(b.Data_Creazione ?? 0) - new Date(a.Data_Creazione ?? 0)), [q.data, search, area]);

  const askDelete = async (c) => {
    if (await confirm({ message: `Una volta eliminato, il caso “${c.Titolo}” non sarà più reperibile.` })) del.mutate(c.path);
  };

  return (
    <>
      <PageHead
        title="Casi"
        sub="Gestisci tutti i casi dello studio legale."
        actions={<Button variant="primary" icon={Plus} onClick={() => create.open()}>Nuovo caso</Button>}
      />
      <Card>
        <CardHead icon={Briefcase} title="Elenco casi" sub={`${rows.length} di ${q.data?.length ?? 0} casi`}>
          <div className="search-box" style={{ width: 240 }}>
            <Search size={15} />
            <input className="input" style={{ height: 36 }} placeholder="Cerca per titolo…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div style={{ width: 200 }}><Select options={AREE_PRATICA} value={area} onChange={setArea} placeholder="Tutte le aree" style={{ height: 36 }} /></div>
          {(search || area) && <IconButton icon={RotateCcw} label="Azzera filtri" onClick={() => { setSearch(''); setArea(null); }} />}
        </CardHead>
        {q.isLoading ? <SkeletonRows rows={6} /> : rows.length === 0 ? (
          <Empty icon={Briefcase} title="Nessun caso" action={!search && !area && <Button icon={Plus} onClick={() => create.open()}>Nuovo caso</Button>}>
            {search || area ? 'Nessun risultato per i filtri impostati.' : 'Crea il primo caso dello studio.'}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead><tr><th>Titolo</th><th>Cliente</th><th>Avvocato</th><th>Scadenza</th><th /></tr></thead>
              <tbody>
                {rows.map((c) => {
                  const scad = parseItDate(c.Scadenza);
                  const days = scad ? Math.ceil((scad - new Date()) / 864e5) : null;
                  return (
                    <tr key={c.id} className="clickable" onClick={() => navigate(`/casi/${c.id}`)}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{c.Titolo || 'Senza titolo'}</div>
                        {c.Area_Pratica && <div style={{ marginTop: 4 }}><Badge tone={AREA_COLOR[c.Area_Pratica]}>{c.Area_Pratica}</Badge></div>}
                      </td>
                      <td className="muted">{clienti.get(c.Cliente)?.Nome || <Missing />}</td>
                      <td className="hide-sm">
                        {c.Avvocato_Principale ? <span className="row" style={{ gap: 8 }}><Avatar size="sm" name={userName(users, c.Avvocato_Principale)} />{userName(users, c.Avvocato_Principale)}</span> : <Missing />}
                      </td>
                      <td className="hide-sm tnum">
                        {c.Scadenza ? <Badge tone={days < 0 ? 'red' : days <= 7 ? 'amber' : undefined}>{c.Scadenza}</Badge> : <Missing />}
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
      <CasoDialog open={create.isOpen} onClose={create.close} />
      <CasoDialog open={edit.isOpen} onClose={edit.close} caso={edit.data} />
    </>
  );
}
