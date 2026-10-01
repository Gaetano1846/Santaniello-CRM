import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Filter, ListChecks, RotateCcw, Search } from 'lucide-react';
import { useIndex, useList, userName } from '../lib/hooks.js';
import { fmtShort, isoToIt, parseItDate, textMatch, toDate } from '../lib/format.js';
import { Avatar, Button, Card, CardHead, Empty, Input, PageHead, SkeletonRows, Missing } from '../components/ui.jsx';
import { EntityPicker } from '../components/pickers.jsx';

const PAGE = 50;

/**
 * Logs_Attivita: tutte le Activity (Data desc) con filtri combinati in AND
 * (avvocato, cliente, caso — più consulenza e intervallo date) e ricerca sul titolo.
 */
export default function LogAttivita() {
  const q = useList('Activity', { orderBy: [['Data', 'desc']] });
  const { map: users } = useIndex('Users');
  const { map: clienti } = useIndex('Clienti');
  const { map: casi } = useIndex('Casi');
  const { map: consulenze } = useIndex('Consulenze');
  const [f, setF] = useState({ search: '', avvocato: null, cliente: null, caso: null, consulenza: null, dal: '', al: '' });
  const [limit, setLimit] = useState(PAGE);
  const set = (k) => (v) => { setF((p) => ({ ...p, [k]: v })); setLimit(PAGE); };

  const rows = useMemo(() => {
    const from = f.dal ? parseItDate(isoToIt(f.dal)) : null;
    const to = f.al ? new Date(parseItDate(isoToIt(f.al)).getTime() + 864e5) : null;
    return (q.data ?? []).filter((a) =>
      textMatch(f.search, a.Titolo)
      && (!f.avvocato || a.Utente === f.avvocato)
      && (!f.cliente || a.Cliente === f.cliente)
      && (!f.caso || a.Caso === f.caso)
      && (!f.consulenza || a.Consulenza === f.consulenza)
      && (!from || toDate(a.Data) >= from)
      && (!to || toDate(a.Data) < to));
  }, [q.data, f]);

  const active = f.search || f.avvocato || f.cliente || f.caso || f.consulenza || f.dal || f.al;
  const reset = () => { setF({ search: '', avvocato: null, cliente: null, caso: null, consulenza: null, dal: '', al: '' }); setLimit(PAGE); };

  return (
    <>
      <PageHead title="Log attività" sub="Visualizza tutte le azioni compiute nel sistema." />

      <Card style={{ marginBottom: 18 }}>
        <CardHead icon={Filter} title="Filtri">
          {active && <Button size="sm" variant="ghost" icon={RotateCcw} onClick={reset}>Azzera</Button>}
        </CardHead>
        <div className="card-pad grid grid-4" style={{ gap: 12 }}>
          <div className="search-box" style={{ maxWidth: 'none' }}>
            <Search size={15} />
            <input className="input" placeholder="Cerca nel log…" value={f.search} onChange={(e) => set('search')(e.target.value)} />
          </div>
          <EntityPicker col="Users" value={f.avvocato} onChange={set('avvocato')} placeholder="Tutti gli avvocati" searchPlaceholder="Cerca avvocato…" />
          <EntityPicker col="Clienti" value={f.cliente} onChange={set('cliente')} placeholder="Tutti i clienti" searchPlaceholder="Cerca cliente…" />
          <EntityPicker col="Casi" value={f.caso} onChange={set('caso')} placeholder="Tutti i casi" searchPlaceholder="Cerca caso…" />
          <EntityPicker col="Consulenze" value={f.consulenza} onChange={set('consulenza')} placeholder="Tutte le consulenze" searchPlaceholder="Cerca consulenza…" />
          <Input type="date" value={f.dal} onChange={(e) => set('dal')(e.target.value)} aria-label="Dal" title="Dal" />
          <Input type="date" value={f.al} onChange={(e) => set('al')(e.target.value)} aria-label="Al" title="Al" />
        </div>
      </Card>

      <Card>
        <CardHead icon={ListChecks} title="Registro attività" sub={`${rows.length} di ${q.data?.length ?? 0} voci`} />
        {q.isLoading ? <SkeletonRows rows={8} /> : rows.length === 0 ? (
          <Empty icon={ListChecks} title="Nessuna attività">{active ? 'Nessuna voce corrisponde ai filtri.' : 'Il registro è vuoto.'}</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead><tr><th>Attività</th><th>Avvocato</th><th>Collegato a</th><th>Data/Ora</th></tr></thead>
              <tbody>
                {rows.slice(0, limit).map((a) => {
                  const who = userName(users, a.Utente);
                  return (
                    <tr key={a.id}>
                      <td style={{ fontWeight: 500 }}>{a.Titolo || <span className="faint">Attività senza titolo</span>}</td>
                      <td className="hide-sm nowrap">{a.Utente ? <span className="row" style={{ gap: 8 }}><Avatar size="sm" name={who} />{who}</span> : <Missing />}</td>
                      <td>
                        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                          {a.Cliente && clienti.get(a.Cliente) && <Link className="badge" to={`/clienti/${a.Cliente.split('/')[1]}`}>{clienti.get(a.Cliente).Nome}</Link>}
                          {a.Consulenza && consulenze.get(a.Consulenza) && <Link className="badge blue" to={`/consulenze/${a.Consulenza.split('/')[1]}`}>{consulenze.get(a.Consulenza).Titolo}</Link>}
                          {a.Caso && casi.get(a.Caso) && <Link className="badge amber" to={`/casi/${a.Caso.split('/')[1]}`}>{casi.get(a.Caso).Titolo}</Link>}
                          {!a.Cliente && !a.Consulenza && !a.Caso && <Missing />}
                        </div>
                      </td>
                      <td className="muted tnum nowrap">{fmtShort(a.Data)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > limit && (
          <div className="card-pad" style={{ textAlign: 'center', borderTop: '1px solid var(--border)' }}>
            <Button onClick={() => setLimit(limit + PAGE)}>Mostra altre {Math.min(PAGE, rows.length - limit)} voci</Button>
          </div>
        )}
      </Card>
    </>
  );
}

