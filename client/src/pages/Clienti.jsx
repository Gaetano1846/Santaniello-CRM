import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { MoreHorizontal, Pencil, Plus, RotateCcw, Search, Trash2, Users } from 'lucide-react';
import { db, useAction, useDialog, useList } from '../lib/hooks.js';
import { textMatch } from '../lib/format.js';
import { AREA_COLOR, CATEGORIE_CLIENTE } from '../lib/constants.js';
import { Avatar, Badge, Button, Card, CardHead, Empty, IconButton, Menu, MenuItem, PageHead, Select, SkeletonRows, Missing } from '../components/ui.jsx';
import { ClienteDialog } from '../components/forms.jsx';
import { useFeedback } from '../components/feedback.jsx';

/** Clienti: elenco con ricerca (Nome, Partita IVA, Email), creazione, modifica, eliminazione */
export default function Clienti() {
  const q = useList('Clienti');
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState(null);
  const create = useDialog();
  const edit = useDialog();
  const navigate = useNavigate();
  const { confirm, toast } = useFeedback();
  const del = useAction((path) => db.remove(path), { onSuccess: () => toast('Cliente eliminato') });

  const rows = useMemo(() => (q.data ?? [])
    .filter((c) => textMatch(search, c.Nome, c.Partita_IVA, c.Email) && (!cat || c.Categoria === cat))
    .sort((a, b) => (a.Nome ?? '').localeCompare(b.Nome ?? '', 'it')), [q.data, search, cat]);

  const askDelete = async (c) => {
    if (await confirm({ title: 'Sei sicuro?', message: `Una volta eliminato, il cliente “${c.Nome}” non potrà più essere reperito.` })) del.mutate(c.path);
  };

  return (
    <>
      <PageHead
        title="Clienti"
        sub="Gestisci tutti i clienti del tuo studio in un unico posto."
        actions={<Button variant="primary" icon={Plus} onClick={() => create.open()}>Nuovo cliente</Button>}
      />

      <Card>
        <CardHead icon={Users} title="Rubrica clienti" sub={`${rows.length} di ${q.data?.length ?? 0} clienti`}>
          <div className="search-box" style={{ width: 260 }}>
            <Search size={15} />
            <input className="input" style={{ height: 36 }} placeholder="Cerca nome, P. IVA, email…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div style={{ width: 190 }}><Select options={CATEGORIE_CLIENTE} value={cat} onChange={setCat} placeholder="Tutte le categorie" style={{ height: 36 }} /></div>
          {(search || cat) && <IconButton icon={RotateCcw} label="Azzera filtri" onClick={() => { setSearch(''); setCat(null); }} />}
        </CardHead>

        {q.isLoading ? <SkeletonRows rows={6} /> : rows.length === 0 ? (
          <Empty icon={Users} title={search || cat ? 'Nessun cliente trovato' : 'Ancora nessun cliente'} action={!search && !cat && <Button icon={Plus} onClick={() => create.open()}>Aggiungi cliente</Button>}>
            {search || cat ? 'Prova a modificare i criteri di ricerca.' : 'Crea il primo cliente per iniziare.'}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr><th>Nome</th><th>Email</th><th>Telefono</th><th>Categoria</th><th /></tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="clickable" onClick={() => navigate(`/clienti/${c.id}`)}>
                    <td>
                      <div className="row">
                        <Avatar name={c.Nome} square />
                        <div style={{ minWidth: 0 }}>
                          <div className="truncate" style={{ fontWeight: 600 }}>{c.Nome || 'Senza nome'}</div>
                          {c.Partita_IVA && <div className="faint small tnum">P. IVA {c.Partita_IVA}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="muted">{c.Email || <Missing />}</td>
                    <td className="muted tnum hide-sm">{c.Telefono || <Missing />}</td>
                    <td className="hide-sm">{c.Categoria ? <Badge tone={AREA_COLOR[c.Categoria]}>{c.Categoria}</Badge> : <Missing />}</td>
                    <td className="actions" onClick={(e) => e.stopPropagation()}>
                      <Menu trigger={<IconButton size="sm" icon={MoreHorizontal} label="Opzioni" />}>
                        <MenuItem icon={Pencil} onClick={() => edit.open(c)}>Modifica</MenuItem>
                        <div className="menu-sep" />
                        <MenuItem icon={Trash2} danger onClick={() => askDelete(c)}>Elimina</MenuItem>
                      </Menu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ClienteDialog open={create.isOpen} onClose={create.close} />
      <ClienteDialog open={edit.isOpen} onClose={edit.close} cliente={edit.data} />
    </>
  );
}
