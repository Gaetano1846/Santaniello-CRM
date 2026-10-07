import path from 'node:path';
import { createRequire } from 'node:module';

/**
 * Estrazione del testo dai documenti caricati, per la ricerca per contenuto.
 * Tutto avviene sul server, senza servizi esterni:
 * - PDF con testo → unpdf (pdf.js); pagine senza testo (scansioni) → OCR
 * - Word (.docx) → mammoth; Excel (.xlsx) → exceljs; testo semplice letto così com'è
 * - immagini (JPG, PNG, …) → OCR con Tesseract in italiano
 */

const require = createRequire(import.meta.url);

export const MAX_TEXT_CHARS = 300_000;
/** pagine dei PDF scansionati passate all'OCR (oltre si indicizza solo l'inizio) */
const MAX_OCR_PAGES = 40;
/** una pagina con meno caratteri di così è considerata un'immagine */
const MIN_PAGE_CHARS = 20;
/** un file corrotto può bloccare pdf.js: oltre questo tempo l'estrazione viene interrotta */
const TIMEOUT_MS = 10 * 60 * 1000;

const TEXT_EXT = new Set(['txt', 'md', 'csv', 'json', 'xml', 'html', 'htm', 'rtf', 'eml']);
const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'bmp', 'tif', 'tiff', 'webp', 'gif']);

export class UnsupportedError extends Error {}

const extOf = (name) => path.extname(name ?? '').slice(1).toLowerCase();

/** true se il formato è indicizzabile (gli altri vengono marcati "non supportato") */
export const isSupported = (name) => {
  const ext = extOf(name);
  return ext === 'pdf' || ext === 'docx' || ext === 'xlsx' || TEXT_EXT.has(ext) || IMAGE_EXT.has(ext);
};

/** Testo pulito: niente caratteri NUL (non ammessi da Postgres), spazi compattati, lunghezza massima */
export function cleanText(s) {
  return String(s ?? '')
    .replace(/\u0000/g, '')
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ *\n[ \n]*/g, '\n')
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

/**
 * Estrae il testo di un file.
 * @returns {Promise<{ testo: string, ocr: boolean }>}
 * @throws {UnsupportedError} se il formato non è gestito
 */
export async function extractText(buffer, name) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Tempo massimo di elaborazione superato')), TIMEOUT_MS);
  });
  try {
    const r = await Promise.race([extract(buffer, name), timeout]);
    return { ...r, testo: cleanText(r.testo) };
  } finally {
    clearTimeout(timer);
  }
}

async function extract(buffer, name) {
  const ext = extOf(name);
  if (ext === 'pdf') return extractPdf(buffer);
  if (ext === 'docx') {
    const mammoth = (await import('mammoth')).default;
    return { testo: (await mammoth.extractRawText({ buffer })).value, ocr: false };
  }
  if (ext === 'xlsx') return { testo: await extractXlsx(buffer), ocr: false };
  if (TEXT_EXT.has(ext)) return { testo: buffer.toString('utf8'), ocr: false };
  if (IMAGE_EXT.has(ext)) return { testo: await ocr([buffer]), ocr: true };
  throw new UnsupportedError(`Formato .${ext || '?'} non supportato`);
}

async function extractPdf(buffer) {
  // il controllo evita che pdf.js resti appeso su file che non sono PDF
  if (buffer.subarray(0, 1024).indexOf('%PDF') === -1) throw new Error('Il file non è un PDF valido');
  const { extractText: pdfText, getDocumentProxy, renderPageAsImage } = await import('unpdf');
  // pdf.js trasferisce il buffer che riceve: ogni chiamata ha la sua copia
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { totalPages, text: pages } = await pdfText(pdf, { mergePages: false });
  await pdf.destroy?.();

  const scanned = [];
  pages.forEach((t, i) => { if (t.trim().length < MIN_PAGE_CHARS) scanned.push(i + 1); });
  if (!scanned.length) return { testo: pages.join('\n\n'), ocr: false };

  const images = [];
  for (const n of scanned.slice(0, MAX_OCR_PAGES)) {
    images.push(Buffer.from(await renderPageAsImage(new Uint8Array(buffer), n, {
      canvasImport: () => import('@napi-rs/canvas'),
      scale: 2, // ~150 dpi su A4: buon compromesso tra precisione e tempo
    })));
  }
  const ocrText = (await ocr(images, scanned)).split('\f');
  // ricompone il documento nell'ordine delle pagine
  const out = pages.map((t, i) => {
    const k = scanned.indexOf(i + 1);
    return k === -1 ? t : (ocrText[k] ?? '');
  });
  if (totalPages > MAX_OCR_PAGES && scanned.length > MAX_OCR_PAGES) {
    console.warn(`OCR limitato alle prime ${MAX_OCR_PAGES} pagine scansionate`);
  }
  return { testo: out.join('\n\n'), ocr: true };
}

async function extractXlsx(buffer) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const lines = [];
  wb.eachSheet((sheet) => {
    lines.push(sheet.name);
    sheet.eachRow((row) => {
      const cells = [];
      row.eachCell((cell) => { const t = cell.text; if (t) cells.push(t); });
      if (cells.length) lines.push(cells.join(' '));
    });
  });
  return lines.join('\n');
}

/* ------------------------------------------------------------ OCR */

let workerPromise = null;
let idleTimer = null;

/** Un solo worker Tesseract condiviso, chiuso dopo qualche minuto di inattività */
async function getWorker() {
  clearTimeout(idleTimer);
  workerPromise ??= (async () => {
    const { createWorker } = await import('tesseract.js');
    const ita = require('@tesseract.js-data/ita');
    // modello "best_int": più preciso del modello rapido, a parità di velocità
    return createWorker('ita', 1, {
      langPath: path.join(path.dirname(ita.langPath), '4.0.0_best_int'),
      gzip: true,
      cacheMethod: 'none',
    });
  })();
  return workerPromise;
}

function scheduleIdleClose() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    const w = workerPromise;
    workerPromise = null;
    try { await (await w)?.terminate(); } catch { /* già chiuso */ }
  }, 3 * 60 * 1000);
  idleTimer.unref?.();
}

/** OCR delle immagini; il testo delle diverse immagini è separato da \f */
async function ocr(images) {
  const worker = await getWorker();
  try {
    const out = [];
    for (const img of images) out.push((await worker.recognize(img)).data.text);
    return out.join('\f');
  } catch (e) {
    // un worker in errore non va riutilizzato
    workerPromise = null;
    try { await worker.terminate(); } catch { /* ignore */ }
    throw e;
  } finally {
    scheduleIdleClose();
  }
}

/** Chiude il worker OCR (test e spegnimento) */
export async function closeOcr() {
  clearTimeout(idleTimer);
  const w = workerPromise;
  workerPromise = null;
  if (w) await (await w).terminate();
}
