/**
 * Popola il database (demo JSON o PostgreSQL) con dati di esempio.
 *   npm run seed            → solo se il database è vuoto
 *   npm run seed -- --force → svuota e ricrea
 * Non va mai eseguito contro Firestore reale.
 */
import fs from 'node:fs';
import { config } from '../config.js';

if (config.dataDriver === 'firestore') {
  console.error('Il seed non può essere eseguito sul Firebase reale.');
  process.exit(1);
}
const force = process.argv.includes('--force');
if (config.dataDriver === 'memory' && force) fs.rmSync(config.memoryFile, { force: true });
if (force) fs.rmSync(config.uploadsDir, { recursive: true, force: true });

const { getDb } = await import('./index.js');
const { createAccountWithEmail, maybeCreateUser } = await import('../services/auth.js');
const { createEntityFolder, createSubfolder } = await import('../domain/folders.js');
const { uploadFile } = await import('../services/storage.js');
const db = await getDb();

const existing = await db.query('Users', { limit: 1 });
if (existing.length && !force) {
  console.log('Il database contiene già dati. Usa --force per svuotarlo e ricrearlo.');
  process.exit(0);
}
if (force && db.kind === 'postgres') {
  await db.pool.query('TRUNCATE users, auth_accounts, clienti, contatti, consulenze, casi, contatti_caso, folder, files, versione_file, activity, promemoria, appuntamenti CASCADE');
}

const pad = (n) => String(n).padStart(2, '0');
const it = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
const inDays = (n, h = 10, m = 0) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, m, 0, 0); return d; };
const ago = (hours) => new Date(Date.now() - hours * 36e5);

// Avvocati (Users) — password demo: "santaniello"
const lawyers = [
  ['Giovanni Santaniello', 'g.santaniello@studio.it', '3331234567'],
  ['Laura Bianchi', 'l.bianchi@studio.it', '3339876543'],
  ['Marco Esposito', 'm.esposito@studio.it', '3401122334'],
];
const U = [];
for (const [nome, email, tel] of lawyers) {
  const uid = await createAccountWithEmail(email, 'santaniello');
  await maybeCreateUser(uid, { email });
  await db.update(`Users/${uid}`, { display_name: nome, phone_number: tel });
  U.push(`Users/${uid}`);
}
const log = (Titolo, Utente, extra = {}, hoursAgo = 1) => db.add('Activity', { Titolo, Data: ago(hoursAgo), Utente, ...extra });

// Clienti
const clientiData = [
  { Nome: 'Rossi Costruzioni S.r.l.', Partita_IVA: '04512870658', Email: 'amministrazione@rossicostruzioni.it', Telefono: 891234567, indirizzo: 'Via Roma 12, Salerno', Categoria: 'Diritto Immobiliare', Note: 'Cliente storico. Preferisce contatto via PEC.' },
  { Nome: 'Farmacia Del Corso', Partita_IVA: '03398120651', Email: 'info@farmaciadelcorso.it', Telefono: 89765432, indirizzo: 'Corso Vittorio Emanuele 88, Salerno', Categoria: 'Diritto Commerciale', Note: '' },
  { Nome: 'Anna Ferraro', Partita_IVA: '', Email: 'anna.ferraro@gmail.com', Telefono: 3478899001, indirizzo: 'Via Irno 4, Baronissi', Categoria: 'Diritto di Famiglia', Note: 'Pratica di separazione consensuale.' },
  { Nome: 'TechNova S.p.A.', Partita_IVA: '09876540121', Email: 'legal@technova.it', Telefono: 281234567, indirizzo: 'Via Tortona 25, Milano', Categoria: 'Propietà Intellettuale', Note: 'Portafoglio marchi e brevetti.' },
  { Nome: 'Caseificio Fratelli Amato', Partita_IVA: '05566770654', Email: 'amato@caseificioamato.it', Telefono: 828123456, indirizzo: 'SS18 km 92, Paestum', Categoria: 'Diritto del Lavoro', Note: '' },
];
const C = [];
for (const [i, c] of clientiData.entries()) {
  const doc = await db.add('Clienti', { ...c, Caso_Aperto: i % 2 === 0 });
  C.push(doc);
  await log(`Creazione del documento cliente di ${c.Nome}`, U[i % 3], { Cliente: doc.path }, 200 - i * 20);
  await createEntityFolder({ titolo: `Cartella di ${c.Nome}`, tipo: 'Cliente', cliente: doc.path });
  await log(`Creazione della cartella per il cliente ${c.Nome}`, U[i % 3], { Cliente: doc.path }, 199 - i * 20);
}
const contatti = [
  [0, 'Paolo Rossi', 'paolo@rossicostruzioni.it', '3391112233'],
  [0, 'Segreteria amministrativa', 'segreteria@rossicostruzioni.it', '089 123 4567'],
  [1, 'Dott.ssa Elena Greco', 'elena.greco@farmaciadelcorso.it', '3355566778'],
  [3, 'Ufficio Legale TechNova', 'legal@technova.it', '02 8123 4567'],
];
for (const [ci, Nome, Email, Telefono] of contatti) {
  await db.add(`${C[ci].path}/Contatti`, { Nome, Email, Telefono, Data_Creazione: ago(100) });
  await log(`Creazione del documento contatto: ${Nome} per il cliente ${C[ci].Nome}`, U[0], { Cliente: C[ci].path }, 90);
}

// Consulenze
const consData = [
  [0, 'Contratto di appalto — Cantiere Via Posidonia', 'Revisione del contratto di appalto e delle garanzie fideiussorie.', -20],
  [1, 'Adeguamento privacy GDPR', 'Audit del trattamento dati clienti e redazione registro dei trattamenti.', -10],
  [3, 'Licensing software gestionale', 'Negoziazione licenze e clausole di riservatezza con distributori esteri.', -35],
  [4, 'Contratti stagionali 2026', 'Consulenza su contratti a termine e somministrazione per la stagione estiva.', -5],
];
const K = [];
for (const [ci, Titolo, Descrizione, start] of consData) {
  const doc = await db.add('Consulenze', {
    Cliente: C[ci].path, Titolo, Descrizione, Avvocato_Principale: U[ci % 3],
    Data_Creazione: ago(150 - K.length * 30), Data_Inizio: it(inDays(start)), Avvocati_Supporto: [U[(ci + 1) % 3]],
  });
  K.push(doc);
  await log(`Creazione del documento consulenza: ${Titolo}`, U[ci % 3], { Consulenza: doc.path }, 140 - K.length * 25);
  await createEntityFolder({ titolo: `Cartella per ${Titolo}`, tipo: 'Consulenza', consulenza: doc.path, cliente: C[ci].path });
}

// Casi
const casiData = [
  [2, 'Separazione consensuale Ferraro', 'Diritto di Famiglia', 'Ricorso per separazione consensuale e accordi su affidamento.', -40, 25],
  [0, 'Recupero crediti — Condominio Le Palme', 'Diritto Civile', 'Decreto ingiuntivo per lavori straordinari non pagati.', -60, 5],
  [4, 'Vertenza lavoratore stagionale', 'Diritto del Lavoro', 'Impugnazione licenziamento; tentativo di conciliazione in sede sindacale.', -15, -2],
  [3, 'Opposizione marchio "NOVATECH"', 'Propietà Intellettuale', 'Opposizione presso EUIPO contro registrazione di marchio confondibile.', -90, 45],
];
const S = [];
for (const [ci, Titolo, Area_Pratica, Descrizione, start, scad] of casiData) {
  const doc = await db.add('Casi', {
    Titolo, Cliente: C[ci].path, Area_Pratica, Data_Creazione: ago(300 - S.length * 50), Avvocato_Principale: U[S.length % 3],
    Avvovati_Supporto: [U[(S.length + 2) % 3]], Data_Inizio: it(inDays(start)), Scadenza: it(inDays(scad)), Descrizione,
  });
  S.push(doc);
  await createEntityFolder({ titolo: `Cartella del caso: ${Titolo}`, tipo: 'caso', cliente: C[ci].path, caso: doc.path });
}
await db.add(`${S[0].path}/Contatti_Caso`, { Nome: 'Avv. Carlo Russo (controparte)', Email: 'c.russo@avvocati.it', Telefono: '089 765 4321', Data_Creazione: ago(50) });
await log('Creazione del documento contatto: Avv. Carlo Russo (controparte)', U[0], { Caso: S[0].path }, 30);

// Sottocartelle e file di esempio
const rootOf = async (field, ref) => (await db.query('Folder', { where: [[field, '==', ref]], limit: 1 }))[0]?.path;
const addFile = async (folder, name, text) => {
  const { url } = await uploadFile({ buffer: Buffer.from(text), originalName: name, contentType: 'text/plain' });
  await db.add('Files', { Nome: name, Data_Caricamento: ago(Math.random() * 40), File: url, Folder_Ref: folder });
};
const cons0 = await rootOf('Consulenza', K[0].path);
const sub1 = await createSubfolder({ tipo: 'Cliente', cliente: C[0].path, folderPadre: cons0, titolo: 'Contratti firmati' });
await createSubfolder({ tipo: 'Cliente', cliente: C[0].path, folderPadre: cons0, titolo: 'Corrispondenza' });
await addFile(cons0, 'Bozza_contratto_appalto.pdf', 'Bozza contratto di appalto (demo)');
await addFile(sub1.path, 'Contratto_firmato_2026.pdf', 'Contratto firmato (demo)');
await addFile(sub1.path, 'Fideiussione_bancaria.docx', 'Fideiussione (demo)');
const caso0 = await rootOf('Caso', S[0].path);
await createSubfolder({ tipo: 'Caso', caso: S[0].path, folderPadre: caso0, titolo: 'Atti depositati' });
await addFile(caso0, 'Ricorso_separazione.pdf', 'Ricorso (demo)');
await addFile(caso0, 'Accordi_economici.xlsx', 'Accordi (demo)');

// Promemoria e appuntamenti (relativi a oggi)
const P = [
  [0, 'Scadenza deposito memoria', 'Depositare memoria ex art. 183 c.p.c.', 1, '09:00', K[0]],
  [0, 'Chiamare cliente per firma', 'Firma procura alle liti.', 0, '16:30', K[0]],
  [1, 'Invio registro trattamenti', 'Inviare registro aggiornato al DPO.', 3, '11:00', K[1]],
  [0, 'Rinnovo polizza RC professionale', '', 9, '10:00', null],
];
for (const [u, Titolo, Descrizione, d, ora, k] of P) {
  await db.add('Promemoria', { Data_Creazione: ago(20), Titolo, Descrizione, Data_Promemoria: it(inDays(d)), Ora_Promemoria: ora, Utente: U[u], ...(k ? { Consulenza_Ref: k.path } : {}) });
  if (k) await log(`Creazione di un nuovo promemoria per la Consulenza ${k.Titolo}`, U[u], { Consulenza: k.path }, 20);
}
const A = [
  [0, 'Incontro in cantiere', 'Via Posidonia 145, Salerno', 0, '11:30', K[0]],
  [0, 'Udienza Tribunale di Salerno', 'Aula 3, Cittadella Giudiziaria', 2, '09:30', null],
  [0, 'Call con ufficio legale TechNova', 'Videochiamata', 5, '15:00', K[2]],
  [1, 'Riunione con DPO', 'Studio — Sala riunioni', 1, '10:00', K[1]],
  [0, 'Revisione contratto con Paolo Rossi', 'Studio', -3, '17:00', K[0]],
  [0, 'Conciliazione sindacale', 'Sede CGIL Salerno', 12, '10:30', K[3]],
];
for (const [u, Titolo, Luogo, d, ora, k] of A) {
  await db.add('Appuntamenti', { Titolo, Data_Creazione: ago(30), Data_Appuntamento: it(inDays(d)), Ora_Appuntamento: ora, Luogo, Utente: U[u], ...(k ? { Consulenza_Ref: k.path } : {}) });
  await log(`Appuntamento creato: ${Titolo} del ${it(inDays(d))} alle ${ora}`, U[u], k ? { Consulenza: k.path } : {}, 28);
}
await log('Modifica del documento relativo al cliente Rossi Costruzioni S.r.l.', U[0], { Cliente: C[0].path }, 3);

await new Promise((r) => setTimeout(r, 200)); // attende il flush su disco
console.log(`Seed completato: ${U.length} avvocati, ${C.length} clienti, ${K.length} consulenze, ${S.length} casi.`);
console.log('Accesso demo: g.santaniello@studio.it / santaniello');
await db.close?.();
