# Timetable Allotter v2

A static, client-side weekly timetable tool for a school. No backend, no build
step, no dependencies — plain HTML, CSS, and ES modules. Everything stays in
the browser (auto-saved to `localStorage`).

## What's new in v2

- **Redesigned shell** — sidebar navigation on desktop, bottom tab bar on
  mobile; timetables scroll horizontally on small screens.
- **Dark / light theme**, persisted.
- **Undo / redo** everywhere (buttons or Ctrl+Z / Ctrl+Shift+Z).
- **Click-to-place Manual mode** — tap a cell, pick from a palette; busy
  teachers are blocked with the clashing class named; cap overruns warn.
- **Locked cells (◆)** — pin a manual placement and Auto builds *around* it.
  If a lock makes the week impossible, the refusal names the exact slot and
  locks to review.
- **Dashboard** — coverage, staff utilisation, busiest teacher, per-person and
  per-subject load meters, and each teacher's personal week.
- **Teacher timetables in exports** — optional extra tables in HTML and CSV.
- **Live validation strip** in Setup — issues appear as you edit, not at
  allot time.

## Run it

ES modules don't load over `file://`, so use a static server or GitHub Pages.

```bash
# from this folder
python3 -m http.server 8000
# open http://localhost:8000
```



## How the auto-allotter works

The schedule is modelled as a bipartite multigraph (classes ↔ teachers, one
edge per weekly period). Filling the week is edge colouring: each colour is one
slot's clash-free assignment. Because every class needs exactly S periods and
the prechecks cap every teacher at S, König's theorem guarantees a colouring
exists — the allocator pads the graph to S-regular and peels off S perfect
matchings. It solves 30 classes × 64 slots in single-digit milliseconds and
never refuses a feasible instance.

Locked cells are pre-coloured edges. Locks are subtracted from the demand,
slots are processed most-locked-first, and each slot's matching is completed
around its locks. Locks can genuinely make a week impossible; when that
happens the refusal names the slot and the locks involved.

## Files

```
index.html          shell: sidebar / bottom bar, stage
styles.css          design tokens, two themes, responsive layout
src/
  app.js            routing, theme, undo/redo wiring
  store.js          state, persistence, history
  model.js          derived helpers (tokens, slots, locks)
  validation.js     live issues + auto prechecks (incl. locks)
  allocator.js      edge-colouring scheduler with lock support
  timetable.js      class + teacher result builders and grids
  exporter.js       print-ready HTML + CSV
  dom.js            DOM helpers
  views/            setup / manual / auto / dashboard / export
```
