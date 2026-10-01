import { useMemo, useState } from 'react';
import {
  AlarmClock, CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Clock, MapPin, Pencil,
  StickyNote, Trash2,
} from 'lucide-react';
import { db, useAction, useDialog, useList } from '../lib/hooks.js';
import {
  dateToIt, dayKey, fmtLong, fmtTime, GIORNI, MESI, parseItDateTime, sameDay,
} from '../lib/format.js';
import { Button, Card, Empty, IconButton, Modal } from './ui.jsx';
import { AppuntamentoDialog, PromemoriaDialog } from './forms.jsx';
import { useFeedback } from './feedback.jsx';

/**
 * Porting di NewCustomWidget / MobileCalendarWidget: Promemoria + Appuntamenti filtrati per
 * utente e/o consulenza, date "dd/MM/yyyy" + "HH:mm" (documenti non interpretabili scartati).
 */
export function useCalendarEvents({ user, consulenza }) {
  const where = [
    ...(consulenza ? [['Consulenza_Ref', '==', consulenza]] : []),
    ...(user ? [['Utente', '==', user]] : []),
  ];
  const q = where.length ? { where } : undefined;
  const prom = useList('Promemoria', q);
  const app = useList('Appuntamenti', q);

  const events = useMemo(() => {
    const out = [];
    for (const p of prom.data ?? []) {
      const date = parseItDateTime(p.Data_Promemoria, p.Ora_Promemoria || '00:00');
      if (date) out.push({ id: p.path, type: 'promemoria', title: p.Titolo || 'Promemoria', date, doc: p });
    }
    for (const a of app.data ?? []) {
      const date = parseItDateTime(a.Data_Appuntamento, a.Ora_Appuntamento || '00:00');
      if (date) out.push({ id: a.path, type: 'appuntamento', title: a.Titolo || 'Appuntamento', date, doc: a });
    }
    // appuntamenti prima dei promemoria, poi per orario (come la vista settimanale originale)
    return out.sort((a, b) => a.date - b.date || (a.type === 'appuntamento' ? -1 : 1));
  }, [prom.data, app.data]);

  return { events, isLoading: prom.isLoading || app.isLoading };
}

const startOfWeek = (d) => { const x = new Date(d); const wd = (x.getDay() + 6) % 7; x.setDate(x.getDate() - wd); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

export function CalendarView({ user, consulenza, consulenzaDoc, title }) {
  const { events, isLoading } = useCalendarEvents({ user, consulenza });
  const [view, setView] = useState('mese');
  const [cursor, setCursor] = useState(() => new Date());
  const [selected, setSelected] = useState(() => new Date());
  const details = useDialog();
  const create = useDialog();

  const byDay = useMemo(() => {
    const m = new Map();
    for (const e of events) {
      const k = dayKey(e.date);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(e);
    }
    return m;
  }, [events]);

  const move = (dir) => {
    const d = new Date(cursor);
    if (view === 'mese') { d.setDate(1); d.setMonth(d.getMonth() + dir); }
    else d.setDate(d.getDate() + (view === 'settimana' ? 7 : 1) * dir);
    setCursor(d);
    if (view !== 'mese') setSelected(d);
  };
  const today = () => { const t = new Date(); setCursor(t); setSelected(t); };

  const label = view === 'mese'
    ? `${MESI[cursor.getMonth()]} ${cursor.getFullYear()}`
    : view === 'settimana'
      ? (() => { const s = startOfWeek(cursor), e = addDays(s, 6); return `${s.getDate()} ${MESI[s.getMonth()].slice(0, 3)} – ${e.getDate()} ${MESI[e.getMonth()].slice(0, 3)} ${e.getFullYear()}`; })()
      : fmtLong(cursor);

  const selectedEvents = byDay.get(dayKey(selected)) ?? [];

  return (
    <>
      <Card>
        <div className="card-head" style={{ flexWrap: 'wrap' }}>
          <div className="row" style={{ gap: 6 }}>
            <Button size="sm" onClick={today}>Oggi</Button>
            <IconButton size="sm" bordered icon={ChevronLeft} label="Precedente" onClick={() => move(-1)} />
            <IconButton size="sm" bordered icon={ChevronRight} label="Successivo" onClick={() => move(1)} />
            <div className="serif" style={{ fontSize: 19, marginLeft: 8, textTransform: 'capitalize' }}>{label}</div>
          </div>
          <div className="grow" />
          <div className="row" style={{ gap: 16 }}>
            <div className="cal-legend">
              <span className="row" style={{ gap: 6 }}><span className="dot" style={{ color: 'var(--blue)' }} />Appuntamenti</span>
              <span className="row" style={{ gap: 6 }}><span className="dot" style={{ color: 'var(--amber)' }} />Promemoria</span>
            </div>
            <div className="segmented" role="tablist" aria-label={title}>
              {[['mese', 'Mese'], ['settimana', 'Settimana'], ['giorno', 'Giorno']].map(([v, l]) => (
                <button key={v} className={view === v ? 'active' : ''} onClick={() => { setView(v); if (v !== 'mese') setCursor(selected); }}>{l}</button>
              ))}
            </div>
          </div>
        </div>

        {isLoading ? <div className="loader"><div className="spinner" /></div> : (
          <>
            {view === 'mese' && (
              <MonthGrid cursor={cursor} byDay={byDay} selected={selected} onSelect={setSelected} onOpen={details.open}
                onDayView={(d) => { setSelected(d); setCursor(d); setView('giorno'); }} />
            )}
            {view === 'settimana' && <WeekGrid cursor={cursor} byDay={byDay} onOpen={details.open} onSelect={(d) => { setSelected(d); setCursor(d); setView('giorno'); }} />}
            {view === 'giorno' && <DayGrid day={cursor} events={byDay.get(dayKey(cursor)) ?? []} onOpen={details.open} />}
          </>
        )}
      </Card>

      {view === 'mese' && (
        <Card style={{ marginTop: 18 }}>
          <div className="card-head">
            <div className="grow">
              <div className="card-title" style={{ textTransform: 'capitalize' }}><CalendarDays size={17} />{fmtLong(selected)}</div>
              <div className="card-sub">{selectedEvents.length ? `${selectedEvents.length} event${selectedEvents.length === 1 ? 'o' : 'i'}` : 'Nessun evento in programma'}</div>
            </div>
            <Button size="sm" icon={StickyNote} onClick={() => create.open({ type: 'promemoria', date: dateToIt(selected) })}>Promemoria</Button>
            <Button size="sm" variant="primary" icon={CalendarPlus} onClick={() => create.open({ type: 'appuntamento', date: dateToIt(selected) })}>Appuntamento</Button>
          </div>
          {selectedEvents.length === 0 ? (
            <Empty icon={CalendarDays} title="Giornata libera">Seleziona un altro giorno o aggiungi un evento.</Empty>
          ) : selectedEvents.map((e) => <AgendaRow key={e.id} e={e} onOpen={details.open} />)}
        </Card>
      )}

      <EventDetails event={details.data} open={details.isOpen} onClose={details.close} consulenzaDoc={consulenzaDoc} />
      <PromemoriaDialog open={create.isOpen && create.data?.type === 'promemoria'} onClose={create.close} consulenza={consulenzaDoc} date={create.data?.date} />
      <AppuntamentoDialog open={create.isOpen && create.data?.type === 'appuntamento'} onClose={create.close} consulenza={consulenzaDoc} date={create.data?.date} />
    </>
  );
}

function AgendaRow({ e, onOpen }) {
  const appt = e.type === 'appuntamento';
  return (
    <div className="agenda-item clickable list-item" style={{ padding: '14px 24px' }} onClick={() => onOpen(e)}>
      <div className="agenda-time">{fmtTime(e.date)}</div>
      <div className={`agenda-bar ${appt ? '' : 'memo'}`} />
      <div className="grow">
        <div style={{ fontWeight: 550 }}>{e.title}</div>
        <div className="faint small">{appt ? (e.doc.Luogo ? `Luogo: ${e.doc.Luogo}` : 'Appuntamento') : (e.doc.Descrizione || 'Promemoria')}</div>
      </div>
      <span className={`badge ${appt ? '' : 'amber'}`}>{appt ? 'Appuntamento' : 'Promemoria'}</span>
    </div>
  );
}

function MonthGrid({ cursor, byDay, selected, onSelect, onOpen, onDayView }) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = startOfWeek(first);
  const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  const weeks = Math.ceil(((last - start) / 864e5 + 1) / 7);
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));
  const now = new Date();

  return (
    <div className="cal">
      {GIORNI.map((g) => <div key={g} className="cal-dow">{g}</div>)}
      {days.map((d) => {
        const evs = byDay.get(dayKey(d)) ?? [];
        const out = d.getMonth() !== cursor.getMonth();
        return (
          <div
            key={d.toISOString()}
            className={`cal-cell ${out ? 'out' : ''} ${sameDay(d, now) ? 'today' : ''} ${sameDay(d, selected) ? 'selected' : ''}`}
            onClick={() => onSelect(d)}
            onDoubleClick={() => onDayView(d)}
          >
            <span className="cal-num tnum">{d.getDate()}</span>
            {evs.slice(0, 3).map((e) => (
              <div key={e.id} className={`cal-event ${e.type === 'appuntamento' ? 'appt' : 'memo'}`} onClick={(ev) => { ev.stopPropagation(); onOpen(e); }} title={`${fmtTime(e.date)} · ${e.title}`}>
                <span className="tnum" style={{ opacity: 0.75 }}>{fmtTime(e.date)}</span>{e.title}
              </div>
            ))}
            {evs.length > 3 && <div className="cal-more">+{evs.length - 3} altri</div>}
            {evs.length > 0 && (
              <div className="cal-dots">
                {evs.slice(0, 4).map((e) => <span key={e.id} className="dot" style={{ width: 6, height: 6, color: e.type === 'appuntamento' ? 'var(--text)' : 'var(--amber)' }} />)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function WeekGrid({ cursor, byDay, onOpen, onSelect }) {
  const start = startOfWeek(cursor);
  const now = new Date();
  return (
    <div className="table-wrap">
      <div className="cal" style={{ minWidth: 760 }}>
        {Array.from({ length: 7 }, (_, i) => {
          const d = addDays(start, i);
          return (
            <div key={i} className="cal-dow" style={{ cursor: 'pointer', ...(sameDay(d, now) ? { color: 'var(--brass-text)' } : {}) }} onClick={() => onSelect(d)}>
              {GIORNI[i]} <span className="tnum" style={{ fontSize: 16, color: 'var(--text)', marginLeft: 4 }}>{d.getDate()}</span>
            </div>
          );
        })}
        {Array.from({ length: 7 }, (_, i) => {
          const d = addDays(start, i);
          const evs = byDay.get(dayKey(d)) ?? [];
          return (
            <div key={i} className={`cal-cell ${sameDay(d, now) ? 'today' : ''}`} style={{ minHeight: 360, cursor: 'default', background: sameDay(d, now) ? 'var(--surface-2)' : undefined }}>
              {evs.map((e) => (
                <div key={e.id} className={`cal-event ${e.type === 'appuntamento' ? 'appt' : 'memo'}`} style={{ flexDirection: 'column', whiteSpace: 'normal', gap: 0, padding: '6px 8px', cursor: 'pointer' }} onClick={() => onOpen(e)}>
                  <span className="tnum" style={{ opacity: 0.75 }}>{fmtTime(e.date)}</span>
                  <span>{e.title}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Vista giorno: 24 fasce orarie; trascinando un evento su un'altra ora lo si sposta (come l'originale) */
function DayGrid({ day, events, onOpen }) {
  const { toast } = useFeedback();
  const [over, setOver] = useState(null);
  const moveEvt = useAction(async ({ e, hour }) => {
    const d = new Date(e.date);
    d.setHours(hour);
    const data = e.type === 'promemoria'
      ? { Data_Promemoria: dateToIt(d), Ora_Promemoria: fmtTime(d) }
      : { Data_Appuntamento: dateToIt(d), Ora_Appuntamento: fmtTime(d) };
    await db.update(e.id, data);
    return fmtTime(d);
  }, { onSuccess: (t) => toast(`Evento spostato alle ${t}`) });

  const hours = Array.from({ length: 24 }, (_, h) => h);
  return (
    <div style={{ maxHeight: 640, overflowY: 'auto' }} ref={(el) => { if (el && !el.dataset.scrolled) { el.scrollTop = 7 * 56; el.dataset.scrolled = '1'; } }}>
      {hours.map((h) => {
        const evs = events.filter((e) => e.date.getHours() === h);
        return (
          <div
            key={h}
            className="row"
            style={{ alignItems: 'stretch', minHeight: 56, borderBottom: '1px solid var(--border)', background: over === h ? 'var(--brass-soft)' : undefined }}
            onDragOver={(ev) => { ev.preventDefault(); setOver(h); }}
            onDragLeave={() => setOver(null)}
            onDrop={(ev) => {
              ev.preventDefault(); setOver(null);
              const e = events.find((x) => x.id === ev.dataTransfer.getData('text/plain'));
              if (e && e.date.getHours() !== h) moveEvt.mutate({ e, hour: h });
            }}
          >
            <div className="faint small tnum" style={{ width: 64, padding: '8px 12px', borderRight: '1px solid var(--border)', flex: 'none' }}>{String(h).padStart(2, '0')}:00</div>
            <div className="grow" style={{ padding: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {evs.map((e) => (
                <div
                  key={e.id}
                  draggable
                  onDragStart={(ev) => ev.dataTransfer.setData('text/plain', e.id)}
                  className={`cal-event ${e.type === 'appuntamento' ? 'appt' : 'memo'}`}
                  style={{ padding: '8px 12px', fontSize: 13, cursor: 'grab' }}
                  onClick={() => onOpen(e)}
                  title="Trascina su un'altra ora per spostarlo"
                >
                  <span className="tnum">{fmtTime(e.date)}</span> {e.title}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EventDetails({ event, open, onClose, consulenzaDoc }) {
  const { confirm, toast } = useFeedback();
  const edit = useDialog();
  const appt = event?.type === 'appuntamento';
  const label = appt ? 'appuntamento' : 'promemoria';
  const del = useAction(() => db.remove(event.id), {
    onSuccess: () => { toast(`${appt ? 'Appuntamento' : 'Promemoria'} eliminato con successo`); onClose(); },
  });
  const askDelete = async () => {
    if (await confirm({ title: `Elimina ${label}`, confirmLabel: 'Elimina', message: `Sei sicuro di voler eliminare questo ${label}? Questa azione non può essere annullata.` })) del.mutate();
  };
  if (!event) return null;

  return (
    <>
      <Modal
        open={open && !edit.isOpen}
        onClose={onClose}
        title={event.title}
        icon={appt ? CalendarDays : AlarmClock}
        size="sm"
        footer={
          <>
            <Button variant="danger" icon={Trash2} onClick={askDelete} loading={del.isPending}>Elimina</Button>
            <div className="grow" />
            <Button icon={Pencil} onClick={() => edit.open()}>Modifica</Button>
            <Button variant="primary" onClick={onClose}>Chiudi</Button>
          </>
        }
      >
        <div className="stack" style={{ gap: 12 }}>
          <span className={`badge ${appt ? 'blue' : 'amber'}`} style={{ alignSelf: 'flex-start' }}>{appt ? 'Appuntamento' : 'Promemoria'}</span>
          <div className="contact-line"><Clock size={15} /> <span style={{ textTransform: 'capitalize' }}>{fmtLong(event.date)}</span> · <b className="tnum">{fmtTime(event.date)}</b></div>
          {appt ? (
            <div className="contact-line"><MapPin size={15} /> {event.doc.Luogo || <span className="faint">Luogo non indicato</span>}</div>
          ) : (
            <div>
              <div className="kv-label">Descrizione</div>
              <div className="kv-value">{event.doc.Descrizione || <span className="faint">Nessuna descrizione</span>}</div>
            </div>
          )}
        </div>
      </Modal>
      {appt
        ? <AppuntamentoDialog open={edit.isOpen} onClose={() => { edit.close(); onClose(); }} appuntamento={event.doc} consulenza={consulenzaDoc} />
        : <PromemoriaDialog open={edit.isOpen} onClose={() => { edit.close(); onClose(); }} promemoria={event.doc} consulenza={consulenzaDoc} />}
    </>
  );
}
