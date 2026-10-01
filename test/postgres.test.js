import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

/**
 * Stessa suite dei test JSON, ma su un vero motore PostgreSQL (PGlite in-process,
 * esposto sul protocollo di rete Postgres e usato tramite il driver "pg").
 */
const pglite = await PGlite.create();
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

after(async () => {
  await db.close();
  await server.stop();
  await pglite.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
