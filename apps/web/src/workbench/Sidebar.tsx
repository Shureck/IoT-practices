// Палитра компонентов и инспектор свойств.
import { useMemo, useState } from 'react';
import { RotateCw, Trash2, Copy, Search, Lock } from 'lucide-react';
import { COMPONENTS, DEFS, fmtOhm, propValue, type PropDef } from '@esp32lab/sim';
import { useWB, WIRE_COLORS } from './store';
import { PartIcon } from './parts';
import { setLiveProp } from './simController';
import { IconButton, inputCls, inputBase } from '../components/ui';

export function Palette() {
  const palette = useWB((s) => s.palette);
  const locked = useWB((s) => s.circuitLocked || s.readOnly);
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return COMPONENTS.filter((c) => c.type !== 'esp32' && (!palette || palette.includes(c.type) || c.type === 'breadboard' || c.type === 'resistor'))
      .filter((c) => !ql || c.title.toLowerCase().includes(ql) || (c.keywords ?? []).some((k) => k.includes(ql)));
  }, [q, palette]);
  const cats = [...new Set(list.map((c) => c.category))];
  if (locked) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-xs text-muted">
        <Lock size={20} className="text-faint" />
        Схема для этого задания уже собрана — меняется только код.
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col">
      <div className="p-2">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-2.5 text-faint" />
          <input className={`${inputCls} h-8 pl-8 text-xs`} placeholder="Найти компонент…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-3">
        {cats.map((cat) => (
          <div key={cat} className="mb-2">
            <div className="px-1 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wider text-faint">{cat}</div>
            <div className="grid grid-cols-2 gap-1.5">
              {list.filter((c) => c.category === cat).map((c) => (
                <button
                  key={c.type}
                  draggable
                  onDragStart={(e) => { e.dataTransfer.setData('application/x-esp32lab-part', c.type); e.dataTransfer.effectAllowed = 'copy'; }}
                  onClick={() => window.dispatchEvent(new CustomEvent('esp32lab:add-part', { detail: c.type }))}
                  title={c.description}
                  className="focus-ring group flex flex-col items-center gap-1 rounded-lg border border-line bg-panel-2/50 p-1.5 text-center transition hover:border-accent/50 hover:bg-panel-2"
                >
                  <div className="flex h-11 items-center justify-center transition group-hover:scale-105"><PartIcon type={c.type} size={42} /></div>
                  <span className="text-[10.5px] leading-tight text-muted group-hover:text-text">{c.title}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PropInput({ def, value, onChange, live }: { def: PropDef; value: unknown; onChange: (v: string | number | boolean) => void; live: boolean }) {
  if (def.type === 'select') {
    return (
      <select className={`${inputCls} h-8 text-xs`} value={String(value)} onChange={(e) => {
        const opt = def.options!.find((o) => String(o.value) === e.target.value);
        onChange(opt ? opt.value : e.target.value);
      }}>
        {def.options!.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
      </select>
    );
  }
  if (def.type === 'bool') {
    return (
      <button onClick={() => onChange(!value)} className={`relative h-5 w-9 rounded-full transition ${value ? 'bg-accent' : 'bg-line-strong'}`} aria-pressed={!!value}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${value ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
    );
  }
  if (def.type === 'number') {
    const v = Number(value);
    const toSlider = (x: number) => (def.log ? Math.log10(Math.max(def.min ?? 0.01, x)) : x);
    const fromSlider = (x: number) => (def.log ? Number((10 ** x).toPrecision(3)) : x);
    return (
      <div className="flex items-center gap-2">
        {def.min !== undefined && def.max !== undefined && (
          <input type="range" className="h-1 flex-1 accent-[var(--accent)]"
            min={toSlider(def.min)} max={toSlider(def.max)} step={def.log ? 0.01 : def.step ?? 1}
            value={toSlider(v)} onChange={(e) => onChange(fromSlider(Number(e.target.value)))} />
        )}
        <input type="number" className={`${inputBase} h-7 w-20 px-1.5 font-mono text-xs`} value={v} step={def.step ?? 1}
          onChange={(e) => onChange(Number(e.target.value))} />
        {def.unit && <span className="w-6 text-[11px] text-faint">{def.unit}</span>}
        {live && <span className="h-1.5 w-1.5 rounded-full bg-ok" title="меняется во время симуляции" />}
      </div>
    );
  }
  return <input className={`${inputCls} h-8 text-xs`} value={String(value)} onChange={(e) => onChange(e.target.value)} />;
}

export function Inspector() {
  const sel = useWB((s) => s.sel);
  const circuit = useWB((s) => s.circuit);
  const running = useWB((s) => s.running);
  const readOnly = useWB((s) => s.readOnly);
  const locked = useWB((s) => s.circuitLocked);
  const wireColor = useWB((s) => s.wireColor);
  const st = useWB.getState;

  if (!sel) {
    return (
      <div className="space-y-3 p-3 text-xs text-muted">
        <div>Выберите компонент или провод, чтобы изменить свойства.</div>
        <div>
          <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-faint">Цвет новых проводов</div>
          <div className="flex flex-wrap gap-1.5">
            {WIRE_COLORS.map((c) => (
              <button key={c} onClick={() => st().set({ wireColor: c })} className={`h-5 w-5 rounded-full border-2 ${wireColor === c ? 'border-accent' : 'border-transparent'}`} style={{ background: c }} aria-label={c} />
            ))}
          </div>
        </div>
        <ul className="space-y-1 text-[11.5px] leading-relaxed">
          <li>• Клик по выводу → клик по другому выводу — провод</li>
          <li>• <b>R</b> — повернуть, <b>Del</b> — удалить, <b>Ctrl+D</b> — копия</li>
          <li>• <b>Ctrl+Z / Ctrl+Y</b> — отменить / вернуть</li>
          <li>• Колёсико — масштаб, перетаскивание поля — сдвиг</li>
          <li>• Кнопки во время симуляции нажимаются мышью; Shift+клик — зафиксировать</li>
        </ul>
      </div>
    );
  }

  if (sel.kind === 'wire') {
    const w = circuit.wires.find((x) => x.id === sel.id);
    if (!w) return null;
    return (
      <div className="space-y-3 p-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Провод</div>
          {!readOnly && !locked && <IconButton title="Удалить (Del)" onClick={() => st().removeSelection()}><Trash2 size={15} /></IconButton>}
        </div>
        <div className="font-mono text-[11.5px] text-muted">{w.a.part}:{w.a.pin} → {w.b.part}:{w.b.pin}</div>
        {!readOnly && !locked && (
          <>
            <div className="flex flex-wrap gap-1.5">
              {WIRE_COLORS.map((c) => (
                <button key={c} onClick={() => { st().updateWire(w.id, (x) => ({ ...x, color: c })); st().set({ wireColor: c }); }}
                  className={`h-6 w-6 rounded-full border-2 ${w.color === c ? 'border-accent' : 'border-transparent'}`} style={{ background: c }} aria-label={c} />
              ))}
            </div>
            <button className="text-xs text-accent hover:underline" onClick={() => st().updateWire(w.id, (x) => ({ ...x, pts: [] }))}>Сбросить изгибы</button>
          </>
        )}
      </div>
    );
  }

  const part = circuit.parts.find((p) => p.id === sel.id);
  if (!part) return null;
  const def = DEFS[part.type];
  const editable = !readOnly && !(locked && part.locked);
  const canDelete = !readOnly && !part.locked && part.type !== 'esp32';
  return (
    <div className="space-y-3 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">{def.title}</div>
          <div className="font-mono text-[11px] text-faint">{part.id}{part.locked ? ' · закреплён' : ''}</div>
        </div>
        <div className="flex">
          {!readOnly && !locked && part.type !== 'esp32' && part.type !== 'breadboard' && <IconButton title="Повернуть (R)" onClick={() => st().rotateSelection()}><RotateCw size={15} /></IconButton>}
          {canDelete && <IconButton title="Копия (Ctrl+D)" onClick={() => st().duplicateSelection()}><Copy size={15} /></IconButton>}
          {canDelete && <IconButton title="Удалить (Del)" onClick={() => st().removeSelection()}><Trash2 size={15} /></IconButton>}
        </div>
      </div>
      <p className="text-[11.5px] leading-relaxed text-muted">{def.description}</p>
      {def.props.map((pd) => {
        const live = !!pd.live;
        if (!editable && !(live && running)) {
          return (
            <div key={pd.key} className="flex justify-between text-xs"><span className="text-muted">{pd.label}</span><span className="font-mono">{fmtProp(pd, propValue(part, pd.key))}</span></div>
          );
        }
        return (
          <div key={pd.key}>
            <div className="mb-1 text-[11px] font-medium text-muted">{pd.label}</div>
            <PropInput def={pd} live={live && running} value={propValue(part, pd.key)} onChange={(v) => {
              st().updatePart(part.id, (p) => ({ ...p, props: { ...p.props, [pd.key]: v } }), !live);
              if (running) setLiveProp(part.id, pd.key, v);
            }} />
          </div>
        );
      })}
      {part.type === 'pir' && running && <div className="text-[11.5px] text-muted">Кликните по датчику на схеме, чтобы «пройти» перед ним.</div>}
      {part.type === 'button' && <div className="text-[11.5px] text-muted">Во время симуляции нажимайте мышью{propValue(part, 'key') ? ` или клавишей «${propValue(part, 'key')}»` : ''}.</div>}
    </div>
  );
}

function fmtProp(pd: PropDef, v: unknown): string {
  if (pd.key === 'value' && typeof v === 'number') return fmtOhm(v);
  if (pd.type === 'select') return pd.options?.find((o) => o.value === v)?.label ?? String(v);
  if (pd.type === 'bool') return v ? 'да' : 'нет';
  return `${v}${pd.unit ? ` ${pd.unit}` : ''}`;
}
