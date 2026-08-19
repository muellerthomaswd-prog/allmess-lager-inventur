'use strict';

/* =========================================================
   IndexedDB Layer
   ========================================================= */
const DB_NAME = 'allmess-lager-db';
const DB_VERSION = 1;
let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('articles')) {
        d.createObjectStore('articles', { keyPath: 'article_number' });
      }
      if (!d.objectStoreNames.contains('inventory')) {
        d.createObjectStore('inventory', { keyPath: 'key' });
      }
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror = (e) => reject(e.target.error);
  });
}

function tx(store, mode) { return db.transaction(store, mode).objectStore(store); }

function idbGet(store, key) {
  return new Promise((resolve, reject) => {
    const r = tx(store, 'readonly').get(key);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
  });
}
function idbPut(store, value) {
  return new Promise((resolve, reject) => {
    const r = tx(store, 'readwrite').put(value);
    r.onsuccess = () => resolve(value);
    r.onerror = () => reject(r.error);
  });
}
function idbAll(store) {
  return new Promise((resolve, reject) => {
    const r = tx(store, 'readonly').getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => reject(r.error);
  });
}

function inventoryKey(articleNumber, calibrationYear) {
  return articleNumber + '|' + (calibrationYear || '');
}

/* =========================================================
   App State
   ========================================================= */
const state = {
  currentScanNumber: null,
  currentArticle: null,     // {article_number, name, category, requires_calibration_year, notes}
  currentCalibYear: null,   // number or null
  stream: null,
  detecting: false,
};

/* =========================================================
   Navigation
   ========================================================= */
function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if (id !== 'view-scan') stopCamera();
  if (id === 'view-start') refreshStart();
  if (id === 'view-list') renderList();
}

document.querySelectorAll('[data-back]').forEach(btn => {
  btn.addEventListener('click', () => showView(btn.dataset.back));
});

/* =========================================================
   Toast
   ========================================================= */
let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2200);
}

/* =========================================================
   Start page
   ========================================================= */
async function refreshStart() {
  const inv = await idbAll('inventory');
  const positions = inv.length;
  const total = inv.reduce((s, i) => s + i.quantity, 0);
  document.getElementById('stat-positions').textContent = positions;
  document.getElementById('stat-total').textContent = total;

  const last = getLastAction();
  const box = document.getElementById('last-action');
  if (last) {
    document.getElementById('last-action-text').textContent =
      `Zuletzt: ${last.delta > 0 ? '+' : ''}${last.delta} ${last.name}${last.calibrationYear ? ' / ' + last.calibrationYear : ''}`;
    box.classList.remove('hidden');
  } else {
    box.classList.add('hidden');
  }
}

function getLastAction() {
  try { return JSON.parse(localStorage.getItem('lastAction') || 'null'); }
  catch { return null; }
}
function setLastAction(a) { localStorage.setItem('lastAction', JSON.stringify(a)); }
function clearLastAction() { localStorage.removeItem('lastAction'); }

document.getElementById('btn-undo').addEventListener('click', async () => {
  const last = getLastAction();
  if (!last) return;
  const rec = await idbGet('inventory', last.key);
  if (rec) {
    rec.quantity = Math.max(0, rec.quantity - last.delta);
    await idbPut('inventory', rec);
  }
  clearLastAction();
  toast('Letzte Buchung rückgängig gemacht');
  refreshStart();
});

document.getElementById('btn-scan').addEventListener('click', () => {
  state.currentScanNumber = null;
  state.currentArticle = null;
  state.currentCalibYear = null;
  showView('view-scan');
  startCamera();
});

document.getElementById('btn-list').addEventListener('click', () => showView('view-list'));
document.getElementById('btn-export').addEventListener('click', () => showView('view-export'));

/* =========================================================
   Scan view — Camera + BarcodeDetector
   ========================================================= */
async function startCamera() {
  const hintEl = document.getElementById('camera-hint');
  const unsupportedEl = document.getElementById('camera-unsupported');
  const videoEl = document.getElementById('camera');

  if (!('BarcodeDetector' in window)) {
    unsupportedEl.classList.remove('hidden');
    hintEl.classList.add('hidden');
    document.querySelector('.camera-wrap').classList.add('hidden');
    return;
  }
  unsupportedEl.classList.add('hidden');
  document.querySelector('.camera-wrap').classList.remove('hidden');
  hintEl.classList.remove('hidden');

  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 960 } }
    });
    videoEl.srcObject = state.stream;
    await videoEl.play();

    let formats = ['code_128', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'code_39', 'qr_code'];
    try {
      const supported = await BarcodeDetector.getSupportedFormats();
      formats = formats.filter(f => supported.includes(f));
    } catch (e) { /* keep default list */ }

    const detector = new BarcodeDetector({ formats });
    state.detecting = true;
    detectLoop(detector, videoEl);
  } catch (err) {
    unsupportedEl.textContent = 'Kamera-Zugriff nicht möglich (' + err.message + '). Bitte Artikelnummer manuell eingeben.';
    unsupportedEl.classList.remove('hidden');
  }
}

async function detectLoop(detector, videoEl) {
  if (!state.detecting) return;
  try {
    const codes = await detector.detect(videoEl);
    if (codes.length > 0) {
      const value = codes[0].rawValue.trim();
      if (value) {
        state.detecting = false;
        handleScannedNumber(value);
        return;
      }
    }
  } catch (e) { /* transient decode errors are normal, keep looping */ }
  requestAnimationFrame(() => detectLoop(detector, videoEl));
}

function stopCamera() {
  state.detecting = false;
  if (state.stream) {
    state.stream.getTracks().forEach(t => t.stop());
    state.stream = null;
  }
}

document.getElementById('manual-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('manual-input');
  const value = input.value.trim();
  if (!value) return;
  input.value = '';
  handleScannedNumber(value);
});

async function handleScannedNumber(number) {
  state.currentScanNumber = number;
  const article = await idbGet('articles', number);

  if (article) {
    state.currentArticle = article;
    document.getElementById('found-name').textContent = article.name;
    document.getElementById('found-number').textContent = article.article_number;
    document.getElementById('found-category').textContent = article.category;
    showView('view-found');
  } else {
    document.getElementById('newarticle-number').textContent = number;
    document.getElementById('newarticle-form').reset();
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('selected'));
    document.getElementById('newarticle-calib').checked = false;
    showView('view-newarticle');
  }
}

document.getElementById('btn-found-continue').addEventListener('click', () => {
  proceedAfterArticleKnown(state.currentArticle);
});

/* =========================================================
   New article form
   ========================================================= */
let selectedCategory = null;
document.querySelectorAll('.cat-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedCategory = btn.dataset.cat;
    document.getElementById('newarticle-calib').checked = btn.dataset.calib === '1';
  });
});

document.getElementById('newarticle-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('newarticle-name').value.trim();
  const notes = document.getElementById('newarticle-notes').value.trim();
  const requiresCalib = document.getElementById('newarticle-calib').checked;

  if (!name) { toast('Bitte Artikelbezeichnung eingeben'); return; }
  if (!selectedCategory) { toast('Bitte Kategorie wählen'); return; }

  const article = {
    article_number: state.currentScanNumber,
    name,
    category: selectedCategory,
    requires_calibration_year: requiresCalib,
    notes: notes || null,
  };
  await idbPut('articles', article);
  state.currentArticle = article;
  selectedCategory = null;
  toast('Artikel angelegt');
  proceedAfterArticleKnown(article);
});

/* =========================================================
   Routing after article is known (found or newly created)
   ========================================================= */
function proceedAfterArticleKnown(article) {
  if (article.requires_calibration_year) {
    openCalibYearView(article);
  } else {
    state.currentCalibYear = null;
    openQuantityView(article, null);
  }
}

/* =========================================================
   Calibration year view
   ========================================================= */
function openCalibYearView(article) {
  document.getElementById('calibyear-context').textContent = article.name;
  const grid = document.getElementById('year-grid');
  grid.innerHTML = '';
  const nowYear = new Date().getFullYear();
  const years = [nowYear - 2, nowYear - 1, nowYear, nowYear + 1];
  years.forEach(y => {
    const b = document.createElement('button');
    b.className = 'year-btn';
    b.textContent = y;
    b.addEventListener('click', () => selectCalibYear(y));
    grid.appendChild(b);
  });
  document.getElementById('calibyear-manual').value = '';
  showView('view-calibyear');
}

function selectCalibYear(year) {
  state.currentCalibYear = year;
  openQuantityView(state.currentArticle, year);
}

document.getElementById('btn-calibyear-manual').addEventListener('click', () => {
  const v = parseInt(document.getElementById('calibyear-manual').value, 10);
  if (!v || v < 1990 || v > 2100) { toast('Bitte gültiges Jahr eingeben'); return; }
  selectCalibYear(v);
});

/* =========================================================
   Quantity view
   ========================================================= */
async function openQuantityView(article, calibYear) {
  const key = inventoryKey(article.article_number, calibYear);
  let rec = await idbGet('inventory', key);
  if (!rec) {
    rec = {
      key,
      article_number: article.article_number,
      calibration_year: calibYear || null,
      quantity: 0,
      last_scanned: new Date().toISOString(),
      scan_count: 0,
    };
  }
  state.currentInventoryKey = key;

  document.getElementById('qty-name').textContent = article.name;
  document.getElementById('qty-meta').textContent =
    article.article_number + (calibYear ? ' · Eichjahr ' + calibYear : '');
  document.getElementById('qty-current').textContent = rec.quantity;
  document.getElementById('qty-manual-row').classList.add('hidden');

  showView('view-quantity');
}

document.querySelectorAll('.qty-btn').forEach(btn => {
  btn.addEventListener('click', () => applyDelta(parseInt(btn.dataset.delta, 10)));
});

async function applyDelta(delta) {
  const key = state.currentInventoryKey;
  let rec = await idbGet('inventory', key);
  if (!rec) {
    rec = {
      key,
      article_number: state.currentArticle.article_number,
      calibration_year: state.currentCalibYear || null,
      quantity: 0,
      last_scanned: new Date().toISOString(),
      scan_count: 0,
    };
  }
  rec.quantity = Math.max(0, rec.quantity + delta);
  rec.last_scanned = new Date().toISOString();
  rec.scan_count = (rec.scan_count || 0) + 1;
  await idbPut('inventory', rec);

  document.getElementById('qty-current').textContent = rec.quantity;

  setLastAction({
    key,
    delta,
    name: state.currentArticle.name,
    calibrationYear: state.currentCalibYear,
  });
}

document.getElementById('btn-qty-manual-toggle').addEventListener('click', () => {
  document.getElementById('qty-manual-row').classList.toggle('hidden');
});

document.getElementById('btn-qty-manual-set').addEventListener('click', async () => {
  const v = parseInt(document.getElementById('qty-manual-input').value, 10);
  if (isNaN(v) || v < 0) { toast('Bitte gültige Menge eingeben'); return; }
  const key = state.currentInventoryKey;
  let rec = await idbGet('inventory', key);
  const previous = rec ? rec.quantity : 0;
  if (!rec) {
    rec = {
      key,
      article_number: state.currentArticle.article_number,
      calibration_year: state.currentCalibYear || null,
      quantity: 0,
      last_scanned: new Date().toISOString(),
      scan_count: 0,
    };
  }
  rec.quantity = v;
  rec.last_scanned = new Date().toISOString();
  rec.scan_count = (rec.scan_count || 0) + 1;
  await idbPut('inventory', rec);
  document.getElementById('qty-current').textContent = rec.quantity;
  document.getElementById('qty-manual-input').value = '';
  document.getElementById('qty-manual-row').classList.add('hidden');

  setLastAction({
    key,
    delta: v - previous,
    name: state.currentArticle.name,
    calibrationYear: state.currentCalibYear,
  });
  toast('Menge gesetzt: ' + v);
});

document.getElementById('btn-qty-next').addEventListener('click', () => {
  state.currentScanNumber = null;
  state.currentArticle = null;
  state.currentCalibYear = null;
  showView('view-scan');
  startCamera();
});

document.getElementById('btn-qty-finish').addEventListener('click', () => showView('view-start'));

/* =========================================================
   Inventory list view
   ========================================================= */
let listFilter = 'Alle';

document.querySelectorAll('#list-filter .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#list-filter .chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    listFilter = chip.dataset.filter;
    renderList();
  });
});
document.getElementById('list-search').addEventListener('input', renderList);

async function getJoinedInventory() {
  const [inv, articles] = await Promise.all([idbAll('inventory'), idbAll('articles')]);
  const byNumber = {};
  articles.forEach(a => byNumber[a.article_number] = a);
  return inv
    .filter(i => i.quantity > 0 || true) // show all positions, including zero
    .map(i => {
      const a = byNumber[i.article_number] || {};
      return {
        article_number: i.article_number,
        name: a.name || '(unbekannt)',
        category: a.category || 'Sonstiges',
        calibration_year: i.calibration_year,
        quantity: i.quantity,
      };
    })
    .sort((x, y) => x.category.localeCompare(y.category) || x.name.localeCompare(y.name) || (x.calibration_year||0) - (y.calibration_year||0));
}

async function renderList() {
  const rows = await getJoinedInventory();
  const search = document.getElementById('list-search').value.trim().toLowerCase();

  const filtered = rows.filter(r => {
    if (listFilter !== 'Alle' && r.category !== listFilter) return false;
    if (!search) return true;
    const hay = [r.article_number, r.name, r.category, r.calibration_year].join(' ').toLowerCase();
    return hay.includes(search);
  });

  const container = document.getElementById('list-table');
  const empty = document.getElementById('list-empty');
  container.innerHTML = '';

  if (filtered.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  filtered.forEach(r => {
    const row = document.createElement('div');
    row.className = 'list-row';
    row.innerHTML = `
      <div class="list-row-main">
        <div class="list-row-name">${escapeHtml(r.name)}</div>
        <div class="list-row-sub">${escapeHtml(r.article_number)}${r.calibration_year ? ' · Eichjahr ' + r.calibration_year : ''} · ${escapeHtml(r.category)}</div>
      </div>
      <div class="list-row-qty">${r.quantity}</div>
    `;
    row.addEventListener('click', async () => {
      const article = await idbGet('articles', r.article_number);
      if (!article) return;
      state.currentArticle = article;
      state.currentCalibYear = r.calibration_year || null;
      openQuantityView(article, r.calibration_year || null);
    });
    container.appendChild(row);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* =========================================================
   Export
   ========================================================= */
document.getElementById('btn-export-xlsx').addEventListener('click', async () => {
  const rows = await getJoinedInventory();
  const status = document.getElementById('export-status');
  if (typeof XLSX === 'undefined') {
    status.textContent = 'Excel-Export braucht einmalig eine Internetverbindung zum Laden der Export-Bibliothek. Bitte online erneut versuchen, oder CSV exportieren.';
    status.classList.remove('hidden');
    return;
  }
  const data = rows.map(r => ({
    Artikelnummer: r.article_number,
    Artikelbezeichnung: r.name,
    Kategorie: r.category,
    Eichjahr: r.calibration_year || '',
    Menge: r.quantity,
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Inventur');
  const filename = 'Allmess_Inventur_' + new Date().toISOString().slice(0, 10) + '.xlsx';
  XLSX.writeFile(wb, filename);
  status.classList.add('hidden');
  toast('Export erstellt: ' + filename);
});

document.getElementById('btn-export-csv').addEventListener('click', async () => {
  const rows = await getJoinedInventory();
  const header = ['Artikelnummer', 'Artikelbezeichnung', 'Kategorie', 'Eichjahr', 'Menge'];
  const lines = [header.join(';')];
  rows.forEach(r => {
    lines.push([r.article_number, r.name, r.category, r.calibration_year || '', r.quantity]
      .map(v => `"${String(v).replace(/"/g, '""')}"`).join(';'));
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Allmess_Inventur_' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  URL.revokeObjectURL(url);
  toast('CSV-Export erstellt');
});

/* =========================================================
   Service worker
   ========================================================= */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

/* =========================================================
   Init
   ========================================================= */
openDB().then(() => {
  refreshStart();
}).catch(err => {
  toast('Datenbank konnte nicht geöffnet werden: ' + err.message);
});
