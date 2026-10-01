import { useEffect, useState } from 'react';
import {
  Briefcase, CalendarDays, CalendarPlus, Clock, FileText, Folder, Hash,
  Home, Mail, MapPin, Pencil, Phone, StickyNote, Tag, UserPlus, UserRound,
} from 'lucide-react';
import { actions, db, useAction, useMe } from '../lib/hooks.js';
import { logActivity, T } from '../lib/activity.js';
import { AREE_PRATICA, CATEGORIE_CLIENTE } from '../lib/constants.js';
import { isoToIt, itToIso } from '../lib/format.js';
import { Field, FormModal, Input, Select, Textarea } from './ui.jsx';
import { EntityPicker, LawyerMultiPicker, useOptions } from './pickers.jsx';
import { useFeedback } from './feedback.jsx';

const useForm = (open, init) => {
  const [f, setF] = useState({});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) setF(init()); }, [open]);
  const bind = (k) => ({ value: f[k] ?? '', onChange: (e) => setF((p) => ({ ...p, [k]: e.target.value })) });
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  return [f, bind, set];
};

/** input date che legge/scrive stringhe "dd/MM/yyyy" (formato salvato su Firestore) */
const ItDate = ({ value, onChange, ...rest }) => (
  <Input icon={CalendarDays} type="date" value={itToIso(value)} onChange={(e) => onChange(isoToIt(e.target.value))} {...rest} />
);

/* ================================================================ CLIENTE */

/** CreateCliente / EditCliente */
export function ClienteDialog({ open, onClose, cliente, onCreated }) {
  const me = useMe();
  const { toast } = useFeedback();
  const editing = !!cliente;
  const [f, bind, set] = useForm(open, () => ({
    Nome: cliente?.Nome ?? '',
    Partita_IVA: cliente?.Partita_IVA ?? '',
    Email: cliente?.Email ?? '',
    Telefono: cliente?.Telefono ? String(cliente.Telefono) : '',
    indirizzo: cliente?.indirizzo ?? '',
    Categoria: cliente?.Categoria ?? null,
    Note: cliente?.Note ?? '',
    cartella: '',
  }));

  const save = useAction(async () => {
    const data = { Nome: f.Nome, Partita_IVA: f.Partita_IVA, Email: f.Email, Telefono: f.Telefono, indirizzo: f.indirizzo, Categoria: f.Categoria, Note: f.Note };
    if (editing) {
      await db.update(cliente.path, data);
      await logActivity(me, T.modificaCliente(cliente.Nome), { cliente: cliente.path });
      return cliente;
    }
    const doc = await db.add('Clienti', { ...data, Caso_Aperto: false });
    await logActivity(me, T.creaCliente(f.Nome), { cliente: doc.path });
    await actions.newCustomAction({ titolo: f.cartella.trim() || `Cartella di ${f.Nome}`, tipo: 'Cliente', cliente: doc.path });
    await logActivity(me, T.creaCartellaCliente(f.Nome), { cliente: doc.path });
    return doc;
  }, {
    onSuccess: (doc) => {
      toast(editing ? 'Cliente aggiornato' : 'Cliente creato', { body: editing ? "L'operazione di modifica è andata a buon fine." : "L'operazione di creazione è andata a buon fine." });
      onClose();
      if (!editing) onCreated?.(doc);
    },
  });

  return (
    <FormModal open={open} onClose={onClose} title={editing ? 'Modifica cliente' : 'Nuovo cliente'} icon={editing ? Pencil : UserPlus} size="lg" onSubmit={() => save.mutate()} busy={save.isPending}>
      <div className="form-grid">
        <Field required label="Nome / Ragione sociale" className="full"><Input icon={UserRound} {...bind('Nome')} required autoFocus /></Field>
        <Field label="Partita IVA"><Input icon={Hash} {...bind('Partita_IVA')} /></Field>
        <Field label="Categoria"><Select options={CATEGORIE_CLIENTE} value={f.Categoria} onChange={set('Categoria')} placeholder="Tutte le aree" /></Field>
        <Field label="Email"><Input icon={Mail} type="email" {...bind('Email')} /></Field>
        <Field label="Telefono" hint="Salvato come numero, senza spazi né prefisso."><Input icon={Phone} type="tel" inputMode="numeric" {...bind('Telefono')} /></Field>
        <Field label="Indirizzo" className="full"><Input icon={Home} {...bind('indirizzo')} /></Field>
        <Field label="Note" className="full"><Textarea rows={3} {...bind('Note')} /></Field>
      </div>
      {!editing && (
        <>
          <div className="form-section"><Folder size={14} /> Cartella cliente</div>
          <Field label="Titolo cartella" hint={`Se vuoto: “Cartella di ${f.Nome || '…'}”`}>
            <Input icon={Folder} {...bind('cartella')} placeholder="Titolo (nome cliente)" />
          </Field>
        </>
      )}
    </FormModal>
  );
}

/* ============================================================= CONSULENZA */

/** CreaConsulenza / ModificaConsulenza */
export function ConsulenzaDialog({ open, onClose, consulenza, rootFolder, onCreated }) {
  const me = useMe();
  const { toast } = useFeedback();
  const editing = !!consulenza;
  const [f, bind, set] = useForm(open, () => ({
    Titolo: consulenza?.Titolo ?? '',
    Data_Inizio: consulenza?.Data_Inizio ?? '',
    Descrizione: consulenza?.Descrizione ?? '',
    Avvocati_Supporto: consulenza?.Avvocati_Supporto ?? [],
    Avvocato_Principale: consulenza?.Avvocato_Principale ?? null,
    Cliente: consulenza?.Cliente ?? null,
    cartella: rootFolder?.Titolo ?? '',
  }));

  const save = useAction(async () => {
    const data = {
      Titolo: f.Titolo, Descrizione: f.Descrizione, Data_Inizio: f.Data_Inizio,
      Avvocati_Supporto: f.Avvocati_Supporto,
      // in modifica un selettore svuotato rimuove il collegamento
      ...(f.Cliente || editing ? { Cliente: f.Cliente ?? null } : {}),
      ...(f.Avvocato_Principale || editing ? { Avvocato_Principale: f.Avvocato_Principale ?? null } : {}),
    };
    if (editing) {
      await db.update(consulenza.path, data);
      if (rootFolder && f.cartella.trim()) await db.update(rootFolder.path, { Titolo: f.cartella.trim() });
      return consulenza;
    }
    const doc = await db.add('Consulenze', { ...data, Data_Creazione: '__now__' });
    await logActivity(me, T.creaConsulenza(f.Titolo), { consulenza: doc.path });
    await actions.newCustomAction({ titolo: f.cartella.trim() || `Cartella per ${f.Titolo}`, tipo: 'Consulenza', consulenza: doc.path, cliente: f.Cliente });
    return doc;
  }, {
    onSuccess: (doc) => {
      toast('Operazione riuscita', { body: `Il documento consulenza è stato ${editing ? 'modificato' : 'creato'} con successo.` });
      onClose();
      if (!editing) onCreated?.(doc);
    },
  });

  return (
    <FormModal open={open} onClose={onClose} title={editing ? 'Modifica consulenza' : 'Nuova consulenza'} icon={editing ? Pencil : FileText} size="lg" onSubmit={() => save.mutate()} busy={save.isPending}>
      <div className="form-grid">
        <Field required label="Titolo" className="full"><Input icon={Tag} {...bind('Titolo')} required autoFocus /></Field>
        <Field label="Cliente" hint={editing ? undefined : 'Necessario per creare la cartella documenti.'}>
          <EntityPicker col="Clienti" value={f.Cliente} onChange={set('Cliente')} placeholder="Seleziona cliente" searchPlaceholder="Cerca cliente" />
        </Field>
        <Field label="Data inizio"><ItDate value={f.Data_Inizio} onChange={set('Data_Inizio')} /></Field>
        <Field label="Descrizione" className="full"><Textarea rows={3} {...bind('Descrizione')} /></Field>
        <Field label="Avvocato principale" className="full">
          <EntityPicker col="Users" value={f.Avvocato_Principale} onChange={set('Avvocato_Principale')} placeholder="Seleziona avvocato" searchPlaceholder="Cerca avvocato" />
        </Field>
        <Field label="Avvocati di supporto" className="full">
          <LawyerMultiPicker value={f.Avvocati_Supporto} onChange={set('Avvocati_Supporto')} exclude={f.Avvocato_Principale} />
        </Field>
      </div>
      {(!editing || rootFolder) && (
        <>
          <div className="form-section"><Folder size={14} /> Cartella consulenza</div>
          <Field label="Titolo cartella" hint={editing ? undefined : `Se vuoto: “Cartella per ${f.Titolo || '…'}”`}>
            <Input icon={Folder} {...bind('cartella')} placeholder="Titolo (nome consulenza)" />
          </Field>
        </>
      )}
      {!editing && !f.Cliente && <div className="notice">Senza cliente la cartella documenti non viene creata</div>}
    </FormModal>
  );
}

/* =================================================================== CASO */

/** CreaCaso / ModificaCaso */
export function CasoDialog({ open, onClose, caso, onCreated }) {
  const { toast } = useFeedback();
  const editing = !!caso;
  const [f, bind, set] = useForm(open, () => ({
    Titolo: caso?.Titolo ?? '',
    Area_Pratica: caso?.Area_Pratica || null,
    Descrizione: caso?.Descrizione ?? '',
    Data_Inizio: caso?.Data_Inizio ?? '',
    Scadenza: caso?.Scadenza ?? '',
    Avvovati_Supporto: caso?.Avvovati_Supporto ?? [],
    Avvocato_Principale: caso?.Avvocato_Principale ?? null,
    Cliente: caso?.Cliente ?? null,
    cartella: '',
  }));

  const save = useAction(async () => {
    const data = {
      Titolo: f.Titolo, Area_Pratica: f.Area_Pratica ?? '', Descrizione: f.Descrizione,
      Data_Inizio: f.Data_Inizio, Scadenza: f.Scadenza, Avvovati_Supporto: f.Avvovati_Supporto,
      ...(f.Cliente || editing ? { Cliente: f.Cliente ?? null } : {}),
      ...(f.Avvocato_Principale || editing ? { Avvocato_Principale: f.Avvocato_Principale ?? null } : {}),
    };
    if (editing) return db.update(caso.path, data);
    const doc = await db.add('Casi', { ...data, Data_Creazione: '__now__' });
    await actions.newCustomAction({ titolo: f.cartella.trim() || `Cartella del caso: ${f.Titolo}`, tipo: 'caso', cliente: f.Cliente, caso: doc.path });
    return doc;
  }, {
    onSuccess: (doc) => {
      toast(editing ? 'Caso aggiornato' : 'Caso creato');
      onClose();
      if (!editing) onCreated?.(doc);
    },
  });

  return (
    <FormModal open={open} onClose={onClose} title={editing ? 'Modifica caso' : 'Nuovo caso'} icon={editing ? Pencil : Briefcase} size="lg" onSubmit={() => save.mutate()} busy={save.isPending}>
      <div className="form-grid">
        <Field required label="Titolo" className="full"><Input icon={Tag} {...bind('Titolo')} required autoFocus /></Field>
        <Field label="Cliente"><EntityPicker col="Clienti" value={f.Cliente} onChange={set('Cliente')} placeholder="Seleziona cliente" searchPlaceholder="Cerca cliente" /></Field>
        <Field label="Area pratica"><Select options={AREE_PRATICA} value={f.Area_Pratica} onChange={set('Area_Pratica')} placeholder="Seleziona area" /></Field>
        <Field label="Data inizio"><ItDate value={f.Data_Inizio} onChange={set('Data_Inizio')} /></Field>
        <Field label="Scadenza"><ItDate value={f.Scadenza} onChange={set('Scadenza')} /></Field>
        <Field label="Descrizione" className="full"><Textarea rows={4} {...bind('Descrizione')} /></Field>
        <Field label="Avvocato principale" className="full"><EntityPicker col="Users" value={f.Avvocato_Principale} onChange={set('Avvocato_Principale')} placeholder="Seleziona avvocato" searchPlaceholder="Cerca avvocato" /></Field>
        <Field label="Avvocati di supporto" className="full"><LawyerMultiPicker value={f.Avvovati_Supporto} onChange={set('Avvovati_Supporto')} exclude={f.Avvocato_Principale} /></Field>
      </div>
      {!editing && (
        <>
          <div className="form-section"><Folder size={14} /> Cartella caso</div>
          <Field label="Titolo cartella" hint={`Se vuoto: “Cartella del caso: ${f.Titolo || '…'}”`}><Input icon={Folder} {...bind('cartella')} placeholder="Titolo (nome caso)" /></Field>
          {!f.Cliente && <div className="notice">Senza cliente la cartella documenti del caso non viene creata.</div>}
        </>
      )}
    </FormModal>
  );
}

/* ============================================================== PROMEMORIA */

/**
 * CreaPromemoria (consulenza fissa), CreaPromemoriaGeneral (consulenza a scelta)
 * e ModificaPromemoria (promemoria passato).
 */
export function PromemoriaDialog({ open, onClose, consulenza, promemoria, date }) {
  const me = useMe();
  const { toast } = useFeedback();
  const { map: consulenze } = useOptions('Consulenze');
  const editing = !!promemoria;
  const [f, bind, set] = useForm(open, () => ({
    Titolo: promemoria?.Titolo ?? '',
    Descrizione: promemoria?.Descrizione ?? '',
    Data_Promemoria: promemoria?.Data_Promemoria ?? date ?? '',
    Ora_Promemoria: promemoria?.Ora_Promemoria ?? '',
    Consulenza_Ref: promemoria?.Consulenza_Ref ?? consulenza?.path ?? null,
  }));

  const save = useAction(async () => {
    const cons = consulenza ?? consulenze.get(f.Consulenza_Ref);
    if (editing) {
      await db.update(promemoria.path, { Titolo: f.Titolo, Descrizione: f.Descrizione, Data_Promemoria: f.Data_Promemoria, Ora_Promemoria: f.Ora_Promemoria });
      await logActivity(me, cons ? T.modificaPromemoria(cons.Titolo) : T.modificaPromemoriaGenerale(f.Titolo), { consulenza: cons?.path });
      return;
    }
    await db.add('Promemoria', {
      Data_Creazione: '__now__', Titolo: f.Titolo, Descrizione: f.Descrizione,
      Data_Promemoria: f.Data_Promemoria, Ora_Promemoria: f.Ora_Promemoria, Utente: me.ref,
      ...(f.Consulenza_Ref ? { Consulenza_Ref: f.Consulenza_Ref } : {}),
    });
    if (consulenza) await logActivity(me, T.creaPromemoriaConsulenza(consulenza.Titolo), { consulenza: consulenza.path });
    else await logActivity(me, T.creaPromemoria(f.Titolo), { consulenza: cons?.path, cliente: cons?.Cliente });
  }, {
    onSuccess: () => {
      toast(editing ? 'Promemoria aggiornato' : 'Promemoria creato', { body: `L'operazione di ${editing ? 'modifica' : 'creazione'} del promemoria è andata a buon fine.` });
      onClose();
    },
  });

  return (
    <FormModal open={open} onClose={onClose} title={editing ? 'Modifica promemoria' : 'Nuovo promemoria'} icon={StickyNote} onSubmit={() => save.mutate()} busy={save.isPending}>
      <Field required label="Titolo"><Input icon={Tag} {...bind('Titolo')} placeholder="Aggiungi titolo" required autoFocus /></Field>
      <Field label="Descrizione"><Textarea rows={4} {...bind('Descrizione')} placeholder="Descrivi il promemoria" /></Field>
      {!consulenza && !editing && (
        <Field label="Consulenza collegata"><EntityPicker col="Consulenze" value={f.Consulenza_Ref} onChange={set('Consulenza_Ref')} placeholder="Seleziona consulenza" searchPlaceholder="Cerca consulenza…" /></Field>
      )}
      <div className="form-grid">
        <Field required label="Data"><ItDate value={f.Data_Promemoria} onChange={set('Data_Promemoria')} required /></Field>
        <Field required label="Ora"><Input icon={Clock} type="time" {...bind('Ora_Promemoria')} required /></Field>
      </div>
    </FormModal>
  );
}

/* ============================================================ APPUNTAMENTO */

/** CreaAppuntamento (consulenza fissa), CreaAppuntamentoGeneral (consulenza a scelta) e modifica */
export function AppuntamentoDialog({ open, onClose, consulenza, appuntamento, date }) {
  const me = useMe();
  const { toast } = useFeedback();
  const editing = !!appuntamento;
  const [f, bind, set] = useForm(open, () => ({
    Titolo: appuntamento?.Titolo ?? '',
    Luogo: appuntamento?.Luogo ?? '',
    Data_Appuntamento: appuntamento?.Data_Appuntamento ?? date ?? '',
    Ora_Appuntamento: appuntamento?.Ora_Appuntamento ?? '',
    Consulenza_Ref: appuntamento?.Consulenza_Ref ?? consulenza?.path ?? null,
  }));

  const save = useAction(async () => {
    const data = { Titolo: f.Titolo, Data_Appuntamento: f.Data_Appuntamento, Ora_Appuntamento: f.Ora_Appuntamento, Luogo: f.Luogo };
    if (editing) {
      await db.update(appuntamento.path, { ...data, ...(consulenza ? {} : { Consulenza_Ref: f.Consulenza_Ref ?? null }) });
      return;
    }
    await db.add('Appuntamenti', {
      ...data, Data_Creazione: '__now__', Utente: me.ref,
      // l'originale non salvava Consulenza_Ref: ora l'appuntamento compare nel calendario della consulenza
      ...(f.Consulenza_Ref ? { Consulenza_Ref: f.Consulenza_Ref } : {}),
    });
    await logActivity(me, T.creaAppuntamento(f.Titolo, f.Data_Appuntamento, f.Ora_Appuntamento), { consulenza: f.Consulenza_Ref });
  }, {
    onSuccess: () => {
      toast(editing ? 'Appuntamento aggiornato' : 'Appuntamento creato', { body: `L'operazione di ${editing ? 'modifica' : 'creazione'} dell'appuntamento è andata a buon fine.` });
      onClose();
    },
  });

  return (
    <FormModal open={open} onClose={onClose} title={editing ? 'Modifica appuntamento' : 'Nuovo appuntamento'} icon={editing ? Pencil : CalendarPlus} onSubmit={() => save.mutate()} busy={save.isPending}>
      <Field required label="Titolo"><Input icon={Tag} {...bind('Titolo')} required autoFocus /></Field>
      <Field label="Luogo"><Input icon={MapPin} {...bind('Luogo')} /></Field>
      {!consulenza && (
        <Field label="Consulenza"><EntityPicker col="Consulenze" value={f.Consulenza_Ref} onChange={set('Consulenza_Ref')} placeholder="Seleziona consulenza" searchPlaceholder="Cerca consulenza…" /></Field>
      )}
      <div className="form-grid">
        <Field required label="Data"><ItDate value={f.Data_Appuntamento} onChange={set('Data_Appuntamento')} required /></Field>
        <Field required label="Ora"><Input icon={Clock} type="time" {...bind('Ora_Appuntamento')} required /></Field>
      </div>
    </FormModal>
  );
}
