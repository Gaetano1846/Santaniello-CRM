import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/** Suite condivisa: la stessa logica deve comportarsi allo stesso modo su ogni driver */
export async function defineSuite() {
  const { getDb } = await import('../server/db/index.js');
  const folders = await import('../server/domain/folders.js');
  const { calcolaAppuntamentiRecenti } = await import('../server/domain/appuntamenti.js');
  const { extractStoragePathFromUrl, uploadFile } = await import('../server/services/storage.js');
  const db = await getDb();

  test('newCustomAction crea Explorer/Clienti e la gerarchia cliente → consulenza/caso', async () => {
    const cliente = (await db.add('Clienti', { Nome: 'ACME' })).path;
    const cf = await folders.createEntityFolder({ titolo: 'Cartella di ACME', tipo: 'Cliente', cliente });
    assert.equal(cf.Parent_Folder, 'Folder/Clienti');
    assert.deepEqual(cf.Array_Parents, ['Folder/Clienti', 'Folder/Explorer']);
    assert.equal((await db.get('Folder/Explorer')).Titolo, 'Explorer');

    const consulenza = (await db.add('Consulenze', { Titolo: 'GDPR', Cliente: cliente })).path;
    const kf = await folders.createEntityFolder({ titolo: 'Cartella per GDPR', tipo: 'Consulenza', consulenza, cliente });
    assert.equal(kf.Parent_Folder, cf.path);
    assert.deepEqual(kf.Array_Parents, [cf.path, 'Folder/Clienti', 'Folder/Explorer']);
    assert.equal(kf.Consulenza, consulenza);

    const caso = (await db.add('Casi', { Titolo: 'Vertenza' })).path;
    const sf = await folders.createEntityFolder({ titolo: 'Cartella del caso', tipo: 'caso', cliente, caso });
    assert.equal(sf.Caso, caso);
    assert.equal(sf.Consulenza, undefined);

    // senza cliente non viene creato nulla (come l'originale)
    assert.equal(await folders.createEntityFolder({ titolo: 'x', tipo: 'Consulenza', consulenza }), null);
  });

  test('creaSottocartella: Array_Parents = [padre, ...antenati del padre] e campi per tipo', async () => {
    const cliente = (await db.add('Clienti', { Nome: 'Beta' })).path;
    const root = await folders.createEntityFolder({ titolo: 'Beta', tipo: 'Cliente', cliente });
    const sub = await folders.createSubfolder({ tipo: 'Cliente', cliente, folderPadre: root.path, titolo: 'Atti' });
    assert.deepEqual(sub.Array_Parents, [root.path, 'Folder/Clienti', 'Folder/Explorer']);
    assert.equal(sub.Cliente, cliente);
    const casoRef = (await db.add('Casi', { Titolo: 'X' })).path;
    const caso = await folders.createSubfolder({ tipo: 'Caso', caso: casoRef, cliente, folderPadre: sub.path, titolo: 'C' });
    assert.equal(caso.Caso, casoRef);
    assert.equal(caso.Cliente, undefined);
    await assert.rejects(folders.createSubfolder({ tipo: 'boh', folderPadre: sub.path, titolo: 'z' }));
  });

  test('deleteFolderAndFilesWithSubfolders elimina albero, file e oggetti storage', async () => {
    const top = await folders.createSubfolder({ tipo: 'generale', folderPadre: 'Folder/Explorer', titolo: 'Top' });
    const mid = await folders.createSubfolder({ tipo: 'generale', folderPadre: top.path, titolo: 'Mid' });
    const leaf = await folders.createSubfolder({ tipo: 'generale', folderPadre: mid.path, titolo: 'Leaf' });
    const { url, storagePath } = await uploadFile({ buffer: Buffer.from('x'), originalName: 'a.txt' });
    const f = await db.add('Files', { Nome: 'a.txt', File: url, Folder_Ref: leaf.path, Data_Caricamento: new Date() });
    await db.add(`${f.path}/VersioneFile`, {});

    assert.equal(await folders.deleteFolderRecursive(top.path), true);
    for (const p of [top.path, mid.path, leaf.path, f.path]) assert.equal(await db.get(p), null);
    assert.equal((await db.query(`${f.path}/VersioneFile`)).length, 0);
    assert.equal(fs.existsSync(path.join(process.env.UPLOADS_DIR, storagePath)), false);
  });

  test('calcolaAppuntamentiRecenti: i 2 più vicini ad adesso, date non valide scartate', async () => {
    const k = (await db.add('Consulenze', { Titolo: 'K' })).path;
    const now = new Date(2026, 8, 28, 12, 0);
    const add = (d, o, c) => db.add('Appuntamenti', { Titolo: `${d} ${o}`, Data_Appuntamento: d, Ora_Appuntamento: o, Consulenza_Ref: k, Data_Creazione: c });
    await add('28/09/2026', '15:00', new Date(1)); // +3h
    await add('27/09/2026', '12:00', new Date(2)); // -24h
    await add('28/09/2026', '10:00', new Date(3)); // -2h
    await add('28/09/2026', '', new Date(4)); // ora vuota → scartato
    await add('non-data', '10:00', new Date(5)); // scartato
    const r = await calcolaAppuntamentiRecenti(k, now);
    assert.deepEqual(r.map((a) => a.Titolo), ['28/09/2026 10:00', '28/09/2026 15:00']);
  });

  test('extractStoragePathFromUrl gestisce URL Firebase e locali', () => {
    assert.equal(
      extractStoragePathFromUrl('https://firebasestorage.googleapis.com/v0/b/bucket.app/o/files%2F123_atto%20civile.pdf?alt=media&token=abc'),
      'files/123_atto civile.pdf',
    );
    assert.equal(extractStoragePathFromUrl('/storage/v0/b/local/o/files%2F1_a.txt?alt=media'), 'files/1_a.txt');
    assert.equal(extractStoragePathFromUrl(''), null);
  });

  test('adapter: where/orderBy/limit/in/array-contains come Firestore', async () => {
    const u1 = (await db.set('Users/u1', { email: 'u1@test.it', display_name: 'U1' })).path;
    for (const [n, d] of [[3, 'c'], [1, 'a'], [2, 'b']]) await db.add('Promemoria', { Titolo: d, Data_Creazione: new Date(2026, 0, n), Utente: u1 });
    const r = await db.query('Promemoria', { where: [['Utente', '==', u1]], orderBy: [['Data_Creazione', 'desc']], limit: 2 });
    assert.deepEqual(r.map((x) => x.Titolo), ['c', 'b']);
    assert.equal((await db.query('Promemoria', { where: [['Titolo', 'in', ['a', 'c']]] })).length, 2);
    const withParent = await db.query('Folder', { where: [['Array_Parents', 'array-contains', 'Folder/Explorer']] });
    assert.ok(withParent.length > 0);
  });

}
