import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ChevronRight, CloudUpload, Download, File, FileImage, FileSpreadsheet, FileText,
  Folder, FolderOpen, FolderPlus, House, MoreHorizontal, Pencil, Trash2, Upload,
} from 'lucide-react';
import { actions, db, useAction, useDialog, useDoc, useList } from '../lib/hooks.js';
import { fileKind, fmtShort } from '../lib/format.js';
import { Button, Card, Empty, Field, FormModal, IconButton, Input, Menu, MenuItem, SkeletonRows } from './ui.jsx';
import { EntityPicker } from './pickers.jsx';
import { useFeedback } from './feedback.jsx';

const KIND_ICON = { pdf: FileText, img: FileImage, doc: FileText, xls: FileSpreadsheet, other: File };

/**
 * Esplora documenti (Folder/Files) condiviso da Cliente, Consulenza, Caso e Documenti.
 *
 * - rootRef: cartella radice oltre la quale non si risale (null = radice virtuale "Documenti")
 * - rootChildren: per la radice virtuale, elenco dei parent da mostrare (Explorer + Clienti)
 * - folderTipo / links: parametri passati a creaSottocartella (tipo, cliente, consulenza, caso)
 * - editLinks: mostra i selettori Cliente/Consulenza nel dialog di modifica (ModificaFolder)
 */
export function FileExplorer({ rootRef, rootLabel = 'Documenti', rootChildren, folderTipo, links = {}, editLinks, title = 'Documenti', sub, jumpTo }) {
  const [current, setCurrent] = useState(rootRef ?? null);
  useEffect(() => { setCurrent(rootRef ?? null); }, [rootRef]);
  useEffect(() => { if (jumpTo?.ref) setCurrent(jumpTo.ref); }, [jumpTo]);

  const atRoot = current === (rootRef ?? null);
  const currentDoc = useDoc(current, { enabled: !!current });

  // Breadcrumb dall'Array_Parents (ordinato dal padre più vicino a Explorer): invertito e limitato alla radice
  const crumbs = useMemo(() => {
    if (!current || !currentDoc.data) return [];
    const ancestors = [...(currentDoc.data.Array_Parents ?? [])].reverse();
    if (rootRef) {
      const i = ancestors.indexOf(rootRef);
      return i === -1 ? [] : ancestors.slice(i + 1);
    }
    // radice virtuale: si parte dal primo figlio di Explorer/Clienti
    const hidden = new Set(rootChildren ?? []);
    return ancestors.filter((a) => !hidden.has(a));
  }, [current, currentDoc.data, rootRef, rootChildren]);

  const goUp = () => {
    if (atRoot) return;
    const parent = currentDoc.data?.Parent_Folder ?? null;
    const isVirtualTop = !rootRef && (rootChildren ?? []).includes(parent);
    setCurrent(isVirtualTop ? null : parent);
  };

  // Contenuto della cartella corrente
  const foldersQ = useList('Folder', current
    ? { where: [['Parent_Folder', '==', current]], orderBy: [['Data_Creazione', 'desc']] }
    : { where: [['Parent_Folder', 'in', rootChildren ?? []]], orderBy: [['Data_Creazione', 'desc']] },
  { enabled: !!current || !!rootChildren?.length });
  const filesQ = useList('Files', { where: [['Folder_Ref', '==', current]], orderBy: [['Data_Caricamento', 'desc']] }, { enabled: !!current });

  // prima le cartelle, poi i file; ciascun gruppo in ordine alfabetico
  const byName = (k) => (a, b) => (a[k] ?? '').localeCompare(b[k] ?? '', 'it', { numeric: true, sensitivity: 'base' });
  const folders = (foldersQ.data ?? []).filter((f) => !(rootChildren ?? []).includes(f.path)).sort(byName('Titolo'));
  const files = current ? [...(filesQ.data ?? [])].sort(byName('Nome')) : [];
  const loading = foldersQ.isLoading || (current && filesQ.isLoading);

  /* ------------------------------------------------------------ azioni */
  const { confirm, toast } = useFeedback();
  const newFolder = useDialog();
  const editFolder = useDialog();
  const fileInput = useRef(null);
  const [uploading, setUploading] = useState(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const delFolder = useAction((ref) => actions.deleteFolder(ref), {
    onSuccess: (r) => toast(r?.ok === false ? 'Cartella eliminata con avvisi' : 'Cartella eliminata', r?.ok === false ? { tone: 'info', body: 'Alcuni file non erano presenti nello storage.' } : undefined),
  });
  const delFile = useAction((ref) => actions.deleteFile(ref), { onSuccess: () => toast('File eliminato') });
  const upload = useAction((list) => actions.upload(current, list), {
    onSuccess: (r) => {
      setUploading(null);
      toast(`${r.created.length} file caricat${r.created.length === 1 ? 'o' : 'i'}`, r.failed.length ? { tone: 'info', body: `Non caricati: ${r.failed.join(', ')}` } : undefined);
    },
  });

  const startUpload = (list) => {
    const arr = [...list];
    if (!arr.length) return;
    if (!current) { toast('Apri una cartella', { body: 'Seleziona prima la cartella in cui caricare i file.', tone: 'info' }); return; }
    setUploading(arr.map((f) => f.name));
    upload.mutate(arr, { onError: () => setUploading(null) });
  };

  const onDrop = (e) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    startUpload(e.dataTransfer.files);
  };
  const dragProps = {
    onDragEnter: (e) => { if (e.dataTransfer.types.includes('Files')) { dragDepth.current++; setDragging(true); } },
    onDragLeave: () => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); },
    onDragOver: (e) => e.preventDefault(),
    onDrop,
  };

  const askDeleteFolder = async (f) => {
    if (await confirm({ message: `Eliminare la cartella “${f.Titolo}” ? Una volta eliminata non sarà più reperibile. Verranno eliminate anche tutte le sottocartelle e i file contenuti.` })) delFolder.mutate(f.path);
  };
  const askDeleteFile = async (f) => {
    if (await confirm({ message: `Eliminare il file “${f.Nome}”? Una volta eliminato non sarà più reperibile.` })) delFile.mutate(f.path);
  };
  const download = (f) => {
    window.open(f.File, '_blank', 'noopener');
    toast('Apertura file…', { tone: 'info', ms: 2500 });
  };

  if (rootRef === undefined) return <Card><SkeletonRows /></Card>;

  return (
    <Card style={{ position: 'relative' }} {...dragProps}>
      <div className="card-head">
        <div className="grow">
          <div className="card-title"><FolderOpen size={17} />{title}</div>
          {sub && <div className="card-sub">{sub}</div>}
        </div>
        <div className="row">
          <Button size="sm" icon={FolderPlus} onClick={() => newFolder.open()} disabled={!current && !!rootRef}>Nuova cartella</Button>
          <Button size="sm" variant="primary" icon={Upload} onClick={() => fileInput.current?.click()} disabled={!current}>Carica file</Button>
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => { startUpload(e.target.files); e.target.value = ''; }} />
        </div>
      </div>

      <div className="explorer-bar">
        <IconButton size="sm" icon={ArrowLeft} label="Cartella superiore" onClick={goUp} disabled={atRoot} style={atRoot ? { opacity: 0.35 } : undefined} />
        <div className="path">
          <button onClick={() => setCurrent(rootRef ?? null)} className={atRoot ? 'current' : undefined}>
            <span className="row" style={{ gap: 6 }}><House size={14} />{rootLabel}</span>
          </button>
          {crumbs.map((ref) => (
            <span key={ref} className="row" style={{ gap: 2 }}>
              <ChevronRight size={14} />
              <CrumbButton refPath={ref} onClick={() => setCurrent(ref)} />
            </span>
          ))}
          {!atRoot && currentDoc.data && (
            <span className="row" style={{ gap: 2 }}>
              <ChevronRight size={14} />
              <span className="current">{currentDoc.data.Titolo || 'Senza titolo'}</span>
            </span>
          )}
        </div>
        <span className="faint small">{folders.length} cartell{folders.length === 1 ? 'a' : 'e'} · {files.length} file</span>
      </div>

      {uploading && (
        <div className="upload-strip">
          <span className="spinner" style={{ width: 16, height: 16 }} />
          <span className="truncate">Caricamento in corso: {uploading.join(', ')}</span>
        </div>
      )}

      {loading ? <SkeletonRows /> : folders.length + files.length === 0 ? (
        <Empty icon={FolderOpen} title="Cartella vuota" action={current && <Button size="sm" icon={Upload} onClick={() => fileInput.current?.click()}>Carica file</Button>}>
          {current ? 'Trascina qui i file oppure usa “Carica file”.' : 'Nessuna cartella presente.'}
        </Empty>
      ) : (
        <div className="list">
          {folders.map((f) => (
            <div key={f.id} className="list-item clickable" onClick={() => setCurrent(f.path)}>
              <span className="file-icon folder"><Folder size={18} /></span>
              <div className="grow">
                <div className="truncate" style={{ fontWeight: 550 }}>{f.Titolo || 'Senza titolo'}</div>
                <div className="faint small">Creata il {fmtShort(f.Data_Creazione)}</div>
              </div>
              <Menu trigger={<IconButton size="sm" icon={MoreHorizontal} label="Azioni cartella" />}>
                <MenuItem icon={FolderOpen} onClick={() => setCurrent(f.path)}>Apri</MenuItem>
                <MenuItem icon={Pencil} onClick={() => editFolder.open(f)}>Modifica</MenuItem>
                <div className="menu-sep" />
                <MenuItem icon={Trash2} danger onClick={() => askDeleteFolder(f)}>Elimina</MenuItem>
              </Menu>
            </div>
          ))}
          {files.map((f) => {
            const kind = fileKind(f.Nome);
            const Icon = KIND_ICON[kind];
            return (
              <div key={f.id} className="list-item">
                <span className={`file-icon ${kind}`}><Icon size={18} /></span>
                <div className="grow">
                  <a href={f.File} target="_blank" rel="noopener" className="truncate" style={{ fontWeight: 550, display: 'block' }}>{f.Nome}</a>
                  <div className="faint small">Caricato il {fmtShort(f.Data_Caricamento)}</div>
                </div>
                <IconButton size="sm" icon={Download} label="Scarica" onClick={() => download(f)} />
                <IconButton size="sm" danger icon={Trash2} label="Elimina" onClick={() => askDeleteFile(f)} />
              </div>
            );
          })}
        </div>
      )}

      {dragging && current && (
        <div className="dropzone-overlay">
          <div className="dropzone-inner">
            <CloudUpload size={40} />
            <strong>Rilascia i file qui</strong>
            <span>per caricarli nella cartella “{currentDoc.data?.Titolo ?? rootLabel}”</span>
          </div>
        </div>
      )}

      <NewFolderDialog open={newFolder.isOpen} onClose={newFolder.close} parent={current} tipo={folderTipo} links={links} />
      <EditFolderDialog open={editFolder.isOpen} folder={editFolder.data} onClose={editFolder.close} editLinks={editLinks} />
    </Card>
  );
}

function CrumbButton({ refPath, onClick }) {
  const d = useDoc(refPath);
  return <button onClick={onClick}>{d.data?.Titolo ?? '…'}</button>;
}

/** CreaSottocartellaCliente / Caso: creaSottocartella(tipo, caso, cliente, consulenza, folderPadre, titolo) */
function NewFolderDialog({ open, onClose, parent, tipo, links }) {
  const [titolo, setTitolo] = useState('');
  const { toast } = useFeedback();
  useEffect(() => { if (open) setTitolo(''); }, [open]);
  const save = useAction(async () => {
    if (parent) {
      await actions.creaSottocartella({ tipo, titolo, folderPadre: parent, ...links });
    } else {
      // radice della pagina Documenti: nuova cartella sotto Explorer
      const { explorerRef } = await actions.roots();
      await actions.creaSottocartella({ tipo: 'generale', titolo, folderPadre: explorerRef });
    }
  }, { onSuccess: () => { toast('Cartella creata', { body: 'La creazione della cartella è andata a buon fine.' }); onClose(); } });

  return (
    <FormModal open={open} onClose={onClose} title="Nuova cartella" icon={FolderPlus} size="sm" onSubmit={() => save.mutate()} busy={save.isPending}>
      <Field required label="Titolo"><Input icon={Folder} value={titolo} onChange={(e) => setTitolo(e.target.value)} required autoFocus /></Field>
    </FormModal>
  );
}

/** ModificaFolder: Titolo + (se presenti) Cliente / Consulenza collegati */
function EditFolderDialog({ open, folder, onClose, editLinks }) {
  const [f, setF] = useState({});
  const { toast } = useFeedback();
  useEffect(() => { if (open && folder) setF({ Titolo: folder.Titolo ?? '', Cliente: folder.Cliente ?? null, Consulenza: folder.Consulenza ?? null }); }, [open, folder]);
  const save = useAction(async () => {
    const data = { Titolo: f.Titolo };
    if (editLinks && folder.Cliente && f.Cliente) data.Cliente = f.Cliente;
    if (editLinks && folder.Consulenza && f.Consulenza) data.Consulenza = f.Consulenza;
    await db.update(folder.path, data);
  }, { onSuccess: () => { toast('Cartella aggiornata', { body: "L'operazione di modifica è stata effettuata con successo." }); onClose(); } });

  if (!folder) return null;
  return (
    <FormModal open={open} onClose={onClose} title="Modifica cartella" icon={Pencil} size="sm" onSubmit={() => save.mutate()} busy={save.isPending}>
      <Field required label="Titolo"><Input icon={Folder} value={f.Titolo ?? ''} onChange={(e) => setF({ ...f, Titolo: e.target.value })} required autoFocus /></Field>
      {editLinks && folder.Cliente && (
        <Field label="Cliente"><EntityPicker col="Clienti" value={f.Cliente} onChange={(v) => setF({ ...f, Cliente: v })} placeholder="Seleziona cliente…" /></Field>
      )}
      {editLinks && folder.Consulenza && (
        <Field label="Consulenza"><EntityPicker col="Consulenze" value={f.Consulenza} onChange={(v) => setF({ ...f, Consulenza: v })} placeholder="Seleziona consulenza…" /></Field>
      )}
    </FormModal>
  );
}
