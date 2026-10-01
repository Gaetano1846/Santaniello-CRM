/**
 * Helper date. L'app originale salva date/ore di appuntamenti, promemoria, casi e
 * consulenze come STRINGHE ("dd/MM/yyyy" e "HH:mm"): manteniamo lo stesso formato.
 */

/** "dd/MM/yyyy" → Date (mezzanotte locale) o null */
export function parseItDate(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s ?? '').trim());
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** combina "dd/MM/yyyy" + "HH:mm" */
export function parseItDateTime(dateStr, timeStr) {
  const d = parseItDate(dateStr);
  if (!d) return null;
  const [h, min] = String(timeStr ?? '').split(':').map(Number);
  if (Number.isFinite(h) && Number.isFinite(min)) d.setHours(h, min, 0, 0);
  return d;
}

/** Porting di calcolaDataRecente (custom function): sottrae 2 giorni */
export const calcolaDataRecente = (date) => new Date(date.getTime() - 2 * 864e5);
