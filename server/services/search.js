import { config } from '../config.js';
import { getDb } from '../db/index.js';

/**
 * Porting di algoliaSearchClienti / algoliaSearchConsulenze:
 *  1. query su Algolia (hitsPerPage 1000, solo objectID)
 *  2. fetch dei documenti Firestore a blocchi di 10 id ("in" query) in parallelo.
 * Se Algolia non è configurato si usa una ricerca testuale locale sugli stessi campi.
 */
const LOCAL_FIELDS = {
  Clienti: ['Nome', 'Partita_IVA', 'Email', 'Telefono', 'indirizzo', 'Categoria', 'Note'],
  Consulenze: ['Titolo', 'Descrizione', 'Data_Inizio'],
};

async function algoliaIds(index, query) {
  const { appId, searchKey } = config.algolia;
  const r = await fetch(`https://${appId}-dsn.algolia.net/1/indexes/${index}/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Algolia-API-Key': searchKey,
      'X-Algolia-Application-Id': appId,
    },
    body: JSON.stringify({ query, hitsPerPage: 1000, attributesToRetrieve: ['objectID'] }),
  });
  if (!r.ok) {
    console.warn(`Algolia search failed with status: ${r.status}`);
    return [];
  }
  const json = await r.json();
  return (json.hits ?? []).map((h) => h.objectID).filter(Boolean);
}

export async function searchCollection(index, query) {
  const db = await getDb();
  const q = String(query ?? '').trim();

  if (config.algolia.appId && config.algolia.searchKey) {
    try {
      const ids = await algoliaIds(index, q);
      const chunks = [];
      for (let i = 0; i < ids.length; i += 10) chunks.push(ids.slice(i, i + 10));
      const results = await Promise.all(chunks.map((c) => db.query(index, { where: [['__id__', 'in', c]] }).catch(() => [])));
      // riordina secondo la rilevanza di Algolia (l'originale la perdeva)
      const rank = new Map(ids.map((id, i) => [id, i]));
      return results.flat().sort((a, b) => rank.get(a.id) - rank.get(b.id));
    } catch (e) {
      console.warn(`Error in algoliaSearch${index}:`, e.message);
      return [];
    }
  }

  const all = await db.query(index);
  if (!q) return all;
  const terms = q.toLowerCase().split(/\s+/);
  return all.filter((d) => {
    const hay = (LOCAL_FIELDS[index] ?? []).map((f) => String(d[f] ?? '')).join(' ').toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}
