// Базовые элементы интерфейса.
import { forwardRef, useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { X } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'ok';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink hover:brightness-110 shadow-sm shadow-accent/20',
  secondary: 'bg-panel-2 text-text border border-line hover:border-line-strong hover:bg-panel',
  ghost: 'text-muted hover:text-text hover:bg-panel-2',
  danger: 'bg-err/90 text-white hover:bg-err',
  ok: 'bg-ok text-white hover:brightness-110',
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; icon?: ReactNode; loading?: boolean }>(
  function Button({ variant = 'secondary', size = 'md', icon, loading, children, className = '', disabled, ...rest }, ref) {
    const sz = size === 'sm' ? 'h-7 px-2.5 text-xs gap-1.5' : size === 'lg' ? 'h-11 px-5 text-[15px] gap-2' : 'h-8.5 px-3 text-[13px] gap-1.5';
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={`focus-ring inline-flex shrink-0 items-center justify-center rounded-lg font-medium whitespace-nowrap transition disabled:cursor-not-allowed disabled:opacity-50 ${sz} ${VARIANTS[variant]} ${className}`}
        {...rest}
      >
        {loading ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : icon}
        {children}
      </button>
    );
  },
);

export function IconButton({ title, children, active, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      title={title}
      aria-label={title}
      className={`focus-ring inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition ${active ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-panel-2 hover:text-text'} disabled:opacity-40 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Badge({ children, tone = 'muted', className = '' }: { children: ReactNode; tone?: 'muted' | 'accent' | 'ok' | 'warn' | 'err' | 'violet'; className?: string }) {
  const t = {
    muted: 'bg-panel-2 text-muted border-line',
    accent: 'bg-accent/12 text-accent border-accent/30',
    ok: 'bg-ok/12 text-ok border-ok/30',
    warn: 'bg-warn/12 text-warn border-warn/30',
    err: 'bg-err/12 text-err border-err/30',
    violet: 'bg-accent-2/12 text-accent-2 border-accent-2/30',
  }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${t} ${className}`}>{children}</span>;
}

export function Modal({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal
        className={`anim-rise flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl ${wide ? 'max-w-3xl' : 'max-w-lg'}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div className="text-[15px] font-semibold">{title}</div>
          <IconButton title="Закрыть" onClick={onClose}><X size={16} /></IconButton>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line bg-panel-2/60 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, className = '' }: { tabs: { id: T; label: ReactNode; badge?: ReactNode; hidden?: boolean }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={`flex items-center gap-0.5 overflow-x-auto ${className}`} role="tablist">
      {tabs.filter((t) => !t.hidden).map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={`focus-ring relative flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium transition ${value === t.id ? 'bg-panel-2 text-text' : 'text-muted hover:text-text'}`}
        >
          {t.label}
          {t.badge}
          {value === t.id && <span className="absolute inset-x-2 -bottom-[5px] h-0.5 rounded-full bg-accent" />}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-faint">{hint}</span>}
    </label>
  );
}

export const inputBase = 'focus-ring h-9 rounded-lg border border-line bg-bg-2 px-3 text-sm text-text placeholder:text-faint focus:border-accent/60 outline-none transition';
export const inputCls = `${inputBase} w-full`;

export function Spinner({ size = 18 }: { size?: number }) {
  return <span className="inline-block animate-spin rounded-full border-2 border-accent border-t-transparent" style={{ width: size, height: size }} />;
}

export function Empty({ icon, title, text, action }: { icon: ReactNode; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 text-4xl">{icon}</div>
      <div className="text-[15px] font-semibold">{title}</div>
      {text && <div className="mt-1 max-w-sm text-sm text-muted">{text}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Progress({ value, className = '', tone = 'accent' }: { value: number; className?: string; tone?: 'accent' | 'ok' }) {
  return (
    <div className={`h-1.5 overflow-hidden rounded-full bg-panel-2 ${className}`}>
      <div className={`h-full rounded-full transition-all duration-500 ${tone === 'ok' ? 'bg-ok' : 'bg-gradient-to-r from-accent to-accent-2'}`} style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} />
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-panel-2 px-1.5 py-0.5 font-mono text-[10.5px] text-muted">{children}</kbd>;
}
