import { getDb } from '../db/index.js';
import { parseItDate } from './dates.js';

/**
 * Porting di calcolaAppuntamentiRecenti(consulenzaRef):
 * i 2 appuntamenti più vicini (in valore assoluto) all'istante attuale, a parità di
 * distanza il meno recente per Data_Creazione. Scarta date/ore non valide.
 *
 * Nota: l'originale legge la sotto-collezione `<consulenza>/Appuntamenti`.
 * Qui interroghiamo sia quella sia la collezione principale filtrata per Consulenza_Ref,
 * dato che le pagine creano gli appuntamenti nella collezione principale.
 */
export async function calcolaAppuntamentiRecenti(consulenzaRef, now = new Date()) {
  const db = await getDb();
  const [sub, main] = await Promise.all([
    db.query(`${consulenzaRef}/Appuntamenti`).catch(() => []),
    db.query('Appuntamenti', { where: [['Consulenza_Ref', '==', consulenzaRef]] }),
  ]);
  const seen = new Set();
  const withDates = [];
  for (const a of [...sub, ...main]) {
    if (seen.has(a.path)) continue;
    seen.add(a.path);
    if (!a.Data_Appuntamento || !a.Ora_Appuntamento) continue;
    const d = parseItDate(a.Data_Appuntamento);
    const [h, m] = a.Ora_Appuntamento.split(':').map((x) => parseInt(x, 10));
    if (!d || !Number.isFinite(h) || !Number.isFinite(m)) continue;
    d.setHours(h, m, 0, 0);
    withDates.push([a, d]);
  }
  withDates.sort(([a, da], [b, dbt]) => {
    const dist = Math.abs(Math.trunc((da - now) / 6e4)) - Math.abs(Math.trunc((dbt - now) / 6e4));
    if (dist) return dist;
    const ca = a.Data_Creazione, cb = b.Data_Creazione;
    if (ca && cb) return ca - cb;
    if (ca) return -1;
    if (cb) return 1;
    return 0;
  });
  return withDates.slice(0, 2).map(([a]) => a);
}
