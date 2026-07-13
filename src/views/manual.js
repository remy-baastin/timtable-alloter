// views/manual.js — click a cell, pick a token from the palette. Busy teachers
// are disabled with the clashing class named; cap overruns warn but don't block.
// Placed cells can be locked so Auto must keep them. Arrow keys move between cells.

import { el, clear } from '../dom.js';
import { getState, update, subscribe } from '../store.js';
import {
  teachingPeriods, listTokens, tokenKey, periodTimeLabel,
} from '../model.js';

let activeClassId = null;
let palette = null; // { dayIndex, periodId, anchorRect }

export function mountManual(root) {
  const unsubscribe = subscribe(render);
  const onKey = (e) => { if (e.key === 'Escape' && palette) { palette = null; render(); } };
  window.addEventListener('keydown', onKey);
  render();
  return () => { unsubscribe(); window.removeEventListener('keydown', onKey); palette = null; };

  function render() {
    clear(root);
    const state = getState();

    root.append(
      el('div', { class: 'page__head' },
        el('h1', { class: 'page__title' }, 'Manual'),
        el('p', { class: 'page__lede' },
          'Tap a cell to place a teacher. Busy teachers are blocked; locked cells (\u25C6) are kept by Auto.'),
      ),
    );

    if (state.classes.length === 0 || teachingPeriods(state).length === 0) {
      root.append(el('div', { class: 'empty' }, 'Add classes and teaching periods in Setup first.'));
      return;
    }
    if (!state.classes.some((c) => c.id === activeClassId)) {
      activeClassId = state.classes[0].id;
    }

    root.append(toolbar(state, render), grid(state, render), meters(state));

    if (palette) root.append(...paletteEls(state, render));
  }
}

// ---------- toolbar ----------

function toolbar(state, rerender) {
  const selector = el(
    'select',
    { onChange: (e) => { activeClassId = e.target.value; palette = null; rerender(); } },
    ...state.classes.map((c) =>
      el('option', { value: c.id, selected: c.id === activeClassId },
        c.name ? `${c.id} — ${c.name}` : c.id)),
  );

  return el(
    'div',
    { class: 'toolbar' },
    el('label', { class: 'field' }, 'Editing class', selector),
    el('span', { class: 'grow' }),
    el('button', {
      class: 'btn btn--danger', type: 'button',
      onClick: () => {
        if (!confirm(`Clear all placements for ${activeClassId}? (Undo can restore)`)) return;
        update((d) => { delete d.manual.cells[activeClassId]; });
      },
    }, 'Clear this class'),
  );
}

// ---------- grid ----------

function grid(state, rerender) {
  const periods = state.periods;
  const teaching = teachingPeriods(state);

  const head = el(
    'tr', {},
    el('th', { class: 'tt__period' }, 'Period'),
    ...state.days.map((d) => el('th', {}, d)),
  );

  const rows = periods.map((period) => {
    const periodCell = el(
      'th', { class: 'tt__period' },
      period.name,
      periodTimeLabel(period) ? el('small', {}, periodTimeLabel(period)) : null,
    );

    if (!period.teaching) {
      return el('tr', {}, periodCell,
        el('td', { class: 'tt__break', colspan: state.days.length }, period.name));
    }

    const pIndex = teaching.findIndex((p) => p.id === period.id);
    const cells = state.days.map((_, dayIndex) =>
      el('td', { class: 'tt__cell' }, cellButton(state, dayIndex, period.id, pIndex, rerender)),
    );
    return el('tr', {}, periodCell, ...cells);
  });

  const table = el('table', { class: 'grid' }, el('thead', {}, head), el('tbody', {}, ...rows));
  table.addEventListener('keydown', (e) => arrowNav(e, state, teaching));

  return el('div', { class: 'tt' }, el('div', { class: 'ttwrap' }, table));
}

function cellButton(state, dayIndex, periodId, pIndex, rerender) {
  const cell = getCell(state, activeClassId, dayIndex, periodId);
  const label = cell ? `${cell.teacherId}\u00b7${cell.code}` : '\u2014';

  return el(
    'button',
    {
      class: cell ? 'cellbtn' : 'cellbtn cellbtn--empty',
      type: 'button',
      'data-d': String(dayIndex),
      'data-p': String(pIndex),
      'aria-label': `${state.days[dayIndex]}, period ${periodId}${cell ? `, ${label}` : ', empty'}`,
      onClick: (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        palette = { dayIndex, periodId, anchorRect: { top: rect.top, left: rect.left, bottom: rect.bottom } };
        rerender();
        focusPalette();
      },
    },
    label,
    cell?.locked ? el('span', { class: 'locksign', title: 'Locked for Auto' }, '\u25C6') : null,
  );
}

function arrowNav(event, state, teaching) {
  const moves = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] };
  const move = moves[event.key];
  const target = event.target.closest?.('.cellbtn');
  if (!move || !target) return;
  event.preventDefault();
  const d = Number(target.dataset.d) + move[0];
  const p = Number(target.dataset.p) + move[1];
  if (d < 0 || d >= state.days.length || p < 0 || p >= teaching.length) return;
  const next = target.closest('table').querySelector(`.cellbtn[data-d="${d}"][data-p="${p}"]`);
  next?.focus();
}

// ---------- palette ----------

function paletteEls(state, rerender) {
  const { dayIndex, periodId, anchorRect } = palette;
  const tokens = listTokens(state);
  const cell = getCell(state, activeClassId, dayIndex, periodId);
  const busy = teachersBusyInSlot(state, dayIndex, periodId, activeClassId);
  const { teacherTotals, tokenTotals } = manualTotals(state);

  const close = () => { palette = null; rerender(); };
  const place = (key) => {
    const [teacherId, code] = key.split('::');
    update((d) => {
      const cells = d.manual.cells;
      cells[activeClassId] ??= {};
      cells[activeClassId][dayIndex] ??= {};
      cells[activeClassId][dayIndex][periodId] = { teacherId, code };
    });
    palette = null;
  };

  const options = tokens.map((token) => {
    const clashClass = busy.get(token.teacherId);
    const isCurrent = cell && tokenKey(cell.teacherId, cell.code) === token.key;
    const teacherUsed = teacherTotals.get(token.teacherId) ?? 0;
    const tokenUsed = tokenTotals.get(token.key) ?? 0;
    const teacherFull = teacherUsed >= (token.teacherMax || 0);
    const tokenFull = tokenUsed >= (token.subjectMax || 0);

    return el(
      'button',
      {
        class: 'palette__opt', type: 'button',
        disabled: Boolean(clashClass) && !isCurrent,
        onClick: () => place(token.key),
      },
      el('span', { class: 'tok' }, token.label),
      token.teacherName ? el('span', { class: 'who' }, token.teacherName) : null,
      el('span', { class: 'grow' }),
      clashClass && !isCurrent
        ? el('span', { class: 'chip chip--danger' }, `busy: ${clashClass}`)
        : (teacherFull || tokenFull)
          ? el('span', { class: 'chip chip--warn' }, 'cap reached')
          : isCurrent
            ? el('span', { class: 'chip chip--ok' }, 'current')
            : null,
    );
  });

  const foot = el(
    'div',
    { class: 'palette__foot' },
    cell
      ? el('button', {
          class: 'btn btn--ghost', type: 'button',
          onClick: () => {
            update((d) => {
              const c = d.manual.cells[activeClassId][dayIndex][periodId];
              c.locked = !c.locked;
            });
            palette = null;
          },
        }, cell.locked ? 'Unlock' : 'Lock for Auto')
      : null,
    cell
      ? el('button', {
          class: 'btn btn--danger', type: 'button',
          onClick: () => {
            update((d) => { delete d.manual.cells[activeClassId][dayIndex][periodId]; });
            palette = null;
          },
        }, 'Clear cell')
      : null,
    el('span', { class: 'grow' }),
    el('button', { class: 'btn', type: 'button', onClick: close }, 'Close'),
  );

  const period = state.periods.find((p) => p.id === periodId);
  const panel = el(
    'div',
    { class: 'palette', role: 'dialog', 'aria-label': 'Choose a teacher', id: 'palettePanel' },
    el('div', { class: 'palette__title' },
      'Place in ', el('b', {}, `${state.days[dayIndex]} ${period?.name ?? ''}`)),
    el('div', { class: 'palette__group' }, 'Teacher \u00b7 subject'),
    ...options,
    foot,
  );

  // Anchor near the clicked cell, clamped to the viewport (desktop only; CSS
  // pins it as a bottom sheet on small screens).
  const top = Math.min(anchorRect.bottom + 6, (window.innerHeight || 800) - 440);
  const left = Math.min(anchorRect.left, (window.innerWidth || 1200) - 350);
  panel.style.top = `${Math.max(10, top)}px`;
  panel.style.left = `${Math.max(10, left)}px`;

  const backdrop = el('div', { class: 'palette-backdrop', onClick: close });
  return [backdrop, panel];
}

function focusPalette() {
  requestAnimationFrame(() => {
    document.getElementById('palettePanel')?.querySelector('button:not(:disabled)')?.focus();
  });
}

// ---------- meters ----------

function meters(state) {
  const tokens = listTokens(state);
  const { teacherTotals, tokenTotals } = manualTotals(state);

  const cards = [];
  for (const teacher of state.teachers) {
    cards.push(meterCard(teacher.id, teacher.name, teacherTotals.get(teacher.id) ?? 0, teacher.maxPerWeek));
  }
  for (const token of tokens) {
    cards.push(meterCard(token.label, '', tokenTotals.get(token.key) ?? 0, token.subjectMax));
  }
  const over = cards.some((c) => c.dataset.over === 'true');

  return el(
    'section',
    { class: 'card' },
    el('div', { class: 'card__head' },
      el('h2', { class: 'card__title' }, 'Weekly load'),
      el('span', { class: over ? 'chip chip--danger' : 'chip chip--ok' },
        over ? 'Caps exceeded' : 'Within caps')),
    el('div', { class: 'meters' }, ...cards),
  );
}

function meterCard(name, who, used, cap) {
  const over = cap > 0 && used > cap;
  const pct = cap > 0 ? Math.min(100, (used / cap) * 100) : 0;
  const node = el(
    'div',
    { class: over ? 'meter meter--over' : 'meter' },
    el('div', { class: 'meter__top' },
      el('span', {}, el('span', { class: 'meter__name' }, name),
        who ? el('span', { class: 'meter__who' }, ` ${who}`) : null),
      el('span', { class: 'meter__val' }, `${used}/${cap}`)),
    el('div', { class: 'meter__bar' }, el('div', { class: 'meter__fill', style: `width:${pct}%` })),
  );
  node.dataset.over = String(over);
  return node;
}

// ---------- state access ----------

function getCell(state, classId, dayIndex, periodId) {
  return state.manual.cells?.[classId]?.[dayIndex]?.[periodId] ?? null;
}

/** teacherId -> classId that occupies them in this slot (excluding one class). */
function teachersBusyInSlot(state, dayIndex, periodId, exceptClassId) {
  const busy = new Map();
  for (const klass of state.classes) {
    if (klass.id === exceptClassId) continue;
    const cell = getCell(state, klass.id, dayIndex, periodId);
    if (cell && !busy.has(cell.teacherId)) busy.set(cell.teacherId, klass.id);
  }
  return busy;
}

function manualTotals(state) {
  const teacherTotals = new Map();
  const tokenTotals = new Map();
  for (const klass of state.classes) {
    const byDay = state.manual.cells?.[klass.id] ?? {};
    for (const byPeriod of Object.values(byDay)) {
      for (const cell of Object.values(byPeriod)) {
        if (!cell) continue;
        teacherTotals.set(cell.teacherId, (teacherTotals.get(cell.teacherId) ?? 0) + 1);
        const key = tokenKey(cell.teacherId, cell.code);
        tokenTotals.set(key, (tokenTotals.get(key) ?? 0) + 1);
      }
    }
  }
  return { teacherTotals, tokenTotals };
}
