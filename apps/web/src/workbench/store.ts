// Состояние верстака (одновременно открыт один верстак).
import { create } from 'zustand';
import {
  DEFS, compileSketch, type CheckResult, type CircuitDoc, type Diag, type NetLogEntry, type Part, type PanicInfo, type PinRef,
  type Wire,
} from '@esp32lab/sim';
import type { PublicPractice } from '../lib/api';

export type BottomTab = 'serial' | 'plotter' | 'analyzer' | 'network' | 'mqtt' | 'chat' | 'browser' | 'problems' | 'board';

export interface SerialChunk { text: string; baud: number; t: number; port: number }

export type Selection = { kind: 'part' | 'wire'; id: string } | null;

export interface Draft { from: PinRef; pts: [number, number][] }

export interface WBState {
  mode: 'practice' | 'sandbox' | 'review';
  practice: PublicPractice | null;
  title: string;
  code: string;
  circuit: CircuitDoc;
  readOnly: boolean;
  circuitLocked: boolean;
  palette: string[] | null;
  // редактор схемы
  sel: Selection;
  draft: Draft | null;
  undo: CircuitDoc[];
  redo: CircuitDoc[];
  wireColor: string;
  // симуляция
  running: boolean;
  paused: boolean;
  speed: number;
  simTime: number;
  realFactor: number;
  status: string;
  serial: SerialChunk[];
  serialRev: number;
  diagnostics: Diag[];
  compileOk: boolean;
  warnings: { msg: string; hint?: string; t: number }[];
  panic: PanicInfo | null;
  views: Record<string, Record<string, unknown>>;
  netLog: NetLogEntry[];
  // проверки и сдача
  checkResults: CheckResult[] | null;
  checking: boolean;
  hintsUsed: number;
  quizAnswers: number[][];
  bottomTab: BottomTab;
  bottomOpen: boolean;
  dirty: boolean;
  muted: boolean;
  /** растёт при каждой загрузке новой схемы (для подгонки вида) */
  loadSeq: number;

  init(p: Partial<WBState>): void;
  setCode(code: string): void;
  setCircuit(c: CircuitDoc, opts?: { history?: boolean }): void;
  updatePart(id: string, fn: (p: Part) => Part, history?: boolean): void;
  addPart(type: string, x: number, y: number, select?: boolean): string;
  removeSelection(): void;
  rotateSelection(): void;
  duplicateSelection(): void;
  addWire(a: PinRef, b: PinRef, pts: [number, number][]): void;
  updateWire(id: string, fn: (w: Wire) => Wire, history?: boolean): void;
  undoOnce(): void;
  redoOnce(): void;
  pushHistory(): void;
  appendSerial(c: SerialChunk): void;
  clearSerial(): void;
  set(p: Partial<WBState>): void;
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

let partSeq = 1;
export function newPartId(type: string, circuit: CircuitDoc): string {
  const base = type === 'esp32' ? 'esp' : type;
  let id = `${base}${partSeq}`;
  while (circuit.parts.some((p) => p.id === id)) id = `${base}${++partSeq}`;
  partSeq++;
  return id;
}

export const WIRE_COLORS = ['#22c55e', '#ef4444', '#111827', '#3b82f6', '#eab308', '#f97316', '#a855f7', '#e5e7eb', '#06b6d4'];

export const useWB = create<WBState>((set, get) => ({
  mode: 'sandbox',
  practice: null,
  title: '',
  code: '',
  circuit: { parts: [], wires: [] },
  readOnly: false,
  circuitLocked: false,
  palette: null,
  sel: null,
  draft: null,
  undo: [],
  redo: [],
  wireColor: WIRE_COLORS[0],
  running: false,
  paused: false,
  speed: 1,
  simTime: 0,
  realFactor: 1,
  status: 'idle',
  serial: [],
  serialRev: 0,
  diagnostics: [],
  compileOk: true,
  warnings: [],
  panic: null,
  views: {},
  netLog: [],
  checkResults: null,
  checking: false,
  hintsUsed: 0,
  quizAnswers: [],
  bottomTab: 'serial',
  bottomOpen: true,
  dirty: false,
  muted: false,
  loadSeq: 0,

  init(p) {
    set({
      sel: null, draft: null, undo: [], redo: [], running: false, paused: false, simTime: 0, serial: [], serialRev: 0,
      warnings: [], panic: null, views: {}, netLog: [], checkResults: null, checking: false, hintsUsed: 0, quizAnswers: [],
      dirty: false, diagnostics: [], compileOk: true, status: 'idle', readOnly: false, circuitLocked: false, palette: null,
      practice: null, title: '', ...p, loadSeq: get().loadSeq + 1,
    });
    const c = compileSketch(get().code);
    set({ diagnostics: c.diagnostics, compileOk: c.ok });
  },
  setCode(code) { set({ code, dirty: true }); },
  setCircuit(c, opts) {
    if (opts?.history !== false) get().pushHistory();
    set({ circuit: c, dirty: true });
  },
  pushHistory() {
    set({ undo: [...get().undo.slice(-80), clone(get().circuit)], redo: [] });
  },
  updatePart(id, fn, history = true) {
    const c = get().circuit;
    if (history) get().pushHistory();
    set({ circuit: { ...c, parts: c.parts.map((p) => (p.id === id ? fn({ ...p, props: { ...p.props } }) : p)) }, dirty: true });
  },
  addPart(type, x, y, select = true) {
    const c = get().circuit;
    const id = newPartId(type, c);
    const def = DEFS[type];
    const props: Part['props'] = {};
    for (const d of def?.props ?? []) props[d.key] = d.default as string | number | boolean;
    get().pushHistory();
    set({ circuit: { ...c, parts: [...c.parts, { id, type, x: Math.round(x / 10) * 10, y: Math.round(y / 10) * 10, rot: 0, props }] }, sel: select ? { kind: 'part', id } : get().sel, dirty: true });
    return id;
  },
  removeSelection() {
    const { sel, circuit } = get();
    if (!sel) return;
    if (sel.kind === 'wire') {
      get().pushHistory();
      set({ circuit: { ...circuit, wires: circuit.wires.filter((w) => w.id !== sel.id) }, sel: null, dirty: true });
      return;
    }
    const part = circuit.parts.find((p) => p.id === sel.id);
    if (!part || part.locked || part.type === 'esp32') return;
    get().pushHistory();
    set({
      circuit: { parts: circuit.parts.filter((p) => p.id !== sel.id), wires: circuit.wires.filter((w) => w.a.part !== sel.id && w.b.part !== sel.id) },
      sel: null,
      dirty: true,
    });
  },
  rotateSelection() {
    const { sel } = get();
    if (sel?.kind !== 'part') return;
    const part = get().circuit.parts.find((p) => p.id === sel.id);
    if (!part || part.type === 'esp32' || part.type === 'breadboard') return;
    get().updatePart(sel.id, (p) => ({ ...p, rot: (p.rot + 90) % 360 }));
  },
  duplicateSelection() {
    const { sel, circuit } = get();
    if (sel?.kind !== 'part') return;
    const part = circuit.parts.find((p) => p.id === sel.id);
    if (!part || part.type === 'esp32') return;
    const id = newPartId(part.type, circuit);
    get().pushHistory();
    set({ circuit: { ...circuit, parts: [...circuit.parts, { ...clone(part), id, locked: false, x: part.x + 30, y: part.y + 30 }] }, sel: { kind: 'part', id }, dirty: true });
  },
  addWire(a, b, pts) {
    const c = get().circuit;
    if (a.part === b.part && a.pin === b.pin) return;
    if (c.wires.some((w) => (w.a.part === a.part && w.a.pin === a.pin && w.b.part === b.part && w.b.pin === b.pin) || (w.b.part === a.part && w.b.pin === a.pin && w.a.part === b.part && w.a.pin === b.pin))) return;
    const id = `w${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
    get().pushHistory();
    set({ circuit: { ...c, wires: [...c.wires, { id, a, b, pts, color: get().wireColor }] }, dirty: true });
  },
  updateWire(id, fn, history = true) {
    const c = get().circuit;
    if (history) get().pushHistory();
    set({ circuit: { ...c, wires: c.wires.map((w) => (w.id === id ? fn(w) : w)) }, dirty: true });
  },
  undoOnce() {
    const { undo, redo, circuit } = get();
    if (!undo.length) return;
    set({ circuit: undo[undo.length - 1], undo: undo.slice(0, -1), redo: [...redo, clone(circuit)], sel: null, dirty: true });
  },
  redoOnce() {
    const { undo, redo, circuit } = get();
    if (!redo.length) return;
    set({ circuit: redo[redo.length - 1], redo: redo.slice(0, -1), undo: [...undo, clone(circuit)], sel: null, dirty: true });
  },
  appendSerial(c) {
    const s = get().serial;
    const last = s[s.length - 1];
    let next: SerialChunk[];
    if (last && last.baud === c.baud && last.port === c.port && last.text.length < 4000) next = [...s.slice(0, -1), { ...last, text: last.text + c.text }];
    else next = [...s, c];
    if (next.length > 400) next = next.slice(-300);
    let total = next.reduce((a, x) => a + x.text.length, 0);
    while (total > 200000 && next.length > 1) { total -= next[0].text.length; next = next.slice(1); }
    set({ serial: next, serialRev: get().serialRev + 1 });
  },
  clearSerial() { set({ serial: [], serialRev: get().serialRev + 1 }); },
  set(p) { set(p); },
}));
