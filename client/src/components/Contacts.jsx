import { useEffect, useState } from 'react';
import { Mail, Pencil, Phone, Plus, Trash2, UserRound, Users } from 'lucide-react';
import { db, useAction, useDialog, useList, useMe } from '../lib/hooks.js';
import { logActivity } from '../lib/activity.js';
import { toDate } from '../lib/format.js';
import { Avatar, Button, Card, CardHead, Empty, Field, FormModal, IconButton, Input, SkeletonRows, Missing } from './ui.jsx';
import { useFeedback } from './feedback.jsx';

/**
 * Contatti di un Cliente (Clienti/{id}/Contatti) o di un Caso (Casi/{id}/Contatti_Caso).
 * logs: { create(nome), edit(nome) } → Titolo attività + campi collegati
 */
export function ContactsSection({ parent, sub, logs, logLink }) {
  const col = `${parent}/${sub}`;
  const q = useList(col);
  const dialog = useDialog();
  const { confirm, toast } = useFeedback();
  const remove = useAction((path) => db.remove(path), { onSuccess: () => toast('Contatto eliminato') });

  const items = [...(q.data ?? [])].sort((a, b) => (toDate(b.Data_Creazione) ?? 0) - (toDate(a.Data_Creazione) ?? 0));

  const onDelete = async (c) => {
    if (await confirm({ message: `Eliminare il contatto “${c.Nome || 'senza nome'}”? Una volta eliminato non sarà più reperibile.` })) remove.mutate(c.path);
  };

  return (
    <Card>
      <CardHead icon={Users} title="Contatti" sub="Gestisci i contatti associati.">
        <Button variant="primary" size="sm" icon={Plus} onClick={() => dialog.open(null)}>Nuovo contatto</Button>
      </CardHead>
      {q.isLoading ? <SkeletonRows /> : items.length === 0 ? (
        <Empty icon={Users} title="Nessun contatto" action={<Button size="sm" icon={Plus} onClick={() => dialog.open(null)}>Aggiungi il primo contatto</Button>}>
          Referenti, segreterie e altri recapiti utili.
        </Empty>
      ) : (
        <div className="grid grid-3" style={{ padding: 18 }}>
          {items.map((c) => (
            <div key={c.id} className="card contact-card" style={{ boxShadow: 'none' }}>
              <div className="row">
                <Avatar name={c.Nome} />
                <div className="grow truncate" style={{ fontWeight: 600 }}>{c.Nome || 'Senza nome'}</div>
                <IconButton size="sm" icon={Pencil} label="Modifica" onClick={() => dialog.open(c)} />
                <IconButton size="sm" danger icon={Trash2} label="Elimina" onClick={() => onDelete(c)} />
              </div>
              <div className="contact-line"><Mail size={14} />{c.Email ? <a className="truncate" href={`mailto:${c.Email}`}>{c.Email}</a> : <Missing />}</div>
              <div className="contact-line"><Phone size={14} />{c.Telefono ? <a href={`tel:${c.Telefono}`}>{c.Telefono}</a> : <Missing />}</div>
            </div>
          ))}
        </div>
      )}
      <ContactDialog open={dialog.isOpen} contact={dialog.data} col={col} onClose={dialog.close} logs={logs} logLink={logLink} />
    </Card>
  );
}

/** CreaContatto / ModificaContatto (e varianti _Caso) */
function ContactDialog({ open, contact, col, onClose, logs, logLink }) {
  const me = useMe();
  const { toast } = useFeedback();
  const [f, setF] = useState({});
  useEffect(() => { if (open) setF({ Nome: contact?.Nome ?? '', Email: contact?.Email ?? '', Telefono: contact?.Telefono ?? '' }); }, [open, contact]);

  const save = useAction(async () => {
    if (contact) {
      await db.update(contact.path, f);
      await logActivity(me, logs.edit(f.Nome), logs.editLink ?? logLink);
    } else {
      await db.add(col, { ...f, Data_Creazione: '__now__' });
      await logActivity(me, logs.create(f.Nome), logLink);
    }
  }, {
    onSuccess: () => {
      toast(contact ? 'Contatto aggiornato' : 'Contatto creato', {
        body: contact ? "L'operazione di modifica del contatto è andata a buon fine." : "L'operazione di creazione del contatto è andata a buon fine.",
      });
      onClose();
    },
  });

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <FormModal open={open} onClose={onClose} title={contact ? 'Modifica contatto' : 'Nuovo contatto'} icon={contact ? Pencil : UserRound} size="sm" onSubmit={() => save.mutate()} busy={save.isPending}>
      <Field required label="Nome"><Input icon={UserRound} value={f.Nome ?? ''} onChange={set('Nome')} required autoFocus /></Field>
      <Field label="Email"><Input icon={Mail} type="email" value={f.Email ?? ''} onChange={set('Email')} /></Field>
      <Field label="Telefono"><Input icon={Phone} type="tel" value={f.Telefono ?? ''} onChange={set('Telefono')} /></Field>
    </FormModal>
  );
}
