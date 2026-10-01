import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { Button, Modal } from './ui.jsx';

/* Toast (SnackBar / AlertDialog "Operazione effettuata" dell'originale) e conferme */

const FeedbackCtx = createContext(null);

export function FeedbackProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirm] = useState(null);
  const seq = useRef(0);

  const toast = useCallback((title, { body, tone = 'success', ms = 3800 } = {}) => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, title, body, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms);
  }, []);

  const confirm = useCallback(
    (opts) => new Promise((resolve) => setConfirm({ ...opts, resolve })),
    [],
  );

  const close = (v) => { confirmState?.resolve(v); setConfirm(null); };
  const Icon = { success: CheckCircle2, error: XCircle, info: Info };

  return (
    <FeedbackCtx.Provider value={{ toast, confirm }}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => {
          const I = Icon[t.tone] ?? Info;
          return (
            <div key={t.id} className={`toast ${t.tone}`}>
              <I size={18} />
              <div>
                <div className="t-title">{t.title}</div>
                {t.body && <div className="t-body">{t.body}</div>}
              </div>
            </div>
          );
        })}
      </div>
      <Modal
        open={!!confirmState}
        onClose={() => close(false)}
        size="sm"
        tone="danger"
        icon={AlertTriangle}
        title={confirmState?.title ?? 'Attenzione'}
        footer={
          <>
            <Button variant="ghost" onClick={() => close(false)}>Annulla</Button>
            <Button variant="danger-solid" onClick={() => close(true)} autoFocus>{confirmState?.confirmLabel ?? 'Elimina'}</Button>
          </>
        }
      >
        <p className="muted" style={{ margin: 0 }}>{confirmState?.message}</p>
      </Modal>
    </FeedbackCtx.Provider>
  );
}

export const useFeedback = () => useContext(FeedbackCtx);

/** Esegue un'azione mostrando un toast di successo o d'errore */
export function useRun() {
  const { toast } = useFeedback();
  return useCallback(async (fn, success, body) => {
    try {
      const r = await fn();
      if (success) toast(success, { body });
      return r;
    } catch (e) {
      toast('Operazione non riuscita', { body: e.message, tone: 'error', ms: 6000 });
      throw e;
    }
  }, [toast]);
}
