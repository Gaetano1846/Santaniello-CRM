import { Router } from 'express';
import multer from 'multer';
import { getDb } from '../db/index.js';
import { NOTE_COLLECTIONS } from '../db/schema.js';
import { deleteStoredFile, uploadFile } from '../services/storage.js';
import { searchCollection } from '../services/search.js';
import { indexStatus, searchDocuments } from '../services/docsearch.js';
import { indexAllegati, indexFiles, reindex, unindex } from '../services/indexer.js';
import { calcolaAppuntamentiRecenti } from '../domain/appuntamenti.js';
import {
  createEntityFolder, createSubfolder, deleteFolderRecursive, deleteSingleFile,
  ensureRootFolders, findClienteRootFolder,
} from '../domain/folders.js';

export const domainRouter = Router();

const idOk = (id) => /^[\w-]{1,128}$/.test(id);
const refOf = (col, v) => {
  if (!v) return null;
  const s = String(v);
  const [c, id, ...rest] = s.split('/');
  if (c !== col || !idOk(id ?? '') || rest.length) throw Object.assign(new Error(`Riferimento non valido: ${s}`), { status: 400 });
  return s;
};

/* ------------------------------------------------------------ ricerca */

/** Ricerca globale della AppBar: Clienti + Consulenze (porting di algoliaSearch*) + Documenti per contenuto */
domainRouter.get('/search', async (req, res) => {
  const q = String(req.query.q ?? '');
  const [clienti, consulenze, documenti] = await Promise.all([
    searchCollection('Clienti', q), searchCollection('Consulenze', q), searchDocuments(q, { limit: 5 }),
  ]);
  res.json({ clienti, consulenze, documenti: documenti.results });
});

/** Ricerca nei documenti per contenuto e nome; cliente="Clienti/id" limita a un cliente */
domainRouter.get('/documenti/cerca', async (req, res) => {
  res.json(await searchDocuments(String(req.query.q ?? ''), {
    limit: req.query.limit,
    cliente: refOf('Clienti', req.query.cliente),
  }));
});

/** Stato dell'indicizzazione dei file indicati (?files=Files/a,Files/b) */
domainRouter.get('/documenti/stato', async (req, res) => {
  const ids = String(req.query.files ?? '').split(',').filter(Boolean).slice(0, 500).map((r) => refOf('Files', r).split('/')[1]);
  res.json(await indexStatus(ids));
});

/** Rielabora un documento andato in errore */
domainRouter.post('/documenti/reindex', async (req, res) => {
  const url = String(req.body?.url ?? '');
  if (!url) return res.status(400).json({ error: 'URL mancante' });
  res.json({ ok: await reindex(url) });
});

/* ------------------------------------------------------------ cartelle */

domainRouter.get('/folders/roots', async (_req, res) => {
  res.json(await ensureRootFolders());
});

/** Cartella radice del cliente; se manca viene creata (l'originale andava in crash) */
domainRouter.get('/folders/cliente-root', async (req, res) => {
  const cliente = refOf('Clienti', req.query.cliente);
  let root = await findClienteRootFolder(cliente);
  if (!root && req.query.create === '1') {
    const db = await getDb();
    const doc = await db.get(cliente);
    if (doc) root = (await createEntityFolder({ titolo: `Cartellla di ${doc.Nome ?? ''}`, tipo: 'Cliente', cliente }))?.path ?? null;
  }
  res.json({ root });
});

/** newCustomAction */
domainRouter.post('/folders/entity', async (req, res) => {
  const { titolo, tipo, cliente, consulenza, caso } = req.body ?? {};
  const doc = await createEntityFolder({
    titolo, tipo,
    cliente: refOf('Clienti', cliente),
    consulenza: refOf('Consulenze', consulenza),
    caso: refOf('Casi', caso),
  });
  res.status(201).json(doc);
});

/** creaSottocartella */
domainRouter.post('/folders/sub', async (req, res) => {
  const { tipo, titolo, cliente, consulenza, caso, folderPadre } = req.body ?? {};
  const doc = await createSubfolder({
    tipo, titolo,
    cliente: refOf('Clienti', cliente),
    consulenza: refOf('Consulenze', consulenza),
    caso: refOf('Casi', caso),
    folderPadre: refOf('Folder', folderPadre),
  });
  res.status(201).json(doc);
});

/** deleteFolderAndFilesWithSubfolders */
domainRouter.delete('/folders/:id', async (req, res) => {
  if (!idOk(req.params.id)) return res.status(400).json({ error: 'Id non valido' });
  res.json({ ok: await deleteFolderRecursive(`Folder/${req.params.id}`) });
});

/* ------------------------------------------------------------ file */

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024, files: 50 } });

/**
 * Porting di SimpleDropZone: per ogni file carica su Storage (files/<ms>_<nome>)
 * e crea Files { Nome, Data_Caricamento, File, Folder_Ref }. Max 3 upload in parallelo.
 */
domainRouter.post('/files', upload.array('files'), async (req, res) => {
  const folder = refOf('Folder', req.body.folder);
  const db = await getDb();
  const files = req.files ?? [];
  const created = [];
  const failed = [];
  for (let i = 0; i < files.length; i += 3) {
    await Promise.all(files.slice(i, i + 3).map(async (f) => {
      // multer decodifica il nome come latin1: riportiamolo a UTF-8
      const name = Buffer.from(f.originalname, 'latin1').toString('utf8');
      try {
        const { url } = await uploadFile({ buffer: f.buffer, originalName: name, contentType: f.mimetype || 'application/octet-stream' });
        created.push(await db.add('Files', { Nome: name, Data_Caricamento: new Date(), File: url, Folder_Ref: folder }));
      } catch (e) {
        console.error('Upload fallito', name, e);
        failed.push(name);
      }
    }));
  }
  // estrazione del testo in background: la risposta non aspetta l'indicizzazione
  indexFiles(created).catch((e) => console.error('Indicizzazione non avviata', e.message));
  res.status(failed.length && !created.length ? 500 : 201).json({ created, failed });
});

/** deleteSingleFileFinalCorrect */
domainRouter.delete('/files/:id', async (req, res) => {
  if (!idOk(req.params.id)) return res.status(400).json({ error: 'Id non valido' });
  res.json({ ok: await deleteSingleFile(`Files/${req.params.id}`) });
});

/* ------------------------------------------------------------ note (clienti, consulenze, casi) */

/** multer decodifica il nome come latin1: riportiamolo a UTF-8 */
const utf8Name = (f) => Buffer.from(f.originalname, 'latin1').toString('utf8');

async function uploadAllegati(files = []) {
  const out = [];
  for (let i = 0; i < files.length; i += 3) {
    out.push(...await Promise.all(files.slice(i, i + 3).map(async (f) => {
      const Nome = utf8Name(f);
      const Tipo = f.mimetype || 'application/octet-stream';
      const { url } = await uploadFile({ buffer: f.buffer, originalName: Nome, contentType: Tipo });
      return { Nome, File: url, Tipo, Dimensione: f.size };
    })));
  }
  return out;
}

/** /note/:col/:id[/:nota] → path della collezione o della nota */
function notaPath(req) {
  const { col, id, nota } = req.params;
  const sub = Object.hasOwn(NOTE_COLLECTIONS, col) ? NOTE_COLLECTIONS[col] : null;
  if (!sub) throw Object.assign(new Error('Collezione non consentita'), { status: 403 });
  if (!idOk(id) || (nota !== undefined && !idOk(nota))) throw Object.assign(new Error('Id non valido'), { status: 400 });
  return nota === undefined ? `${col}/${id}/${sub}` : `${col}/${id}/${sub}/${nota}`;
}

/** Nuova nota: titolo, descrizione e allegati (immagini o documenti) caricati insieme */
domainRouter.post('/note/:col/:id', upload.array('files'), async (req, res) => {
  const col = notaPath(req);
  const db = await getDb();
  if (!(await db.get(`${req.params.col}/${req.params.id}`))) return res.status(404).json({ error: 'Documento non trovato' });
  const Titolo = String(req.body.titolo ?? '').trim();
  if (!Titolo) return res.status(400).json({ error: 'Il titolo è obbligatorio' });
  const Allegati = await uploadAllegati(req.files);
  const doc = await db.add(col, {
    Titolo, Descrizione: String(req.body.descrizione ?? ''), Data_Creazione: new Date(), Utente: req.user.ref, Allegati,
  });
  indexAllegati(doc.path, Allegati).catch((e) => console.error('Indicizzazione non avviata', e.message));
  res.status(201).json(doc);
});

/** Modifica: "mantieni" = URL degli allegati esistenti da conservare; gli altri vengono eliminati dallo storage */
domainRouter.patch('/note/:col/:id/:nota', upload.array('files'), async (req, res) => {
  const p = notaPath(req);
  const db = await getDb();
  const cur = await db.get(p);
  if (!cur) return res.status(404).json({ error: 'Nota non trovata' });
  const Titolo = String(req.body.titolo ?? '').trim();
  if (!Titolo) return res.status(400).json({ error: 'Il titolo è obbligatorio' });
  const keep = new Set(JSON.parse(req.body.mantieni ?? '[]'));
  const prev = cur.Allegati ?? [];
  const nuovi = await uploadAllegati(req.files);
  const doc = await db.update(p, {
    Titolo, Descrizione: String(req.body.descrizione ?? ''), Allegati: [...prev.filter((a) => keep.has(a.File)), ...nuovi],
  });
  const rimossi = prev.filter((a) => !keep.has(a.File));
  await Promise.all(rimossi.map((a) => deleteStoredFile(a.File)));
  await unindex(rimossi.map((a) => a.File));
  indexAllegati(p, nuovi).catch((e) => console.error('Indicizzazione non avviata', e.message));
  res.json(doc);
});

domainRouter.delete('/note/:col/:id/:nota', async (req, res) => {
  const p = notaPath(req);
  const db = await getDb();
  const cur = await db.get(p);
  if (!cur) return res.status(204).end();
  await db.delete(p);
  await Promise.all((cur.Allegati ?? []).map((a) => deleteStoredFile(a.File)));
  res.status(204).end();
});

/* ------------------------------------------------------------ appuntamenti */

domainRouter.get('/consulenze/:id/appuntamenti-recenti', async (req, res) => {
  if (!idOk(req.params.id)) return res.status(400).json({ error: 'Id non valido' });
  res.json(await calcolaAppuntamentiRecenti(`Consulenze/${req.params.id}`));
});
