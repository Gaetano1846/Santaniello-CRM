import { getDb } from '../db/index.js';
import { createAccountWithEmail, maybeCreateUser } from '../services/auth.js';
import { createEntityFolder, createSubfolder, findClienteRootFolder } from '../domain/folders.js';
import { uploadFile } from '../services/storage.js';
import { idle, indexAllegati, indexFiles } from '../services/indexer.js';
import { closeOcr } from '../services/extract.js';

/**
 * npm run seed:demo — arricchisce i dati demo SENZA cancellare quelli esistenti:
 * avvocati, clienti di tutte le categorie con contatti e cartelle, consulenze, casi,
 * note con allegati, promemoria e appuntamenti distribuiti attorno a oggi (anche per
 * l'utente con cui si accede) e il relativo registro attività.
 * Rilanciabile: i clienti già presenti (stesso nome) vengono saltati.
 */

const db = await getDb();
if (db.kind !== 'postgres') {
  console.error('Lo script richiede PostgreSQL (DATABASE_URL).');
  process.exit(1);
}

const pad = (n) => String(n).padStart(2, '0');
const it = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
const ago = (hours) => new Date(Date.now() - hours * 36e5);

/* ------------------------------------------------------------ avvocati */

async function lawyer(nome, email, tel) {
  const [u] = await db.query('Users', { where: [['email', '==', email]], limit: 1 });
  if (u) return u.path;
  const uid = await createAccountWithEmail(email, 'santaniello');
  await maybeCreateUser(uid, { email });
  await db.update(`Users/${uid}`, { display_name: nome, phone_number: tel, created_time: new Date() });
  return `Users/${uid}`;
}
const users = await db.query('Users');
const byMail = (m) => users.find((u) => u.email === m)?.path;
const U = {
  gs: byMail('g.santaniello@studio.it'),
  lb: byMail('l.bianchi@studio.it'),
  me: byMail('m.esposito@studio.it'),
  fr: await lawyer('Francesca Romano', 'f.romano@studio.it', '3384455667'),
  dc: await lawyer('Davide Coppola', 'd.coppola@studio.it', '3297788990'),
};
// l'utente con cui si accede di solito riceve anche lui agenda e attività
const zack = byMail('zack.s@meetaly.agency');
const TEAM = [U.gs, U.lb, U.me, U.fr, U.dc];
const pick = (i) => TEAM[i % TEAM.length];

let logs = 0;
const log = async (Titolo, Utente, extra, hoursAgo) => {
  await db.add('Activity', { Titolo, Data: ago(hoursAgo), Utente, ...extra });
  logs++;
};

/* ------------------------------------------------------------ clienti */

const CLIENTI = [
  { Nome: 'Studio Dentistico Galdi', Partita_IVA: '04987650654', Email: 'segreteria@studiogaldi.it', Telefono: '089 252 1144', indirizzo: 'Via Mercanti 31, Salerno', Categoria: 'Diritto Civile', Note: 'Contenzioso con paziente per responsabilità medica.', contatti: [['Dott. Alfredo Galdi', 'a.galdi@studiogaldi.it', '3356677889']] },
  { Nome: 'Marco Pellegrino', Partita_IVA: '', Email: 'marco.pellegrino@libero.it', Telefono: '3401239876', indirizzo: 'Via Wenner 18, Fisciano', Categoria: 'Diritto Penale', Note: 'Indagato per omesso versamento IVA. Massima riservatezza.', contatti: [] },
  { Nome: 'Hotel Costa d\'Amalfi S.r.l.', Partita_IVA: '05123450657', Email: 'direzione@hotelcostadamalfi.it', Telefono: '089 871 0022', indirizzo: 'Via Pantaleone Comite 7, Amalfi', Categoria: 'Diritto Commerciale', Note: 'Struttura 4 stelle, 62 camere. Stagionalità aprile–ottobre.', contatti: [['Rag. Teresa Amodio (amministrazione)', 't.amodio@hotelcostadamalfi.it', '3398800112'], ['Booking office', 'booking@hotelcostadamalfi.it', '089 871 0023']] },
  { Nome: 'Officine Meccaniche Sarno S.p.A.', Partita_IVA: '02233440651', Email: 'hr@omsarno.it', Telefono: '081 515 9900', indirizzo: 'Zona Industriale, Sarno', Categoria: 'Diritto del Lavoro', Note: '180 dipendenti. CCNL metalmeccanico industria.', contatti: [['Ing. Bruno Vitale (HR)', 'b.vitale@omsarno.it', '3471122998'], ['RSPP Sig. Nicola Ruggiero', 'rspp@omsarno.it', '3489911223']] },
  { Nome: 'Giulia e Roberto Cantalupo', Partita_IVA: '', Email: 'g.cantalupo@gmail.com', Telefono: '3332211445', indirizzo: 'Via Allende 60, Pontecagnano', Categoria: 'Diritto di Famiglia', Note: 'Adozione internazionale — procedura con ente autorizzato.', contatti: [] },
  { Nome: 'Agricola Valle del Sele', Partita_IVA: '05677880652', Email: 'info@vallesele.it', Telefono: '0828 345 210', indirizzo: 'Località Borgo San Cesareo, Eboli', Categoria: 'Diritto Tributario', Note: 'Avviso di accertamento IRES 2022 — accise gasolio agricolo.', contatti: [['Dott. Comm. Sergio Landi (commercialista)', 'studio@landicommercialisti.it', '0828 300 455']] },
  { Nome: 'Lumen Design S.r.l.', Partita_IVA: '10234560963', Email: 'legal@lumendesign.it', Telefono: '02 4567 8901', indirizzo: 'Via Savona 97, Milano', Categoria: 'Propietà Intellettuale', Note: 'Design di lampade. Contraffazione su marketplace online.', contatti: [['Arch. Chiara Ferri', 'c.ferri@lumendesign.it', '3471234500']] },
  { Nome: 'Condominio Parco Arbostella', Partita_IVA: '95034560653', Email: 'amministrazione@parcoarbostella.it', Telefono: '089 330 1122', indirizzo: 'Via Arbostella 120, Salerno', Categoria: 'Diritto Immobiliare', Note: 'Infiltrazioni dai box interrati — accertamento tecnico preventivo.', contatti: [['Amministratore Rag. Felice Sica', 'felice.sica@studiosica.it', '3405566778']] },
  { Nome: 'Pasticceria Pantaleone', Partita_IVA: '04455660655', Email: 'ordini@pasticceriapantaleone.it', Telefono: '089 227 825', indirizzo: 'Via dei Mercanti 75, Salerno', Categoria: 'Diritto Commerciale', Note: 'Contratto di franchising per apertura punti vendita a Napoli e Roma.', contatti: [] },
  { Nome: 'Vincenzo Esposito', Partita_IVA: '', Email: 'vinc.esposito72@gmail.com', Telefono: '3289900776', indirizzo: 'Corso Garibaldi 210, Salerno', Categoria: 'Diritto Civile', Note: 'Sinistro stradale con lesioni — trattativa con compagnia assicurativa.', contatti: [] },
  { Nome: 'Logistica Tirrenica S.r.l.', Partita_IVA: '05889900651', Email: 'amministrazione@logisticatirrenica.it', Telefono: '089 562 7700', indirizzo: 'Porto Commerciale, Molo 3 Gennaio, Salerno', Categoria: 'Diritto del Lavoro', Note: 'Ispezione INL su appalti di manodopera nel magazzino portuale.', contatti: [['Dott.ssa Rita Palumbo (CFO)', 'r.palumbo@logisticatirrenica.it', '3381239870']] },
  { Nome: 'Fondazione Ravello Musica', Partita_IVA: '95112230653', Email: 'segreteria@ravellomusica.org', Telefono: '089 858 4422', indirizzo: 'Piazza Duomo 1, Ravello', Categoria: 'Diritto Tributario', Note: 'Ente del Terzo Settore — iscrizione RUNTS e regime fiscale.', contatti: [] },
  { Nome: 'Antonio Russo', Partita_IVA: '', Email: 'antonio.russo.sa@gmail.com', Telefono: '3475544332', indirizzo: 'Via Velia 44, Salerno', Categoria: 'Diritto Penale', Note: 'Parte civile in procedimento per truffa online (falso trading).', contatti: [] },
  { Nome: 'Edil Cilento S.n.c.', Partita_IVA: '05012340656', Email: 'edilcilento@pec.it', Telefono: '0974 823 456', indirizzo: 'Via Nazionale 33, Vallo della Lucania', Categoria: 'Diritto Immobiliare', Note: 'Abuso edilizio contestato — istanza di sanatoria.', contatti: [['Geom. Luigi Cammarano', 'l.cammarano@edilcilento.it', '3397712345']] },
];

const existingClienti = await db.query('Clienti');
const C = {};
let nuoviClienti = 0;
for (const [i, raw] of CLIENTI.entries()) {
  const { contatti, ...c } = raw;
  const found = existingClienti.find((x) => x.Nome === c.Nome);
  if (found) { C[c.Nome] = found; continue; }
  const author = pick(i);
  const doc = await db.add('Clienti', { ...c, Telefono: Number.parseInt(c.Telefono.replace(/\D/g, ''), 10), Caso_Aperto: i % 3 !== 1 });
  C[c.Nome] = doc;
  nuoviClienti++;
  const h = 900 - i * 50;
  await log(`Creazione del documento cliente di ${c.Nome}`, author, { Cliente: doc.path }, h);
  await createEntityFolder({ titolo: `Cartella di ${c.Nome}`, tipo: 'Cliente', cliente: doc.path });
  await log(`Creazione della cartella per il cliente ${c.Nome}`, author, { Cliente: doc.path }, h - 0.1);
  for (const [Nome, Email, Telefono] of contatti) {
    await db.add(`${doc.path}/Contatti`, { Nome, Email, Telefono, Data_Creazione: ago(h - 2) });
    await log(`Creazione del documento contatto: ${Nome} per il cliente ${c.Nome}`, author, { Cliente: doc.path }, h - 2);
  }
}
if (!nuoviClienti) {
  console.log('I dati demo estesi sono già presenti: nulla da fare.');
  await db.close();
  process.exit(0);
}
const old = Object.fromEntries(existingClienti.map((c) => [c.Nome, c]));
const cli = (n) => (C[n] ?? old[n]).path;

/* ------------------------------------------------------------ consulenze */

const CONSULENZE = [
  ['Hotel Costa d\'Amalfi S.r.l.', 'Contratti con tour operator 2027', 'Revisione dei contratti di allotment con tour operator tedeschi e clausole di release.', -25, 'lb', ['fr']],
  ['Hotel Costa d\'Amalfi S.r.l.', 'Recensioni diffamatorie online', 'Richiesta di rimozione di recensioni false su portali di prenotazione e valutazione azioni.', -8, 'fr', []],
  ['Officine Meccaniche Sarno S.p.A.', 'Accordo aziendale sullo smart working', 'Redazione dell\'accordo con le RSU per il lavoro agile degli impiegati tecnici.', -40, 'me', ['dc']],
  ['Officine Meccaniche Sarno S.p.A.', 'Modello organizzativo 231', 'Aggiornamento del MOG 231 per reati ambientali e sicurezza sul lavoro.', -60, 'gs', ['me', 'lb']],
  ['Pasticceria Pantaleone', 'Contratto di franchising', 'Redazione del contratto di affiliazione commerciale e del manuale operativo.', -18, 'lb', []],
  ['Agricola Valle del Sele', 'Accertamento accise gasolio agricolo', 'Analisi dell\'avviso di accertamento e valutazione dell\'adesione o del ricorso.', -12, 'dc', ['gs']],
  ['Fondazione Ravello Musica', 'Iscrizione al RUNTS', 'Adeguamento statutario al Codice del Terzo Settore e iscrizione al registro unico.', -30, 'gs', []],
  ['Lumen Design S.r.l.', 'Tutela del design comunitario', 'Deposito dei disegni comunitari per la nuova collezione e strategia anti-contraffazione.', -22, 'fr', ['lb']],
  ['Logistica Tirrenica S.r.l.', 'Due diligence appalti di manodopera', 'Verifica della genuinità degli appalti di facchinaggio dopo l\'ispezione INL.', -6, 'me', []],
  ['Farmacia Del Corso', 'Apertura parafarmacia online', 'Requisiti per la vendita online di SOP e OTC e informativa e-commerce.', -3, 'lb', ['fr']],
];
const K = {};
for (const [i, [cl, Titolo, Descrizione, start, av, sup]] of CONSULENZE.entries()) {
  const h = 600 - i * 40;
  const doc = await db.add('Consulenze', {
    Cliente: cli(cl), Titolo, Descrizione, Avvocato_Principale: U[av], Avvocati_Supporto: sup.map((s) => U[s]),
    Data_Creazione: ago(h), Data_Inizio: it(inDays(start)),
  });
  K[Titolo] = doc;
  await log(`Creazione del documento consulenza: ${Titolo}`, U[av], { Consulenza: doc.path }, h);
  await createEntityFolder({ titolo: `Cartella per ${Titolo}`, tipo: 'Consulenza', consulenza: doc.path, cliente: cli(cl) });
}

/* ------------------------------------------------------------ casi */

const CASI = [
  ['Studio Dentistico Galdi', 'Responsabilità medica — paziente Lombardi', 'Diritto Civile', 'Difesa in giudizio per presunto errore in implantologia; CTU medico-legale in corso.', -120, 40, 'gs', ['fr']],
  ['Marco Pellegrino', 'Procedimento penale omesso versamento IVA', 'Diritto Penale', 'Art. 10-ter D.Lgs. 74/2000; valutazione del pagamento del debito per la causa di non punibilità.', -45, 18, 'dc', []],
  ['Giulia e Roberto Cantalupo', 'Adozione internazionale — Colombia', 'Diritto di Famiglia', 'Assistenza nella procedura con l\'ente autorizzato e il Tribunale per i Minorenni di Salerno.', -200, 120, 'lb', []],
  ['Agricola Valle del Sele', 'Ricorso avviso di accertamento IRES 2022', 'Diritto Tributario', 'Ricorso alla Corte di giustizia tributaria di primo grado di Salerno.', -30, 9, 'dc', ['gs']],
  ['Lumen Design S.r.l.', 'Contraffazione lampada "Aurora"', 'Propietà Intellettuale', 'Ricorso cautelare per inibitoria e sequestro contro venditori su marketplace.', -14, 3, 'fr', ['lb']],
  ['Condominio Parco Arbostella', 'ATP infiltrazioni box interrati', 'Diritto Immobiliare', 'Accertamento tecnico preventivo ex art. 696-bis c.p.c. contro l\'impresa costruttrice.', -75, 30, 'gs', ['me']],
  ['Vincenzo Esposito', 'Risarcimento sinistro stradale SS18', 'Diritto Civile', 'Lesioni personali con postumi permanenti al 9%; negoziazione assistita con la compagnia.', -50, 21, 'me', []],
  ['Antonio Russo', 'Truffa online — falso trading', 'Diritto Penale', 'Costituzione di parte civile; recupero delle somme bonificate su conti esteri.', -20, 60, 'dc', ['fr']],
  ['Edil Cilento S.n.c.', 'Sanatoria abuso edilizio Vallo della Lucania', 'Altro', 'Istanza di accertamento di conformità e ricorso al TAR contro l\'ordinanza di demolizione.', -90, -4, 'me', ['gs']],
];
const S = {};
for (const [i, [cl, Titolo, Area_Pratica, Descrizione, start, scad, av, sup]] of CASI.entries()) {
  const h = 700 - i * 45;
  const doc = await db.add('Casi', {
    Titolo, Cliente: cli(cl), Area_Pratica, Descrizione, Avvocato_Principale: U[av], Avvovati_Supporto: sup.map((s) => U[s]),
    Data_Creazione: ago(h), Data_Inizio: it(inDays(start)), Scadenza: it(inDays(scad)),
  });
  S[Titolo] = doc;
  const folder = await createEntityFolder({ titolo: `Cartella del caso: ${Titolo}`, tipo: 'caso', cliente: cli(cl), caso: doc.path });
  if (i % 2 === 0 && folder?.path) {
    await createSubfolder({ tipo: 'Caso', caso: doc.path, folderPadre: folder.path, titolo: 'Atti di parte' });
    await createSubfolder({ tipo: 'Caso', caso: doc.path, folderPadre: folder.path, titolo: 'Provvedimenti del giudice' });
  }
}
const CONTATTI_CASO = [
  ['Responsabilità medica — paziente Lombardi', 'Avv. Paola Sessa (controparte)', 'p.sessa@avvocatisalerno.it', '089 241 5566'],
  ['Responsabilità medica — paziente Lombardi', 'Prof. Enrico Marra (CTP medico-legale)', 'e.marra@medicinalegale.it', '3395566001'],
  ['Contraffazione lampada "Aurora"', 'Investigatore Sergio Bove', 's.bove@agenziabove.it', '3471200345'],
  ['ATP infiltrazioni box interrati', 'Ing. Fabio De Rosa (CTU)', 'fabio.derosa@ingpec.eu', '3386655441'],
  ['Risarcimento sinistro stradale SS18', 'Liquidatore Generali — Dott. Mauro Elia', 'sinistri.salerno@generali.it', '089 220 1100'],
];
for (const [caso, Nome, Email, Telefono] of CONTATTI_CASO) {
  await db.add(`${S[caso].path}/Contatti_Caso`, { Nome, Email, Telefono, Data_Creazione: ago(100) });
  await log(`Creazione del documento contatto: ${Nome}`, U.gs, { Caso: S[caso].path }, 99);
}

/* ------------------------------------------------------------ note con allegati */

const allegato = async (Nome, text, Tipo = 'text/plain') => {
  const buffer = Buffer.from(text, 'utf8');
  const { url } = await uploadFile({ buffer, originalName: Nome, contentType: Tipo });
  return { Nome, File: url, Tipo, Dimensione: buffer.length };
};
const NOTE = [
  ['Clienti', C['Hotel Costa d\'Amalfi S.r.l.'], 'Riunione con la direzione', 'Discussi i rinnovi dei contratti con i tour operator e il problema delle recensioni false su TripAdvisor. Il direttore chiede una diffida entro fine mese.', 'lb', [['Appunti_riunione_direzione.txt', 'Presenti: direttore Gianluca Fusco, rag. Teresa Amodio. Temi: allotment TUI e DER Touristik, release a 21 giorni, overbooking di agosto, recensioni anonime che citano cimici nelle camere (falso, disinfestazione certificata a maggio).']]],
  ['Clienti', C['Marco Pellegrino'], 'Primo colloquio', 'Il cliente dichiara un debito IVA di 312.000 euro relativo al 2023. Valutare la rateizzazione con l\'Agenzia delle Entrate prima dell\'apertura del dibattimento.', 'dc', []],
  ['Clienti', C['Officine Meccaniche Sarno S.p.A.'], 'Sopralluogo in stabilimento', 'Visitato il reparto verniciatura. Necessario aggiornare il DVR e la valutazione del rischio chimico prima dell\'audit 231.', 'me', [['Checklist_sopralluogo.csv', 'Area;Rischio;Priorità\nVerniciatura;Esposizione a solventi;Alta\nSaldatura;Fumi metallici;Media\nMagazzino;Movimentazione carichi;Media\nUffici;Videoterminali;Bassa']]],
  ['Consulenze', K['Contratto di franchising'], 'Bozza royalties', 'Proposta: fee d\'ingresso 25.000 euro, royalty del 4% sul fatturato, contributo marketing 1%. Esclusiva territoriale per comune.', 'lb', [['Simulazione_royalties.csv', 'Anno;Fatturato punto vendita;Royalty 4%;Marketing 1%\n2027;480000;19200;4800\n2028;560000;22400;5600\n2029;610000;24400;6100']]],
  ['Consulenze', K['Accertamento accise gasolio agricolo'], 'Documenti richiesti al commercialista', 'Servono i libretti UMA 2022, le fatture di acquisto del gasolio e il registro di carico e scarico.', 'dc', []],
  ['Consulenze', K['Modello organizzativo 231'], 'Verbale Organismo di Vigilanza', 'L\'OdV ha segnalato la mancata formazione dei preposti. Programmare il corso entro novembre.', 'gs', [['Verbale_OdV_settembre.txt', 'Organismo di Vigilanza — riunione del 22 settembre 2026. Presidente avv. Santaniello. Rilievi: formazione preposti non completata (art. 37 D.Lgs. 81/2008); procedura rifiuti speciali CER 08 01 11 da aggiornare; flussi informativi trimestrali regolari.']]],
  ['Casi', S['Responsabilità medica — paziente Lombardi'], 'Esito CTU', 'Il CTU riconosce un danno biologico del 4% ma esclude il nesso causale per la perimplantite. Valutare proposta transattiva.', 'gs', [['Sintesi_CTU.txt', 'Consulenza tecnica d\'ufficio — dott. Raffaele Nappi. Conclusioni: impianto in sede 3.6 correttamente posizionato; perimplantite riconducibile a scarsa igiene orale della paziente; danno biologico 4% per parestesia transitoria del nervo alveolare.']]],
  ['Casi', S['Contraffazione lampada "Aurora"'], 'Acquisti di prova', 'Effettuati tre acquisti di prova su Amazon ed eBay: i prodotti riportano il marchio contraffatto e sono spediti da Shenzhen.', 'fr', []],
  ['Casi', S['Truffa online — falso trading'], 'Ricostruzione dei bonifici', 'Il cliente ha versato 48.500 euro in sei bonifici verso conti lituani e ciprioti tra marzo e giugno.', 'dc', [['Elenco_bonifici.csv', 'Data;Importo;IBAN beneficiario;Causale\n04/03/2026;2500;LT12 3250 0...;Deposito piattaforma\n18/03/2026;6000;LT12 3250 0...;Upgrade conto gold\n02/04/2026;10000;CY17 0020 0...;Sblocco profitti\n20/04/2026;12000;CY17 0020 0...;Tassa di prelievo\n15/05/2026;9000;CY17 0020 0...;Antiriciclaggio\n10/06/2026;9000;LT44 7300 0...;Commissione finale']]],
  ['Casi', S['Sanatoria abuso edilizio Vallo della Lucania'], 'Udienza TAR rinviata', 'Il TAR Salerno ha rinviato la camera di consiglio; sospensiva concessa fino alla decisione sull\'istanza di accertamento di conformità.', 'me', []],
];
const NOTA_SUB = { Clienti: 'Note_Cliente', Consulenze: 'Note_Consulenza', Casi: 'Note_Caso' };
const NOTA_LABEL = { Clienti: (d) => `il cliente ${d.Nome}`, Consulenze: (d) => `la consulenza ${d.Titolo}`, Casi: (d) => `il caso ${d.Titolo}` };
for (const [i, [col, parent, Titolo, Descrizione, av, files]] of NOTE.entries()) {
  const Allegati = [];
  for (const [n, t] of files) Allegati.push(await allegato(n, t, n.endsWith('.csv') ? 'text/csv' : 'text/plain'));
  const nota = await db.add(`${parent.path}/${NOTA_SUB[col]}`, { Titolo, Descrizione, Data_Creazione: ago(80 - i * 6), Utente: U[av], Allegati });
  await indexAllegati(nota.path, Allegati);
  const link = col === 'Clienti' ? { Cliente: parent.path } : col === 'Consulenze' ? { Consulenza: parent.path } : { Caso: parent.path };
  await log(`Creazione della nota “${Titolo}” per ${NOTA_LABEL[col](parent)}`, U[av], link, 80 - i * 6);
}

/* ------------------------------------------------------------ file nelle cartelle dei nuovi clienti */

const nuoviFile = [];
for (const [nome, file, text] of [
  ['Officine Meccaniche Sarno S.p.A.', 'Accordo_smart_working_bozza.txt', 'ACCORDO AZIENDALE SUL LAVORO AGILE. Destinatari: impiegati tecnici e amministrativi. Due giornate settimanali di lavoro da remoto, fascia di disconnessione dalle 19:00 alle 8:00, buono pasto riconosciuto anche nelle giornate agili, dotazione di notebook aziendale.'],
  ['Hotel Costa d\'Amalfi S.r.l.', 'Diffida_recensioni_false.txt', 'Oggetto: diffida alla pubblicazione di recensioni false e lesive. Le recensioni pubblicate tra il 3 e il 19 agosto 2026 dall\'utente "viaggiatore_deluso88" contengono affermazioni non veritiere sulla presenza di cimici da letto, smentite dal certificato di disinfestazione della ditta Igiene Sud del 12 maggio 2026.'],
  ['Condominio Parco Arbostella', 'Relazione_tecnica_infiltrazioni.txt', 'Relazione tecnica di parte — infiltrazioni nei box interrati della scala C. Causa probabile: assenza della guaina bentonitica sul muro contro terra e pendenze errate della rampa carrabile. Costo stimato degli interventi: 146.000 euro.'],
]) {
  const root = await findClienteRootFolder(cli(nome));
  if (!root) continue;
  const buffer = Buffer.from(text, 'utf8');
  const { url } = await uploadFile({ buffer, originalName: file, contentType: 'text/plain' });
  nuoviFile.push(await db.add('Files', { Nome: file, Data_Caricamento: ago(40), File: url, Folder_Ref: root }));
}
await indexFiles(nuoviFile);

/* ------------------------------------------------------------ agenda */

const PROMEMORIA = [
  [zack, 'Preparare memoria difensiva Galdi', 'Replica alla CTU entro il termine assegnato dal giudice.', 0, '15:00', null],
  [zack, 'Telefonare al cliente Pellegrino', 'Aggiornarlo sulla rateizzazione del debito IVA.', 1, '10:30', null],
  [zack, 'Verificare deposito disegni comunitari', 'Controllare lo stato del deposito su EUIPO per Lumen Design.', 2, '09:00', 'Tutela del design comunitario'],
  [zack, 'Scadenza ricorso tributario', 'Ultimo giorno per notificare il ricorso alla Agricola Valle del Sele.', 9, '12:00', 'Accertamento accise gasolio agricolo'],
  [zack, 'Inviare bozza franchising', 'Mandare al cliente la versione 2 del contratto.', 4, '17:00', 'Contratto di franchising'],
  [zack, 'Rinnovo abbonamento banca dati giuridica', '', 14, '09:30', null],
  [zack, 'Controllare PEC tribunale', 'Comunicazioni di cancelleria della settimana.', -1, '08:45', null],
  [U.gs, 'Riunione OdV 231', 'Convocare l\'Organismo di Vigilanza delle Officine Sarno.', 6, '11:00', 'Modello organizzativo 231'],
  [U.lb, 'Richiamare tour operator TUI', 'Chiarire la clausola di release a 21 giorni.', 2, '16:00', 'Contratti con tour operator 2027'],
  [U.fr, 'Deposito ricorso cautelare Aurora', '', 1, '09:00', null],
  [U.dc, 'Raccogliere libretti UMA', '', 3, '10:00', 'Accertamento accise gasolio agricolo'],
  [U.me, 'Sopralluogo magazzino portuale', 'Con il CFO di Logistica Tirrenica.', 5, '14:30', 'Due diligence appalti di manodopera'],
];
for (const [Utente, Titolo, Descrizione, d, ora, k] of PROMEMORIA) {
  if (!Utente) continue;
  const cons = k ? K[k] : null;
  await db.add('Promemoria', { Data_Creazione: ago(30), Titolo, Descrizione, Data_Promemoria: it(inDays(d)), Ora_Promemoria: ora, Utente, ...(cons ? { Consulenza_Ref: cons.path } : {}) });
  await log(cons ? `Creazione di un nuovo promemoria per la Consulenza ${cons.Titolo}` : `Creazione del documento promemoria: ${Titolo}`, Utente, cons ? { Consulenza: cons.path } : {}, 30);
}

const APPUNTAMENTI = [
  [zack, 'Udienza Galdi — Tribunale di Salerno', 'Discussione sulla CTU e tentativo di conciliazione.', 'Cittadella Giudiziaria, Aula 12', 0, '09:30', null],
  [zack, 'Incontro con Hotel Costa d\'Amalfi', 'Firma del mandato per la diffida.', 'Amalfi — sede dell\'hotel', 1, '15:00', 'Recensioni diffamatorie online'],
  [zack, 'Call con Lumen Design', 'Strategia sui marketplace.', 'Videochiamata Teams', 2, '11:00', 'Tutela del design comunitario'],
  [zack, 'Firma contratto di franchising', '', 'Studio — Sala riunioni', 7, '17:30', 'Contratto di franchising'],
  [zack, 'Commissione tributaria — Valle del Sele', 'Udienza di trattazione.', 'Corte di giustizia tributaria, Via Arce', 16, '10:00', 'Accertamento accise gasolio agricolo'],
  [zack, 'Colloquio con Antonio Russo', 'Raccolta documenti per la costituzione di parte civile.', 'Studio', -2, '18:00', null],
  [zack, 'Riunione RSU Officine Sarno', 'Presentazione bozza accordo smart working.', 'Sarno — sala mensa', 3, '14:00', 'Accordo aziendale sullo smart working'],
  [zack, 'Pranzo di lavoro con commercialista Landi', '', 'Ristorante Il Brigantino, Salerno', -6, '13:00', null],
  [U.gs, 'Assemblea Condominio Parco Arbostella', 'Relazione sull\'ATP.', 'Sala condominiale, Via Arbostella', 4, '19:00', null],
  [U.lb, 'Incontro Fondazione Ravello Musica', 'Modifiche statutarie per il RUNTS.', 'Ravello — Villa Rufolo', 8, '11:30', 'Iscrizione al RUNTS'],
  [U.fr, 'Udienza cautelare contraffazione Aurora', '', 'Tribunale delle Imprese di Napoli', 10, '09:00', null],
  [U.dc, 'Interrogatorio Pellegrino', 'Assistenza all\'interrogatorio davanti al PM.', 'Procura della Repubblica di Salerno', 5, '10:00', null],
  [U.me, 'Negoziazione assistita sinistro SS18', '', 'Studio', 12, '16:00', null],
];
for (const [Utente, Titolo, Descrizione, Luogo, d, ora, k] of APPUNTAMENTI) {
  if (!Utente) continue;
  const cons = k ? K[k] : null;
  await db.add('Appuntamenti', { Titolo, Descrizione, Luogo, Data_Creazione: ago(25), Data_Appuntamento: it(inDays(d)), Ora_Appuntamento: ora, Utente, ...(cons ? { Consulenza_Ref: cons.path } : {}) });
  await log(`Appuntamento creato: ${Titolo} del ${it(inDays(d))} alle ${ora}`, Utente, cons ? { Consulenza: cons.path } : {}, 25);
}

// qualche modifica recente nel registro, per i filtri per data
for (const [i, nome] of ['Hotel Costa d\'Amalfi S.r.l.', 'Lumen Design S.r.l.', 'Logistica Tirrenica S.r.l.'].entries()) {
  await log(`Modifica del documento relativo al cliente ${nome}`, pick(i + 1), { Cliente: cli(nome) }, 2 + i * 5);
}

console.log(`Aggiunti: 2 avvocati, ${nuoviClienti} clienti, ${CONSULENZE.length} consulenze, ${CASI.length} casi, ${NOTE.length} note, `
  + `${nuoviFile.length} file, ${PROMEMORIA.length} promemoria, ${APPUNTAMENTI.length} appuntamenti, ${logs} voci di registro.`);
console.log('Nuovi avvocati: f.romano@studio.it / d.coppola@studio.it (password: santaniello). Indicizzazione allegati…');
await idle();
await closeOcr();
await db.close();
