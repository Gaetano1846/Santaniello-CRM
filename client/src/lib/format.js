/* Formattazione date/testi. Date e ore di appuntamenti, promemoria, casi e consulenze
   sono salvate come stringhe "dd/MM/yyyy" e "HH:mm" (formato dell'app originale). */

const pad = (n) => String(n).padStart(2, '0');

export const toDate = (v) => (v ? (v instanceof Date ? v : new Date(v)) : null);

/** dd/MM/yyyy */
export function fmtDate(v) {
  const d = toDate(v);
  return d && !Number.isNaN(d) ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}` : '';
}
/** dd/MM H:mm (formato usato nelle liste file/log dell'originale) */
export function fmtShort(v) {
  const d = toDate(v);
  return d && !Number.isNaN(d) ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${d.getHours()}:${pad(d.getMinutes())}` : '';
}
export function fmtDateTime(v) {
  const d = toDate(v);
  return d ? `${fmtDate(d)} · ${pad(d.getHours())}:${pad(d.getMinutes())}` : '';
}
export const fmtTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

const rtf = new Intl.RelativeTimeFormat('it', { numeric: 'auto' });
export function fmtRelative(v) {
  const d = toDate(v);
  if (!d) return '';
  const diff = (d - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return 'adesso';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), 'day');
  return fmtDate(d);
}

/** "dd/MM/yyyy" → Date | null */
export function parseItDate(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s ?? '').trim());
  if (!m) return null;
  const d = new Date(+m[3], +m[2] - 1, +m[1]);
  return Number.isNaN(d.getTime()) ? null : d;
}
/** "dd/MM/yyyy" + "HH:mm" → Date | null (come i widget calendario: ora vuota = scarta) */
export function parseItDateTime(dateStr, timeStr) {
  const d = parseItDate(dateStr);
  if (!d) return null;
  const [h, m = '0'] = String(timeStr ?? '').split(':');
  const hh = parseInt(h, 10), mm = parseInt(m, 10);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  d.setHours(hh, mm, 0, 0);
  return d;
}
/** input[type=date] "yyyy-MM-dd" ↔ "dd/MM/yyyy" */
export const isoToIt = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
export function itToIso(it) {
  const d = parseItDate(it);
  return d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : '';
}
export const dateToIt = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
export const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
export const GIORNI = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];
export const fmtLong = (d) => d.toLocaleDateString('it-IT', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });

export function initials(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** Ricerca testuale: case/accent-insensitive, tutti i termini devono comparire */
const norm = (s) => String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
export function textMatch(query, ...fields) {
  const terms = norm(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = norm(fields.join(' '));
  return terms.every((t) => hay.includes(t));
}

export function fileKind(name) {
  const ext = String(name ?? '').split('.').pop().toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'heic'].includes(ext)) return 'img';
  if (['doc', 'docx', 'odt', 'rtf', 'txt', 'pages'].includes(ext)) return 'doc';
  if (['xls', 'xlsx', 'csv', 'ods', 'numbers'].includes(ext)) return 'xls';
  return 'other';
}

export function fmtSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1).replace('.', ',')} MB`;
}
