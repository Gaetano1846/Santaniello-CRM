import { useMemo } from 'react';
import { AlarmClock, CalendarCheck, CalendarPlus, CalendarRange, StickyNote } from 'lucide-react';
import { useDialog, useMe } from '../lib/hooks.js';
import { dayKey, fmtLong } from '../lib/format.js';
import { Button } from '../components/ui.jsx';
import { CalendarView, useCalendarEvents } from '../components/Calendar.jsx';
import { AppuntamentoDialog, PromemoriaDialog } from '../components/forms.jsx';

/** Calendario: promemoria e appuntamenti dell'utente collegato */
export default function Calendario() {
  const me = useMe();
  const prom = useDialog();
  const app = useDialog();
  const { events } = useCalendarEvents({ user: me.ref });

  const stats = useMemo(() => {
    const now = new Date();
    const today = dayKey(now);
    const week = new Date(now.getTime() + 7 * 864e5);
    return {
      today: events.filter((e) => dayKey(e.date) === today).length,
      week: events.filter((e) => e.date >= now && e.date <= week).length,
      memo: events.filter((e) => e.type === 'promemoria' && e.date >= now).length,
      next: events.find((e) => e.date >= now),
    };
  }, [events]);

  const hour = new Date().getHours();
  const greeting = hour < 13 ? 'Buongiorno' : hour < 18 ? 'Buon pomeriggio' : 'Buonasera';

  return (
    <>
      <div className="hero">
        <div className="row-between" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <div className="hero-date">{fmtLong(new Date())}</div>
            <h1 className="page-title">{greeting}, {me.display_name?.split(' ')[0] || 'Avvocato'}</h1>
            <div className="hero-next">
              {stats.next ? <>Prossimo: <b>{stats.next.title}</b> · {stats.next.date.toLocaleString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</> : 'Nessun impegno in programma.'}
            </div>
          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <Button icon={StickyNote} onClick={() => prom.open()}>Aggiungi promemoria</Button>
            <Button variant="primary" icon={CalendarPlus} onClick={() => app.open()}>Aggiungi appuntamento</Button>
          </div>
        </div>
      </div>

      <div className="grid grid-3 stats" style={{ marginBottom: 18 }}>
        <Stat icon={CalendarCheck} tone="blue" value={stats.today} label="Eventi oggi" />
        <Stat icon={CalendarRange} tone="green" value={stats.week} label="Nei prossimi 7 giorni" />
        <Stat icon={AlarmClock} tone="amber" value={stats.memo} label="Promemoria in arrivo" />
      </div>

      <CalendarView user={me.ref} title="Calendario Utente" />

      <PromemoriaDialog open={prom.isOpen} onClose={prom.close} />
      <AppuntamentoDialog open={app.isOpen} onClose={app.close} />
    </>
  );
}

export function Stat({ icon: Icon, tone, value, label }) {
  return (
    <div className="card stat">
      <div className="stat-icon" style={{ background: `var(--${tone}-soft)`, color: `var(--${tone})` }}><Icon size={20} /></div>
      <div>
        <div className="stat-value tnum">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
}
