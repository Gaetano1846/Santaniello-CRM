import { useEffect, useRef, useState } from 'react';
import {
  CloudUpload, File, FileImage, FileSpreadsheet, FileText, NotebookPen, Paperclip, Pencil, Plus, Tag, Trash2, X,
} from 'lucide-react';
import { actions, useAction, useDialog, useIndex, useList, useMe, userName } from '../lib/hooks.js';
import { logActivity, T } from '../lib/activity.js';
import { fileKind, fmtDateTime, fmtSize, toDate } from '../lib/format.js';
import { Button, Card, CardHead, Empty, Field, FormModal, IconButton, Input, SkeletonRows, Textarea } from './ui.jsx';
import { useFeedback } from './feedback.jsx';

const KIND_ICON = { pdf: FileText, img: FileImage, doc: FileText, xls: FileSpreadsheet, other: File };
const isImage = (a) => (a.Tipo ?? '').startsWith('image/') || fileKind(a.Nome) === 'img';

/** Collezione padre → sotto-collezione delle note (come NOTE_COLLECTIONS sul server) */
export const NOTE_SUB = { Clienti: 'Note_Cliente', Consulenze: 'Note_Consulenza', Casi: 'Note_Caso' };
export const noteCol = (parentRef) => `${parentRef}/${NOTE_SUB[parentRef.split('/')[0]]}`;

/**
 * Note di un Cliente, una Consulenza o un Caso: titolo, descrizione e allegati (immagini o documenti).
 * label: come compare nel log attività ("il cliente Rossi"); logLink: { cliente | consulenza | caso }
 */
export function NoteSection({ parent, sub, label, logLink }) {
  const q = useList(noteCol(parent));
  const { map: users } = useIndex('Users');
  const dialog = useDialog();
  const { confirm, toast } = useFeedback();
  const remove = useAction((ref) => actions.eliminaNota(ref), { onSuccess: () => toast('Nota eliminata') });

  const items = [...(q.data ?? [])].sort((a, b) => (toDate(b.Data_Creazione) ?? 0) - (toDate(a.Data_Creazione) ?? 0));

  const onDelete = async (n) => {
    const extra = n.Allegati?.length ? ' Verranno eliminati anche i suoi allegati.' : '';
    if (await confirm({ message: `Eliminare la nota “${n.Titolo}”? Una volta eliminata non sarà più reperibile.${extra}` })) remove.mutate(n.path);
  };

  return (
    <Card>
      <CardHead icon={NotebookPen} title="Note" sub={sub}>
        <Button variant="primary" size="sm" icon={Plus} onClick={() => dialog.open(null)}>Nuova nota</Button>
      </CardHead>
      {q.isLoading ? <SkeletonRows /> : items.length === 0 ? (
        <Empty icon={NotebookPen} title="Nessuna nota" action={<Button size="sm" icon={Plus} onClick={() => dialog.open(null)}>Scrivi la prima nota</Button>}>
          Annota informazioni utili e allega documenti o immagini.
        </Empty>
      ) : (
        <div className="note-list">
          {items.map((n) => (
            <article key={n.id} className="note-item">
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <div className="grow">
                  <div className="note-title">{n.Titolo || 'Senza titolo'}</div>
                  <div className="faint small">
                    {fmtDateTime(n.Data_Creazione)}{n.Utente && userName(users, n.Utente) ? ` · ${userName(users, n.Utente)}` : ''}
                  </div>
                </div>
                <IconButton size="sm" icon={Pencil} label="Modifica" onClick={() => dialog.open(n)} />
                <IconButton size="sm" danger icon={Trash2} label="Elimina" onClick={() => onDelete(n)} />
              </div>
              {n.Descrizione && <p className="note-text">{n.Descrizione}</p>}
              <Attachments items={n.Allegati ?? []} />
            </article>
          ))}
        </div>
      )}
      <NotaDialog open={dialog.isOpen} nota={dialog.data} parent={parent} label={label} logLink={logLink} onClose={dialog.close} />
    </Card>
  );
}

/** Immagini come miniature, gli altri file come righe scaricabili */
function Attachments({ items }) {
  if (!items.length) return null;
  const images = items.filter(isImage);
  const docs = items.filter((a) => !isImage(a));
  return (
    <div className="stack" style={{ gap: 8 }}>
      {images.length > 0 && (
        <div className="note-thumbs">
          {images.map((a) => (
            <a key={a.File} href={a.File} target="_blank" rel="noopener" className="note-thumb" title={a.Nome}>
              <img src={a.File} alt={a.Nome} loading="lazy" />
            </a>
          ))}
        </div>
      )}
      {docs.map((a) => {
        const kind = fileKind(a.Nome);
        const Icon = KIND_ICON[kind];
        return (
          <a key={a.File} href={a.File} target="_blank" rel="noopener" className="note-file">
            <span className={`file-icon ${kind}`}><Icon size={16} /></span>
            <span className="grow truncate">{a.Nome}</span>
            {a.Dimensione ? <span className="faint small tnum">{fmtSize(a.Dimensione)}</span> : null}
          </a>
        );
      })}
    </div>
  );
}

function NotaDialog({ open, nota, parent, label, logLink, onClose }) {
  const me = useMe();
  const { toast } = useFeedback();
  const editing = !!nota;
  const [f, setF] = useState({ Titolo: '', Descrizione: '' });
  const [kept, setKept] = useState([]); // allegati già salvati da conservare
  const [files, setFiles] = useState([]); // nuovi file da caricare
  const [dragging, setDragging] = useState(false);
  const input = useRef(null);

  useEffect(() => {
    if (!open) return;
    setF({ Titolo: nota?.Titolo ?? '', Descrizione: nota?.Descrizione ?? '' });
    setKept(nota?.Allegati ?? []);
    setFiles([]);
  }, [open, nota]);

  const addFiles = (list) => {
    // copia subito: la FileList dell'input viene svuotata sul posto da `value = ''`
    // prima che React esegua l'updater, e i file scelti col pulsante andavano persi
    const nuovi = Array.from(list ?? []);
    if (nuovi.length) setFiles((prev) => [...prev, ...nuovi]);
  };

  const save = useAction(async () => {
    const body = { titolo: f.Titolo.trim(), descrizione: f.Descrizione, files };
    if (editing) {
      await actions.modificaNota(nota.path, { ...body, mantieni: kept.map((a) => a.File) });
      await logActivity(me, T.modificaNota(body.titolo, label), logLink);
    } else {
      await actions.creaNota(parent, body);
      await logActivity(me, T.creaNota(body.titolo, label), logLink);
    }
  }, {
    onSuccess: () => {
      toast(editing ? 'Nota aggiornata' : 'Nota creata', { body: `L'operazione di ${editing ? 'modifica' : 'creazione'} della nota è andata a buon fine.` });
      onClose();
    },
  });

  const drop = {
    onDragOver: (e) => { e.preventDefault(); setDragging(true); },
    onDragLeave: () => setDragging(false),
    onDrop: (e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); },
  };

  return (
    <FormModal open={open} onClose={onClose} title={editing ? 'Modifica nota' : 'Nuova nota'} icon={editing ? Pencil : NotebookPen} size="lg" onSubmit={() => save.mutate()} busy={save.isPending}>
      <Field required label="Titolo"><Input icon={Tag} value={f.Titolo} onChange={(e) => setF({ ...f, Titolo: e.target.value })} required autoFocus /></Field>
      <Field label="Descrizione"><Textarea rows={5} value={f.Descrizione} onChange={(e) => setF({ ...f, Descrizione: e.target.value })} placeholder="Scrivi la nota" /></Field>

      <div className="stack" style={{ gap: 8 }}>
        <span className="field-label"><Paperclip size={14} /> Allegati</span>
        <button type="button" className={`note-drop${dragging ? ' active' : ''}`} onClick={() => input.current?.click()} {...drop}>
          <CloudUpload size={22} />
          <span><strong>Aggiungi file</strong> o trascinali qui</span>
          <span className="faint small">Immagini, PDF, documenti</span>
        </button>
        <input ref={input} type="file" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        {kept.map((a) => (
          <PendingFile key={a.File} name={a.Nome} size={a.Dimensione} onRemove={() => setKept(kept.filter((k) => k !== a))} />
        ))}
        {files.map((file, i) => (
          <PendingFile key={`${file.name}-${i}`} name={file.name} size={file.size} isNew onRemove={() => setFiles(files.filter((_, j) => j !== i))} />
        ))}
      </div>
    </FormModal>
  );
}

function PendingFile({ name, size, isNew, onRemove }) {
  const kind = fileKind(name);
  const Icon = KIND_ICON[kind];
  return (
    <div className="note-file">
      <span className={`file-icon ${kind}`}><Icon size={16} /></span>
      <span className="grow truncate">{name}</span>
      <span className="faint small tnum">{isNew ? 'Da caricare · ' : ''}{fmtSize(size)}</span>
      <IconButton size="sm" icon={X} label={`Rimuovi ${name}`} onClick={onRemove} />
    </div>
  );
}
