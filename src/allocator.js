// allocator.js — assign every class's weekly periods to slots with no teacher
// double-booked in the same slot, honouring locked placements. Pure function.
//
// Without locks this is bipartite edge colouring: one edge per period a class
// needs from a teacher. Each class has degree S (the slot count) and, after
// prechecks, each teacher has degree <= S, so by König's theorem the multigraph
// colours with exactly S colours; each colour is a class-saturating matching —
// one slot's clash-free assignment. We pad to an S-regular graph with dummy
// vertices and peel off S perfect matchings. This path never refuses a
// feasible instance and needs no retries.
//
// Locks pin (class, slot) -> token before colouring. Pre-coloured edge
// colouring has no polynomial guarantee, so locks are handled exactly per
// slot with restarts: locked edges are reserved out of the demand, each slot's
// matching is completed around its locks, and on failure the whole peel is
// retried with a different slot order and matching tie-breaks (seeded PRNG,
// deterministic). If every attempt fails, the refusal names the slot and locks
// that could not be completed so the UI can say exactly what to unlock.
//
// Within a class, two subjects sharing a teacher (T02·PHY / T02·OPT) are
// interchangeable for clash purposes; the concrete subject is drawn from the
// class↔teacher bucket when an edge is realised. Locked tokens are reserved
// first so a lock always keeps its exact subject.

const LOCK_ATTEMPTS = 48;

/**
 * @param {Object} input
 * @param {Array<{dayIndex:number, periodId:string}>} input.slots
 * @param {Array<{id:string, demand:Array<{key:string, count:number}>}>} input.classes
 * @param {Object<string,string>} input.teacherOfKey  token key -> teacher id
 * @param {Array<{classId:string, slotIndex:number, key:string}>} [input.locks]
 * @returns {{ ok:true, assign:Object } |
 *           { ok:false, failedSlot?:number, failedLocks?:Array<{classId:string,key:string}> }}
 *   assign[classId][slotIndex] = token key
 */
export function allocate(input) {
  const { slots, classes, teacherOfKey } = input;
  const locks = input.locks ?? [];
  const degree = slots.length;
  const classCount = classes.length;
  if (classCount === 0 || degree === 0) return { ok: false };

  // ---- index classes and teachers ----
  const classIndexOf = new Map(classes.map((c, i) => [c.id, i]));
  const teacherIndex = new Map();
  for (const klass of classes) {
    for (const { key, count } of klass.demand) {
      if (count <= 0) continue;
      const id = teacherOfKey[key];
      if (!teacherIndex.has(id)) teacherIndex.set(id, teacherIndex.size);
    }
  }
  const size = Math.max(classCount, teacherIndex.size);

  // ---- build multigraph + token buckets ----
  const mult0 = Array.from({ length: size }, () => new Int32Array(size));
  const bucket0 = new Map();

  for (let c = 0; c < classCount; c += 1) {
    let edges = 0;
    for (const { key, count } of classes[c].demand) {
      if (count <= 0) continue;
      const t = teacherIndex.get(teacherOfKey[key]);
      mult0[c][t] += count;
      const cell = c * size + t;
      const queue = bucket0.get(cell) ?? [];
      for (let i = 0; i < count; i += 1) queue.push(key);
      bucket0.set(cell, queue);
      edges += count;
    }
    if (edges !== degree) return { ok: false }; // prechecks should prevent this
  }

  // ---- reserve locked edges ----
  const locksBySlot = new Map();
  for (const lock of locks) {
    const c = classIndexOf.get(lock.classId);
    if (c === undefined || lock.slotIndex < 0 || lock.slotIndex >= degree) continue;
    const t = teacherIndex.get(teacherOfKey[lock.key]);
    if (t === undefined || mult0[c][t] <= 0) return { ok: false };
    mult0[c][t] -= 1;
    const queue = bucket0.get(c * size + t) ?? [];
    const at = queue.lastIndexOf(lock.key);
    if (at === -1) return { ok: false };
    queue.splice(at, 1);
    const list = locksBySlot.get(lock.slotIndex) ?? [];
    list.push({ classIndex: c, teacherIdx: t, key: lock.key });
    locksBySlot.set(lock.slotIndex, list);
  }

  // Two locks in one slot must not share a teacher or a class.
  for (const [slot, list] of locksBySlot) {
    const teachers = new Set();
    const classSet = new Set();
    for (const { classIndex, teacherIdx } of list) {
      if (teachers.has(teacherIdx) || classSet.has(classIndex)) {
        return { ok: false, failedSlot: slot, failedLocks: describeLocks(list, classes) };
      }
      teachers.add(teacherIdx);
      classSet.add(classIndex);
    }
  }

  // ---- pad unlocked degrees so every slot can host a full matching ----
  makeRegular(mult0, size, degree, locksBySlot);

  // ---- attempts ----
  const baseOrder = Array.from({ length: degree }, (_, i) => i).sort(
    (a, b) => (locksBySlot.get(b)?.length ?? 0) - (locksBySlot.get(a)?.length ?? 0),
  );

  const attempts = locksBySlot.size === 0 ? 1 : LOCK_ATTEMPTS;
  let firstFailure = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const rand = mulberry32(0x51ed270b ^ (attempt * 2654435761));
    const order = attempt === 0 ? baseOrder : shuffled(baseOrder, rand);
    const offset = attempt === 0 ? 0 : Math.floor(rand() * size);

    const outcome = peel({
      mult: mult0.map((row) => row.slice()),
      bucket: cloneBucket(bucket0),
      size, degree, order, offset,
      classes, classCount, locksBySlot,
    });
    if (outcome.ok) return outcome;
    firstFailure ??= outcome;
  }
  return firstFailure ?? { ok: false };
}

/** One full peel: a matching per slot in `order`. Mutates its own copies. */
function peel({ mult, bucket, size, degree, order, offset, classes, classCount, locksBySlot }) {
  const assign = {};
  for (const klass of classes) assign[klass.id] = {};

  const matchRight = new Int32Array(size);
  for (const slot of order) {
    const slotLocks = locksBySlot.get(slot) ?? [];
    const lockedLeft = new Uint8Array(size);
    const lockedRight = new Uint8Array(size);
    for (const { classIndex, teacherIdx } of slotLocks) {
      lockedLeft[classIndex] = 1;
      lockedRight[teacherIdx] = 1;
    }

    matchRight.fill(-1);
    for (let right = 0; right < size; right += 1) if (lockedRight[right]) matchRight[right] = -2;

    let complete = true;
    for (let left = 0; left < size; left += 1) {
      if (lockedLeft[left]) continue;
      const seen = new Uint8Array(size);
      if (!augment(left, mult, matchRight, seen, size, offset)) { complete = false; break; }
    }
    if (!complete) {
      return { ok: false, failedSlot: slot, failedLocks: describeLocks(slotLocks, classes) };
    }

    for (const { classIndex, key } of slotLocks) {
      assign[classes[classIndex].id][slot] = key;
    }
    for (let right = 0; right < size; right += 1) {
      const left = matchRight[right];
      if (left < 0) continue;
      mult[left][right] -= 1;
      if (left < classCount) {
        const queue = bucket.get(left * size + right);
        if (queue && queue.length) assign[classes[left].id][slot] = queue.pop();
      }
    }
  }
  return { ok: true, assign };
}

/** Kuhn's augmenting-path step; `offset` rotates the scan for attempt diversity. */
function augment(left, mult, matchRight, seen, size, offset) {
  const row = mult[left];
  for (let step = 0; step < size; step += 1) {
    const right = (step + offset) % size;
    if (row[right] <= 0 || seen[right] || matchRight[right] === -2) continue;
    seen[right] = 1;
    if (matchRight[right] === -1 || augment(matchRight[right], mult, matchRight, seen, size, offset)) {
      matchRight[right] = left;
      return true;
    }
  }
  return false;
}

/**
 * Pad every vertex's UNLOCKED degree toward its per-peel need: left i must be
 * matched in (degree - locks_i) peels, right j in at most that many. Dummy
 * edges are added greedily between under-full rows and columns; totals agree
 * because both sides sum to size*degree - totalLocks.
 */
function makeRegular(mult, size, deg, locksBySlot) {
  const lockLeft = new Int32Array(size);
  const lockRight = new Int32Array(size);
  for (const list of locksBySlot.values()) {
    for (const { classIndex, teacherIdx } of list) {
      lockLeft[classIndex] += 1;
      lockRight[teacherIdx] += 1;
    }
  }

  const rowDeg = new Int32Array(size);
  const colDeg = new Int32Array(size);
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j < size; j += 1) {
      rowDeg[i] += mult[i][j];
      colDeg[j] += mult[i][j];
    }
  }

  let i = 0;
  let j = 0;
  while (i < size && j < size) {
    if (rowDeg[i] >= deg - lockLeft[i]) { i += 1; continue; }
    if (colDeg[j] >= deg - lockRight[j]) { j += 1; continue; }
    const add = Math.min(deg - lockLeft[i] - rowDeg[i], deg - lockRight[j] - colDeg[j]);
    mult[i][j] += add;
    rowDeg[i] += add;
    colDeg[j] += add;
  }
}

function cloneBucket(bucket) {
  const copy = new Map();
  for (const [key, queue] of bucket) copy.set(key, queue.slice());
  return copy;
}

function shuffled(array, rand) {
  const out = array.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Small seeded PRNG so attempts are deterministic run-to-run. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function describeLocks(list, classes) {
  return list.map(({ classIndex, key }) => ({ classId: classes[classIndex].id, key }));
}
