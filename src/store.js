// store.js — single source of truth. Observable, persisted, with undo/redo.

const STORAGE_KEY = 'timetable-allotter/v2';
const THEME_KEY = 'timetable-allotter/theme';
const HISTORY_LIMIT = 60;

const listeners = new Set();
let state = load() ?? demoState();
let past = [];
let future = [];

export function getState() {
  return state;
}

/**
 * Apply a mutation to a cloned draft, then persist and notify.
 * Pass { history:false } for changes that shouldn't create an undo step.
 */
export function update(mutator, { history = true } = {}) {
  if (history) pushHistory();
  const draft = clone(state);
  mutator(draft);
  state = draft;
  persist();
  emit();
}

export function replaceState(next, { history = true } = {}) {
  if (history) pushHistory();
  state = normalize(next);
  persist();
  emit();
}

export const canUndo = () => past.length > 0;
export const canRedo = () => future.length > 0;

export function undo() {
  if (!past.length) return;
  future.push(clone(state));
  state = past.pop();
  persist();
  emit();
}

export function redo() {
  if (!future.length) return;
  past.push(clone(state));
  state = future.pop();
  persist();
  emit();
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function exportJSON() {
  return JSON.stringify(state, null, 2);
}

/** Replace state from imported JSON. Throws on malformed input. */
export function importJSON(text) {
  const next = JSON.parse(text);
  if (!next || !Array.isArray(next.periods) || !Array.isArray(next.teachers)) {
    throw new Error('This file is not a Timetable Allotter export.');
  }
  replaceState(next);
}

export function loadDemo() {
  replaceState(demoState());
}

export function clearAll() {
  replaceState(emptyState());
}

// ---------- theme (outside undo history) ----------

export function getTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'light'; } catch { return 'light'; }
}

export function setTheme(theme) {
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
}

// ---------- internals ----------

function pushHistory() {
  past.push(clone(state));
  if (past.length > HISTORY_LIMIT) past.shift();
  future = [];
}

function emit() {
  for (const listener of listeners) listener(state);
}

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch { /* storage unavailable — degrade silently */ }
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

const clone =
  typeof structuredClone === 'function'
    ? structuredClone
    : (value) => JSON.parse(JSON.stringify(value));

/** Fill in any missing fields so older/partial saves stay usable. */
function normalize(raw) {
  return {
    days: raw.days ?? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    periods: raw.periods ?? [],
    teachers: raw.teachers ?? [],
    classes: (raw.classes ?? []).map((c) => ({ assignments: [], ...c })),
    manual: raw.manual ?? { cells: {} },
    lastAuto: raw.lastAuto ?? null,
  };
}

function emptyState() {
  return {
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    periods: [],
    teachers: [],
    classes: [],
    manual: { cells: {} },
    lastAuto: null,
  };
}

/** Internally consistent example: 4 classes, 6 teachers, 25 slots/class. */
function demoState() {
  const core = [
    { teacherId: 'T01', code: 'MAT', periodsPerWeek: 5 },
    { teacherId: 'T02', code: 'PHY', periodsPerWeek: 5 },
    { teacherId: 'T03', code: 'CHE', periodsPerWeek: 5 },
    { teacherId: 'T04', code: 'ENG', periodsPerWeek: 5 },
    { teacherId: 'T05', code: 'TAM', periodsPerWeek: 3 },
  ];
  const base = () => core.map((a) => ({ ...a }));
  return {
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    periods: [
      { id: 'p1', name: 'P1', start: '09:00', end: '09:50', teaching: true },
      { id: 'p2', name: 'P2', start: '09:50', end: '10:40', teaching: true },
      { id: 'brk', name: 'Break', start: '10:40', end: '11:00', teaching: false },
      { id: 'p3', name: 'P3', start: '11:00', end: '11:50', teaching: true },
      { id: 'lun', name: 'Lunch', start: '11:50', end: '12:40', teaching: false },
      { id: 'p4', name: 'P4', start: '12:40', end: '13:30', teaching: true },
      { id: 'p5', name: 'P5', start: '13:30', end: '14:20', teaching: true },
    ],
    teachers: [
      { id: 'T01', name: 'Teacher 1', maxPerWeek: 25, subjects: [{ code: 'MAT', maxPerWeek: 20 }] },
      { id: 'T02', name: 'Teacher 2', maxPerWeek: 25, subjects: [{ code: 'PHY', maxPerWeek: 20 }] },
      { id: 'T03', name: 'Teacher 3', maxPerWeek: 25, subjects: [{ code: 'CHE', maxPerWeek: 20 }] },
      { id: 'T04', name: 'Teacher 4', maxPerWeek: 25, subjects: [{ code: 'ENG', maxPerWeek: 20 }] },
      {
        id: 'T05', name: 'Teacher 5', maxPerWeek: 25,
        subjects: [{ code: 'TAM', maxPerWeek: 12 }, { code: 'CS', maxPerWeek: 6 }],
      },
      { id: 'T06', name: 'Teacher 6', maxPerWeek: 10, subjects: [{ code: 'ART', maxPerWeek: 6 }] },
    ],
    classes: [
      { id: 'C1', name: 'Class 1', assignments: [...base(), { teacherId: 'T05', code: 'CS', periodsPerWeek: 2 }] },
      { id: 'C2', name: 'Class 2', assignments: [...base(), { teacherId: 'T05', code: 'CS', periodsPerWeek: 2 }] },
      { id: 'C3', name: 'Class 3', assignments: [...base(), { teacherId: 'T06', code: 'ART', periodsPerWeek: 2 }] },
      { id: 'C4', name: 'Class 4', assignments: [...base(), { teacherId: 'T06', code: 'ART', periodsPerWeek: 2 }] },
    ],
    manual: { cells: {} },
    lastAuto: null,
  };
}
