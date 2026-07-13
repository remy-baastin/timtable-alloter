// exporter.js — render results to downloadable, print-optimized HTML and CSV.

import { tokenLabel, periodTimeLabel } from './model.js';

/**
 * Standalone HTML document.
 * @param {Object} classResult
 * @param {string[]} classIds
 * @param {Object|null} teacherResult - include teacher weeks when provided
 */
export function buildHTML(classResult, classIds, teacherResult = null) {
  const classTables = classResult.classes
    .filter((c) => classIds.includes(c.id))
    .map((klass) =>
      tableHTML(klass.id, klass.name, classResult, (d, p) => {
        const token = classResult.cell(klass.id, d, p);
        return token ? tokenLabel(token.teacherId, token.code) : null;
      }),
    )
    .join('\n');

  const teacherTables = teacherResult
    ? teacherResult.teachers
        .map((t) =>
          tableHTML(t.id, t.name, teacherResult, (d, p) => {
            const cell = teacherResult.cell(t.id, d, p);
            return cell ? `${cell.classId}\u00b7${cell.code}` : null;
          }, 'Free'),
        )
        .join('\n')
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Timetable</title>
<style>
  body { font-family: system-ui, Arial, sans-serif; color: #17211d; margin: 32px; }
  h1 { font-size: 18px; margin-bottom: 4px; }
  .sub { color: #8b948f; font-size: 12px; margin: 0 0 18px; }
  h2 { font-size: 15px; margin: 26px 0 8px; }
  h2 span { color: #8b948f; font-weight: 400; margin-left: 6px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #d4dad6; padding: 6px 9px; text-align: center; font-size: 13px; }
  thead th { background: #f2f5f3; }
  th.period { text-align: left; white-space: nowrap; background: #f2f5f3; }
  th.period small { display: block; color: #8b948f; font-weight: 400; font-family: monospace; }
  td.token { font-family: monospace; }
  td.break { background: #f2f5f3; color: #8b948f; font-style: italic; }
  td.free { color: #b3bab5; }
  section.block { page-break-inside: avoid; }
  @media print {
    body { margin: 0; }
    section.block { page-break-after: always; }
    section.block:last-child { page-break-after: auto; }
  }
</style>
</head>
<body>
<h1>Weekly Timetable</h1>
<p class="sub">Generated ${new Date().toLocaleString()}</p>
${classTables}
${teacherTables ? `<h1 style="margin-top:36px">Teacher Timetables</h1>\n${teacherTables}` : ''}
</body>
</html>`;
}

function tableHTML(id, name, shape, cellText, emptyText = '&mdash;') {
  const headCols = shape.days.map((d) => `<th>${escape(d)}</th>`).join('');
  const rows = shape.periods
    .map((period) => {
      const label =
        `<th class="period">${escape(period.name)}` +
        (periodTimeLabel(period) ? `<small>${escape(periodTimeLabel(period))}</small>` : '') +
        '</th>';

      if (!period.teaching) {
        return `<tr>${label}<td class="break" colspan="${shape.days.length}">${escape(period.name)}</td></tr>`;
      }
      const cells = shape.days
        .map((_, dayIndex) => {
          const text = cellText(dayIndex, period.id);
          return text
            ? `<td class="token">${escape(text)}</td>`
            : `<td class="free">${emptyText}</td>`;
        })
        .join('');
      return `<tr>${label}${cells}</tr>`;
    })
    .join('');

  const sub = name ? ` <span>${escape(name)}</span>` : '';
  return `<section class="block"><h2>${escape(id)}${sub}</h2>
<table><thead><tr><th class="period">Period</th>${headCols}</tr></thead><tbody>${rows}</tbody></table></section>`;
}

/** One CSV file: a labelled block per class (and per teacher when provided). */
export function buildCSV(classResult, classIds, teacherResult = null) {
  const blocks = [];

  for (const klass of classResult.classes.filter((c) => classIds.includes(c.id))) {
    blocks.push(
      csvBlock(
        klass.name ? `${klass.id} ${klass.name}` : klass.id,
        classResult,
        (d, p) => {
          const token = classResult.cell(klass.id, d, p);
          return token ? tokenLabel(token.teacherId, token.code) : '';
        },
      ),
    );
  }

  if (teacherResult) {
    for (const teacher of teacherResult.teachers) {
      blocks.push(
        csvBlock(
          teacher.name ? `Teacher ${teacher.id} ${teacher.name}` : `Teacher ${teacher.id}`,
          teacherResult,
          (d, p) => {
            const cell = teacherResult.cell(teacher.id, d, p);
            return cell ? `${cell.classId}\u00b7${cell.code}` : '';
          },
        ),
      );
    }
  }

  return blocks.join('\r\n\r\n');
}

function csvBlock(title, shape, cellText) {
  const lines = [csvRow([title]), csvRow(['Period', ...shape.days])];
  for (const period of shape.periods) {
    const label = periodTimeLabel(period)
      ? `${period.name} (${periodTimeLabel(period)})`
      : period.name;
    if (!period.teaching) {
      lines.push(csvRow([label, ...shape.days.map(() => period.name)]));
      continue;
    }
    lines.push(csvRow([label, ...shape.days.map((_, d) => cellText(d, period.id))]));
  }
  return lines.join('\r\n');
}

function csvRow(values) {
  return values.map(csvField).join(',');
}

function csvField(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function escape(text) {
  return String(text ?? '').replace(/[&<>"]/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]),
  );
}
