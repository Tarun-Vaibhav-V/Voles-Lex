import { X } from 'lucide-react';

const cx = (...c) => c.filter(Boolean).join(' ');
export { cx };

export function Button({ variant = 'normal', size = 'md', className, icon: Icon, children, ...p }) {
  const v = {
    primary: 'bg-action hover:bg-action-dark text-white border-action',
    normal: 'bg-white hover:bg-gray-50 text-ink border-gray-500',
    link: 'bg-transparent border-transparent text-link hover:underline px-1',
    danger: 'bg-white hover:bg-red-50 text-bad border-bad',
    ghost: 'bg-transparent border-transparent text-muted hover:bg-gray-100',
  }[variant];
  const s = size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-4 text-sm';
  return (
    <button
      className={cx('inline-flex items-center justify-center gap-1.5 rounded-full border font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap', v, s, className)}
      {...p}
    >
      {Icon && <Icon size={size === 'sm' ? 13 : 15} />}
      {children}
    </button>
  );
}

export function Container({ title, description, actions, children, className, padded = true }) {
  return (
    <section className={cx('bg-white rounded-xl shadow-[0_1px_3px_rgba(0,28,36,.15)] border border-line/60', className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-4 px-5 pt-4 pb-3 border-b border-line/70">
          <div className="min-w-0">
            <h2 className="text-[17px] font-bold">{title}</h2>
            {description && <p className="text-muted text-[13px] mt-0.5">{description}</p>}
          </div>
          {actions && <div className="flex gap-2 shrink-0 flex-wrap justify-end">{actions}</div>}
        </header>
      )}
      <div className={padded ? 'p-5' : ''}>{children}</div>
    </section>
  );
}

export function Field({ label, hint, children, className }) {
  return (
    <label className={cx('block', className)}>
      <span className="block text-[13px] font-semibold mb-1">{label}</span>
      {hint && <span className="block text-xs text-muted -mt-0.5 mb-1.5">{hint}</span>}
      {children}
    </label>
  );
}

const inputCls = 'w-full h-8 px-2.5 rounded-lg border border-gray-400 bg-white text-sm outline-none focus:border-link focus:ring-2 focus:ring-link/25';
export const Input = ({ className, ...p }) => <input className={cx(inputCls, className)} {...p} />;
export const Select = ({ className, children, ...p }) => <select className={cx(inputCls, 'pr-7', className)} {...p}>{children}</select>;
export const Textarea = ({ className, ...p }) => <textarea className={cx(inputCls, 'h-auto py-2 leading-relaxed', className)} {...p} />;

export function Badge({ tone = 'gray', children, className }) {
  const t = {
    gray: 'bg-gray-100 text-gray-700 border-gray-300',
    green: 'bg-green-50 text-ok border-green-300',
    red: 'bg-red-50 text-bad border-red-300',
    blue: 'bg-blue-50 text-link border-blue-200',
    orange: 'bg-orange-50 text-action-dark border-orange-300',
    purple: 'bg-violet-50 text-violet-700 border-violet-200',
  }[tone];
  return <span className={cx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold', t, className)}>{children}</span>;
}

export function Toggle({ checked, onChange, label }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="inline-flex items-center gap-2 text-sm">
      <span className={cx('w-8 h-[18px] rounded-full relative transition-colors', checked ? 'bg-link' : 'bg-gray-400')}>
        <span className={cx('absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-all', checked ? 'left-[16px]' : 'left-[2px]')} />
      </span>
      {label}
    </button>
  );
}

export function Modal({ title, onClose, children, footer, wide }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className={cx('bg-white rounded-xl shadow-2xl w-full max-h-[90vh] flex flex-col', wide ? 'max-w-3xl' : 'max-w-lg')} onMouseDown={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-line">
          <h3 className="font-bold text-[17px]">{title}</h3>
          <button onClick={onClose} className="text-muted hover:text-ink"><X size={18} /></button>
        </header>
        <div className="p-5 overflow-auto scroll-thin">{children}</div>
        {footer && <footer className="px-5 py-3 border-t border-line flex justify-end gap-2">{footer}</footer>}
      </div>
    </div>
  );
}

export function Table({ columns, rows, empty = 'No resources', onRowClick }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted border-b border-line">
            {columns.map((c) => <th key={c.key} className="font-semibold px-4 py-2.5 whitespace-nowrap">{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={columns.length} className="text-center text-muted py-10">{empty}</td></tr>}
          {rows.map((r, i) => (
            <tr key={r.id ?? i} onClick={onRowClick ? () => onRowClick(r) : undefined} className={cx('border-b border-line/60 last:border-0', onRowClick && 'hover:bg-blue-50/40 cursor-pointer')}>
              {columns.map((c) => <td key={c.key} className="px-4 py-2.5 align-top">{c.render ? c.render(r) : r[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Stat({ label, value, sub, tone }) {
  return (
    <div className="rounded-xl border border-line/70 bg-white p-4">
      <div className="text-xs font-semibold text-muted uppercase tracking-wide">{label}</div>
      <div className={cx('text-2xl font-bold mt-1 tabular-nums', tone === 'green' && 'text-ok', tone === 'orange' && 'text-action')}>{value}</div>
      {sub && <div className="text-xs text-muted mt-0.5">{sub}</div>}
    </div>
  );
}

export function Alert({ tone = 'info', children, className }) {
  const t = { info: 'bg-blue-50 border-link/40', warn: 'bg-amber-50 border-amber-400', error: 'bg-red-50 border-bad/50', ok: 'bg-green-50 border-ok/40' }[tone];
  return <div className={cx('rounded-lg border px-3.5 py-2.5 text-[13px]', t, className)}>{children}</div>;
}

export const Code = ({ children, className }) => (
  <pre className={cx('bg-[#0f1b2a] text-[#d4e1f0] rounded-lg p-3.5 text-xs font-mono overflow-auto scroll-thin leading-relaxed', className)}>{children}</pre>
);
