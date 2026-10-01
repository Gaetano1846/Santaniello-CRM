import { useMemo } from 'react';
import { History, ListChecks } from 'lucide-react';
import { useIndex, useList, userName } from '../lib/hooks.js';
import { fmtDateTime, fmtRelative, toDate } from '../lib/format.js';
import { Card, CardHead, Empty, SkeletonRows } from './ui.jsx';

/**
 * Registro attività di un'entità. I filtri di uguaglianza vanno al server, ordinamento
 * e finestra "recenti" (ultimi 2 giorni, come calcolaDataRecente) sono applicati qui.
 */
export function ActivityFeed({ where, recentDays, limit, title = 'Registro Attività', sub, compact }) {
  const q = useList('Activity', { where });
  const { map: users } = useIndex('Users');

  const items = useMemo(() => {
    let list = [...(q.data ?? [])].sort((a, b) => toDate(b.Data) - toDate(a.Data));
    if (recentDays) {
      const from = Date.now() - recentDays * 864e5;
      list = list.filter((a) => toDate(a.Data) > from);
    }
    return limit ? list.slice(0, limit) : list;
  }, [q.data, recentDays, limit]);

  return (
    <Card>
      <CardHead icon={recentDays ? History : ListChecks} title={title} sub={sub} />
      {q.isLoading ? <SkeletonRows rows={3} /> : items.length === 0 ? (
        <Empty icon={History} title={recentDays ? 'Nessuna attività recente' : 'Nessuna attività registrata'}>
          {recentDays ? `Le azioni degli ultimi ${recentDays} giorni compariranno qui.` : 'Le operazioni svolte compariranno qui.'}
        </Empty>
      ) : (
        <div className="timeline" style={compact ? { paddingTop: 4 } : undefined}>
          {items.map((a) => (
            <div key={a.id} className="tl-item">
              <div className="tl-dot"><ListChecks size={15} /></div>
              <div className="grow">
                <div className="tl-title">{a.Titolo || <span className="faint">Attività senza titolo</span>}</div>
                <div className="tl-meta">
                  {a.Utente && <span>{userName(users, a.Utente) || 'Utente'}</span>}
                  {a.Utente && <span>•</span>}
                  <span title={fmtDateTime(a.Data)}>{fmtRelative(a.Data)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
