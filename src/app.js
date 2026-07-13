// app.js — bootstrap: tab routing, theme, undo/redo (buttons + shortcuts).

import { mountSetup } from './views/setup.js';
import { mountManual } from './views/manual.js';
import { mountAuto } from './views/auto.js';
import { mountDashboard } from './views/dashboard.js';
import { mountExport } from './views/export.js';
import {
  undo, redo, canUndo, canRedo, subscribe, getTheme, setTheme,
} from './store.js';

const views = {
  setup: mountSetup,
  manual: mountManual,
  auto: mountAuto,
  dashboard: mountDashboard,
  export: mountExport,
};

const stage = document.getElementById('stage');
const navButtons = [...document.querySelectorAll('.nav__item')];
const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');
const themeBtn = document.getElementById('themeBtn');

let cleanup = null;

// ---------- routing ----------

function navigate(name) {
  if (!views[name]) name = 'setup';
  cleanup?.();
  stage.replaceChildren();
  for (const button of navButtons) {
    button.setAttribute('aria-current', button.dataset.view === name ? 'page' : 'false');
  }
  cleanup = views[name](stage);
  if (location.hash !== `#${name}`) location.hash = name;
}

for (const button of navButtons) {
  button.addEventListener('click', () => navigate(button.dataset.view));
}
window.addEventListener('hashchange', () => navigate(location.hash.slice(1)));

// ---------- undo / redo ----------

function refreshHistoryButtons() {
  undoBtn.disabled = !canUndo();
  redoBtn.disabled = !canRedo();
}
undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);
subscribe(refreshHistoryButtons);

window.addEventListener('keydown', (event) => {
  const mod = event.ctrlKey || event.metaKey;
  if (!mod) return;
  const key = event.key.toLowerCase();
  const inField = /^(input|select|textarea)$/i.test(document.activeElement?.tagName ?? '');
  if (inField) return; // don't hijack text editing
  if (key === 'z' && !event.shiftKey) { event.preventDefault(); undo(); }
  else if ((key === 'z' && event.shiftKey) || key === 'y') { event.preventDefault(); redo(); }
});

// ---------- theme ----------

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  setTheme(theme);
}
themeBtn.addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});
applyTheme(getTheme());

// ---------- go ----------

refreshHistoryButtons();
navigate(location.hash.slice(1) || 'setup');
