/**
 * Schema Firestore dell'app originale (lib/backend/schema/*.dart).
 * I nomi dei campi sono IDENTICI all'originale (compresi i refusi come "Avvovati_Supporto")
 * così il nuovo progetto legge e scrive gli stessi documenti.
 *
 * Nel codice server i riferimenti (DocumentReference) sono rappresentati come path stringa
 * ("Clienti/abc") e i timestamp come Date. Gli adapter si occupano della conversione.
 */
const NOTE = {
  fields: ['Titolo', 'Descrizione', 'Data_Creazione', 'Utente', 'Allegati'],
  refs: ['Utente'],
  refLists: [],
  dates: ['Data_Creazione'],
};

/** Collezione padre → sotto-collezione delle note */
export const NOTE_COLLECTIONS = { Clienti: 'Note_Cliente', Consulenze: 'Note_Consulenza', Casi: 'Note_Caso' };

export const schema = {
  Users: {
    fields: ['email', 'display_name', 'photo_url', 'uid', 'created_time', 'phone_number'],
    refs: [],
    refLists: [],
    dates: ['created_time'],
  },
  Clienti: {
    fields: ['Nome', 'Partita_IVA', 'Email', 'Telefono', 'indirizzo', 'Caso_Aperto', 'Categoria', 'Note'],
    refs: [],
    refLists: [],
    dates: [],
    ints: ['Telefono'],
  },
  Contatti: {
    // sotto-collezione Clienti/{id}/Contatti
    fields: ['Nome', 'Email', 'Telefono', 'Data_Creazione'],
    refs: [],
    refLists: [],
    dates: ['Data_Creazione'],
  },
  // Note con allegati (non presenti nell'app originale), sotto-collezioni di Clienti, Consulenze e Casi.
  // Allegati: [{ Nome, File (URL di download), Tipo (MIME), Dimensione (byte) }]
  Note_Cliente: NOTE,
  Note_Consulenza: NOTE,
  Note_Caso: NOTE,
  Casi: {
    fields: ['Titolo', 'Cliente', 'Area_Pratica', 'Data_Creazione', 'Avvocato_Principale', 'Avvovati_Supporto', 'Data_Inizio', 'Scadenza', 'Descrizione'],
    refs: ['Cliente', 'Avvocato_Principale'],
    refLists: ['Avvovati_Supporto'],
    dates: ['Data_Creazione'],
  },
  Contatti_Caso: {
    // sotto-collezione Casi/{id}/Contatti_Caso
    fields: ['Nome', 'Email', 'Telefono', 'Data_Creazione'],
    refs: [],
    refLists: [],
    dates: ['Data_Creazione'],
  },
  Consulenze: {
    fields: ['Cliente', 'Titolo', 'Descrizione', 'Avvocato_Principale', 'Data_Creazione', 'Data_Inizio', 'Avvocati_Supporto'],
    refs: ['Cliente', 'Avvocato_Principale'],
    refLists: ['Avvocati_Supporto'],
    dates: ['Data_Creazione'],
  },
  Folder: {
    fields: ['Titolo', 'Data_Creazione', 'Cliente', 'Consulenza', 'Parent_Folder', 'Caso', 'Array_Parents'],
    refs: ['Cliente', 'Consulenza', 'Parent_Folder', 'Caso'],
    refLists: ['Array_Parents'],
    dates: ['Data_Creazione'],
  },
  Files: {
    fields: ['Nome', 'Data_Caricamento', 'File', 'Folder_Ref'],
    refs: ['Folder_Ref'],
    refLists: [],
    dates: ['Data_Caricamento'],
  },
  VersioneFile: { fields: [], refs: [], refLists: [], dates: [] },
  Activity: {
    fields: ['Titolo', 'Data', 'Utente', 'Cliente', 'Consulenza', 'Caso'],
    refs: ['Utente', 'Cliente', 'Consulenza', 'Caso'],
    refLists: [],
    dates: ['Data'],
  },
  Promemoria: {
    fields: ['Data_Creazione', 'Titolo', 'Descrizione', 'Data_Promemoria', 'Utente', 'Ora_Promemoria', 'Consulenza_Ref'],
    refs: ['Utente', 'Consulenza_Ref'],
    refLists: [],
    dates: ['Data_Creazione'],
  },
  Appuntamenti: {
    fields: ['Titolo', 'Descrizione', 'Data_Creazione', 'Data_Appuntamento', 'Ora_Appuntamento', 'Luogo', 'Utente', 'Consulenza_Ref'],
    refs: ['Utente', 'Consulenza_Ref'],
    refLists: [],
    dates: ['Data_Creazione'],
  },
};

/** Nome della collezione (ultimo segmento dispari) da un path di collezione o documento */
export function collectionNameOf(path) {
  const parts = path.split('/').filter(Boolean);
  return parts.length % 2 === 0 ? parts[parts.length - 2] : parts[parts.length - 1];
}

export function schemaFor(path) {
  return schema[collectionNameOf(path)] ?? { fields: [], refs: [], refLists: [], dates: [] };
}
