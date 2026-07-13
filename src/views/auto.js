// views/auto.js — run the allocator over Setup inputs + Manual locks. Shows the
// result grids or a refusal that names exactly what to fix.

import { el, clear } from '../dom.js';
import { getState, update, subscribe } from '../store.js';
import {
  buildSlots, teacherByTokenKey, teachingSlotCount, tokenKey, collectLocks,
  parseTokenKey, tokenLabel,
} from '../model.js';
import { validateForAuto, slotName } from '../validation.js';
import { allocate } from '../allocator.js';
import { buildFromAuto, renderTimetable } from '../timetable.js';

let lastErrors = null; // transient refusal messages for this visit

export function mountAuto(root) {
  const unsubscribe = subscribe(render);
  render();
  return () => { unsubscribe(); lastErrors = null; };

  function render() {
    clear(root);
    const state = getState();
    const locks = collectLocks(state);

    root.append(
      el('div', { class: 'page__head' },
        el('h1', { class: 'page__title' }, 'Auto'),
        el('p', { class: 'page__lede' },
          'Fills every class\u2019s week with no teacher double-booked. ' +
          'Locked manual cells are kept exactly where you pinned them.'),
      ),
      controls(state, locks, render),
    );

    if (lastErrors?.length) root.append(refusalBanner(lastErrors));

    const result = buildFromAuto(state);
    if (result && !lastErrors?.length) {
      const when = new Date(state.lastAuto.generatedAt);
      root.append(
        el('div', { class: 'banner banner--ok' },
          `Allotted ${when.toLocaleString()} — no teacher is double-booked` +
          (state.lastAuto.lockCount ? `, ${state.lastAuto.lockCount} lock(s) honoured.` : '.')),
      );
      const grids = el('div', {});
      renderTimetable(grids, result);
      root.append(grids);
    } else if (!result && !lastErrors?.length) {
      root.append(el('div', { class: 'empty' }, 'Nothing allotted yet. Press \u201CAllot timetable\u201D.'));
    }
  }
}

function controls(state, locks, rerender) {
  return el(
    'section',
    { class: 'card' },
    el('div', { class: 'card__head' },
      el('h2', { class: 'card__title' }, 'Run'),
      el('span', { class: 'card__note' },
        el('span', {}, 'Slots / class: ', el('strong', {}, String(teachingSlotCount(state)))))),
    el('div', { class: 'row' },
      el('button', {
        class: 'btn btn--primary', type: 'button',
        onClick: () => { runAllotment(state, locks); rerender(); },
      }, 'Allot timetable'),
      locks.length
        ? el('span', { class: 'chip chip--lock' }, `\u25C6 ${locks.length} locked cell(s) will be honoured`)
        : el('span', { class: 'card__note' }, 'Tip: lock cells in Manual to pin them before allotting.'),
      el('span', { class: 'grow' }),
      state.lastAuto
        ? el('button', {
            class: 'btn btn--ghost', type: 'button',
            onClick: () => { update((d) => { d.lastAuto = null; }); lastErrors = null; rerender(); },
          }, 'Clear result')
        : null,
    ),
  );
}

function runAllotment(state, locks) {
  const check = validateForAuto(state);
  if (!check.ok) {
    lastErrors = check.errors;
    return;
  }

  const slots = buildSlots(state);
  const teacherOfKey = teacherByTokenKey(state);
  const classes = state.classes.map((klass) => ({
    id: klass.id,
    demand: mergedDemand(klass.assignments ?? []),
  }));

  const result = allocate({ slots, classes, teacherOfKey, locks });

  if (!result.ok) {
    lastErrors = refusalMessages(state, slots, result, locks);
    return;
  }

  lastErrors = [];
  update((draft) => {
    draft.lastAuto = { assign: result.assign, slots, generatedAt: Date.now(), lockCount: locks.length };
  });
}

function refusalMessages(state, slots, result, locks) {
  if (result.failedSlot !== undefined) {
    const where = slotName(state, slots[result.failedSlot]);
    const lockText = (result.failedLocks ?? [])
      .map(({ classId, key }) => {
        const { teacherId, code } = parseTokenKey(key);
        return `${classId} \u2192 ${tokenLabel(teacherId, code)}`;
      })
      .join(', ');
    return [
      `Could not complete ${where} while honouring its locks${lockText ? ` (${lockText})` : ''}.`,
      locks.length
        ? 'Unlock one of the cells named above, or move it to a different slot, then allot again.'
        : 'Review the per-class subject counts.',
    ];
  }
  return [
    'Could not find a clash-free arrangement for these inputs.',
    locks.length
      ? `${locks.length} lock(s) are constraining the layout — try unlocking some in Manual.`
      : 'Review the per-class subject counts and caps in Setup.',
  ];
}

/** Collapse repeated tokens within a class into one demand entry. */
function mergedDemand(assignments) {
  const counts = new Map();
  for (const a of assignments) {
    const key = tokenKey(a.teacherId, a.code);
    counts.set(key, (counts.get(key) ?? 0) + num(a.periodsPerWeek));
  }
  return [...counts].map(([key, count]) => ({ key, count }));
}

function refusalBanner(errors) {
  return el(
    'div',
    { class: 'banner banner--danger' },
    el('strong', {}, 'Allotment refused'),
    el('ul', {}, ...errors.map((e) => el('li', {}, e))),
  );
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
