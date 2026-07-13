// model.js — pure helpers over the application state. No DOM, no side effects.

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Stable identity for a teacher+subject pair. */
export const tokenKey = (teacherId, code) => `${teacherId}::${code}`;

export function parseTokenKey(key) {
  const [teacherId, code] = key.split('::');
  return { teacherId, code };
}

/** Human label shown everywhere a token appears, e.g. "T02·PHY". */
export const tokenLabel = (teacherId, code) => `${teacherId}\u00b7${code}`;

/** Periods that hold a class (breaks excluded). */
export const teachingPeriods = (state) => state.periods.filter((p) => p.teaching);

/** Total fillable cells per class per week. */
export const teachingSlotCount = (state) =>
  teachingPeriods(state).length * state.days.length;

/**
 * Ordered list of schedulable slots: day-major, then teaching period.
 * The allocator and the result builders must share this exact order.
 */
export function buildSlots(state) {
  const slots = [];
  state.days.forEach((_, dayIndex) => {
    teachingPeriods(state).forEach((period) => {
      slots.push({ dayIndex, periodId: period.id });
    });
  });
  return slots;
}

/** Flatten teachers into the list of teacher+subject tokens. */
export function listTokens(state) {
  const tokens = [];
  for (const teacher of state.teachers) {
    for (const subject of teacher.subjects) {
      tokens.push({
        key: tokenKey(teacher.id, subject.code),
        teacherId: teacher.id,
        teacherName: teacher.name || '',
        teacherMax: teacher.maxPerWeek,
        code: subject.code,
        subjectMax: subject.maxPerWeek,
        label: tokenLabel(teacher.id, subject.code),
      });
    }
  }
  return tokens;
}

/** Map of token key -> owning teacher id, used for clash checks. */
export function teacherByTokenKey(state) {
  const map = {};
  for (const token of listTokens(state)) map[token.key] = token.teacherId;
  return map;
}

export function findPeriod(state, periodId) {
  return state.periods.find((p) => p.id === periodId);
}

/** Pretty time range for a period, e.g. "09:00–09:45". */
export function periodTimeLabel(period) {
  if (!period.start && !period.end) return '';
  return `${period.start || '—'}\u2013${period.end || '—'}`;
}

/**
 * Locked manual placements that are still valid coordinates, as allocator input.
 * @returns {Array<{classId:string, slotIndex:number, key:string}>}
 */
export function collectLocks(state) {
  const slots = buildSlots(state);
  const slotIndexOf = new Map(slots.map((s, i) => [`${s.dayIndex}|${s.periodId}`, i]));
  const locks = [];

  for (const klass of state.classes) {
    const byDay = state.manual.cells?.[klass.id] ?? {};
    for (const [dayIndex, byPeriod] of Object.entries(byDay)) {
      for (const [periodId, cell] of Object.entries(byPeriod)) {
        if (!cell?.locked) continue;
        const slotIndex = slotIndexOf.get(`${dayIndex}|${periodId}`);
        if (slotIndex === undefined) continue; // day/period no longer active
        locks.push({
          classId: klass.id,
          slotIndex,
          key: tokenKey(cell.teacherId, cell.code),
        });
      }
    }
  }
  return locks;
}

/** Count manual placements (filled cells on active coordinates) per class. */
export function manualCoverage(state) {
  const slots = buildSlots(state);
  const valid = new Set(slots.map((s) => `${s.dayIndex}|${s.periodId}`));
  let filled = 0;
  for (const klass of state.classes) {
    const byDay = state.manual.cells?.[klass.id] ?? {};
    for (const [dayIndex, byPeriod] of Object.entries(byDay)) {
      for (const [periodId, cell] of Object.entries(byPeriod)) {
        if (cell && valid.has(`${dayIndex}|${periodId}`)) filled += 1;
      }
    }
  }
  return { filled, total: slots.length * state.classes.length };
}
