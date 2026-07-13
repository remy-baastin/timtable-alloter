// views/dashboard.js — workload analytics and per-teacher personal timetables,
// computed from either the Auto result or the Manual grid.

import { el, clear } from '../dom.js';
import { getState, subscribe } from '../store.js';
import {
  listTokens, teachingSlotCount, manualCoverage, tokenKey,
} from '../model.js';
import {
  buildFromManual, buildFromAuto, buildTeacherResult, renderTeacherWeek,
} from '../timetable.js';

let source = 'auto';
let teacherId = null;

export function mountDashboard(root) {
  const unsubscribe = subscribe(render);
  render();
  return unsubscribe;

  function render() {
    clear(root);
    const state = getState();

    root.append(
      el('div', { class: 'page__head' },
        el('h1', { class: 'page__title' }, 'Dashboard'),
        el('p', { class: 'page__lede' },
          'Workload per person, subject usage, and each teacher\u2019s personal week.')),
    );

    if (state.teachers.length === 0) {
      root.append(el('div', { class: 'empty' }, 'Add teachers in Setup to see workload.'));
      return;
    }

    const hasAuto = Boolean(state.lastAuto);
    if (source === 'auto' && !hasAuto) source = 'manual';

    const classResult = source === 'auto' ? buildFromAuto(state) : buildFromManual(state);
    const totals = totalsFrom(state, classResult);

    root.append(
      sourcePicker(hasAuto, render),
      statsRow(state, totals),
      utilisationCard(state, totals),
      teacherWeekCard(state, classResult, render),
    );
  }
}

function sourcePicker(hasAuto, rerender) {
  const option = (value, label, enabled) =>
    el('label', { class: 'pill' + (source === value ? ' pill--on' : '') },
      el('input', {
        type: 'radio', name: 'dash-source', checked: source === value, disabled: !enabled,
        onChange: () => { source = value; rerender(); },
      }),
      label);

  return el('div', { class: 'toolbar' },
    el('div', { class: 'pills' },
      option('auto', 'Auto result', hasAuto),
      option('manual', 'Manual grid', true)),
    !hasAuto ? el('span', { class: 'card__note' }, 'Run Auto to analyse its result.') : null,
  );
}

// ---------- computations ----------

function totalsFrom(state, classResult) {
  const teacherTotals = new Map();
  const tokenTotals = new Map();
  let placed = 0;

  if (classResult) {
    for (const klass of classResult.classes) {
      classResult.days.forEach((_, dayIndex) => {
        for (const period of classResult.periods) {
          if (!period.teaching) continue;
          const token = classResult.cell(klass.id, dayIndex, period.id);
          if (!token) continue;
          placed += 1;
          teacherTotals.set(token.teacherId, (teacherTotals.get(token.teacherId) ?? 0) + 1);
          const key = tokenKey(token.teacherId, token.code);
          tokenTotals.set(key, (tokenTotals.get(key) ?? 0) + 1);
        }
      });
    }
  }
  return { teacherTotals, tokenTotals, placed };
}

function statsRow(state, totals) {
  const slots = teachingSlotCount(state);
  const capacity = slots * state.classes.length;
  const coverage = capacity ? Math.round((totals.placed / capacity) * 100) : 0;

  const capTotal = state.teachers.reduce((s, t) => s + (t.maxPerWeek || 0), 0);
  const used = [...totals.teacherTotals.values()].reduce((s, n) => s + n, 0);
  const utilisation = capTotal ? Math.round((used / capTotal) * 100) : 0;

  const busiest = [...totals.teacherTotals.entries()].sort((a, b) => b[1] - a[1])[0];

  return el('div', { class: 'stats' },
    stat('Classes', String(state.classes.length), `${slots} slots each`),
    stat('Coverage', `${coverage}%`, `${totals.placed} of ${capacity} cells placed`),
    stat('Staff utilisation', `${utilisation}%`, `${used} of ${capTotal} cap periods used`),
    stat('Busiest teacher', busiest ? busiest[0] : '\u2014',
      busiest ? `${busiest[1]} periods this week` : 'nothing placed yet'),
  );
}

function stat(label, value, hint) {
  return el('div', { class: 'stat' },
    el('div', { class: 'stat__label' }, label),
    el('div', { class: 'stat__value' }, value),
    el('div', { class: 'stat__hint' }, hint));
}

function utilisationCard(state, totals) {
  const tokens = listTokens(state);
  const cards = [];

  for (const teacher of state.teachers) {
    cards.push(meterCard(teacher.id, teacher.name,
      totals.teacherTotals.get(teacher.id) ?? 0, teacher.maxPerWeek));
  }
  for (const token of tokens) {
    cards.push(meterCard(token.label, '',
      totals.tokenTotals.get(token.key) ?? 0, token.subjectMax));
  }

  return el('section', { class: 'card' },
    el('div', { class: 'card__head' },
      el('h2', { class: 'card__title' }, 'Weekly load'),
      el('span', { class: 'card__note' }, source === 'auto' ? 'From the Auto result' : 'From the Manual grid')),
    el('div', { class: 'meters' }, ...cards));
}

function meterCard(name, who, used, cap) {
  const over = cap > 0 && used > cap;
  const pct = cap > 0 ? Math.min(100, (used / cap) * 100) : 0;
  return el('div', { class: over ? 'meter meter--over' : 'meter' },
    el('div', { class: 'meter__top' },
      el('span', {}, el('span', { class: 'meter__name' }, name),
        who ? el('span', { class: 'meter__who' }, ` ${who}`) : null),
      el('span', { class: 'meter__val' }, `${used}/${cap}`)),
    el('div', { class: 'meter__bar' }, el('div', { class: 'meter__fill', style: `width:${pct}%` })));
}

function teacherWeekCard(state, classResult, rerender) {
  if (!state.teachers.some((t) => t.id === teacherId)) teacherId = state.teachers[0].id;

  const selector = el('select',
    { onChange: (e) => { teacherId = e.target.value; rerender(); } },
    ...state.teachers.map((t) =>
      el('option', { value: t.id, selected: t.id === teacherId },
        t.name ? `${t.id} — ${t.name}` : t.id)));

  const holder = el('div', {});
  const teacherResult = buildTeacherResult(state, classResult);
  if (teacherResult) renderTeacherWeek(holder, teacherResult, teacherId);

  return el('section', { class: 'card' },
    el('div', { class: 'card__head' },
      el('h2', { class: 'card__title' }, 'Teacher week'),
      el('label', { class: 'field' }, 'Teacher', selector)),
    holder);
}
