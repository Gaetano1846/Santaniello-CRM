/**
 * Client HTTP + helper "stile Firestore" (i riferimenti sono path stringa: "Clienti/abc").
 */
export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

const OFFLINE = 'Impossibile contattare il server. Controlla la connessione e riprova tra qualche istante.';

/** Messaggio per gli errori senza spiegazione dal server (mai un codice nudo come "Errore 500") */
function fallbackMessage(status) {
  // 502–504, o 500 senza corpo: il server non risponde (spento, in riavvio, proxy senza backend)
  if (status >= 500) return OFFLINE;
  if (status === 401) return 'Sessione scaduta: accedi di nuovo.';
  if (status === 403) return 'Non hai i permessi per questa operazione.';
  if (status === 404) return 'Elemento non trovato.';
  if (status === 413) return 'File troppo grande.';
  if (status === 429) return 'Troppe richieste: riprova tra poco.';
  return 'Operazione non riuscita. Riprova.';
}

export async function api(path, { method = 'GET', body, form } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
  } catch {
    throw new ApiError(OFFLINE, 0);
  }
  if (res.status === 204) return null;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized();
    throw new ApiError(json.error ?? fallbackMessage(res.status), res.status);
  }
  return json;
}

const enc = (p) => p.split('/').map(encodeURIComponent).join('/');

/** Accesso dati generico, equivalente alle chiamate Firestore dell'app originale */
export const db = {
  list: (col, q) => api(`/data/${enc(col)}${q ? `?q=${encodeURIComponent(JSON.stringify(q))}` : ''}`),
  group: (name, q) => api(`/group/${name}${q ? `?q=${encodeURIComponent(JSON.stringify(q))}` : ''}`),
  get: (path) => api(`/doc/${enc(path)}`),
  add: (col, data) => api(`/data/${enc(col)}`, { method: 'POST', body: data }),
  update: (path, data) => api(`/doc/${enc(path)}`, { method: 'PATCH', body: data }),
  remove: (path) => api(`/doc/${enc(path)}`, { method: 'DELETE' }),
};

/** Operazioni composite lato server (porting delle custom action) */
export const actions = {
  search: (q) => api(`/search?q=${encodeURIComponent(q)}`),
  roots: () => api('/folders/roots'),
  clienteRoot: (cliente, create = true) => api(`/folders/cliente-root?cliente=${encodeURIComponent(cliente)}${create ? '&create=1' : ''}`),
  /** newCustomAction(titolo, consulenza, cliente, tipo, caso) */
  newCustomAction: (body) => api('/folders/entity', { method: 'POST', body }),
  /** creaSottocartella(tipo, caso, cliente, consulenza, folderPadre, titolo) */
  creaSottocartella: (body) => api('/folders/sub', { method: 'POST', body }),
  /** deleteFolderAndFilesWithSubfolders(folderRef) */
  deleteFolder: (ref) => api(`/folders/${ref.split('/').pop()}`, { method: 'DELETE' }),
  /** deleteSingleFileFinalCorrect(fileRef) */
  deleteFile: (ref) => api(`/files/${ref.split('/').pop()}`, { method: 'DELETE' }),
  upload: (folder, files) => {
    const form = new FormData();
    form.append('folder', folder);
    for (const f of files) form.append('files', f, f.name);
    return api('/files', { method: 'POST', form });
  },
  /** Note con allegati di Clienti, Consulenze e Casi (multipart: titolo, descrizione, files, mantieni) */
  creaNota: (parent, { titolo, descrizione, files }) => api(`/note/${parent}`, { method: 'POST', form: notaForm({ titolo, descrizione, files }) }),
  modificaNota: (ref, { titolo, descrizione, files, mantieni }) => api(`/note/${notaUrl(ref)}`, { method: 'PATCH', form: notaForm({ titolo, descrizione, files, mantieni }) }),
  eliminaNota: (ref) => api(`/note/${notaUrl(ref)}`, { method: 'DELETE' }),
  /** Ricerca nei documenti per contenuto: { results, indexing } */
  cercaDocumenti: (q, { cliente, limit } = {}) => api(`/documenti/cerca?q=${encodeURIComponent(q)}${cliente ? `&cliente=${encodeURIComponent(cliente)}` : ''}${limit ? `&limit=${limit}` : ''}`),
  /** Stato dell'indicizzazione: { "Files/id": { url, stato, errore, ocr } } */
  statoDocumenti: (fileRefs) => api(`/documenti/stato?files=${encodeURIComponent(fileRefs.join(','))}`),
  reindexDocumento: (url) => api('/documenti/reindex', { method: 'POST', body: { url } }),
  appuntamentiRecenti: (consulenzaRef) => api(`/consulenze/${consulenzaRef.split('/').pop()}/appuntamenti-recenti`),
};

/** "Clienti/a/Note_Cliente/b" → "Clienti/a/b" */
const notaUrl = (ref) => { const [col, id, , nota] = ref.split('/'); return `${col}/${id}/${nota}`; };

function notaForm({ titolo, descrizione, files = [], mantieni }) {
  const form = new FormData();
  form.append('titolo', titolo);
  form.append('descrizione', descrizione ?? '');
  if (mantieni) form.append('mantieni', JSON.stringify(mantieni));
  for (const f of files) form.append('files', f, f.name);
  return form;
}

export const idOf = (ref) => (ref ? String(ref).split('/').pop() : '');
