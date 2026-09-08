import { useId, type ReactNode } from 'react';

export function Section({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="section">
      <div className="section__head">
        {icon}
        <span>{title}</span>
      </div>
      <div className="section__body">{children}</div>
    </div>
  );
}

export function Field({ label, value, hint, children }: { label: string; value?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="field">
      <div className="field__label">
        <span>{label}</span>
        {value !== undefined && <span className="field__value">{value}</span>}
      </div>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  hint,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  hint?: string;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  const id = useId();
  const decimals = step < 1 ? Math.min(3, Math.ceil(-Math.log10(step))) : 0;
  return (
    <div className="field" style={disabled ? { opacity: 0.5 } : undefined}>
      <label className="field__label" htmlFor={id}>
        <span>{label}</span>
      </label>
      <div className="slider">
        <input id={id} type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} />
        <input
          className="slider__num"
          type="number"
          min={min}
          max={max}
          step={step}
          value={Number(value.toFixed(decimals))}
          disabled={disabled}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v)));
          }}
        />
        {unit && <span className="muted mono">{unit}</span>}
      </div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={'seg__opt' + (o.value === value ? ' seg__opt--on' : '')} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ label, hint, value, onChange, disabled }: { label: string; hint?: string; value: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle" style={disabled ? { opacity: 0.5 } : undefined}>
      <input type="checkbox" checked={value} disabled={disabled} onChange={(e) => onChange(e.target.checked)} style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }} />
      <span className={'toggle__track' + (value ? ' toggle__track--on' : '')}>
        <span className="toggle__thumb" />
      </span>
      <span className="toggle__text">
        <span className="toggle__label">{label}</span>
        {hint && <span className="hint" style={{ marginTop: 0 }}>{hint}</span>}
      </span>
    </label>
  );
}

export function Button({ children, onClick, primary, ghost, sm, full, danger, disabled, title }: { children: ReactNode; onClick?: () => void; primary?: boolean; ghost?: boolean; sm?: boolean; full?: boolean; danger?: boolean; disabled?: boolean; title?: string }) {
  const cls = ['btn', primary && 'btn--primary', ghost && 'btn--ghost', sm && 'btn--sm', full && 'btn--full', danger && 'btn--danger'].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}

export function Callout({ kind = 'warn', children }: { kind?: 'warn' | 'danger' | 'ok' | 'info'; children: ReactNode }) {
  return <div className={'callout' + (kind !== 'warn' ? ' callout--' + kind : '')}>{children}</div>;
}

export const Icon = {
  picture: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="2.5" width="12" height="11" rx="2" /><path d="M2.5 11l3.5-3.5 3 3 2-2 2.5 2.5" /><circle cx="10.5" cy="6" r="1" /></svg>,
  fill: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 9l6-6 6 6-6 6z" /><path d="M16 12c1.2 1.6 1.2 3 0 3s-1.2-1.4 0-3z" fill="currentColor" /></svg>,
  del: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 5h12M8 5V3h4v2M6 5l1 12h6l1-12" /></svg>,
  paint: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 16c0-3 1.5-4 3-4l7-7 2 2-7 7c0 1.5-1 3-4 3z" /></svg>,
  erase: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 13l7-7 5 5-5 5H7z" /><path d="M3 17h14" /></svg>,
  move: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="10" cy="10" r="2.5" /><path d="M10 2v4M10 14v4M2 10h4M14 10h4" /></svg>,
  round: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 17V9a6 6 0 016-6h8" /><path d="M3 17L17 3" strokeDasharray="2 2" opacity=".5" /></svg>,
  pan: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M7 11V4.5a1.5 1.5 0 013 0V9M10 9V3.5a1.5 1.5 0 013 0V9M13 9V5a1.5 1.5 0 013 0v6.5c0 3.5-2.5 6-6 6s-5-2-6.5-4.5L2.5 10.5A1.5 1.5 0 015 9l2 2" /></svg>,
  download: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M8 2v8M4.5 6.5L8 10l3.5-3.5M2.5 12.5h11" /></svg>,
};
