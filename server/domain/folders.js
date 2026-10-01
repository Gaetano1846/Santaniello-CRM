import { getDb } from '../db/index.js';
import { deleteStoredFile } from '../services/storage.js';

/**
 * Porting 1:1 delle custom action FlutterFlow che gestiscono l'albero documentale:
 *  - newCustomAction                     → ensureRootFolders + createEntityFolder
 *  - newCustomAction2                    → findExplorer
 *  - creaSottocartella                   → createSubfolder
 *  - deleteFolderAndFilesWithSubfolders  → deleteFolderRecursive
 *  - deleteSingleFileFinalCorrect        → deleteSingleFile
 *
 * Struttura: Folder/Explorer → Folder/Clienti → cartella cliente → cartelle consulenza/caso → sottocartelle
 * Ogni Folder ha Parent_Folder e Array_Parents = [padre, nonno, ..., Explorer].
 */

export const EXPLORER = 'Folder/Explorer';
export const CLIENTI = 'Folder/Clienti';

/** newCustomAction2: cerca il folder con Titolo "Explorer" */
export async function findExplorer() {
  const db = await getDb();
  const [doc] = await db.query('Folder', { where: [['Titolo', '==', 'Explorer']], limit: 1 });
  return doc?.path ?? null;
}

/** Passi 1-2 di newCustomAction: garantisce l'esistenza di Explorer e Clienti */
export async function ensureRootFolders() {
  const db = await getDb();
  let explorerRef = await findExplorer();
  if (!explorerRef) {
    await db.set(EXPLORER, { Titolo: 'Explorer', Data_Creazione: new Date() });
    explorerRef = EXPLORER;
  }
  const [clienti] = await db.query('Folder', {
    where: [['Titolo', '==', 'Clienti'], ['Parent_Folder', '==', explorerRef]],
    limit: 1,
  });
  let clientiRef = clienti?.path;
  if (!clientiRef) {
    await db.set(CLIENTI, { Titolo: 'Clienti', Data_Creazione: new Date(), Parent_Folder: explorerRef });
    clientiRef = CLIENTI;
  }
  return { explorerRef, clientiRef };
}

/** Cartella radice del cliente: figlia di Clienti con Array_Parents = [Clienti, Explorer] */
export async function findClienteRootFolder(clienteRef) {
  const db = await getDb();
  const { explorerRef, clientiRef } = await ensureRootFolders();
  const candidates = await db.query('Folder', {
    where: [['Cliente', '==', clienteRef], ['Parent_Folder', '==', clientiRef]],
  });
  return (
    candidates.find(
      (d) => Array.isArray(d.Array_Parents) && d.Array_Parents.length === 2 &&
        d.Array_Parents.includes(explorerRef) && d.Array_Parents.includes(clientiRef),
    )?.path ?? null
  );
}

/**
 * newCustomAction(titolo, consulenza, cliente, tipo, caso)
 * tipo: 'cliente' | 'consulenza' | 'caso'
 */
export async function createEntityFolder({ titolo, tipo, cliente = null, consulenza = null, caso = null }) {
  const db = await getDb();
  const { explorerRef, clientiRef } = await ensureRootFolders();
  if (!titolo || !tipo) return null;
  const t = tipo.toLowerCase();

  if (t === 'cliente') {
    return db.add('Folder', {
      Titolo: titolo,
      Data_Creazione: new Date(),
      Cliente: cliente,
      Parent_Folder: clientiRef,
      Array_Parents: [clientiRef, explorerRef],
    });
  }

  if (t === 'consulenza' || t === 'caso') {
    if (!cliente || (t === 'caso' && !caso)) {
      console.warn(t === 'caso' ? 'Errore: Cliente o Caso non specificato' : 'Errore: Cliente non specificato per la consulenza');
      return null;
    }
    const clienteFolder = await findClienteRootFolder(cliente);
    if (!clienteFolder) {
      console.warn(`Errore: Folder del cliente non trovato${t === 'caso' ? ' per il caso' : ''}`);
      return null;
    }
    return db.add('Folder', {
      Titolo: titolo,
      Data_Creazione: new Date(),
      ...(t === 'consulenza' ? { Consulenza: consulenza } : { Caso: caso }),
      Cliente: cliente,
      Parent_Folder: clienteFolder,
      Array_Parents: [clienteFolder, clientiRef, explorerRef],
    });
  }
  return null;
}

/**
 * creaSottocartella(tipo, caso, cliente, consulenza, folderPadre, titolo)
 * Array_Parents = [folderPadre, ...folderPadre.Array_Parents]
 */
export async function createSubfolder({ tipo, caso = null, cliente = null, consulenza = null, folderPadre, titolo }) {
  const db = await getDb();
  const data = { Titolo: titolo, Parent_Folder: folderPadre, Data_Creazione: new Date() };
  const parent = await db.get(folderPadre);
  data.Array_Parents = [folderPadre, ...(Array.isArray(parent?.Array_Parents) ? parent.Array_Parents : [])];

  switch (String(tipo).toLowerCase()) {
    case 'caso':
      if (caso) data.Caso = caso;
      break;
    case 'cliente':
      if (cliente) data.Cliente = cliente;
      break;
    case 'consulenza':
      if (cliente) data.Cliente = cliente;
      if (consulenza) data.Consulenza = consulenza;
      break;
    case 'generale':
      // estensione: sottocartelle create dalla pagina Documenti fuori dall'albero clienti
      break;
    default:
      throw Object.assign(new Error(`Tipo di cartella non riconosciuto: ${tipo}`), { status: 400 });
  }
  return db.add('Folder', data);
}

/** Elimina i file di una cartella: sotto-collezione VersioneFile, oggetto Storage, documento */
async function deleteFilesOfFolder(folderRef) {
  const db = await getDb();
  let ok = true;
  const files = await db.query('Files', { where: [['Folder_Ref', '==', folderRef]] });
  for (const f of files) {
    try {
      await db.deleteCollection(`${f.path}/VersioneFile`);
      if (f.File && !(await deleteStoredFile(String(f.File)))) ok = false;
      await db.delete(f.path);
    } catch {
      ok = false;
    }
  }
  return ok;
}

/** deleteFolderAndFilesWithSubfolders: depth-first, file prima delle cartelle */
export async function deleteFolderRecursive(folderRef) {
  const db = await getDb();
  let ok = true;
  async function walk(ref) {
    const subs = await db.query('Folder', { where: [['Parent_Folder', '==', ref]] });
    for (const sub of subs) {
      await walk(sub.path);
      if (!(await deleteFilesOfFolder(sub.path))) ok = false;
      try { await db.delete(sub.path); } catch { ok = false; }
    }
  }
  try {
    await walk(folderRef);
    if (!(await deleteFilesOfFolder(folderRef))) ok = false;
    await db.delete(folderRef);
  } catch {
    ok = false;
  }
  return ok;
}

/** deleteSingleFileFinalCorrect */
export async function deleteSingleFile(fileRef) {
  const db = await getDb();
  const data = await db.get(fileRef);
  if (!data) return false;
  let ok = true;
  try { await db.deleteCollection(`${fileRef}/VersioneFile`); } catch { ok = false; }
  if (data.File) {
    if (!(await deleteStoredFile(String(data.File)))) ok = false;
  } else ok = false;
  await db.delete(fileRef);
  return ok;
}

/** Tutte le cartelle discendenti (via Array_Parents) — usato per eliminare i dati di un'entità */
export async function foldersOf(field, ref) {
  const db = await getDb();
  return db.query('Folder', { where: [[field, '==', ref]] });
}
