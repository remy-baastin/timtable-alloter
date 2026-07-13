// views/setup.js — configure days, periods, teachers, classes; live issue strip.

import { el, clear, downloadFile } from '../dom.js';
import {
  getState, update, subscribe, exportJSON, importJSON, loadDemo, clearAll,
} from '../store.js';
import { WEEKDAYS, teachingSlotCount, listTokens, tokenLabel } from '../model.js';
import { liveIssues } from '../validation.js';

export function mountSetup(root) {
  const unsubscribe = subscribe(render);
  render();
  return unsubscribe;

  function render() {
    clear(root);
    const state = getState();
    root.append(
      el('div', { class: 'page__head' },
        el('h1', { class: 'page__title' }, 'Setup'),
        el('p', { class: 'page__lede' },
          'Define the week, the people, and each class\u2019s weekly subject counts. ' +
          'Issues update as you commit changes.'),
      ),
      issuesStrip(state),
      daysCard(state),
      periodsCard(state),
      teachersCard(state),
      classesCard(state),
      dataCard(),
    );
  }
}

function issuesStrip(state) {
  const issues = liveIssues(state);
  if (issues.length === 0) {
    return el('div', { class: 'banner banner--ok' }, 'Setup is consistent — Auto can run.');
  }
  return el(
    'div',
    { class: 'banner banner--warn' },
    el('strong', {}, `${issues.length} issue${issues.length > 1 ? 's' : ''} to resolve`),
    el('ul', {}, ...issues.map((i) => el('li', {}, i))),
  );
}

// ---------- Days ----------

function daysCard(state) {
  const pills = WEEKDAYS.map((day) => {
    const on = state.days.includes(day);
    return el(
      'label',
      { class: on ? 'pill pill--on' : 'pill' },
      el('input', {
        type: 'checkbox', checked: on,
        onChange: () =>
          update((draft) => {
            draft.days = WEEKDAYS.filter((d) => (d === day ? !on : draft.days.includes(d)));
          }),
      }),
      day,
    );
  });
  return card('Days', `${state.days.length} active`, el('div', { class: 'pills' }, ...pills));
}

// ---------- Periods ----------

function periodsCard(state) {
  const rows = state.periods.map((period, index) =>
    el(
      'div',
      { class: 'list__row' },
      textInput(period.name, 'Name', 'w-mid', (v) => update((d) => { d.periods[index].name = v; })),
      timeInput(period.start, (v) => update((d) => { d.periods[index].start = v; })),
      timeInput(period.end, (v) => update((d) => { d.periods[index].end = v; })),
      el('label', { class: 'row', style: 'gap:6px;font-size:12px;color:var(--ink-soft)' },
        el('input', {
          type: 'checkbox', checked: period.teaching,
          onChange: (e) => update((d) => { d.periods[index].teaching = e.target.checked; }),
        }),
        'Teaching',
      ),
      el('span', { class: 'grow' }),
      moveButtons(index, state.periods.length, (from, to) =>
        update((d) => { const [p] = d.periods.splice(from, 1); d.periods.splice(to, 0, p); }),
      ),
      removeButton(() => update((d) => { d.periods.splice(index, 1); })),
    ),
  );

  return card(
    'Periods',
    el('span', {}, 'Teaching slots / week: ', el('strong', {}, String(teachingSlotCount(state)))),
    rows.length ? el('div', { class: 'list' }, ...rows) : empty('No periods yet.'),
    el('div', { class: 'row', style: 'margin-top:10px' },
      ghostButton('+ Add period', () =>
        update((d) => {
          d.periods.push({
            id: uid('p'),
            name: `P${d.periods.filter((p) => p.teaching).length + 1}`,
            start: '', end: '', teaching: true,
          });
        }),
      ),
    ),
  );
}

// ---------- Teachers ----------

function teachersCard(state) {
  const blocks = state.teachers.map((teacher, ti) => {
    const head = el(
      'div',
      { class: 'list__row' },
      textInput(teacher.id, 'ID', 'w-narrow', (v) => update((d) => { d.teachers[ti].id = v.trim(); })),
      textInput(teacher.name, 'Name', 'w-mid', (v) => update((d) => { d.teachers[ti].name = v; })),
      labelled('Max / week', numberInput(teacher.maxPerWeek, (v) =>
        update((d) => { d.teachers[ti].maxPerWeek = v; }))),
      el('span', { class: 'grow' }),
      removeButton(() => update((d) => { d.teachers.splice(ti, 1); })),
    );

    const subjectRows = teacher.subjects.map((subject, si) =>
      el(
        'div',
        { class: 'list__row list__row--sub' },
        textInput(subject.code, 'Code', 'w-narrow', (v) =>
          update((d) => { d.teachers[ti].subjects[si].code = v.trim().toUpperCase(); })),
        labelled('Max / week', numberInput(subject.maxPerWeek, (v) =>
          update((d) => { d.teachers[ti].subjects[si].maxPerWeek = v; }))),
        el('span', { class: 'muted mono' }, tokenLabel(teacher.id, subject.code)),
        el('span', { class: 'grow' }),
        removeButton(() => update((d) => { d.teachers[ti].subjects.splice(si, 1); })),
      ),
    );

    const addSubject = el(
      'div',
      { class: 'list__row list__row--sub' },
      ghostButton('+ Add subject', () =>
        update((d) => { d.teachers[ti].subjects.push({ code: 'NEW', maxPerWeek: 5 }); })),
    );

    return el('div', { class: 'list' }, head, ...subjectRows, addSubject);
  });

  return card(
    'Teachers & subjects',
    'A person may hold several subjects',
    el('div', { class: 'stack' }, ...(blocks.length ? blocks : [empty('No teachers yet.')])),
    el('div', { class: 'row', style: 'margin-top:10px' },
      ghostButton('+ Add teacher', () =>
        update((d) => {
          const n = d.teachers.length + 1;
          d.teachers.push({
            id: `T${String(n).padStart(2, '0')}`, name: '', maxPerWeek: 20,
            subjects: [{ code: 'NEW', maxPerWeek: 5 }],
          });
        }),
      ),
    ),
  );
}

// ---------- Classes ----------

function classesCard(state) {
  const tokens = listTokens(state);
  const required = teachingSlotCount(state);

  const blocks = state.classes.map((klass, ci) => {
    const assignments = klass.assignments ?? [];
    const total = assignments.reduce((s, a) => s + num(a.periodsPerWeek), 0);

    const head = el(
      'div',
      { class: 'list__row' },
      textInput(klass.id, 'ID', 'w-narrow', (v) => update((d) => { d.classes[ci].id = v.trim(); })),
      textInput(klass.name, 'Name', 'w-mid', (v) => update((d) => { d.classes[ci].name = v; })),
      el('span', { class: 'grow' }),
      el('span', { class: total === required ? 'chip chip--ok' : 'chip chip--warn' },
        el('span', { class: 'mono' }, `${total} / ${required}`)),
      removeButton(() => update((d) => { d.classes.splice(ci, 1); })),
    );

    const rows = assignments.map((a, ai) =>
      el(
        'div',
        { class: 'list__row list__row--sub' },
        tokenSelect(tokens, a, (v) =>
          update((d) => {
            const [teacherId, code] = v.split('::');
            d.classes[ci].assignments[ai].teacherId = teacherId;
            d.classes[ci].assignments[ai].code = code;
          })),
        labelled('Periods / week', numberInput(a.periodsPerWeek, (v) =>
          update((d) => { d.classes[ci].assignments[ai].periodsPerWeek = v; }))),
        el('span', { class: 'grow' }),
        removeButton(() => update((d) => { d.classes[ci].assignments.splice(ai, 1); })),
      ),
    );

    const addRow = el(
      'div',
      { class: 'list__row list__row--sub' },
      tokens.length
        ? ghostButton('+ Add subject', () =>
            update((d) => {
              const first = tokens[0];
              d.classes[ci].assignments.push({
                teacherId: first.teacherId, code: first.code, periodsPerWeek: 1,
              });
            }))
        : el('span', { class: 'muted' }, 'Add a teacher first'),
    );

    return el('div', { class: 'list' }, head, ...rows, addRow);
  });

  return card(
    'Classes',
    el('span', {}, 'Each class must total ', el('strong', {}, String(required)), ' periods'),
    el('div', { class: 'stack' }, ...(blocks.length ? blocks : [empty('No classes yet.')])),
    el('div', { class: 'row', style: 'margin-top:10px' },
      ghostButton('+ Add class', () =>
        update((d) => {
          const n = d.classes.length + 1;
          d.classes.push({ id: `C${n}`, name: '', assignments: [] });
        }),
      ),
    ),
  );
}

// ---------- Data ----------

function dataCard() {
  const fileInput = el('input', {
    type: 'file', accept: 'application/json', style: 'display:none',
    onChange: (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      file.text().then((text) => {
        try { importJSON(text); }
        catch (err) { alert(`Could not import: ${err.message}`); }
      });
      e.target.value = '';
    },
  });

  return card(
    'Data',
    'Saved automatically in this browser',
    el('div', { class: 'row' },
      el('button', {
        class: 'btn', type: 'button',
        onClick: () => downloadFile('timetable-config.json', exportJSON(), 'application/json'),
      }, 'Export config'),
      el('button', { class: 'btn', type: 'button', onClick: () => fileInput.click() }, 'Import config'),
      fileInput,
      el('span', { class: 'grow' }),
      el('button', { class: 'btn', type: 'button', onClick: () => loadDemo() }, 'Load demo'),
      el('button', {
        class: 'btn btn--danger', type: 'button',
        onClick: () => { if (confirm('Clear all data? Undo can restore it.')) clearAll(); },
      }, 'Clear all'),
    ),
  );
}

// ---------- small builders ----------

function card(title, note, ...body) {
  return el(
    'section',
    { class: 'card' },
    el('div', { class: 'card__head' },
      el('h2', { class: 'card__title' }, title),
      el('span', { class: 'card__note' }, note)),
    ...body,
  );
}

function textInput(value, placeholder, sizeClass, onCommit) {
  return el('input', {
    type: 'text', value: value ?? '', placeholder, class: sizeClass || '',
    onChange: (e) => onCommit(e.target.value),
  });
}

function numberInput(value, onCommit) {
  return el('input', {
    type: 'number', min: '0', step: '1', value: String(value ?? 0), class: 'w-narrow',
    onChange: (e) => onCommit(Math.max(0, Math.floor(Number(e.target.value) || 0))),
  });
}

function timeInput(value, onCommit) {
  return el('input', { type: 'time', value: value ?? '', onChange: (e) => onCommit(e.target.value) });
}

function labelled(text, control) {
  return el('label', { class: 'field' }, text, control);
}

function tokenSelect(tokens, assignment, onCommit) {
  const current = `${assignment.teacherId}::${assignment.code}`;
  const options = tokens.map((t) =>
    el('option', { value: t.key, selected: t.key === current },
      t.teacherName ? `${t.label} (${t.teacherName})` : t.label));
  if (!tokens.some((t) => t.key === current)) {
    options.unshift(el('option', { value: current, selected: true },
      `${tokenLabel(assignment.teacherId, assignment.code)} (undefined)`));
  }
  return el('select', { onChange: (e) => onCommit(e.target.value) }, ...options);
}

function ghostButton(text, onClick) {
  return el('button', { class: 'btn btn--ghost', type: 'button', onClick }, text);
}

function removeButton(onClick) {
  return el('button', { class: 'btn btn--danger', type: 'button', onClick, title: 'Remove' }, 'Remove');
}

function moveButtons(index, length, move) {
  return el(
    'span',
    { class: 'row', style: 'gap:2px' },
    el('button', {
      class: 'btn btn--ghost', type: 'button', disabled: index === 0,
      title: 'Move up', 'aria-label': 'Move up',
      onClick: () => move(index, index - 1),
    }, '\u2191'),
    el('button', {
      class: 'btn btn--ghost', type: 'button', disabled: index === length - 1,
      title: 'Move down', 'aria-label': 'Move down',
      onClick: () => move(index, index + 1),
    }, '\u2193'),
  );
}

function empty(text) {
  return el('div', { class: 'empty' }, text);
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

let counter = 0;
function uid(prefix) {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter}`;
}
