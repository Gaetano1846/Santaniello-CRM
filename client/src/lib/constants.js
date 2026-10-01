/**
 * Opzioni delle tendine dell'app originale. I valori sono dati salvati su Firestore,
 * quindi restano identici (il duplicato "Diritto Tributario" è stato rimosso dalla lista
 * visualizzata perché identico; il refuso "Propietà" è mantenuto per compatibilità dei dati).
 */
export const CATEGORIE_CLIENTE = [
  'Diritto Civile',
  'Diritto Penale',
  'Diritto Commerciale',
  'Diritto del Lavoro',
  'Diritto di Famiglia',
  'Diritto Tributario',
  'Propietà Intellettuale',
  'Diritto Immobiliare',
];

export const AREE_PRATICA = [...CATEGORIE_CLIENTE, 'Altro'];

/** Colore badge per area/categoria */
export const AREA_COLOR = {
  'Diritto Civile': 't-civile',
  'Diritto Penale': 't-penale',
  'Diritto Commerciale': 't-commerciale',
  'Diritto del Lavoro': 't-lavoro',
  'Diritto di Famiglia': 't-famiglia',
  'Diritto Tributario': 't-tributario',
  'Propietà Intellettuale': 't-ip',
  'Diritto Immobiliare': 't-immobiliare',
  Altro: 't-altro',
};
