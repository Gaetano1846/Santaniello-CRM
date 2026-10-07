import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

/**
 * Stessa suite dei test JSON, ma su un vero motore PostgreSQL (PGlite in-process,
 * esposto sul protocollo di rete Postgres e usato tramite il driver "pg").
 */
// estensioni usate dalla ricerca documenti per contenuto
const pglite = await PGlite.create({ extensions: { unaccent, pg_trgm } });
const server = new PGLiteSocketServer({ db: pglite, port: 55432, host: '127.0.0.1' });
await server.start();

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-pg-'));
process.env.DATA_DRIVER = 'postgres';
process.env.DATABASE_URL = 'postgres://postgres:postgres@127.0.0.1:55432/postgres';
process.env.PG_POOL_MAX = '1'; // PGlite accetta una connessione alla volta
process.env.UPLOADS_DIR = path.join(dir, 'uploads');

const { defineSuite } = await import('./suite.js');
await defineSuite();

const { getDb } = await import('../server/db/index.js');
const db = await getDb();

test('postgres: vincoli relazionali e cascata sulle sotto-collezioni', async () => {
  const c = await db.add('Clienti', { Nome: 'Gamma', Telefono: 3331234567, Caso_Aperto: false });
  assert.equal(c.Telefono, 3331234567);
  await db.add(`${c.path}/Contatti`, { Nome: 'Ref', Data_Creazione: new Date() });
  const k = await db.add('Consulenze', { Titolo: 'K', Cliente: c.path, Avvocati_Supporto: [] });
  assert.equal(k.Cliente, c.path);
  assert.deepEqual(k.Avvocati_Supporto, []);

  // riferimento a un documento inesistente → errore di integrità
  await assert.rejects(db.add('Consulenze', { Titolo: 'X', Cliente: 'Clienti/inesistente' }));

  // eliminare il cliente: i contatti spariscono, la consulenza resta senza cliente
  await db.delete(c.path);
  assert.equal((await db.collectionGroup('Contatti', { where: [['Nome', '==', 'Ref']] })).length, 0);
  assert.equal((await db.get(k.path)).Cliente, undefined);
});

test('postgres: update parziale, set con merge, 404 su documento inesistente', async () => {
  const d = await db.add('Casi', { Titolo: 'A', Descrizione: 'orig', Avvovati_Supporto: [] });
  await db.update(d.path, { Titolo: 'B' });
  const r = await db.get(d.path);
  assert.equal(r.Titolo, 'B');
  assert.equal(r.Descrizione, 'orig');
  await db.set(d.path, { Scadenza: '01/01/2027' }, { merge: true });
  assert.equal((await db.get(d.path)).Descrizione, 'orig');
  await db.set(d.path, { Titolo: 'C' }); // senza merge: sostituisce
  assert.equal((await db.get(d.path)).Descrizione, undefined);
  await assert.rejects(db.update('Casi/nope', { Titolo: 'x' }), /inesistente/);
});

test('postgres: API HTTP completa (registrazione, CRUD, upload, eliminazioni)', async () => {
  process.env.PORT = '0';
  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  const { authRouter } = await import('../server/routes/auth.js');
  const { dataRouter } = await import('../server/routes/data.js');
  const { domainRouter } = await import('../server/routes/domain.js');
  const { requireAuth } = await import('../server/services/auth.js');
  const app = express();
  app.use(express.json(), cookieParser());
  app.use('/api', authRouter);
  app.use('/api', requireAuth, dataRouter, domainRouter);
  app.use((err, _q, res, _n) => res.status(err.status ?? 500).json({ error: err.message }));
  const srv = app.listen(0);
  const B = `http://127.0.0.1:${srv.address().port}/api`;

  try {
    let r = await fetch(`${B}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome: 'Avv. Test', email: 'test@studio.it', telefono: '1', password: 'segreta1' }) });
    assert.equal(r.status, 201);
    const cookie = r.headers.get('set-cookie').split(';')[0];
    const H = { cookie, 'Content-Type': 'application/json' };
    const call = async (m, p, body) => { const x = await fetch(B + p, { method: m, headers: H, body: body && JSON.stringify(body) }); return x.status === 204 ? null : x.json(); };

    // login con password errata
    r = await fetch(`${B}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'test@studio.it', password: 'sbagliata' }) });
    assert.equal(r.status, 401);

    const cli = await call('POST', '/data/Clienti', { Nome: 'Delta', Telefono: '+39 089 123', Caso_Aperto: false });
    assert.equal(cli.Telefono, 39089123);
    const root = await call('POST', '/folders/entity', { titolo: 'Cartella di Delta', tipo: 'Cliente', cliente: cli.path });
    assert.deepEqual(root.Array_Parents, ['Folder/Clienti', 'Folder/Explorer']);
    const sub = await call('POST', '/folders/sub', { tipo: 'Cliente', cliente: cli.path, folderPadre: root.path, titolo: 'Atti' });

    const fd = new FormData();
    fd.append('folder', sub.path);
    fd.append('files', new Blob(['ciao']), 'atto è.pdf');
    const up = await (await fetch(`${B}/files`, { method: 'POST', headers: { cookie }, body: fd })).json();
    assert.equal(up.created[0].Nome, 'atto è.pdf');

    const list = await call('GET', `/data/Files?q=${encodeURIComponent(JSON.stringify({ where: [['Folder_Ref', '==', sub.path]], orderBy: [['Data_Caricamento', 'desc']] }))}`);
    assert.equal(list.length, 1);

    await call('PATCH', `/doc/${cli.path}`, { Note: 'aggiornato' });
    assert.equal((await call('GET', `/doc/${cli.path}`)).Note, 'aggiornato');

    const act = await call('POST', '/data/Activity', { Titolo: 'Test', Data: '__now__', Utente: (await call('GET', '/auth/me')).ref, Cliente: cli.path });
    assert.ok(act.Data);

    assert.deepEqual(await call('DELETE', `/folders/${root.id}`), { ok: true });
    assert.equal((await call('GET', `/data/Folder?q=${encodeURIComponent(JSON.stringify({ where: [['Cliente', '==', cli.path]] }))}`)).length, 0);
    await call('DELETE', `/doc/${cli.path}`);
    assert.equal((await fetch(`${B}/doc/${cli.path}`, { headers: H })).status, 404);
    // l'attività resta, senza riferimento al cliente eliminato
    assert.equal((await call('GET', `/doc/${act.path}`)).Cliente, undefined);
  } finally {
    srv.close();
  }
});

/** PDF minimo con layer di testo (una riga per elemento) */
function textPdf(lines) {
  const content = `BT /F1 12 Tf 60 760 Td 16 TL ${lines.map((l) => `(${l}) '`).join(' ')} ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  let out = '%PDF-1.4\n';
  const offs = objs.map((o, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  out += offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

test('postgres: ricerca dei documenti per contenuto (PDF, testo, OCR, note, errori)', async () => {
  const { uploadFile } = await import('../server/services/storage.js');
  const { indexAllegati, indexFiles, idle, reindex, unindex } = await import('../server/services/indexer.js');
  const { searchDocuments, indexStatus } = await import('../server/services/docsearch.js');
  const { createCanvas } = await import('@napi-rs/canvas');

  const cli = await db.add('Clienti', { Nome: 'Studio Esposito' });
  const cons = await db.add('Consulenze', { Titolo: 'Locazione Via Roma', Cliente: cli.path, Avvocati_Supporto: [] });
  const root = await db.add('Folder', { Titolo: 'Cartella Esposito', Cliente: cli.path, Array_Parents: [] });
  const sub = await db.add('Folder', { Titolo: 'Atti', Parent_Folder: root.path, Array_Parents: [root.path] });

  const save = async (nome, buffer, folder) => {
    const { url } = await uploadFile({ buffer, originalName: nome, contentType: 'application/octet-stream' });
    return db.add('Files', { Nome: nome, Data_Caricamento: new Date(), File: url, Folder_Ref: folder });
  };
  // immagine "scansionata": solo pixel, nessun testo selezionabile
  const c = createCanvas(1200, 300);
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 1200, 300); g.fillStyle = '#000'; g.font = '40px serif';
  g.fillText('Decreto ingiuntivo per la ditta Vesuviana', 40, 120);
  g.fillText('somma dovuta euro dodicimila', 40, 200);

  const files = [
    await save('Bozza_contratto.pdf', textPdf(['Contratto di locazione ad uso abitativo', 'Clausola penale per morosita del conduttore']), sub.path),
    await save('verbale.txt', Buffer.from('Verbale di udienza: il giudice rinvia la causa al prossimo anno.'), root.path),
    await save('scansione.png', c.toBuffer('image/png'), sub.path),
    await save('rotto.pdf', Buffer.from('non sono un pdf'), sub.path),
    await save('archivio.zip', Buffer.from('PK'), sub.path),
  ];
  await indexFiles(files);
  // allegato di una nota della consulenza
  const { url: notaUrl } = await uploadFile({ buffer: Buffer.from('Promemoria fideiussione bancaria da rinnovare'), originalName: 'appunti.txt', contentType: 'text/plain' });
  const nota = await db.add(`${cons.path}/Note_Consulenza`, { Titolo: 'Garanzie', Allegati: [{ Nome: 'appunti.txt', File: notaUrl }] });
  await indexAllegati(nota.path, nota.Allegati);
  await idle();

  const st = await indexStatus(files.map((f) => f.id));
  assert.equal(st[files[0].path].stato, 'indicizzato');
  assert.equal(st[files[2].path].ocr, true);
  assert.equal(st[files[3].path].stato, 'errore');
  assert.equal(st[files[4].path].stato, 'non_supportato');

  // plurale e senza accento trovano "contratto" e "morosita"; il contesto risale le cartelle
  let r = await searchDocuments('contratti morosità');
  assert.equal(r.results.length, 1);
  assert.equal(r.results[0].nome, 'Bozza_contratto.pdf');
  assert.equal(r.results[0].cliente.nome, 'Studio Esposito');
  assert.equal(r.results[0].folder.titolo, 'Atti');
  assert.match(r.results[0].estratto, /\u0001[Mm]orosita\u0002/);

  // prefisso mentre si scrive, testo semplice
  assert.equal((await searchDocuments('udien')).results[0]?.nome, 'verbale.txt');
  // testo letto con OCR dall'immagine
  r = await searchDocuments('decreto ingiuntivo');
  assert.equal(r.results[0]?.nome, 'scansione.png');
  assert.equal(r.results[0].ocr, true);
  // allegato di nota: contesto consulenza + cliente della consulenza
  r = await searchDocuments('fideiussione');
  assert.equal(r.results[0]?.origine, 'nota');
  assert.equal(r.results[0].consulenza.titolo, 'Locazione Via Roma');
  assert.equal(r.results[0].cliente.nome, 'Studio Esposito');
  assert.equal(r.results[0].nota.entita, cons.path);
  // errore di battitura: trovato per somiglianza
  r = await searchDocuments('fidejussione');
  assert.equal(r.results[0]?.nome, 'appunti.txt');
  assert.equal(r.results[0].simile, true);
  // filtro per cliente e nessuna sintassi tsquery dall'utente
  assert.equal((await searchDocuments('contratto', { cliente: 'Clienti/altro' })).results.length, 0);
  assert.deepEqual((await searchDocuments("':* & | !(")).results, []);

  // file eliminato o allegato rimosso: spariscono dai risultati
  await db.delete(files[0].path);
  assert.equal((await searchDocuments('morosita')).results.length, 0);
  await unindex([notaUrl]);
  assert.equal((await searchDocuments('fideiussione')).results.length, 0);
  // rielaborazione di un file in errore
  assert.equal(await reindex(files[3].File), true);
  await idle();
  assert.equal((await indexStatus([files[3].id]))[files[3].path].stato, 'errore');
});

after(async () => {
  const { idle } = await import('../server/services/indexer.js');
  const { closeOcr } = await import('../server/services/extract.js');
  await idle();
  await closeOcr();
  await db.close();
  await server.stop();
  await pglite.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
