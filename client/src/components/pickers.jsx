import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useIndex } from '../lib/hooks.js';
import { textMatch } from '../lib/format.js';
import { Avatar, Combobox } from './ui.jsx';

/** Opzioni per Combobox dalle collezioni principali (selezione per id, non per nome) */
export function useOptions(col) {
  const { list, map, isLoading } = useIndex(col);
  const options = useMemo(() => {
    const label = {
      Users: (d) => d.display_name || d.email || 'Senza nome',
      Clienti: (d) => d.Nome || 'Senza nome',
      Consulenze: (d) => d.Titolo || 'Senza titolo',
      Casi: (d) => d.Titolo || 'Senza titolo',
    }[col];
    const sub = { Users: (d) => d.email, Clienti: (d) => d.Partita_IVA || d.Email }[col];
    return list
      .map((d) => ({ value: d.path, label: label(d), sub: sub?.(d) }))
      .sort((a, b) => a.label.localeCompare(b.label, 'it'));
  }, [list, col]);
  return { options, map, isLoading };
}

export function EntityPicker({ col, value, onChange, placeholder, searchPlaceholder }) {
  const { options } = useOptions(col);
  return <Combobox options={options} value={value} onChange={onChange} placeholder={placeholder} searchPlaceholder={searchPlaceholder} />;
}

/**
 * ListaAvvocati: selezione multipla degli avvocati di supporto (Users).
 * A differenza dell'originale la ricerca filtra davvero la lista e le selezioni
 * esistenti risultano già spuntate in modifica.
 */
export function LawyerMultiPicker({ value = [], onChange, exclude }) {
  const { list } = useIndex('Users');
  const [q, setQ] = useState('');
  const users = list
    .filter((u) => u.path !== exclude && textMatch(q, u.display_name, u.email))
    .sort((a, b) => (a.display_name ?? '').localeCompare(b.display_name ?? '', 'it'));
  const toggle = (ref) => onChange(value.includes(ref) ? value.filter((r) => r !== ref) : [...value, ref]);

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="search-box" style={{ maxWidth: 'none' }}>
        <Search size={15} />
        <input className="input" style={{ height: 36 }} placeholder="Cerca avvocato…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="picker-list">
        {users.length === 0 && <div className="faint small" style={{ padding: 10 }}>Nessun avvocato trovato</div>}
        {users.map((u) => (
          <label key={u.path} className="check">
            <input type="checkbox" checked={value.includes(u.path)} onChange={() => toggle(u.path)} />
            <Avatar name={u.display_name || u.email} size="sm" />
            <span className="grow truncate">{u.display_name || u.email}</span>
          </label>
        ))}
      </div>
      {value.length > 0 && <div className="faint small">{value.length} selezionat{value.length === 1 ? 'o' : 'i'}</div>}
    </div>
  );
}
