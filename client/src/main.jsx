import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api, setUnauthorizedHandler } from './lib/api.js';
import { AuthContext } from './lib/hooks.js';
import { FeedbackProvider } from './components/feedback.jsx';
import { Layout } from './components/Layout.jsx';
import { Loader } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import Calendario from './pages/Calendario.jsx';
import Clienti from './pages/Clienti.jsx';
import Cliente from './pages/Cliente.jsx';
import Consulenze from './pages/Consulenze.jsx';
import Consulenza from './pages/Consulenza.jsx';
import Casi from './pages/Casi.jsx';
import Caso from './pages/Caso.jsx';
import Documenti from './pages/Documenti.jsx';
import LogAttivita from './pages/LogAttivita.jsx';
import './styles/app.css';

const queryClient = new QueryClient({
  // niente nuovo tentativo sugli errori 4xx (documento eliminato, permessi): non cambierebbero
  defaultOptions: { queries: { staleTime: 5_000, retry: (n, e) => n < 1 && !(e?.status >= 400 && e?.status < 500) } },
});

function App() {
  const [user, setUser] = useState(undefined); // undefined = verifica in corso
  const navigate = useNavigate();

  useEffect(() => {
    api('/auth/me').then(setUser).catch(() => setUser(null));
    setUnauthorizedHandler(() => { setUser(null); queryClient.clear(); });
  }, []);

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    queryClient.clear();
    setUser(null);
    navigate('/login');
  };

  if (user === undefined) return <Loader />;

  return (
    <AuthContext.Provider value={{ user, setUser, logout }}>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/calendario" replace /> : <Login />} />
        {/* Tutte le pagine richiedono l'accesso (nell'originale nessuna rotta era protetta) */}
        <Route element={user ? <Layout /> : <Navigate to="/login" replace />}>
          <Route index element={<Navigate to="/calendario" replace />} />
          <Route path="calendario" element={<Calendario />} />
          <Route path="clienti" element={<Clienti />} />
          <Route path="clienti/:id" element={<Cliente />} />
          <Route path="consulenze" element={<Consulenze />} />
          <Route path="consulenze/:id" element={<Consulenza />} />
          <Route path="casi" element={<Casi />} />
          <Route path="casi/:id" element={<Caso />} />
          <Route path="documenti" element={<Documenti />} />
          <Route path="log" element={<LogAttivita />} />
          <Route path="*" element={<Navigate to="/calendario" replace />} />
        </Route>
      </Routes>
    </AuthContext.Provider>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <FeedbackProvider>
          <App />
        </FeedbackProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
