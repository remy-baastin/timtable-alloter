// views/export.js — choose a source grid and classes, optionally include
// teacher timetables, download as HTML and CSV.

import { el, clear, downloadFile } from '../dom.js';
import { getState, subscribe } from '../store.js';
import { buildFromManual, buildFromAuto, buildTeacherResult } from '../timetable.js';
import { buildHTML, buildCSV } from '../exporter.js';

let source = 'auto';
let selected = null; // Set<string> | null
let includeTeachers = false;

export function mountExport(root) {
  const unsubscribe = subscribe(render);
  render();
  return unsubscribe;

  function render() {
    clear(root);
    const state = getState();

    root.append(
      el('div', { class: 'page__head' },
        el('h1', { class: 'page__title' }, 'Export'),
        el('p', { class: 'page__lede' },
          'Standalone HTML (print-ready, one table per page) and CSV. Nothing leaves your browser.')),
    );

    if (state.classes.length === 0) {
      root.append(el('div', { class: 'empty' }, 'No classes to export. Add them in Setup.'));
      return;
    }

    const hasAuto = Boolean(state.lastAuto);
    if (source === 'auto' && !hasAuto) source = 'manual';

    if (selected === null) selected = new Set(state.classes.map((c) => c.id));
    selected = new Set([...selected].filter((id) => state.classes.some((c) => c.id === id)));

    root.append(sourceCard(hasAuto, render), classesCard(state, render), actionsCard(state));
  }
}

function sourceCard(hasAuto, rerender) {
  const option = (value, label, enabled) =>
    el('label', { class: 'pill' + (source === value ? ' pill--on' : '') },
      el('input', {
        type: 'radio', name: 'exp-source', checked: source === value, disabled: !enabled,
        onChange: () => { source = value; rerender(); },
      }),
      label);

  return el('section', { class: 'card' },
    el('div', { class: 'card__head' },
      el('h2', { class: 'card__title' }, 'Source'),
      el('span', { class: 'card__note' }, 'Which grid to export')),
    el('div', { class: 'pills' },
      option('manual', 'Manual grid', true),
      option('auto', 'Auto result', hasAuto)));
}

function classesCard(state, rerender) {
  const allChecked = selected.size === state.classes.length;

  const selectAll = el('label', {},
    el('input', {
      type: 'checkbox', checked: allChecked,
      onChange: (e) => {
        selected = e.target.checked ? new Set(state.classes.map((c) => c.id)) : new Set();
        rerender();
      },
    }),
    el('strong', {}, 'Select all'));

  const items = state.classes.map((c) =>
    el('label', {},
      el('input', {
        type: 'checkbox', checked: selected.has(c.id),
        onChange: (e) => { e.target.checked ? selected.add(c.id) : selected.delete(c.id); rerender(); },
      }),
      c.name ? `${c.id} — ${c.name}` : c.id));

  const teacherToggle = el('label', { style: 'display:flex;gap:8px;align-items:center;margin-top:12px;font-size:13px' },
    el('input', {
      type: 'checkbox', checked: includeTeachers,
      onChange: (e) => { includeTeachers = e.target.checked; rerender(); },
    }),
    'Also include every teacher\u2019s personal timetable');

  return el('section', { class: 'card' },
    el('div', { class: 'card__head' },
      el('h2', { class: 'card__title' }, 'Contents'),
      el('span', { class: 'card__note' }, `${selected.size} class(es) selected`)),
    el('div', { class: 'checklist' }, selectAll, ...items),
    teacherToggle);
}

function actionsCard(state) {
  const classResult = source === 'auto' ? buildFromAuto(state) : buildFromManual(state);
  const teacherResult = includeTeachers ? buildTeacherResult(state, classResult) : null;
  const ids = [...selected];
  const ready = Boolean(classResult) && ids.length > 0;

  const note = !classResult
    ? 'No auto result yet — run Auto first, or switch source to Manual.'
    : ids.length === 0
      ? 'Select at least one class.'
      : '';

  return el('section', { class: 'card' },
    el('div', { class: 'row' },
      el('button', {
        class: 'btn btn--primary', type: 'button', disabled: !ready,
        onClick: () => downloadFile('timetable.html', buildHTML(classResult, ids, teacherResult), 'text/html'),
      }, 'Download HTML'),
      el('button', {
        class: 'btn', type: 'button', disabled: !ready,
        onClick: () => downloadFile('timetable.csv', buildCSV(classResult, ids, teacherResult), 'text/csv'),
      }, 'Download CSV'),
      note ? el('span', { class: 'card__note' }, note) : null));
}
