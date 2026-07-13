// timetable.js — normalize manual cells or an auto assignment into results,
// for class-facing and teacher-facing grids, and render them read-only.

import { el } from './dom.js';
import { parseTokenKey, tokenLabel, periodTimeLabel } from './model.js';

/**
 * Class result: cell(classId, dayIndex, periodId) -> {teacherId, code} | null
 */
export function buildFromManual(state) {
  const cells = state.manual?.cells ?? {};
  return makeResult(state, (classId, dayIndex, periodId) => {
    const cell = cells?.[classId]?.[dayIndex]?.[periodId];
    return cell ? { teacherId: cell.teacherId, code: cell.code } : null;
  });
}

export function buildFromAuto(state) {
  const auto = state.lastAuto;
  if (!auto) return null;

  const lookup = {};
  for (const [classId, bySlot] of Object.entries(auto.assign)) {
    lookup[classId] = {};
    for (const [slotIndex, key] of Object.entries(bySlot)) {
      const slot = auto.slots[Number(slotIndex)];
      if (slot) lookup[classId][`${slot.dayIndex}|${slot.periodId}`] = key;
    }
  }

  return makeResult(state, (classId, dayIndex, periodId) => {
    const key = lookup?.[classId]?.[`${dayIndex}|${periodId}`];
    return key ? parseTokenKey(key) : null;
  });
}

function makeResult(state, cellFn) {
  return {
    days: state.days,
    periods: state.periods,
    classes: state.classes.map((c) => ({ id: c.id, name: c.name || '' })),
    cell: cellFn,
  };
}

/**
 * Teacher result: cell(teacherId, dayIndex, periodId) -> {classId, code} | null.
 * Derived by inverting a class result.
 */
export function buildTeacherResult(state, classResult) {
  if (!classResult) return null;
  const map = new Map(); // `${teacherId}|${day}|${period}` -> {classId, code}
  for (const klass of classResult.classes) {
    classResult.days.forEach((_, dayIndex) => {
      for (const period of classResult.periods) {
        if (!period.teaching) continue;
        const token = classResult.cell(klass.id, dayIndex, period.id);
        if (token) {
          map.set(`${token.teacherId}|${dayIndex}|${period.id}`, {
            classId: klass.id,
            code: token.code,
          });
        }
      }
    });
  }
  return {
    days: classResult.days,
    periods: classResult.periods,
    teachers: state.teachers.map((t) => ({ id: t.id, name: t.name || '' })),
    cell: (teacherId, dayIndex, periodId) =>
      map.get(`${teacherId}|${dayIndex}|${periodId}`) ?? null,
  };
}

// ---------- rendering ----------

/** Render one class grid per id into `container`. */
export function renderTimetable(container, result, classIds) {
  const ids = classIds ?? result.classes.map((c) => c.id);
  for (const id of ids) {
    const klass = result.classes.find((c) => c.id === id);
    if (klass) {
      container.append(
        gridBlock(klass.id, klass.name, result, (dayIndex, periodId) => {
          const token = result.cell(klass.id, dayIndex, periodId);
          return token ? tokenLabel(token.teacherId, token.code) : null;
        }),
      );
    }
  }
}

/** Render one teacher's personal week. */
export function renderTeacherWeek(container, teacherResult, teacherId) {
  const teacher = teacherResult.teachers.find((t) => t.id === teacherId);
  if (!teacher) return;
  container.append(
    gridBlock(teacher.id, teacher.name, teacherResult, (dayIndex, periodId) => {
      const cell = teacherResult.cell(teacher.id, dayIndex, periodId);
      return cell ? `${cell.classId}\u00b7${cell.code}` : null;
    }, 'Free'),
  );
}

function gridBlock(id, name, shape, cellText, emptyText = '\u2014') {
  const head = el(
    'tr',
    {},
    el('th', { class: 'tt__period' }, 'Period'),
    ...shape.days.map((day) => el('th', {}, day)),
  );

  const rows = shape.periods.map((period) => {
    const periodCell = el(
      'th',
      { class: 'tt__period' },
      period.name,
      periodTimeLabel(period) ? el('small', {}, periodTimeLabel(period)) : null,
    );

    if (!period.teaching) {
      return el(
        'tr', {},
        periodCell,
        el('td', { class: 'tt__break', colspan: shape.days.length }, period.name),
      );
    }

    const cells = shape.days.map((_, dayIndex) => {
      const text = cellText(dayIndex, period.id);
      return text
        ? el('td', { class: 'tt__cell', style: 'padding:7px 9px' }, text)
        : el('td', { class: 'tt__free' }, emptyText);
    });
    return el('tr', {}, periodCell, ...cells);
  });

  return el(
    'div',
    { class: 'tt' },
    el('div', { class: 'tt__name' }, id, name ? el('span', {}, name) : null),
    el(
      'div',
      { class: 'ttwrap' },
      el('table', { class: 'grid' }, el('thead', {}, head), el('tbody', {}, ...rows)),
    ),
  );
}
