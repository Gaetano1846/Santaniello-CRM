import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { createCanvas } from '@napi-rs/canvas';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { extractStoragePathFromUrl, uploadFile } from '../services/storage.js';
import { idle, indexFiles, kick } from '../services/indexer.js';
import { closeOcr } from '../services/extract.js';

/**
 * npm run seed:documenti — popola le cartelle dei clienti demo con documenti verosimili
 * (PDF di testo, PDF scansionati, Word, Excel, CSV, testo, immagini) per provare la
 * ricerca per contenuto. I file demo già presenti ma illeggibili vengono sostituiti con
 * documenti veri; i nuovi file vengono creati una sola volta (si salta chi esiste già).
 */

const F = {
  appalto: 'FVxKNaX2R3taX-K62Lhf',
  appaltoFirmati: 'jK5K155hbZxWZMoeO3Ie',
  appaltoCorrispondenza: 'q3DLjrbfQ3CgSjFaIS4M',
  palme: '0RdniVc0KcrDGxeiL6s5',
  gdpr: 'qXJ4q_xJ3A6d57VJfQ0v',
  separazione: 'PEumW1duZSyorVDmeOzR',
  separazioneAtti: 'lHnQEV2qcj1pUmqXd6ir',
  licensing: 'ZICDX8anWZQTzSJD_6IQ',
  marchio: 'Rog-vbLUp46td3o47r8d',
  stagionali: '6A3SxkJvE5t5kRR0tFIq',
  vertenza: '6ClkussCPvXWzN0gIGEj',
};

/* ------------------------------------------------------------ contenuti */
// "# " = titolo, "## " = sottotitolo, il resto sono paragrafi

const DOCS = [
  {
    folder: F.appalto, name: 'Bozza_contratto_appalto.pdf', kind: 'pdf', date: '2026-09-29',
    text: `# CONTRATTO DI APPALTO PER LAVORI EDILI
## Bozza n. 3 — riservata, non firmare
Tra la società ROSSI COSTRUZIONI S.r.l., con sede in Salerno, Via Roma 12, P.IVA 04512870658, in persona dell'amministratore unico geom. Pasquale Rossi (di seguito "Appaltatore")
e la società IMMOBILIARE POSIDONIA S.r.l., con sede in Salerno, Via Posidonia 210, in persona del legale rappresentante dott.ssa Carmela De Luca (di seguito "Committente")
si conviene e si stipula quanto segue.
## Art. 1 — Oggetto dell'appalto
Il Committente affida all'Appaltatore, che accetta, l'esecuzione dei lavori di costruzione di un edificio residenziale di n. 24 unità abitative con autorimessa interrata, da realizzarsi nel cantiere di Via Posidonia, Salerno, foglio 14, particella 1182, secondo il progetto esecutivo redatto dall'arch. Raffaele Cuomo e il permesso di costruire n. 87/2026.
## Art. 2 — Corrispettivo
Il corrispettivo è fissato a corpo in euro 1.248.000,00 (unmilioneduecentoquarantottomila/00) oltre IVA. Il prezzo è comprensivo degli oneri per la sicurezza non soggetti a ribasso, pari a euro 37.440,00.
## Art. 3 — Pagamenti e stati di avanzamento
I pagamenti avverranno per stati di avanzamento lavori (SAL) ogni qualvolta il credito dell'Appaltatore raggiunga euro 150.000,00, al netto della ritenuta di garanzia del 5% che sarà svincolata al collaudo. Ogni pagamento è subordinato alla verifica del DURC in corso di validità.
## Art. 4 — Termini di esecuzione e penali
I lavori dovranno essere ultimati entro 540 giorni naturali e consecutivi dalla data del verbale di consegna. Per ogni giorno di ritardo sarà applicata una penale pari allo 0,5 per mille dell'importo contrattuale, fino a un massimo del 10%.
## Art. 5 — Garanzie
A garanzia dell'esatto adempimento l'Appaltatore presenta fideiussione bancaria a prima richiesta pari al 10% dell'importo contrattuale, oltre a polizza CAR (Contractor's All Risks) con massimale non inferiore a euro 2.000.000,00.
## Art. 6 — Subappalto
Il subappalto è ammesso nei limiti di legge previa autorizzazione scritta del Committente. Restano a carico dell'Appaltatore gli obblighi di solidarietà retributiva e contributiva verso i dipendenti dei subappaltatori.
## Art. 7 — Foro competente
Per ogni controversia è competente in via esclusiva il Foro di Salerno.
NOTE PER IL CLIENTE: verificare con l'ing. Gallo la clausola sulla revisione prezzi dei materiali (acciaio e calcestruzzo) prima della sottoscrizione.`,
  },
  {
    folder: F.appaltoFirmati, name: 'Contratto_firmato_2026.pdf', kind: 'scan', date: '2026-09-30',
    text: `# CONTRATTO DI APPALTO
## Esemplare firmato — Repertorio n. 4417
Salerno, 28 settembre 2026
Le parti ROSSI COSTRUZIONI S.r.l. e IMMOBILIARE POSIDONIA S.r.l. confermano integralmente il testo del contratto di appalto relativo al cantiere di Via Posidonia per un corrispettivo a corpo di euro 1.248.000,00 oltre IVA.
Viene inserita la clausola di revisione prezzi: qualora il costo dell'acciaio per cemento armato subisca una variazione superiore al 10% rispetto al prezziario regionale Campania 2026, il corrispettivo sarà adeguato per la parte eccedente.
Il verbale di consegna dei lavori è fissato per il giorno 15 ottobre 2026.
Letto, confermato e sottoscritto.
L'Appaltatore: Pasquale Rossi
Il Committente: Carmela De Luca`,
  },
  {
    folder: F.appaltoFirmati, name: 'Fideiussione_bancaria.docx', kind: 'docx', date: '2026-09-30',
    text: `# GARANZIA FIDEIUSSORIA A PRIMA RICHIESTA
## Banca Monte Pruno — Filiale di Salerno — Garanzia n. FG/2026/00873
Premesso che la ROSSI COSTRUZIONI S.r.l. ha stipulato con IMMOBILIARE POSIDONIA S.r.l. un contratto di appalto per la costruzione di un edificio residenziale in Via Posidonia, Salerno, per l'importo di euro 1.248.000,00;
che il contratto prevede la prestazione di una garanzia pari al 10% dell'importo contrattuale;
la sottoscritta Banca Monte Pruno si costituisce fideiussore nell'interesse dell'Appaltatore e a favore del Committente fino alla concorrenza massima di euro 124.800,00 (centoventiquattromilaottocento/00).
La Banca si obbliga a pagare quanto richiesto entro 15 giorni dalla semplice richiesta scritta del beneficiario, senza poter opporre alcuna eccezione e con espressa rinuncia al beneficio della preventiva escussione del debitore principale di cui all'art. 1944 c.c. e ai termini di cui all'art. 1957 c.c.
La presente garanzia ha validità fino all'emissione del certificato di collaudo e comunque non oltre il 31 dicembre 2028.
Il Direttore di Filiale — dott. Antonio Mazzeo`,
  },
  {
    folder: F.appaltoCorrispondenza, name: 'PEC_diffida_ritardo_consegna_ferro.eml', kind: 'txt', date: '2026-10-02',
    text: `From: amministrazione@pec.rossicostruzioni.it
To: ordini@pec.siderurgicameridionale.it
Subject: Diffida ad adempiere — fornitura acciaio B450C ordine n. 2026/331
Date: Fri, 2 Oct 2026 10:14:00 +0200

Spett.le Siderurgica Meridionale S.p.A.,
con la presente vi diffidiamo formalmente ad adempiere alla consegna di 42 tonnellate di barre in acciaio B450C per cemento armato, previste dall'ordine n. 2026/331 con consegna entro il 20 settembre 2026 presso il cantiere di Via Posidonia, Salerno.
Il ritardo sta causando il fermo delle lavorazioni delle fondazioni e ci espone alle penali previste dal contratto di appalto con il committente.
Ai sensi dell'art. 1454 c.c. vi assegniamo il termine di 15 giorni dal ricevimento della presente per la consegna, decorso inutilmente il quale il contratto di fornitura si intenderà risolto di diritto, con riserva di agire per il risarcimento di tutti i danni.
Distinti saluti,
geom. Pasquale Rossi — Rossi Costruzioni S.r.l.`,
  },
  {
    folder: F.appalto, name: 'Computo_metrico_estimativo.xlsx', kind: 'xlsx', date: '2026-09-25',
    sheets: [{
      name: 'Computo metrico',
      rows: [
        ['Codice', 'Descrizione lavorazione', 'U.M.', 'Quantità', 'Prezzo unitario €', 'Importo €'],
        ['E.01.010', 'Scavo di sbancamento con mezzi meccanici', 'mc', 3850, 6.8, 26180],
        ['E.03.020', 'Calcestruzzo per fondazioni C25/30', 'mc', 920, 128.5, 118220],
        ['E.04.010', 'Acciaio in barre B450C per cemento armato', 'kg', 168000, 1.42, 238560],
        ['E.07.030', 'Solaio in latero-cemento H 24 cm', 'mq', 4200, 58.3, 244860],
        ['E.09.015', 'Muratura di tamponamento in laterizio porizzato', 'mq', 3100, 46.9, 145390],
        ['E.12.040', 'Impermeabilizzazione con guaina bituminosa', 'mq', 1350, 21.4, 28890],
        ['E.15.010', 'Cappotto termico in EPS grafitato sp. 12 cm', 'mq', 2900, 62.0, 179800],
        ['E.18.020', 'Infissi in PVC con vetrocamera basso emissivo', 'mq', 610, 395.0, 240950],
        ['', 'Oneri della sicurezza non soggetti a ribasso', '', '', '', 37440],
        ['', 'TOTALE COMPUTO', '', '', '', 1260290],
      ],
    }],
  },
  {
    folder: F.palme, name: 'Ricorso_decreto_ingiuntivo_Condominio_Le_Palme.pdf', kind: 'pdf', date: '2026-08-01',
    text: `# TRIBUNALE ORDINARIO DI SALERNO
## Ricorso per decreto ingiuntivo ex artt. 633 e ss. c.p.c.
La ROSSI COSTRUZIONI S.r.l., P.IVA 04512870658, rappresentata e difesa dall'avv. Santaniello del Foro di Salerno,
CONTRO
il CONDOMINIO "LE PALME", sito in Salerno, Via Generale Clark 45, C.F. 95012340657, in persona dell'amministratore pro tempore dott. Gennaro Esposito.
## Premesso che
1) con delibera assembleare del 12 gennaio 2026 il Condominio approvava i lavori straordinari di rifacimento delle facciate e del lastrico solare, affidandoli alla ricorrente per l'importo di euro 87.450,00 IVA inclusa;
2) i lavori venivano regolarmente eseguiti e ultimati in data 30 maggio 2026, come risulta dal verbale di fine lavori sottoscritto dal direttore dei lavori ing. Marco Gallo;
3) a fronte delle fatture n. 41/2026 e n. 58/2026 il Condominio ha corrisposto soltanto un acconto di euro 20.000,00, restando debitore della somma di euro 67.450,00;
4) il credito è certo, liquido ed esigibile e fondato su prova scritta.
## Tutto ciò premesso
la ricorrente chiede che l'Ill.mo Tribunale voglia ingiungere al Condominio Le Palme il pagamento della somma di euro 67.450,00 oltre interessi moratori ex D.Lgs. 231/2002 dalla scadenza delle singole fatture al saldo, nonché spese e compensi della procedura, con clausola di provvisoria esecuzione ex art. 642 c.p.c.
Si producono: delibera assembleare, contratto, fatture, verbale di fine lavori, estratto autentico delle scritture contabili.
Salerno, 1 agosto 2026 — avv. Santaniello`,
  },
  {
    folder: F.palme, name: 'Verbale_assemblea_condominio_scansione.pdf', kind: 'scan', date: '2026-08-01',
    text: `# CONDOMINIO LE PALME — Via Generale Clark 45, Salerno
## Verbale di assemblea straordinaria del 12 gennaio 2026
L'anno 2026, il giorno 12 del mese di gennaio alle ore 18:30, presso la sala condominiale, si è riunita in seconda convocazione l'assemblea dei condomini.
Presenti 21 condomini su 32, rappresentanti 712 millesimi.
Presiede l'amministratore dott. Gennaro Esposito, segretaria la sig.ra Lucia Marino.
Punto 1: rifacimento delle facciate e impermeabilizzazione del lastrico solare.
Dopo ampia discussione l'assemblea approva il preventivo della ditta Rossi Costruzioni per euro 87.450,00 IVA inclusa, con 18 voti favorevoli pari a 640 millesimi.
Il pagamento avverrà in quattro rate trimestrali a carico dei condomini secondo la tabella millesimale A.
Punto 2: nomina del direttore dei lavori. Viene nominato l'ing. Marco Gallo.
La seduta è tolta alle ore 20:45.`,
  },
  {
    folder: F.gdpr, name: 'Registro_trattamenti_GDPR.xlsx', kind: 'xlsx', date: '2026-09-10',
    sheets: [{
      name: 'Registro art. 30',
      rows: [
        ['Trattamento', 'Finalità', 'Categorie di dati', 'Base giuridica', 'Conservazione', 'Misure di sicurezza'],
        ['Dispensazione farmaci con ricetta', 'Adempimento obblighi sanitari', 'Dati sanitari, codice fiscale', 'Art. 9.2.h GDPR', '10 anni', 'Accesso con credenziali, log'],
        ['Fidelity card', 'Programma fedeltà e sconti', 'Anagrafica, acquisti', 'Consenso', '24 mesi dall\'ultimo utilizzo', 'Pseudonimizzazione'],
        ['Telecamere videosorveglianza', 'Tutela del patrimonio', 'Immagini', 'Legittimo interesse', '72 ore', 'Cartello informativo, accordo sindacale'],
        ['Prenotazione tamponi e vaccini', 'Servizi di telemedicina', 'Dati sanitari', 'Art. 9.2.h GDPR', '5 anni', 'Cifratura del database'],
        ['Gestione del personale', 'Rapporto di lavoro', 'Dati comuni e particolari', 'Contratto e obbligo legale', '10 anni', 'Armadio chiuso a chiave'],
      ],
    }],
  },
  {
    folder: F.gdpr, name: 'Informativa_privacy_clienti_farmacia.docx', kind: 'docx', date: '2026-09-12',
    text: `# INFORMATIVA SUL TRATTAMENTO DEI DATI PERSONALI
## ai sensi degli artt. 13 e 14 del Regolamento (UE) 2016/679
Titolare del trattamento è FARMACIA DEL CORSO, Corso Vittorio Emanuele 88, Salerno, P.IVA 03398120651, nella persona del titolare dott. Vincenzo Del Corso.
Il Responsabile della protezione dei dati (DPO) è raggiungibile all'indirizzo dpo@farmaciadelcorso.it.
## Dati trattati
La farmacia tratta dati anagrafici, codice fiscale e dati relativi alla salute (categorie particolari di dati ai sensi dell'art. 9 GDPR) contenuti nelle ricette mediche, anche dematerializzate, e nel fascicolo sanitario elettronico.
## Finalità
I dati sono trattati per la dispensazione dei medicinali, la tenuta del registro degli stupefacenti, l'erogazione dei servizi di telemedicina (holter, elettrocardiogramma) e, previo consenso esplicito, per il programma fedeltà.
## Comunicazione dei dati
I dati possono essere comunicati all'ASL Salerno, al Sistema Tessera Sanitaria del Ministero dell'Economia e alla software house che gestisce il gestionale di farmacia, nominata responsabile del trattamento ex art. 28 GDPR.
## Diritti dell'interessato
L'interessato può esercitare i diritti di accesso, rettifica, cancellazione, limitazione e portabilità, nonché proporre reclamo al Garante per la protezione dei dati personali.`,
  },
  {
    folder: F.gdpr, name: 'Nomina_responsabile_trattamento_art28.pdf', kind: 'pdf', date: '2026-09-15',
    text: `# ATTO DI NOMINA A RESPONSABILE DEL TRATTAMENTO
## ex art. 28 Regolamento (UE) 2016/679
FARMACIA DEL CORSO, in qualità di Titolare del trattamento,
NOMINA
la società FARMASOFT SOLUTIONS S.r.l., con sede in Napoli, Centro Direzionale Isola G1, fornitrice del gestionale di farmacia e del servizio di backup in cloud, quale Responsabile del trattamento.
## Obblighi del Responsabile
Il Responsabile tratta i dati personali soltanto su istruzione documentata del Titolare; garantisce che le persone autorizzate siano vincolate alla riservatezza; adotta le misure di sicurezza di cui all'art. 32, tra cui cifratura AES-256 dei backup e autenticazione a due fattori; non ricorre a sub-responsabili senza autorizzazione scritta.
In caso di violazione dei dati personali (data breach) il Responsabile ne dà comunicazione al Titolare senza ingiustificato ritardo e comunque entro 24 ore dalla scoperta.
Al termine del contratto il Responsabile cancella o restituisce tutti i dati, salvo obblighi di conservazione di legge.
Salerno, 15 settembre 2026`,
  },
  {
    folder: F.separazioneAtti, name: 'Ricorso_separazione.pdf', kind: 'pdf', date: '2026-08-21',
    text: `# TRIBUNALE ORDINARIO DI SALERNO
## Ricorso congiunto per separazione consensuale ex art. 473-bis.51 c.p.c.
I coniugi ANNA FERRARO, nata a Salerno il 3 marzo 1986, residente in Baronissi, Via Irno 4, e GIUSEPPE MANCUSO, nato a Avellino il 19 novembre 1983,
premesso che hanno contratto matrimonio concordatario in Baronissi il 14 giugno 2012 e che dalla loro unione sono nati i figli LUCA (2014) e SOFIA (2018);
che è venuta meno la comunione materiale e spirituale tra i coniugi, rendendo intollerabile la prosecuzione della convivenza;
CHIEDONO
che il Tribunale pronunci la separazione personale alle seguenti condizioni:
## Condizioni concordate
1) I figli minori sono affidati in via condivisa a entrambi i genitori, con collocamento prevalente presso la madre.
2) La casa coniugale di Baronissi, Via Irno 4, è assegnata alla madre, che vi abiterà con i figli.
3) Il padre potrà tenere con sé i figli a fine settimana alternati, dal venerdì all'uscita da scuola alla domenica sera, e per metà delle vacanze estive e natalizie.
4) Il padre corrisponderà un assegno di mantenimento per i figli di euro 650,00 mensili, rivalutabile annualmente secondo gli indici ISTAT, oltre al 50% delle spese straordinarie mediche, scolastiche e sportive.
5) Nessun assegno è dovuto tra i coniugi, essendo entrambi economicamente autosufficienti.
6) Il mutuo sulla casa coniugale presso Banca Monte Pruno continuerà a essere pagato in parti uguali.
Baronissi, 21 agosto 2026`,
  },
  {
    folder: F.separazioneAtti, name: 'Accordi_economici.xlsx', kind: 'xlsx', date: '2026-08-20',
    sheets: [{
      name: 'Prospetto economico',
      rows: [
        ['Voce', 'Importo mensile €', 'A carico di', 'Note'],
        ['Assegno mantenimento figli Luca e Sofia', 650, 'Giuseppe Mancuso', 'Rivalutazione ISTAT annuale'],
        ['Rata mutuo casa coniugale', 780, 'Entrambi al 50%', 'Banca Monte Pruno, scadenza 2041'],
        ['Retta scuola di musica Sofia', 90, 'Entrambi al 50%', 'Spesa straordinaria concordata'],
        ['Abbonamento piscina Luca', 55, 'Entrambi al 50%', 'Spesa straordinaria concordata'],
        ['Reddito netto Anna Ferraro', 1850, '', 'Impiegata ASL Salerno'],
        ['Reddito netto Giuseppe Mancuso', 2420, '', 'Agente di commercio'],
      ],
    }],
  },
  {
    folder: F.separazione, name: 'Certificato_stato_famiglia.jpg', kind: 'jpg', date: '2026-08-18',
    text: `# COMUNE DI BARONISSI
## Ufficio Anagrafe — Certificato di stato di famiglia
Si certifica che nel registro della popolazione residente risulta iscritta la seguente famiglia, residente in Via Irno 4:
FERRARO ANNA — intestataria scheda — nata a Salerno il 03/03/1986
MANCUSO GIUSEPPE — coniuge — nato ad Avellino il 19/11/1983
MANCUSO LUCA — figlio — nato a Salerno il 07/05/2014
MANCUSO SOFIA — figlia — nata a Salerno il 22/09/2018
Si rilascia in carta libera per uso giudiziario.
Baronissi, 18 agosto 2026 — L'Ufficiale d'Anagrafe`,
  },
  {
    folder: F.licensing, name: 'Contratto_licenza_software_SaaS.docx', kind: 'docx', date: '2026-09-05',
    text: `# CONTRATTO DI LICENZA D'USO SOFTWARE IN MODALITÀ SaaS
## TechNova S.p.A. — Gestionale "NovaERP Cloud"
Tra TECHNOVA S.p.A., con sede in Milano, Via Tortona 25, P.IVA 09876540121 ("Licenziante") e il Cliente indicato nell'ordine di acquisto ("Licenziatario").
## 1. Oggetto
Il Licenziante concede al Licenziatario una licenza d'uso non esclusiva e non trasferibile del software gestionale NovaERP Cloud, fruito in modalità Software as a Service, per il numero di utenti nominativi indicato nell'ordine.
## 2. Livelli di servizio (SLA)
Il Licenziante garantisce una disponibilità del servizio pari al 99,7% su base mensile. In caso di mancato rispetto è riconosciuto un credito di servizio pari al 5% del canone mensile per ogni 0,5% di indisponibilità ulteriore.
## 3. Proprietà intellettuale e codice sorgente
Il software, il codice sorgente e la documentazione restano di proprietà esclusiva del Licenziante. È vietata la decompilazione e il reverse engineering salvo i limiti inderogabili dell'art. 64-quater della legge sul diritto d'autore. Il codice sorgente è depositato presso un agente di escrow e sarà rilasciato al Licenziatario in caso di fallimento o cessazione dell'attività del Licenziante.
## 4. Canone
Il canone annuo è di euro 180,00 per utente, fatturato anticipatamente, con adeguamento ISTAT dal secondo anno.
## 5. Limitazione di responsabilità
La responsabilità complessiva del Licenziante è limitata all'importo dei canoni corrisposti nei dodici mesi precedenti l'evento, salvo dolo o colpa grave.
## 6. Legge applicabile
Il contratto è regolato dalla legge italiana. Foro esclusivo di Milano.`,
  },
  {
    folder: F.marchio, name: 'Atto_opposizione_EUIPO_marchio_NOVATECH.pdf', kind: 'pdf', date: '2026-07-02',
    text: `# NOTICE OF OPPOSITION — ATTO DI OPPOSIZIONE
## Ufficio dell'Unione Europea per la Proprietà Intellettuale (EUIPO) — Alicante
Opponente: TECHNOVA S.p.A., Via Tortona 25, Milano, titolare del marchio dell'Unione europea denominativo "TECHNOVA" n. 018234567, registrato per le classi 9 e 42 della Classificazione di Nizza.
Domanda contestata: marchio figurativo "NOVATECH" n. 019876543, depositato da NovaTech Solutions GmbH, Monaco di Baviera, per prodotti e servizi delle classi 9, 38 e 42.
## Motivi dell'opposizione
L'opposizione è fondata sull'art. 8, paragrafo 1, lettera b), del Regolamento (UE) 2017/1001 (RMUE): sussiste un rischio di confusione per il pubblico, inclusivo del rischio di associazione, data la somiglianza visiva, fonetica e concettuale tra i segni, composti dagli stessi elementi "TECH" e "NOVA" in ordine invertito, e l'identità dei servizi di software as a service e di progettazione di programmi per elaboratore.
In via subordinata si invoca l'art. 8, paragrafo 5, RMUE per la notorietà acquisita dal marchio anteriore in Italia, documentata da fatturato, investimenti pubblicitari e sondaggi di mercato.
## Richieste
Si chiede il rigetto integrale della domanda di marchio n. 019876543 e la condanna della richiedente alle spese della procedura.
Termine di cooling-off: 2 settembre 2026. Termine per il deposito di fatti e prove: 14 novembre 2026.`,
  },
  {
    folder: F.marchio, name: 'Ricerca_anteriorita_marchi.csv', kind: 'txt', date: '2026-06-20',
    text: `Marchio;Numero;Titolare;Ufficio;Classi;Stato;Somiglianza
TECHNOVA;018234567;TechNova S.p.A.;EUIPO;9, 42;Registrato;Marchio anteriore dell'opponente
NOVATECH;019876543;NovaTech Solutions GmbH;EUIPO;9, 38, 42;Domanda pubblicata;Alta
NOVA-TEK;302021000123;Novatek Elettronica S.r.l.;UIBM;9;Registrato;Media
TECNOVA;1456789;Tecnova Ingenieria S.L.;WIPO;37, 42;Registrato;Media
NEOTECH;018765432;Neotech Labs Oy;EUIPO;42;Registrato;Bassa`,
  },
  {
    folder: F.stagionali, name: 'Contratto_lavoro_stagionale_modello.docx', kind: 'docx', date: '2026-04-10',
    text: `# CONTRATTO DI LAVORO SUBORDINATO A TEMPO DETERMINATO PER ATTIVITÀ STAGIONALE
## Caseificio Fratelli Amato — SS18 km 92, Paestum
Il CASEIFICIO FRATELLI AMATO, P.IVA 05566770654, assume il/la sig./sig.ra ____________ con contratto a tempo determinato per attività stagionale ai sensi dell'art. 21, comma 2, D.Lgs. 81/2015, connesso all'incremento della produzione di mozzarella di bufala campana DOP nel periodo estivo.
## Durata
Dal 1 maggio 2026 al 30 settembre 2026. Il contratto non è soggetto al limite di durata di 24 mesi né all'obbligo di causale, trattandosi di attività stagionale.
## Mansioni e inquadramento
Addetto alla filatura e al confezionamento, livello 6 del CCNL Industria Alimentare. Periodo di prova: 15 giorni di effettivo lavoro.
## Orario e retribuzione
Orario settimanale di 40 ore su sei giorni, con turni a partire dalle ore 5:00. Retribuzione lorda mensile come da tabelle del CCNL, oltre ratei di tredicesima, quattordicesima e TFR.
## Diritto di precedenza
Il lavoratore ha diritto di precedenza nelle assunzioni a termine per le medesime attività stagionali, a condizione che manifesti la propria volontà per iscritto entro tre mesi dalla cessazione del rapporto.
## Sicurezza e HACCP
Il lavoratore riceverà la formazione sulla sicurezza ai sensi del D.Lgs. 81/2008 e la formazione igienico-sanitaria HACCP prima dell'inizio delle lavorazioni.`,
  },
  {
    folder: F.vertenza, name: 'Lettera_impugnazione_licenziamento.pdf', kind: 'scan', date: '2026-09-16',
    text: `# Raccomandata A/R — anticipata via PEC
Spett.le Caseificio Fratelli Amato, SS18 km 92, Paestum
Oggetto: impugnazione del licenziamento del sig. Mario Iannone
Il sottoscritto Mario Iannone, assistito dalla FLAI CGIL di Salerno, impugna ai sensi dell'art. 6 della legge 604/1966 il licenziamento intimato con lettera del 31 agosto 2026, per mancanza di giusta causa e di giustificato motivo.
Il recesso è avvenuto prima della scadenza del termine del contratto stagionale fissata al 30 settembre 2026, senza alcuna contestazione disciplinare preventiva ai sensi dell'art. 7 dello Statuto dei Lavoratori.
Si contesta inoltre il mancato pagamento di 96 ore di lavoro straordinario prestate nei mesi di luglio e agosto 2026.
Si chiede l'attivazione del tentativo di conciliazione in sede sindacale e il pagamento delle retribuzioni fino alla scadenza naturale del contratto.
Capaccio Paestum, 10 settembre 2026 — Mario Iannone`,
  },
  {
    folder: F.vertenza, name: 'Prospetto_ore_straordinario_Iannone.xlsx', kind: 'xlsx', date: '2026-09-18',
    sheets: [{
      name: 'Straordinari',
      rows: [
        ['Mese', 'Settimana', 'Ore ordinarie', 'Ore straordinario', 'Turno', 'Firma caporeparto'],
        ['Luglio 2026', '1', 40, 10, 'Filatura 5:00-14:00', 'Sì'],
        ['Luglio 2026', '2', 40, 12, 'Filatura 5:00-14:00', 'Sì'],
        ['Luglio 2026', '3', 40, 14, 'Confezionamento', 'No'],
        ['Luglio 2026', '4', 40, 11, 'Confezionamento', 'No'],
        ['Agosto 2026', '1', 40, 15, 'Filatura 5:00-14:00', 'Sì'],
        ['Agosto 2026', '2', 40, 18, 'Filatura (Ferragosto)', 'No'],
        ['Agosto 2026', '3', 40, 16, 'Filatura 5:00-14:00', 'Sì'],
        ['', 'Totale', 280, 96, '', ''],
      ],
    }],
  },
  {
    folder: F.vertenza, name: 'Verbale_conciliazione_sindacale.txt', kind: 'txt', date: '2026-09-25',
    text: `VERBALE DI CONCILIAZIONE IN SEDE SINDACALE
ai sensi degli artt. 410 e 411 c.p.c.

In data 25 settembre 2026, presso la sede della FLAI CGIL di Salerno, sono comparsi:
- il sig. Mario Iannone, assistito dal rappresentante sindacale sig. Francesco Pepe;
- il Caseificio Fratelli Amato, in persona del socio sig. Antonio Amato, assistito dall'avv. Santaniello.

Le parti, al fine di evitare il giudizio, convengono quanto segue:
1. Il Caseificio corrisponde al sig. Iannone, a titolo di incentivo all'esodo e transazione generale novativa, la somma lorda di euro 4.800,00 entro il 15 ottobre 2026 mediante bonifico.
2. La somma comprende il pagamento delle ore di straordinario rivendicate e le retribuzioni fino alla scadenza del contratto stagionale.
3. Il sig. Iannone rinuncia all'impugnazione del licenziamento e a ogni ulteriore pretesa derivante dal rapporto di lavoro.
4. Il Caseificio rilascia attestazione utile all'esercizio del diritto di precedenza per la stagione 2027.

Letto, confermato e sottoscritto.`,
  },
];

/* ------------------------------------------------------------ PDF di testo */

/** Codifica WinAnsi (Helvetica standard): lettere accentate e simboli comuni */
const WIN = { '€': 0x80, '’': 0x92, '‘': 0x91, '“': 0x93, '”': 0x94, '–': 0x96, '—': 0x97, '…': 0x85 };
function pdfStr(s) {
  const bytes = [];
  for (const ch of s) {
    const c = WIN[ch] ?? ch.codePointAt(0);
    const b = c <= 0xff ? c : 0x3f;
    if (b === 0x28 || b === 0x29 || b === 0x5c) bytes.push(0x5c);
    bytes.push(b);
  }
  return Buffer.from(bytes).toString('latin1');
}

function wrap(text, maxChars) {
  const out = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const w of para.split(' ')) {
      if (line && (line + ' ' + w).length > maxChars) { out.push(line); line = w; } else line = line ? `${line} ${w}` : w;
    }
    out.push(line);
  }
  return out;
}

/** Righe formattate: { text, size, bold, gap } */
function layout(text, widthChars) {
  const lines = [];
  for (const raw of text.split('\n')) {
    if (raw.startsWith('# ')) {
      for (const l of wrap(raw.slice(2), widthChars * 0.7)) lines.push({ text: l, size: 15, bold: true, center: true });
      lines.push({ text: '', size: 6 });
    } else if (raw.startsWith('## ')) {
      lines.push({ text: '', size: 4 });
      for (const l of wrap(raw.slice(3), widthChars * 0.85)) lines.push({ text: l, size: 11.5, bold: true });
    } else if (!raw.trim()) {
      lines.push({ text: '', size: 6 });
    } else {
      for (const l of wrap(raw, widthChars)) lines.push({ text: l, size: 10.5 });
      lines.push({ text: '', size: 4 });
    }
  }
  return lines;
}

/** Assembla un PDF dati gli oggetti delle pagine (contenuto + risorse) */
function buildPdf(pages) {
  const objs = [];
  const add = (body) => { objs.push(body); return objs.length; };
  const catalog = add(null);
  const pagesObj = add(null);
  const fonts = {
    F1: add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
    F2: add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'),
  };
  const kids = [];
  for (const pg of pages) {
    const xobj = pg.image ? add(pg.image) : null;
    const content = zlib.deflateSync(Buffer.from(pg.content, 'latin1'));
    const contentObj = add([`<< /Length ${content.length} /Filter /FlateDecode >>\nstream\n`, content, '\nendstream']);
    const res = `<< /Font << /F1 ${fonts.F1} 0 R /F2 ${fonts.F2} 0 R >>${xobj ? ` /XObject << /Im1 ${xobj} 0 R >>` : ''} >>`;
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 842] /Resources ${res} /Contents ${contentObj} 0 R >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

  const chunks = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  let offset = chunks[0].length;
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(offset);
    const parts = [`${i + 1} 0 obj\n`, ...(Array.isArray(body) ? body : [body]), '\nendobj\n']
      .map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p, 'latin1')));
    for (const p of parts) { chunks.push(p); offset += p.length; }
  });
  const xref = [`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
  chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${offset}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(chunks);
}

function textPdf(text) {
  const lines = layout(text, 95);
  const pages = [];
  let cur = [];
  let y = 790;
  const flush = () => { pages.push(cur); cur = []; y = 790; };
  for (const l of lines) {
    const h = l.size * 1.35;
    if (y - h < 60) flush();
    y -= h;
    if (l.text) {
      const x = l.center ? Math.max(56, 297 - l.text.length * l.size * 0.27) : 56;
      cur.push(`BT /${l.bold ? 'F2' : 'F1'} ${l.size} Tf ${x.toFixed(1)} ${y.toFixed(1)} Td (${pdfStr(l.text)}) Tj ET`);
    }
  }
  if (cur.length) flush();
  return buildPdf(pages.map((ops, i) => ({
    content: [...ops, `BT /F1 8 Tf 280 30 Td (${pdfStr(`Pagina ${i + 1} di ${pages.length}`)}) Tj ET`].join('\n'),
  })));
}

/* ------------------------------------------------------------ scansioni (immagini) */

/** Disegna il documento come un foglio scansionato: leggera rotazione, grana, toni grigi */
function renderScan(text, { width = 1240, height = 1754 } = {}) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f4f1ea';
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate(-0.006);
  ctx.translate(-width / 2, -height / 2);
  ctx.fillStyle = '#1d1d1f';
  const scale = width / 595;
  let y = 120;
  for (const l of layout(text, 78)) {
    const size = l.size * scale * 1.05;
    y += size * 1.4;
    if (!l.text) continue;
    ctx.font = `${l.bold ? 'bold ' : ''}${size.toFixed(0)}px "Times New Roman", serif`;
    const w = ctx.measureText(l.text).width;
    ctx.fillText(l.text, l.center ? (width - w) / 2 : 110, y);
  }
  ctx.restore();
  // grana della scansione
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = `rgba(0,0,0,${(rnd() * 0.18).toFixed(2)})`;
    ctx.fillRect(rnd() * width, rnd() * height, 1.3, 1.3);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.05)';
  ctx.fillRect(0, 0, 18, height);
  return canvas;
}

async function scanPdf(text) {
  const canvas = renderScan(text);
  const jpg = await canvas.encode('jpeg', 82);
  return buildPdf([{
    image: [`<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`, jpg, '\nendstream'],
    content: 'q 595 0 0 842 0 0 cm /Im1 Do Q',
  }]);
}

const scanJpg = (text) => renderScan(text, { width: 1240, height: 1240 }).encode('jpeg', 85);

/* ------------------------------------------------------------ Word ed Excel */

const xmlEsc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function docx(text) {
  const paras = text.split('\n').map((raw) => {
    const [style, t] = raw.startsWith('# ') ? ['Title', raw.slice(2)] : raw.startsWith('## ') ? ['Heading1', raw.slice(3)] : [null, raw];
    const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '';
    const rPr = style ? '<w:rPr><w:b/></w:rPr>' : '';
    return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${xmlEsc(t)}</w:t></w:r></w:p>`;
  }).join('');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function xlsx(sheets) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Studio Legale Santaniello';
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name);
    s.rows.forEach((r) => ws.addRow(r));
    ws.getRow(1).font = { bold: true };
    ws.columns.forEach((c, i) => { c.width = Math.min(48, Math.max(...s.rows.map((r) => String(r[i] ?? '').length)) + 2); });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function build(doc) {
  switch (doc.kind) {
    case 'pdf': return textPdf(doc.text);
    case 'scan': return scanPdf(doc.text);
    case 'jpg': return scanJpg(doc.text);
    case 'docx': return docx(doc.text);
    case 'xlsx': return xlsx(doc.sheets);
    default: return Buffer.from(doc.text, 'utf8');
  }
}

const MIME = {
  pdf: 'application/pdf', jpg: 'image/jpeg', txt: 'text/plain', eml: 'message/rfc822', csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/* ------------------------------------------------------------ esecuzione */

const db = await getDb();
if (db.kind !== 'postgres') {
  console.error('Lo script richiede PostgreSQL (DATABASE_URL).');
  process.exit(1);
}
const p = db.pool;
const existing = (await p.query('SELECT id, nome, file, folder_ref FROM files')).rows;

const created = [];
let replaced = 0;
for (const doc of DOCS) {
  const buffer = await build(doc);
  const ext = path.extname(doc.name).slice(1);
  const same = existing.find((f) => f.nome === doc.name && f.folder_ref === doc.folder);
  if (same) {
    // file demo esistente: si sovrascrive il contenuto e si rimette in coda
    const abs = path.join(config.uploadsDir, extractStoragePathFromUrl(same.file));
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, buffer);
    await p.query(`UPDATE documenti_testo SET stato = 'in_attesa', errore = NULL, aggiornato = now() WHERE url = $1`, [same.file]);
    replaced++;
    console.log(`  sostituito  ${doc.name}`);
    continue;
  }
  const { url } = await uploadFile({ buffer, originalName: doc.name, contentType: MIME[ext] ?? 'application/octet-stream' });
  const when = new Date(`${doc.date}T${String(9 + (created.length % 8)).padStart(2, '0')}:${String((created.length * 7) % 60).padStart(2, '0')}:00`);
  created.push(await db.add('Files', { Nome: doc.name, Data_Caricamento: when, File: url, Folder_Ref: `Folder/${doc.folder}` }));
  console.log(`  caricato    ${doc.name}`);
}

console.log(`\nNuovi documenti: ${created.length}, sostituiti: ${replaced}. Estrazione del testo in corso (l'OCR richiede qualche secondo)…`);
await indexFiles(created);
kick();
await idle();
const { rows } = await p.query('SELECT stato, count(*)::int AS n FROM documenti_testo GROUP BY stato ORDER BY stato');
for (const r of rows) console.log(`  ${r.stato.padEnd(15)} ${r.n}`);
await closeOcr();
await db.close();
