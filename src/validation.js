// validation.js — necessary conditions checked before the allocator runs, plus
// lock sanity. Each failure is a plain-language reason with a fix.

import {
  teachingSlotCount,
  listTokens,
  tokenLabel,
  tokenKey,
  collectLocks,
  buildSlots,
  findPeriod,
} from './model.js';

/**
 * Validate the auto-mode inputs (structure, sums, caps, locks).
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateForAuto(state) {
  const errors = [...structuralErrors(state), ...capErrors(state), ...lockErrors(state)];
  return { ok: errors.length === 0, errors };
}

/** Live issues for the Setup screen (structure + caps; locks are Manual's concern). */
export function liveIssues(state) {
  return [...structuralErrors(state), ...capErrors(state)];
}

// ---------- structure: sums and defined tokens ----------

function structuralErrors(state) {
  const errors = [];
  const slots = teachingSlotCount(state);

  if (state.days.length === 0) errors.push('No days are selected. Pick at least one day.');
  if (slots === 0) errors.push('There are no teaching periods. Add a period and mark it as teaching.');
  if (state.classes.length === 0) errors.push('No classes defined yet.');

  const tokenSet = new Set(listTokens(state).map((t) => t.key));

  for (const klass of state.classes) {
    const assigned = (klass.assignments ?? []).reduce((s, a) => s + toCount(a.periodsPerWeek), 0);
    if (slots > 0 && assigned !== slots) {
      const diff = slots - assigned;
      errors.push(
        `${classLabel(klass)} totals ${assigned} of ${slots} periods — ` +
          (diff > 0 ? `add ${diff} more.` : `remove ${-diff}.`),
      );
    }
    for (const a of klass.assignments ?? []) {
      if (!tokenSet.has(tokenKey(a.teacherId, a.code))) {
        errors.push(
          `${classLabel(klass)} uses ${tokenLabel(a.teacherId, a.code)}, which is not defined. ` +
            `Add subject ${a.code} to teacher ${a.teacherId}, or remove the row.`,
        );
      }
    }
  }
  return errors;
}

// ---------- caps: token, teacher, and Hall condition ----------

function capErrors(state) {
  const errors = [];
  const slots = teachingSlotCount(state);
  const tokens = listTokens(state);
  const tokenMax = new Map(tokens.map((t) => [t.key, t.subjectMax]));
  const tokenSet = new Set(tokens.map((t) => t.key));
  const teacherMax = new Map(state.teachers.map((t) => [t.id, t.maxPerWeek]));

  const perToken = new Map();
  const perTeacher = new Map();

  for (const klass of state.classes) {
    for (const a of klass.assignments ?? []) {
      const key = tokenKey(a.teacherId, a.code);
      if (!tokenSet.has(key)) continue; // reported structurally
      perToken.set(key, (perToken.get(key) ?? 0) + toCount(a.periodsPerWeek));
      perTeacher.set(a.teacherId, (perTeacher.get(a.teacherId) ?? 0) + toCount(a.periodsPerWeek));
    }
  }

  for (const [key, total] of perToken) {
    const cap = tokenMax.get(key) ?? 0;
    if (total > cap) {
      const [teacherId, code] = key.split('::');
      errors.push(
        `${tokenLabel(teacherId, code)} is booked ${total}/${cap} weekly periods across classes. ` +
          'Raise the subject cap or reduce its periods.',
      );
    }
  }

  for (const [teacherId, total] of perTeacher) {
    const cap = teacherMax.get(teacherId) ?? 0;
    if (total > cap) {
      errors.push(
        `Teacher ${teacherId} is booked ${total}/${cap} weekly periods. ` +
          'Raise the teacher cap or move periods to another teacher.',
      );
    }
    if (slots > 0 && total > slots) {
      errors.push(
        `Teacher ${teacherId} needs ${total} periods but the week only has ${slots} slots — ` +
          'one person can hold at most one class per slot. Spread these across more teachers.',
      );
    }
  }
  return errors;
}

// ---------- locks ----------

function lockErrors(state) {
  const errors = [];
  const locks = collectLocks(state);
  if (locks.length === 0) return errors;

  const slots = buildSlots(state);
  const tokenTeacher = new Map(listTokens(state).map((t) => [t.key, t.teacherId]));

  // Per class: locked count per token must fit within that class's demand.
  const demandOf = new Map();
  for (const klass of state.classes) {
    const m = new Map();
    for (const a of klass.assignments ?? []) {
      m.set(tokenKey(a.teacherId, a.code), (m.get(tokenKey(a.teacherId, a.code)) ?? 0) + toCount(a.periodsPerWeek));
    }
    demandOf.set(klass.id, m);
  }

  const lockedCount = new Map(); // `${classId}|${key}` -> n
  for (const lock of locks) {
    const mapKey = `${lock.classId}|${lock.key}`;
    lockedCount.set(mapKey, (lockedCount.get(mapKey) ?? 0) + 1);
  }
  for (const [mapKey, n] of lockedCount) {
    const [classId, key] = mapKey.split('|');
    const demand = demandOf.get(classId)?.get(key) ?? 0;
    if (n > demand) {
      const [teacherId, code] = key.split('::');
      errors.push(
        `${classId} has ${n} locked ${tokenLabel(teacherId, code)} cell(s) but only ` +
          `${demand} weekly period(s) of it in Setup. Unlock some or raise the count.`,
      );
    }
  }

  // Same slot: two locks must not share a teacher.
  const bySlot = new Map();
  for (const lock of locks) {
    const list = bySlot.get(lock.slotIndex) ?? [];
    list.push(lock);
    bySlot.set(lock.slotIndex, list);
  }
  for (const [slotIndex, list] of bySlot) {
    const seen = new Map();
    for (const lock of list) {
      const teacher = tokenTeacher.get(lock.key);
      if (!teacher) continue;
      if (seen.has(teacher)) {
        errors.push(
          `${slotName(state, slots[slotIndex])}: locked cells in ${seen.get(teacher)} and ` +
            `${lock.classId} both need teacher ${teacher}. Unlock one of them.`,
        );
      } else {
        seen.set(teacher, lock.classId);
      }
    }
  }

  return errors;
}

export function slotName(state, slot) {
  if (!slot) return 'Unknown slot';
  const period = findPeriod(state, slot.periodId);
  return `${state.days[slot.dayIndex] ?? '?'} ${period?.name ?? slot.periodId}`;
}

function toCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function classLabel(klass) {
  return klass.name ? `${klass.id} (${klass.name})` : klass.id;
}
