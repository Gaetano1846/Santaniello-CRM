import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Collaudo end-to-end delle API sul server in esecuzione (npm run dev oppure npm start).
 *   npm run test:e2e
 * Variabili: E2E_URL (default http://localhost:4310), E2E_EMAIL, E2E_PASSWORD
 * (default l'avvocato demo g.santaniello@studio.it / santaniello).
 * Ogni dato creato porta il prefisso del run ed è eliminato alla fine, anche se un test fallisce.
 */

const BASE = process.env.E2E_URL ?? 'http://localhost:4310';
const EMAIL = process.env.E2E_EMAIL ?? 'g.santaniello@studio.it';
const PASSWORD = process.env.E2E_PASSWORD ?? 'santaniello';
const TAG = `E2E${Date.now().toString(36)}`;

let cookie = '';
async function call(method, path, { body, form, auth = true, raw = false } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(auth && cookie ? { Cookie: cookie } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const set = res.headers.get('set-cookie');
  if (set && auth) cookie = set.split(';')[0];
  if (raw) return res;
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}
const api = (m, p, o) => call(m, `/api${p}`, o);
const q = (obj) => `?q=${encodeURIComponent(JSON.stringify(obj))}`;
/** risultati con le parole cercate (esclusi quelli aggiunti per somiglianza) */
const exact = (r) => r.results.filter((x) => !x.simile);
const ok = (r, status = 200) => {
  assert.equal(r.status, status, `HTTP ${r.status}: ${JSON.stringify(r.json)}`);
  return r.json;
};
const fileForm = (fields, files) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (const [name, text, type = 'text/plain'] of files) fd.append('files', new Blob([text], { type }), name);
  return fd;
};
/** Attende che la coda di indicizzazione abbia elaborato i documenti */
async function waitIndexed(check, timeout = 30_000) {
  const end = Date.now() + timeout;
  for (;;) {
    const r = await check();
    if (r) return r;
    if (Date.now() > end) throw new Error('Indicizzazione non completata in tempo');
    await new Promise((res) => setTimeout(res, 400));
  }
}

const created = []; // path da eliminare a fine run (in ordine inverso)
const S = {};

before(async () => {
  const h = await api('GET', '/health', { auth: false });
  assert.equal(h.status, 200, `Server non raggiungibile su ${BASE}`);
});

after(async () => {
  if (!cookie) {
    const r = await api('POST', '/auth/login', { body: { email: EMAIL, password: PASSWORD } });
    if (r.status !== 200) return;
  }
  for (const p of created.reverse()) {
    if (p.startsWith('Folder/')) await api('DELETE', `/folders/${p.split('/')[1]}`);
    else await api('DELETE', `/doc/${p}`);
  }
  // registro attività del run
  const acts = (await api('GET', `/data/Activity${q({ orderBy: [['Data', 'desc']], limit: 300 })}`)).json ?? [];
  for (const a of acts.filter((x) => x.Titolo?.includes(TAG))) await api('DELETE', `/doc/${a.path}`);
});

/* ------------------------------------------------------------ autenticazione */

test('login: senza sessione le API rispondono 401', async () => {
  assert.equal((await api('GET', '/auth/me', { auth: false })).status, 401);
  assert.equal((await api('GET', '/data/Clienti', { auth: false })).status, 401);
  assert.equal((await api('GET', '/search?q=rossi', { auth: false })).status, 401);
});

test('login: credenziali errate → 401 con messaggio chiaro', async () => {
  const r = await api('POST', '/auth/login', { body: { email: EMAIL, password: 'password-sbagliata' }, auth: false });
  assert.equal(r.status, 401);
  assert.match(r.json.error, /non corrett/i);
  const r2 = await api('POST', '/auth/login', { body: { email: 'nessuno@inesistente.it', password: 'x' }, auth: false });
  assert.equal(r2.status, 401);
});

test('login: credenziali corrette → sessione e profilo utente', async () => {
  const me = ok(await api('POST', '/auth/login', { body: { email: EMAIL, password: PASSWORD } }));
  assert.equal(me.email, EMAIL);
  assert.ok(cookie, 'cookie di sessione non ricevuto');
  const me2 = ok(await api('GET', '/auth/me'));
  assert.equal(me2.path, me.path);
  S.me = me;
});

test('account: modifica del profilo e ripristino', async () => {
  const orig = S.me;
  const upd = ok(await api('PATCH', '/account', { body: { nome: `${orig.display_name} ${TAG}`, email: orig.email, telefono: '3330000000' } }));
  assert.equal(upd.display_name, `${orig.display_name} ${TAG}`);
  assert.equal(upd.phone_number, '3330000000');
  const back = ok(await api('PATCH', '/account', { body: { nome: orig.display_name, email: orig.email, telefono: orig.phone_number ?? '' } }));
  assert.equal(back.display_name, orig.display_name);
});

test('reset password: risponde senza rivelare se l\'email esiste', async () => {
  ok(await api('POST', '/auth/reset', { body: { email: 'nessuno@inesistente.it' }, auth: false }));
});

/* ------------------------------------------------------------ validazione */

test('API dati: collezioni, campi, id e operatori non validi sono rifiutati', async () => {
  assert.equal((await api('GET', '/data/Segreti')).status, 403);
  assert.equal((await api('GET', `/data/Clienti${q({ where: [['Password', '==', 'x']] })}`)).status, 400);
  assert.equal((await api('GET', `/data/Clienti${q({ where: [['Nome', 'LIKE', 'x']] })}`)).status, 400);
  assert.equal((await api('GET', '/doc/Clienti/id con spazi')).status, 400);
  assert.equal((await api('GET', '/doc/Clienti/inesistente123')).status, 404);
  assert.equal((await api('POST', '/data/Clienti', { body: { CampoInventato: 1 } })).status, 400);
  assert.equal((await api('GET', '/endpoint-inesistente')).status, 404);
});

/* ------------------------------------------------------------ clienti */

test('clienti: creazione con cartella e registro attività', async () => {
  const c = ok(await api('POST', '/data/Clienti', { body: {
    Nome: `${TAG} Alfa Trasporti S.r.l.`, Partita_IVA: '01234567890', Email: `${TAG.toLowerCase()}@alfatrasporti.it`,
    Telefono: '089 123 456', indirizzo: 'Via Test 1, Salerno', Categoria: 'Diritto Commerciale', Caso_Aperto: true, Note: 'Cliente di collaudo',
  } }), 201);
  created.push(c.path);
  assert.equal(c.Telefono, 89123456, 'il telefono è salvato come numero (schema originale)');
  const folder = ok(await api('POST', '/folders/entity', { body: { titolo: `Cartella di ${c.Nome}`, tipo: 'Cliente', cliente: c.path } }), 201);
  created.push(folder.path);
  assert.equal(folder.Parent_Folder, 'Folder/Clienti');
  const root = ok(await api('GET', `/folders/cliente-root?cliente=${c.path}`));
  assert.equal(root.root, folder.path);
  ok(await api('POST', '/data/Activity', { body: { Titolo: `Creazione del documento cliente di ${c.Nome}`, Data: '__now__', Utente: S.me.path, Cliente: c.path } }), 201);
  S.cliente = c;
  S.clienteFolder = folder;
});

test('clienti: lettura, elenco e filtri (categoria, ordinamento, limite, id)', async () => {
  const doc = ok(await api('GET', `/doc/${S.cliente.path}`));
  assert.equal(doc.Nome, S.cliente.Nome);
  const all = ok(await api('GET', '/data/Clienti'));
  assert.ok(all.length >= 20, `attesi almeno 20 clienti demo, trovati ${all.length}`);
  const comm = ok(await api('GET', `/data/Clienti${q({ where: [['Categoria', '==', 'Diritto Commerciale']] })}`));
  assert.ok(comm.length >= 2 && comm.every((c) => c.Categoria === 'Diritto Commerciale'));
  assert.ok(comm.some((c) => c.path === S.cliente.path));
  const aperti = ok(await api('GET', `/data/Clienti${q({ where: [['Caso_Aperto', '==', true]] })}`));
  assert.ok(aperti.every((c) => c.Caso_Aperto === true));
  const sorted = ok(await api('GET', `/data/Clienti${q({ orderBy: [['Nome', 'asc']], limit: 5 })}`));
  assert.equal(sorted.length, 5);
  const names = sorted.map((c) => c.Nome);
  assert.deepEqual(names, [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  const byId = ok(await api('GET', `/data/Clienti${q({ where: [['__id__', 'in', [S.cliente.id]]] })}`));
  assert.equal(byId.length, 1);
});

test('clienti: modifica parziale', async () => {
  const upd = ok(await api('PATCH', `/doc/${S.cliente.path}`, { body: { Categoria: 'Diritto Tributario', Note: 'Aggiornato dal collaudo', Caso_Aperto: false } }));
  assert.equal(upd.Categoria, 'Diritto Tributario');
  assert.equal(upd.Nome, S.cliente.Nome, 'i campi non inviati restano invariati');
  const trib = ok(await api('GET', `/data/Clienti${q({ where: [['Categoria', '==', 'Diritto Tributario']] })}`));
  assert.ok(trib.some((c) => c.path === S.cliente.path), 'il filtro per categoria riflette la modifica');
});

test('contatti del cliente: crea, modifica, elenca, elimina', async () => {
  const col = `${S.cliente.path}/Contatti`;
  const a = ok(await api('POST', `/data/${col}`, { body: { Nome: `${TAG} Mario Bianchi`, Email: 'm.bianchi@test.it', Telefono: '3331112222', Data_Creazione: '__now__' } }), 201);
  const b = ok(await api('POST', `/data/${col}`, { body: { Nome: `${TAG} Ufficio acquisti`, Email: 'acquisti@test.it', Data_Creazione: '__now__' } }), 201);
  ok(await api('PATCH', `/doc/${a.path}`, { body: { Telefono: '3339998888' } }));
  const list = ok(await api('GET', `/data/${col}${q({ orderBy: [['Data_Creazione', 'desc']] })}`));
  assert.equal(list.length, 2);
  assert.equal(list.find((x) => x.path === a.path).Telefono, '3339998888');
  const group = ok(await api('GET', `/group/Contatti${q({ where: [['Email', '==', 'acquisti@test.it']] })}`));
  assert.ok(group.some((x) => x.path === b.path), 'collectionGroup trova il contatto');
  assert.equal((await api('DELETE', `/doc/${b.path}`)).status, 204);
  assert.equal(ok(await api('GET', `/data/${col}`)).length, 1);
});

/* ------------------------------------------------------------ consulenze */

test('consulenze: crea, filtra per cliente e per avvocato, modifica', async () => {
  const k = ok(await api('POST', '/data/Consulenze', { body: {
    Cliente: S.cliente.path, Titolo: `${TAG} Revisione contratti di trasporto`, Descrizione: 'Clausole CMR e limitazione di responsabilità del vettore',
    Avvocato_Principale: S.me.path, Avvocati_Supporto: [], Data_Creazione: '__now__', Data_Inizio: '01/10/2026',
  } }), 201);
  created.push(k.path);
  const f = ok(await api('POST', '/folders/entity', { body: { titolo: `Cartella per ${k.Titolo}`, tipo: 'Consulenza', consulenza: k.path, cliente: S.cliente.path } }), 201);
  assert.equal(f.Parent_Folder, S.clienteFolder.path, 'la cartella della consulenza è dentro quella del cliente');
  const perCliente = ok(await api('GET', `/data/Consulenze${q({ where: [['Cliente', '==', S.cliente.path]] })}`));
  assert.deepEqual(perCliente.map((x) => x.path), [k.path]);
  const perAvv = ok(await api('GET', `/data/Consulenze${q({ where: [['Avvocato_Principale', '==', S.me.path]] })}`));
  assert.ok(perAvv.length >= 2 && perAvv.every((x) => x.Avvocato_Principale === S.me.path));
  const users = ok(await api('GET', '/data/Users'));
  const altro = users.find((u) => u.path !== S.me.path);
  const upd = ok(await api('PATCH', `/doc/${k.path}`, { body: { Avvocati_Supporto: [altro.path], Descrizione: 'Clausole CMR aggiornate' } }));
  assert.deepEqual(upd.Avvocati_Supporto, [altro.path]);
  const supp = ok(await api('GET', `/data/Consulenze${q({ where: [['Avvocati_Supporto', 'array-contains', altro.path]] })}`));
  assert.ok(supp.some((x) => x.path === k.path), 'filtro array-contains sugli avvocati di supporto');
  S.consulenza = k;
});

/* ------------------------------------------------------------ casi */

test('casi: crea con contatti, filtra per area, modifica', async () => {
  const c = ok(await api('POST', '/data/Casi', { body: {
    Titolo: `${TAG} Opposizione a decreto ingiuntivo`, Cliente: S.cliente.path, Area_Pratica: 'Diritto Civile',
    Data_Creazione: '__now__', Avvocato_Principale: S.me.path, Avvovati_Supporto: [], Data_Inizio: '01/10/2026', Scadenza: '30/11/2026',
    Descrizione: 'Opposizione ex art. 645 c.p.c.',
  } }), 201);
  created.push(c.path);
  ok(await api('POST', '/folders/entity', { body: { titolo: `Cartella del caso: ${c.Titolo}`, tipo: 'caso', cliente: S.cliente.path, caso: c.path } }), 201);
  const ct = ok(await api('POST', `/data/${c.path}/Contatti_Caso`, { body: { Nome: `${TAG} Avv. controparte`, Email: 'controparte@test.it', Data_Creazione: '__now__' } }), 201);
  ok(await api('PATCH', `/doc/${ct.path}`, { body: { Telefono: '089 000 111' } }));
  const civ = ok(await api('GET', `/data/Casi${q({ where: [['Area_Pratica', '==', 'Diritto Civile']] })}`));
  assert.ok(civ.some((x) => x.path === c.path) && civ.every((x) => x.Area_Pratica === 'Diritto Civile'));
  const upd = ok(await api('PATCH', `/doc/${c.path}`, { body: { Area_Pratica: 'Diritto Commerciale', Scadenza: '15/12/2026' } }));
  assert.equal(upd.Scadenza, '15/12/2026');
  const civ2 = ok(await api('GET', `/data/Casi${q({ where: [['Area_Pratica', '==', 'Diritto Civile']] })}`));
  assert.ok(!civ2.some((x) => x.path === c.path), 'dopo la modifica il caso esce dal filtro');
  S.caso = c;
});

/* ------------------------------------------------------------ cartelle e file */

test('cartelle: sottocartella, caricamento file e download protetto', async () => {
  const sub = ok(await api('POST', '/folders/sub', { body: { tipo: 'Cliente', titolo: `${TAG} Fatture`, cliente: S.cliente.path, folderPadre: S.clienteFolder.path } }), 201);
  assert.deepEqual(sub.Array_Parents, [S.clienteFolder.path, 'Folder/Clienti', 'Folder/Explorer']);
  const r = ok(await api('POST', '/files', { form: fileForm({ folder: sub.path }, [
    [`${TAG}_fattura.txt`, `Fattura n. 77 di Alfa Trasporti: noleggio semirimorchio frigorifero ${TAG}KAPPA, importo 3.450 euro.`],
    [`${TAG}_preventivo.csv`, 'Voce;Importo\nTrasporto Salerno-Verona;1200\nSosta tecnica;150'],
  ]) }), 201);
  assert.equal(r.created.length, 2);
  assert.deepEqual(r.failed, []);
  const files = ok(await api('GET', `/data/Files${q({ where: [['Folder_Ref', '==', sub.path]], orderBy: [['Data_Caricamento', 'desc']] })}`));
  assert.equal(files.length, 2);
  const dl = await call('GET', files[0].File, { raw: true });
  assert.equal(dl.status, 200, 'download con sessione');
  const dlAnon = await call('GET', files[0].File, { raw: true, auth: false });
  assert.equal(dlAnon.status, 401, 'download senza sessione bloccato');
  S.sub = sub;
  S.files = r.created;
});

test('ricerca documenti: contenuto indicizzato, filtro per cliente, stato', async () => {
  const term = `${TAG}KAPPA`.toLowerCase();
  const found = await waitIndexed(async () => {
    const r = ok(await api('GET', `/documenti/cerca?q=${term}`));
    return r.results.length ? r : null;
  });
  const hit = found.results[0];
  assert.equal(hit.nome, `${TAG}_fattura.txt`);
  assert.ok(hit.estratto?.includes('\u0001'), 'estratto con il termine evidenziato');
  const stem = ok(await api('GET', `/documenti/cerca?q=${encodeURIComponent(`semirimorchi frigorifer ${term}`)}`));
  assert.equal(stem.results[0]?.nome, `${TAG}_fattura.txt`, 'prefissi e varianti trovano il documento');
  const altroCliente = (ok(await api('GET', '/data/Clienti'))).find((c) => c.path !== S.cliente.path);
  const filtered = ok(await api('GET', `/documenti/cerca?q=${term}&cliente=${altroCliente.path}`));
  assert.equal(exact(filtered).length, 0, 'il filtro per cliente esclude gli altri clienti');
  const mine = ok(await api('GET', `/documenti/cerca?q=${term}&cliente=${S.cliente.path}`));
  assert.deepEqual(exact(mine).map((x) => x.nome), [`${TAG}_fattura.txt`]);
  const stato = ok(await api('GET', `/documenti/stato?files=${S.files.map((f) => f.path).join(',')}`));
  assert.ok(JSON.stringify(stato).includes('indicizzato'), JSON.stringify(stato));
  const demo = ok(await api('GET', '/documenti/cerca?q=fideiussione'));
  assert.ok(demo.results.some((d) => d.nome === 'Fideiussione_bancaria.docx'), 'contenuto Word demo trovato');
  const ocr = ok(await api('GET', '/documenti/cerca?q=Gennaro%20Esposito'));
  assert.ok(ocr.results.some((d) => d.nome.includes('scansione')), 'contenuto OCR trovato');
  assert.equal(ok(await api('GET', '/documenti/cerca?q=')).results.length, 0);
});

test('file: eliminazione singola toglie il documento dalla ricerca', async () => {
  const [fattura] = S.files.filter((f) => f.Nome.endsWith('fattura.txt'));
  ok(await api('DELETE', `/files/${fattura.id}`));
  assert.equal((await api('GET', `/doc/${fattura.path}`)).status, 404);
  const r = ok(await api('GET', `/documenti/cerca?q=${TAG.toLowerCase()}kappa`));
  assert.equal(exact(r).length, 0);
});

test('cartelle: eliminazione ricorsiva di sottocartella e file', async () => {
  ok(await api('DELETE', `/folders/${S.sub.id}`));
  assert.equal((await api('GET', `/doc/${S.sub.path}`)).status, 404);
  const files = ok(await api('GET', `/data/Files${q({ where: [['Folder_Ref', '==', S.sub.path]] })}`));
  assert.equal(files.length, 0);
});

/* ------------------------------------------------------------ note */

for (const [col, key] of [['Clienti', 'cliente'], ['Consulenze', 'consulenza'], ['Casi', 'caso']]) {
  test(`note (${col}): crea con allegati, ricerca, modifica, elimina`, async () => {
    const parent = S[key];
    const id = parent.id;
    assert.equal((await api('POST', `/note/${col}/${id}`, { form: fileForm({ titolo: '  ' }, []) })).status, 400, 'titolo obbligatorio');
    const word = `${TAG}nota${key}`.toLowerCase();
    const n = ok(await api('POST', `/note/${col}/${id}`, { form: fileForm(
      { titolo: `${TAG} Nota ${key}`, descrizione: 'Prima versione' },
      [[`verbale_${key}.txt`, `Verbale di riunione: ${word} parcheggio container al molo Manfredi.`], [`foto_${key}.png`, 'non è una vera immagine', 'image/png']],
    ) }), 201);
    assert.equal(n.Allegati.length, 2);
    assert.equal(n.Utente, S.me.path);
    const hit = await waitIndexed(async () => {
      const r = ok(await api('GET', `/documenti/cerca?q=${word}`));
      return r.results.length ? r.results[0] : null;
    });
    assert.equal(hit.origine, 'nota');
    // modifica: tengo solo il verbale, aggiungo un nuovo allegato
    const keep = n.Allegati.filter((a) => a.Nome.startsWith('verbale')).map((a) => a.File);
    const upd = ok(await api('PATCH', `/note/${col}/${id}/${n.id}`, { form: fileForm(
      { titolo: `${TAG} Nota ${key} (rev. 2)`, descrizione: 'Seconda versione', mantieni: JSON.stringify(keep) },
      [[`integrazione_${key}.txt`, 'Integrazione al verbale']],
    ) }));
    assert.equal(upd.Titolo, `${TAG} Nota ${key} (rev. 2)`);
    assert.deepEqual(upd.Allegati.map((a) => a.Nome).sort(), [`integrazione_${key}.txt`, `verbale_${key}.txt`]);
    const removed = n.Allegati.find((a) => a.Nome.startsWith('foto'));
    assert.equal((await call('GET', removed.File, { raw: true })).status, 404, 'allegato rimosso eliminato dallo storage');
    const sub = { Clienti: 'Note_Cliente', Consulenze: 'Note_Consulenza', Casi: 'Note_Caso' }[col];
    assert.equal(ok(await api('GET', `/data/${col}/${id}/${sub}`)).length, 1);
    assert.equal((await api('DELETE', `/note/${col}/${id}/${n.id}`)).status, 204);
    assert.equal(ok(await api('GET', `/data/${col}/${id}/${sub}`)).length, 0);
    assert.equal(exact(ok(await api('GET', `/documenti/cerca?q=${word}`))).length, 0, 'nota eliminata → allegati fuori dalla ricerca');
  });
}

/* ------------------------------------------------------------ agenda */

test('promemoria: crea, filtra per utente e consulenza, modifica, elimina', async () => {
  const p = ok(await api('POST', '/data/Promemoria', { body: {
    Data_Creazione: '__now__', Titolo: `${TAG} Depositare memoria`, Descrizione: 'Termine perentorio', Data_Promemoria: '20/10/2026',
    Ora_Promemoria: '09:00', Utente: S.me.path, Consulenza_Ref: S.consulenza.path,
  } }), 201);
  created.push(p.path);
  const mine = ok(await api('GET', `/data/Promemoria${q({ where: [['Utente', '==', S.me.path]], orderBy: [['Data_Creazione', 'desc']] })}`));
  assert.ok(mine.some((x) => x.path === p.path) && mine.every((x) => x.Utente === S.me.path));
  const perCons = ok(await api('GET', `/data/Promemoria${q({ where: [['Consulenza_Ref', '==', S.consulenza.path]] })}`));
  assert.deepEqual(perCons.map((x) => x.path), [p.path]);
  const upd = ok(await api('PATCH', `/doc/${p.path}`, { body: { Ora_Promemoria: '11:30', Data_Promemoria: '21/10/2026' } }));
  assert.equal(upd.Ora_Promemoria, '11:30');
  assert.equal((await api('DELETE', `/doc/${p.path}`)).status, 204);
  assert.equal((await api('GET', `/doc/${p.path}`)).status, 404);
});

test('appuntamenti: crea, appuntamenti recenti della consulenza, modifica, elimina', async () => {
  const pad = (n) => String(n).padStart(2, '0');
  const d = new Date(Date.now() + 864e5);
  const domani = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  const a = ok(await api('POST', '/data/Appuntamenti', { body: {
    Titolo: `${TAG} Incontro in porto`, Descrizione: 'Sopralluogo', Data_Creazione: '__now__', Data_Appuntamento: domani,
    Ora_Appuntamento: '10:00', Luogo: 'Molo Manfredi', Utente: S.me.path, Consulenza_Ref: S.consulenza.path,
  } }), 201);
  created.push(a.path);
  const recenti = ok(await api('GET', `/consulenze/${S.consulenza.id}/appuntamenti-recenti`));
  assert.ok(JSON.stringify(recenti).includes(a.id), `appuntamento non tra i recenti: ${JSON.stringify(recenti)}`);
  const upd = ok(await api('PATCH', `/doc/${a.path}`, { body: { Luogo: 'Autorità portuale, Salerno' } }));
  assert.equal(upd.Luogo, 'Autorità portuale, Salerno');
  assert.equal((await api('DELETE', `/doc/${a.path}`)).status, 204);
});

/* ------------------------------------------------------------ registro attività */

test('registro attività: filtri per utente, cliente, intervallo di date', async () => {
  const t0 = new Date(Date.now() - 60_000).toISOString();
  ok(await api('POST', '/data/Activity', { body: { Titolo: `${TAG} Modifica del documento relativo al cliente`, Data: '__now__', Utente: S.me.path, Cliente: S.cliente.path } }), 201);
  const perCliente = ok(await api('GET', `/data/Activity${q({ where: [['Cliente', '==', S.cliente.path]], orderBy: [['Data', 'desc']] })}`));
  assert.ok(perCliente.length >= 2, 'creazione + modifica del cliente');
  const recenti = ok(await api('GET', `/data/Activity${q({ where: [['Utente', '==', S.me.path], ['Data', '>=', t0]], orderBy: [['Data', 'desc']] })}`));
  assert.ok(recenti.some((a) => a.Titolo.includes(TAG)));
  assert.ok(recenti.every((a) => new Date(a.Data) >= new Date(t0)));
  const pagina = ok(await api('GET', `/data/Activity${q({ orderBy: [['Data', 'desc']], limit: 25 })}`));
  assert.equal(pagina.length, 25);
  assert.ok(new Date(pagina[0].Data) >= new Date(pagina[24].Data), 'ordinamento per data decrescente');
});

/* ------------------------------------------------------------ ricerca globale */

test('ricerca globale: clienti, consulenze e documenti', async () => {
  const r = ok(await api('GET', `/search?q=${encodeURIComponent(TAG)}`));
  assert.ok(r.clienti.some((c) => c.path === S.cliente.path), 'cliente trovato per nome');
  assert.ok(r.consulenze.some((c) => c.path === S.consulenza.path), 'consulenza trovata per titolo');
  const piva = ok(await api('GET', '/search?q=04512870658'));
  assert.equal(piva.clienti[0]?.Nome, 'Rossi Costruzioni S.r.l.', 'ricerca per partita IVA');
  const desc = ok(await api('GET', '/search?q=tour%20operator'));
  assert.ok(desc.consulenze.some((c) => c.Titolo === 'Contratti con tour operator 2027'), 'consulenza trovata per descrizione');
  const doc = ok(await api('GET', '/search?q=mozzarella'));
  assert.ok(doc.documenti.some((d) => d.nome.includes('stagionale')), 'documento trovato per contenuto');
  const none = ok(await api('GET', '/search?q=zzqqxxnessunrisultato'));
  assert.equal(none.clienti.length + none.consulenze.length + none.documenti.length, 0);
});

/* ------------------------------------------------------------ eliminazioni a cascata e logout */

test('eliminazione: caso, consulenza e cliente con le sotto-collezioni', async () => {
  for (const p of [S.caso.path, S.consulenza.path]) {
    assert.equal((await api('DELETE', `/doc/${p}`)).status, 204);
    assert.equal((await api('GET', `/doc/${p}`)).status, 404);
  }
  ok(await api('DELETE', `/folders/${S.clienteFolder.id}`));
  // una nota con allegato rimasta sul cliente: l'allegato deve sparire con lui
  const nota = ok(await api('POST', `/note/Clienti/${S.cliente.id}`, { form: fileForm({ titolo: `${TAG} Nota finale` }, [['ultimo.txt', 'allegato finale']]) }), 201);
  const allegato = nota.Allegati[0].File;
  assert.equal((await call('GET', allegato, { raw: true })).status, 200);
  assert.equal((await api('DELETE', `/doc/${S.cliente.path}`)).status, 204);
  assert.equal((await call('GET', allegato, { raw: true })).status, 404, 'allegati delle note eliminati con il cliente');
  assert.equal((await api('GET', `/doc/${S.cliente.path}`)).status, 404);
  assert.equal(ok(await api('GET', `/data/${S.cliente.path}/Contatti`)).length, 0, 'contatti eliminati in cascata');
  const rest = ok(await api('GET', `/search?q=${encodeURIComponent(TAG)}`));
  assert.equal(rest.clienti.length + rest.consulenze.length, 0);
});

test('logout: la sessione non è più valida', async () => {
  ok(await api('POST', '/auth/logout'));
  cookie = '';
  assert.equal((await api('GET', '/auth/me')).status, 401);
});
