import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { initials, textMatch } from '../lib/format.js';

const cx = (...c) => c.filter(Boolean).join(' ');

/* -------------------------------------------------------------- buttons */

export function Button({ variant, size, icon: Icon, children, loading, className, block, ...rest }) {
  return (
    <button
      type="button"
      className={cx('btn', variant && `btn-${variant}`, size && `btn-${size}`, block && 'btn-block', className)}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {loading ? <span className="spinner" style={{ width: 16, height: 16 }} /> : Icon && <Icon size={16} strokeWidth={2} />}
      {children}
    </button>
  );
}

export function IconButton({ icon: Icon, label, size, danger, bordered, className, iconSize, ...rest }) {
  return (
    <button
      type="button"
      className={cx('icon-btn', size, danger && 'danger', bordered && 'bordered', className)}
      aria-label={label}
      title={label}
      {...rest}
    >
      <Icon size={iconSize ?? (size === 'sm' ? 16 : 18)} strokeWidth={1.9} />
    </button>
  );
}

/* ---------------------------------------------------------------- forms */

export function Field({ label, icon: Icon, hint, error, children, className, required }) {
  return (
    <label className={cx('field', className)}>
      {label && (
        <span className="field-label">
          {Icon && <Icon size={14} />} {label}
          {required && <em aria-hidden="true">*</em>}
        </span>
      )}
      {children}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

export function Input({ icon: Icon, suffix, className, ...rest }) {
  if (!Icon && !suffix) return <input className={cx('input', className)} {...rest} />;
  return (
    <span className="input-wrap">
      {Icon && <Icon size={16} />}
      <input className={cx('input', className)} style={suffix ? { paddingRight: 44 } : undefined} {...rest} />
      {suffix && <span className="input-suffix">{suffix}</span>}
    </span>
  );
}

export const Textarea = ({ className, ...rest }) => <textarea className={cx('textarea', className)} {...rest} />;

/** Select nativo; se il valore salvato non è tra le opzioni viene comunque mostrato */
export function Select({ options, value, onChange, placeholder, className, ...rest }) {
  const opts = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  if (value && !opts.some((o) => o.value === value)) opts.unshift({ value, label: value });
  return (
    <select className={cx('select', className)} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} {...rest}>
      <option value="">{placeholder ?? 'Seleziona…'}</option>
      {opts.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

/* ----------------------------------------------------------- combobox */

/**
 * Selettore ricercabile che lavora per riferimento (id), non per testo visualizzato
 * come facevano le tendine FlutterFlow. options: [{ value, label, sub? }]
 */
export function Combobox({ options, value, onChange, placeholder = 'Seleziona…', searchPlaceholder = 'Cerca…', clearable = true, disabled }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);
  const selected = options.find((o) => o.value === value);
  const filtered = useMemo(() => options.filter((o) => textMatch(q, o.label, o.sub)), [options, q]);

  useEffect(() => {
    if (!open) return;
    const h = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        className="select"
        disabled={disabled}
        style={{ textAlign: 'left', display: 'flex', alignItems: 'center', cursor: 'pointer', backgroundImage: 'none' }}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={cx('truncate grow', !selected && 'faint')}>{selected?.label ?? placeholder}</span>
        {clearable && selected ? (
          <X size={15} className="faint" onClick={(e) => { e.stopPropagation(); onChange(null); }} />
        ) : (
          <ChevronDown size={16} className="faint" />
        )}
      </button>
      {open && (
        <div className="popover" style={{ left: 0, right: 0, top: 'calc(100% + 6px)' }}>
          <div className="search-box" style={{ maxWidth: 'none', marginBottom: 4 }}>
            <Search size={15} />
            <input autoFocus className="input" style={{ height: 36 }} placeholder={searchPlaceholder} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div style={{ maxHeight: 240, overflowY: 'auto' }}>
            {filtered.length === 0 && <div className="faint small" style={{ padding: 10 }}>Nessun risultato</div>}
            {filtered.map((o) => (
              <button type="button" key={o.value} className="menu-item" onClick={() => { onChange(o.value); setOpen(false); setQ(''); }}>
                <span className="grow truncate">
                  {o.label}
                  {o.sub && <span className="faint small"> · {o.sub}</span>}
                </span>
                {o.value === value && <Check size={15} />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------- containers */

export const Card = ({ className, children, ...rest }) => <section className={cx('card', className)} {...rest}>{children}</section>;

export function CardHead({ icon: Icon, title, sub, children }) {
  return (
    <div className="card-head">
      <div className="grow">
        <div className="card-title">{Icon && <Icon size={17} />}{title}</div>
        {sub && <div className="card-sub">{sub}</div>}
      </div>
      {children && <div className="row">{children}</div>}
    </div>
  );
}

export function Empty({ icon: Icon, title, children, action }) {
  return (
    <div className="empty">
      {Icon && <div className="empty-icon"><Icon size={22} /></div>}
      {title && <div className="empty-title">{title}</div>}
      {children && <div className="small">{children}</div>}
      {action && <div style={{ marginTop: 10 }}>{action}</div>}
    </div>
  );
}

export const Loader = () => <div className="loader"><div className="spinner" /></div>;

export function SkeletonRows({ rows = 4 }) {
  return (
    <div style={{ padding: '14px 24px', display: 'grid', gap: 14 }}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="row"><div className="skeleton" style={{ width: 36, height: 36, borderRadius: 12 }} /><div className="skeleton grow" style={{ height: 14 }} /></div>
      ))}
    </div>
  );
}

/** Valore assente: "Non indicato" in corsivo attenuato, mai un trattino */
export const Missing = ({ children = 'Non indicato' }) => <span className="missing">{children}</span>;

export const Badge =({ tone, children, dot }) => <span className={cx('badge', tone)}>{dot && <span className="dot" />}{children}</span>;

export function Avatar({ name, size, square, title }) {
  return <span className={cx('avatar', size, square && 'square')} title={title ?? name}>{initials(name)}</span>;
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} className={cx('tab', value === t.value && 'active')} onClick={() => onChange(t.value)}>
          {t.icon && <t.icon size={16} />}
          {t.label}
          {t.count != null && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function KV({ label, icon: Icon, children, full }) {
  const empty = children == null || children === '' || (Array.isArray(children) && !children.length);
  return (
    <div className={full ? 'full' : undefined}>
      <div className="kv-label">{Icon && <Icon size={13} />}{label}</div>
      <div className={cx('kv-value', empty && 'empty-val')}>{empty ? 'Non indicato' : children}</div>
    </div>
  );
}

/* --------------------------------------------------------------- modal */

// dialog aperti, dal più vecchio al più recente: tastiera e focus riguardano solo l'ultimo
const modalStack = [];

export function Modal({ open, onClose, title, icon: Icon, tone, size, children, footer, busy }) {
  const titleId = useId();
  const box = useRef(null);
  const busyRef = useRef(busy);
  const closeRef = useRef(onClose);
  busyRef.current = busy;
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement;
    const token = {};
    modalStack.push(token);
    const h = (e) => {
      if (modalStack[modalStack.length - 1] !== token) return;
      if (e.key === 'Escape' && !busyRef.current) closeRef.current?.();
      // il focus resta dentro il dialog (Tab / Maiusc+Tab)
      if (e.key === 'Tab' && box.current) {
        const els = [...box.current.querySelectorAll('button:not([disabled]), [href], input:not([disabled]):not([hidden]), select, textarea, [tabindex]:not([tabindex="-1"])')];
        if (!els.length) return;
        const first = els[0], last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', h);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (!box.current?.contains(document.activeElement)) box.current?.focus();
    return () => {
      document.removeEventListener('keydown', h);
      modalStack.splice(modalStack.indexOf(token), 1);
      if (!modalStack.length) document.body.style.overflow = prev;
      // alla chiusura il focus torna a chi ha aperto il dialog
      if (trigger instanceof HTMLElement && document.contains(trigger)) trigger.focus();
    };
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="modal-layer" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose?.()}>
      <div ref={box} tabIndex={-1} className={cx('modal', size)} role="dialog" aria-modal="true" aria-labelledby={titleId} style={{ outline: 'none' }}>
        <div className="modal-head">
          {Icon && <div className={cx('modal-icon', tone)}><Icon size={19} /></div>}
          <div id={titleId} className="modal-title grow">{title}</div>
          {onClose && <IconButton icon={X} label="Chiudi" onClick={onClose} disabled={busy} />}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Form dentro un modal: submit con Invio, pulsanti Annulla/Conferma */
export function FormModal({ open, onClose, title, icon, size, onSubmit, busy, submitLabel = 'Conferma', children, danger }) {
  const formId = useId();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      icon={icon}
      size={size}
      busy={busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Annulla</Button>
          <Button variant={danger ? 'danger-solid' : 'primary'} icon={Check} loading={busy} type="submit" form={formId}>{submitLabel}</Button>
        </>
      }
    >
      <form id={formId} onSubmit={(e) => { e.preventDefault(); onSubmit(); }} className="stack">
        {children}
      </form>
    </Modal>
  );
}

/* -------------------------------------------------------------- menu */

/** Menu contestuale ancorato a un pulsante (sostituisce gli "aligned dialog" di FlutterFlow) */
export function Menu({ trigger, children, align = 'right', width = 200 }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btn = useRef(null);
  const pop = useRef(null);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const top = r.bottom + 6 + window.scrollY;
    const left = align === 'right' ? r.right - width + window.scrollX : r.left + window.scrollX;
    setPos({ top, left: Math.max(8, Math.min(left, window.innerWidth - width - 8)) });
  }, [open, align, width]);

  useEffect(() => {
    if (!open) return;
    const h = (e) => !pop.current?.contains(e.target) && !btn.current?.contains(e.target) && setOpen(false);
    const k = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    window.addEventListener('resize', () => setOpen(false), { once: true });
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [open]);

  return (
    <>
      <span ref={btn} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} style={{ display: 'inline-flex' }}>{trigger}</span>
      {open && pos && createPortal(
        <div ref={pop} className="popover" style={{ top: pos.top, left: pos.left, width }} onClick={(e) => { e.stopPropagation(); setOpen(false); }}>
          {children}
        </div>,
        document.body,
      )}
    </>
  );
}

export function MenuItem({ icon: Icon, danger, children, ...rest }) {
  return (
    <button type="button" className={cx('menu-item', danger && 'danger')} {...rest}>
      {Icon && <Icon size={16} />} {children}
    </button>
  );
}

/* ----------------------------------------------------------- page head */

export function PageHead({ crumbs, title, sub, actions, before }) {
  return (
    <>
      {crumbs}
      <div className="page-head">
        <div className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
          {before}
          <div>
            <h1 className="page-title">{title}</h1>
            {sub && <div className="page-sub">{sub}</div>}
          </div>
        </div>
        {actions && <div className="row" style={{ flexWrap: 'wrap' }}>{actions}</div>}
      </div>
    </>
  );
}
