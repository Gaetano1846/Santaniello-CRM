import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { actions, db } from './api.js';
import { useFeedback } from '../components/feedback.jsx';

/* Le liste si aggiornano da sole (focus finestra + polling leggero) per avvicinarsi
   ai listener realtime di Firestore usati dall'app Flutter. */
const LIVE = { refetchInterval: 30_000, refetchOnWindowFocus: true };

export function useList(col, q, opts = {}) {
  return useQuery({
    queryKey: ['list', col, q ?? null],
    queryFn: () => db.list(col, q),
    enabled: !!col && opts.enabled !== false,
    ...LIVE,
    ...opts,
  });
}

export function useDoc(path, opts = {}) {
  return useQuery({
    queryKey: ['doc', path],
    queryFn: () => db.get(path),
    enabled: !!path && opts.enabled !== false,
    ...LIVE,
    ...opts,
  });
}

/** Mappa path → documento di un'intera collezione (Users, Clienti, …) per lookup veloci */
export function useIndex(col) {
  const q = useList(col);
  const map = useMemo(() => new Map((q.data ?? []).map((d) => [d.path, d])), [q.data]);
  return { ...q, map, list: q.data ?? [] };
}

export const userName = (users, ref) => users.get(ref)?.display_name || users.get(ref)?.email || '';

/**
 * Mutazione generica: esegue fn e poi invalida tutte le query (equivalente pratico
 * dei listener realtime: dopo ogni scrittura la UI riflette lo stato aggiornato).
 */
export function useAction(fn, { onSuccess } = {}) {
  const qc = useQueryClient();
  const { toast } = useFeedback();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (data, vars) => {
      // prima la reazione (toast, chiusura dialog, navigazione), poi l'aggiornamento:
      // dopo un'eliminazione la pagina del documento viene lasciata subito e non lo si
      // ricarica inutilmente (le query non più attive non vengono riscaricate)
      onSuccess?.(data, vars);
      await qc.invalidateQueries();
    },
    onError: (e) => toast('Operazione non riuscita', { body: e.message, tone: 'error', ms: 6000 }),
  });
}

export function useInvalidate() {
  const qc = useQueryClient();
  return useCallback(() => qc.invalidateQueries(), [qc]);
}

/* ------------------------------------------------------------ sessione */

export const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);
export const useMe = () => useContext(AuthContext).user;

/* ---------------------------------------------------------- dialog state */

/** Gestione compatta di un dialog: open(payload) / close() */
export function useDialog() {
  const [state, setState] = useState(null);
  return {
    isOpen: state !== null,
    data: state?.data,
    open: (data = true) => setState({ data }),
    close: () => setState(null),
  };
}

export { actions, db };
