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

export async function api(path, { method = 'GET', body, form } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  if (res.status === 204) return null;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized();
    throw new ApiError(json.error ?? `Errore ${res.status}`, res.status);
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
  appuntamentiRecenti: (consulenzaRef) => api(`/consulenze/${consulenzaRef.split('/').pop()}/appuntamenti-recenti`),
};

export const idOf = (ref) => (ref ? String(ref).split('/').pop() : '');
