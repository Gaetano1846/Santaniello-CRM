import { db } from './api.js';

/**
 * Registro attività (collezione Activity). Titoli identici all'app originale,
 * con i soli refusi evidenti corretti ("conselenza", "Cartellla", spazio mancante).
 */
export const T = {
  creaCliente: (nome) => `Creazione del documento cliente di ${nome}`,
  creaCartellaCliente: (nome) => `Creazione della cartella per il cliente ${nome}`,
  modificaCliente: (nomeVecchio) => `Modifica del documento relativo al cliente ${nomeVecchio}`,
  creaContattoCliente: (contatto, cliente) => `Creazione del documento contatto: ${contatto} per il cliente ${cliente}`,
  creaNota: (titolo, entita) => `Creazione della nota “${titolo}” per ${entita}`,
  modificaNota: (titolo, entita) => `Modifica della nota “${titolo}” di ${entita}`,
  modificaContatto: (nome) => `Modifica del documento contatto di ${nome}`,
  creaContattoCaso: (nome) => `Creazione del documento contatto: ${nome}`,
  creaConsulenza: (titolo) => `Creazione del documento consulenza: ${titolo}`,
  creaAppuntamento: (titolo, data, ora) => `Appuntamento creato: ${titolo} del ${data} alle ${ora}`,
  creaPromemoriaConsulenza: (titolo) => `Creazione di un nuovo promemoria per la Consulenza ${titolo}`,
  creaPromemoria: (titolo) => `Creazione del documento promemoria: ${titolo}`,
  modificaPromemoria: (titolo) => `Modifica promemoria per la Consulenza ${titolo}`,
  // nuovi (l'originale non permetteva queste operazioni o non le registrava con un titolo)
  modificaPromemoriaGenerale: (titolo) => `Modifica del documento promemoria: ${titolo}`,
};

/** Crea un documento Activity { Titolo, Data: now, Utente, Cliente?, Consulenza?, Caso? } */
export function logActivity(user, titolo, { cliente, consulenza, caso } = {}) {
  return db.add('Activity', {
    Titolo: titolo,
    Data: '__now__',
    Utente: user.ref,
    ...(cliente ? { Cliente: cliente } : {}),
    ...(consulenza ? { Consulenza: consulenza } : {}),
    ...(caso ? { Caso: caso } : {}),
  });
}
