import { Router } from 'express';
import multer from 'multer';
import { getDb } from '../db/index.js';
import { uploadFile } from '../services/storage.js';
import { searchCollection } from '../services/search.js';
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

/** Ricerca globale della AppBar: Clienti + Consulenze (porting di algoliaSearch*) */
domainRouter.get('/search', async (req, res) => {
  const q = String(req.query.q ?? '');
  const [clienti, consulenze] = await Promise.all([searchCollection('Clienti', q), searchCollection('Consulenze', q)]);
  res.json({ clienti, consulenze });
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
  res.status(failed.length && !created.length ? 500 : 201).json({ created, failed });
});

/** deleteSingleFileFinalCorrect */
domainRouter.delete('/files/:id', async (req, res) => {
  if (!idOk(req.params.id)) return res.status(400).json({ error: 'Id non valido' });
  res.json({ ok: await deleteSingleFile(`Files/${req.params.id}`) });
});

/* ------------------------------------------------------------ appuntamenti */

domainRouter.get('/consulenze/:id/appuntamenti-recenti', async (req, res) => {
  if (!idOk(req.params.id)) return res.status(400).json({ error: 'Id non valido' });
  res.json(await calcolaAppuntamentiRecenti(`Consulenze/${req.params.id}`));
});
