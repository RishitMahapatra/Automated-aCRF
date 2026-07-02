/**
 * settings.js — Mapping Manager
 * Full-page view for managing the internal SDTM mapping database.
 */

const Settings = (() => {
  'use strict';

  // ── State ──────────────────────────────────────────────────
  let _entries    = [];
  let _dirty      = false;

  function _setDirty() {
    _dirty = true;
    if (typeof window._markSessionDirty === 'function') window._markSessionDirty();
  }
  let _showAll    = false;
  let _currentPage = 1;
  let _initialized = false;
  const PAGE_SIZE  = 50;

  // Typed confirm state (shared across all calls, no listener accumulation)
  let _typedConfirmCallback = null;
  let _typedInputHandler    = null;

  // Import choice callbacks (wired once in init)
  let _importChoiceCallbacks = { addNew: null, replaceAll: null };

  const TYPED_PHRASES = [
    'WiPe iT', 'BuG HuNTeR', 'FLuSh AlL', 'TaBuLa RaSa',
    'CLeAR AlL', 'ZeRo OuT', 'FrEsH StArT', 'Go BrR', 'YeS DeLeTE',
  ];

  // Per-column filter values (null = no filter on that column)
  let _colFilters = {
    src_dataset:   null,
    raw_variable:  null,
    raw_label:     null,
    sdtm_dataset:  null,
    sdtm_variable: null,
    sdtm_label:    null,
  };

  // ── Navigation ─────────────────────────────────────────────

  function show() {
    _loadDatabase().then(() => {
      document.getElementById('layout').classList.add('hidden');
      document.getElementById('settings-page').classList.remove('hidden');
      _renderTable();
      _updateStats();
    });
  }

  function hide() {
    if (_dirty) {
      _showConfirm(
        'Unsaved Changes',
        'You have unsaved changes to the mapping table. Discard them?',
        () => { _dirty = false; _doHide(); },
        null
      );
      return;
    }
    _doHide();
  }

  function _doHide() {
    _closeColFilter();
    document.getElementById('settings-page').classList.add('hidden');
    document.getElementById('layout').classList.remove('hidden');
  }

  // ── Database I/O ───────────────────────────────────────────

  async function _loadDatabase() {
    try {
      const res = await window.pywebview.api.load_mapping_db();
      _entries = (res.ok && res.data && res.data.entries) ? res.data.entries : [];
      _dirty   = false;
    } catch (e) {
      console.error('[settings] load error:', e);
      _entries = [];
    }
  }

  async function _saveDatabase() {
    const data = {
      version: 1,
      last_modified: new Date().toISOString(),
      entry_count: _entries.length,
      entries: _entries,
    };
    try {
      const res = await window.pywebview.api.save_mapping_db(data);
      if (res.ok) {
        _dirty = false;
        _showToast('Mapping database saved.', 'success');
        _updateStats();
      } else {
        _showToast('Save failed: ' + (res.error || ''), 'error');
      }
    } catch (e) {
      _showToast('Save error: ' + e, 'error');
    }
  }

  // ── Column Filters ─────────────────────────────────────────

  function _getFiltered() {
    return _entries.filter(e =>
      Object.entries(_colFilters).every(([field, val]) =>
        !val || (e[field] || '').toUpperCase() === val.toUpperCase()
      )
    );
  }

  function _hasActiveFilters() {
    return Object.values(_colFilters).some(Boolean);
  }

  function _clearAllFilters() {
    Object.keys(_colFilters).forEach(k => { _colFilters[k] = null; });
    _currentPage = 1;
    _renderTable();
    _updateFilterIcons();
  }

  function _updateFilterIcons() {
    Object.keys(_colFilters).forEach(field => {
      const btn = document.querySelector(`.col-filter-btn[data-field="${field}"]`);
      if (btn) btn.classList.toggle('col-filter-active', !!_colFilters[field]);
    });
  }

  function _openColFilter(field, anchorEl) {
    _closeColFilter();

    const allValues = [...new Set(
      _entries.map(e => (e[field] || '').trim()).filter(Boolean)
    )].sort();

    const current = _colFilters[field] || null;

    const dropdown = document.createElement('div');
    dropdown.className = 'col-filter-dropdown';
    dropdown.id        = 'col-filter-dropdown';

    // Search box
    const searchInput = document.createElement('input');
    searchInput.type        = 'text';
    searchInput.className   = 'col-filter-search';
    searchInput.placeholder = 'Search…';
    searchInput.addEventListener('click', e => e.stopPropagation());
    dropdown.appendChild(searchInput);

    const sep1 = document.createElement('div');
    sep1.className = 'col-filter-sep';
    dropdown.appendChild(sep1);

    // "All / Clear" button
    const allBtn = document.createElement('button');
    allBtn.className  = 'col-filter-item' + (!current ? ' col-filter-active' : '');
    allBtn.textContent = current ? '✕  Clear filter' : '— All —';
    allBtn.addEventListener('click', e => {
      e.stopPropagation();
      _colFilters[field] = null;
      _currentPage = 1;
      _showAll = false;
      _renderTable();
      _updateFilterIcons();
      _closeColFilter();
    });
    dropdown.appendChild(allBtn);

    // Value list container
    const listWrap = document.createElement('div');
    listWrap.className = 'col-filter-list';
    dropdown.appendChild(listWrap);

    function renderValues(filter) {
      listWrap.innerHTML = '';
      const q = (filter || '').toUpperCase();
      const filtered = q ? allValues.filter(v => v.toUpperCase().includes(q)) : allValues;

      if (filtered.length && allValues.length) {
        const sep = document.createElement('div');
        sep.className = 'col-filter-sep';
        listWrap.appendChild(sep);
      }

      filtered.forEach(v => {
        const btn = document.createElement('button');
        btn.className   = 'col-filter-item' + (current === v ? ' col-filter-active' : '');
        btn.textContent = v;
        btn.title       = v;
        btn.addEventListener('click', e => {
          e.stopPropagation();
          _colFilters[field] = v;
          _currentPage = 1;
          _showAll = false;
          _renderTable();
          _updateFilterIcons();
          _closeColFilter();
        });
        listWrap.appendChild(btn);
      });

      if (filtered.length === 0) {
        const noMatch = document.createElement('div');
        noMatch.className = 'col-filter-no-match';
        noMatch.textContent = 'No matches';
        listWrap.appendChild(noMatch);
      }
    }

    renderValues('');
    searchInput.addEventListener('input', () => renderValues(searchInput.value.trim()));

    // Position: fixed, under the button
    const rect = anchorEl.getBoundingClientRect();
    dropdown.style.cssText = `position:fixed;top:${rect.bottom + 2}px;left:${rect.left}px;z-index:9999;`;

    document.body.appendChild(dropdown);
    setTimeout(() => searchInput.focus(), 30);

    // Close on outside click
    setTimeout(() => {
      document.addEventListener('click', function outsideHandler(e) {
        if (!dropdown.contains(e.target)) {
          _closeColFilter();
          document.removeEventListener('click', outsideHandler);
        }
      });
    }, 0);
  }

  function _closeColFilter() {
    const d = document.getElementById('col-filter-dropdown');
    if (d) d.remove();
  }

  // ── Table Rendering ────────────────────────────────────────

  function _renderTable() {
    const tbody = document.getElementById('mdb-table-body');
    if (!tbody) return;

    const filtered = _getFiltered();
    let page, start;

    if (_showAll) {
      page  = filtered;
      start = 0;
    } else {
      const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
      if (_currentPage > totalPages) _currentPage = totalPages;
      start = (_currentPage - 1) * PAGE_SIZE;
      page  = filtered.slice(start, start + PAGE_SIZE);
    }

    tbody.innerHTML = '';

    if (page.length === 0) {
      const msg = _hasActiveFilters()
        ? 'No entries match the active filters — <span class="mdb-clear-link" id="mdb-clear-filters-link">Clear filters</span>'
        : 'No entries found';
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:32px;">${msg}</td></tr>`;
      if (_hasActiveFilters()) {
        document.getElementById('mdb-clear-filters-link')?.addEventListener('click', _clearAllFilters);
      }
      _updatePagination(0, 0, 0);
      return;
    }

    page.forEach((e, i) => {
      const filteredIdx = start + i;
      const tr = document.createElement('tr');
      tr.dataset.idx = filteredIdx;
      tr.innerHTML = `
        <td class="mdb-cell mdb-cell-num">${filteredIdx + 1}</td>
        <td class="mdb-cell mdb-cell-edit" data-field="src_dataset">${_esc(e.src_dataset)}</td>
        <td class="mdb-cell mdb-cell-edit" data-field="raw_variable">${_esc(e.raw_variable)}</td>
        <td class="mdb-cell mdb-cell-edit" data-field="raw_label">${_esc(e.raw_label || '')}</td>
        <td class="mdb-cell mdb-cell-edit" data-field="sdtm_dataset">${_esc(e.sdtm_dataset)}</td>
        <td class="mdb-cell mdb-cell-edit" data-field="sdtm_variable">${_esc(e.sdtm_variable)}</td>
        <td class="mdb-cell mdb-cell-edit" data-field="sdtm_label">${_esc(e.sdtm_label || '')}</td>
        <td class="mdb-cell mdb-cell-actions">
          <button class="mdb-row-btn mdb-row-del" title="Delete this entry">&times;</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    _updatePagination(filtered.length, start + 1, start + page.length);
  }

  function _updatePagination(total, from, to) {
    const info     = document.getElementById('mdb-page-info');
    const prevBtn  = document.getElementById('mdb-page-prev');
    const nextBtn  = document.getElementById('mdb-page-next');
    const showAllBtn = document.getElementById('mdb-show-all-btn');

    if (info) {
      info.textContent = total === 0 ? 'No entries' : `Showing ${from}–${to} of ${total}`;
    }

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (prevBtn) prevBtn.disabled = _showAll || _currentPage <= 1;
    if (nextBtn) nextBtn.disabled = _showAll || _currentPage >= totalPages;

    if (showAllBtn) {
      if (total <= PAGE_SIZE) {
        showAllBtn.style.display = 'none';
      } else {
        showAllBtn.style.display = '';
        showAllBtn.textContent = _showAll ? 'Paginate' : `Show All (${total})`;
      }
    }
  }

  function _updateStats() {
    const el = document.getElementById('mdb-stats');
    if (!el) return;
    const domains = new Set(_entries.map(e => e.src_dataset).filter(Boolean));
    el.textContent = `${_entries.length} entries · ${domains.size} domains`;
    if (_dirty) el.textContent += ' · Unsaved changes';
  }

  // ── Inline Editing ─────────────────────────────────────────

  function _handleCellClick(e) {
    const cell = e.target.closest('.mdb-cell-edit');
    if (!cell || cell.querySelector('input')) return;

    const tr    = cell.closest('tr');
    const idx   = parseInt(tr.dataset.idx, 10);
    const field = cell.dataset.field;
    const entry = _getFilteredEntry(idx);
    if (!entry) return;

    const oldVal = entry[field] || '';
    const input  = document.createElement('input');
    input.type      = 'text';
    input.className = 'mdb-inline-input';
    input.value     = oldVal;
    cell.textContent = '';
    cell.appendChild(input);
    input.focus();
    input.select();

    function commit() {
      const newVal = input.value.trim();
      cell.textContent = newVal;
      if (newVal !== oldVal) {
        entry[field] = (field === 'sdtm_label' || field === 'raw_label') ? newVal : newVal.toUpperCase();
        _setDirty();
        _updateStats();
      }
    }

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', ev => {
      if (ev.key === 'Enter')  { ev.preventDefault(); input.blur(); }
      if (ev.key === 'Escape') { input.value = oldVal; input.blur(); }
    });
  }

  function _getFilteredEntry(filteredIdx) {
    return _getFiltered()[filteredIdx] || null;
  }

  function _handleDeleteClick(e) {
    const btn = e.target.closest('.mdb-row-del');
    if (!btn) return;
    const tr    = btn.closest('tr');
    const idx   = parseInt(tr.dataset.idx, 10);
    const entry = _getFilteredEntry(idx);
    if (!entry) return;

    _showConfirm(
      'Delete Entry',
      `Delete mapping: ${entry.src_dataset}.${entry.raw_variable} → ${entry.sdtm_dataset}.${entry.sdtm_variable}?`,
      () => {
        const realIdx = _entries.indexOf(entry);
        if (realIdx !== -1) {
          _entries.splice(realIdx, 1);
          _setDirty();
          _renderTable();
          _updateStats();
        }
      },
      null
    );
  }

  // ── Add Record ─────────────────────────────────────────────

  function _showAddRecord() {
    const d = document.getElementById('mdb-add-dialog');
    if (!d) return;
    ['add-src-ds', 'add-raw-var', 'add-raw-label', 'add-sdtm-ds', 'add-sdtm-var', 'add-sdtm-label']
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    d.classList.remove('hidden');
    document.getElementById('add-src-ds')?.focus();
  }

  function _commitAddRecord() {
    const srcDs   = (document.getElementById('add-src-ds')?.value || '').trim().toUpperCase();
    const rawVar  = (document.getElementById('add-raw-var')?.value || '').trim().toUpperCase();
    const sdtmDs  = (document.getElementById('add-sdtm-ds')?.value || '').trim().toUpperCase();
    const sdtmVar = (document.getElementById('add-sdtm-var')?.value || '').trim().toUpperCase();
    const rawLbl  = (document.getElementById('add-raw-label')?.value || '').trim();
    const sdtmLbl = (document.getElementById('add-sdtm-label')?.value || '').trim();

    if (!srcDs || !rawVar || !sdtmDs || !sdtmVar) {
      _showToast('Source Dataset, Raw Variable, SDTM Dataset, and SDTM Variable are required.', 'warning');
      return;
    }
    if (_entries.find(e => e.src_dataset === srcDs && e.raw_variable === rawVar)) {
      _showToast(`Duplicate: ${srcDs}.${rawVar} already exists.`, 'warning');
      return;
    }

    _entries.push({
      id: _uid(), src_dataset: srcDs, raw_variable: rawVar, raw_label: rawLbl,
      sdtm_dataset: sdtmDs, sdtm_variable: sdtmVar, sdtm_label: sdtmLbl, source: 'manual',
    });
    _setDirty();
    document.getElementById('mdb-add-dialog')?.classList.add('hidden');
    _showAll = false;
    _currentPage = Math.ceil(_entries.length / PAGE_SIZE);
    _renderTable();
    _updateStats();
    _showToast('Record added.', 'success');
  }

  // ── Import ─────────────────────────────────────────────────

  function _openImportDialog() {
    ['imp-header-row', 'imp-data-start', 'imp-src-ds-col', 'imp-raw-var-col',
     'imp-raw-label-col', 'imp-sdtm-ds-col', 'imp-sdtm-var-col', 'imp-sdtm-label-col']
      .forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = el.dataset.default || '';
      });
    const pathEl = document.getElementById('import-file-path');
    if (pathEl) pathEl.value = '';
    document.getElementById('mdb-import-dialog').classList.remove('hidden');
  }

  function _startImport() { _openImportDialog(); }

  async function _browseExcel() {
    try {
      const res = await window.pywebview.api.select_excel_for_import();
      if (!res.ok) { _showToast('File picker: ' + res.error, 'error'); return; }
      const pathEl = document.getElementById('import-file-path');
      if (pathEl) pathEl.value = res.path;
    } catch (e) {
      _showToast('File picker error: ' + e, 'error');
    }
  }

  function _col(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }

  async function _executeImport() {
    const path = (document.getElementById('import-file-path')?.value || '').trim();
    if (!path) { _showToast('Please select a file or paste a file path first.', 'warning'); return; }

    const srcDs  = _col('imp-src-ds-col');
    const rawVar = _col('imp-raw-var-col');
    const sdtmDs = _col('imp-sdtm-ds-col');
    const sdtmV  = _col('imp-sdtm-var-col');
    if (!srcDs || !rawVar || !sdtmDs || !sdtmV) {
      _showToast('Source Dataset, Raw Variable, SDTM Dataset, and SDTM Variable columns are required.', 'warning');
      return;
    }

    const config = {
      header_row:        parseInt(document.getElementById('imp-header-row')?.value || '1', 10),
      data_start_row:    parseInt(document.getElementById('imp-data-start')?.value || '2', 10),
      src_dataset_col:   srcDs,
      raw_variable_col:  rawVar,
      raw_label_col:     _col('imp-raw-label-col'),
      sdtm_dataset_col:  sdtmDs,
      sdtm_variable_col: sdtmV,
      sdtm_label_col:    _col('imp-sdtm-label-col'),
    };

    try {
      const res = await window.pywebview.api.import_excel_mapping(path, config);
      if (!res.ok) { _showToast('Import error: ' + res.error, 'error'); return; }
      document.getElementById('mdb-import-dialog').classList.add('hidden');

      if (_entries.length === 0) {
        // Nothing existing — just load
        _entries = res.entries;
        _setDirty();
        _currentPage = 1;
        _renderTable();
        _updateStats();
        _showToast(`Imported ${res.count} entries.`, 'success');
      } else {
        // Existing data — show simple two-option choice
        _showImportChoice(res.entries);
      }
    } catch (e) {
      _showToast('Import error: ' + e, 'error');
    }
  }

  function _showImportChoice(incoming) {
    const newOnly = incoming.filter(inc => {
      const key = `${inc.src_dataset}||${inc.raw_variable}`;
      return !_entries.some(e => `${e.src_dataset}||${e.raw_variable}` === key);
    });
    const skipped = incoming.length - newOnly.length;

    _importChoiceCallbacks.addNew = () => {
      newOnly.forEach(e => { e.id = _uid(); e.source = 'import'; _entries.push(e); });
      _setDirty();
      _renderTable();
      _updateStats();
      _showToast(`Added ${newOnly.length} new entries${skipped > 0 ? ` (${skipped} skipped)` : ''}.`, 'success');
    };

    _importChoiceCallbacks.replaceAll = () => {
      _showTypedConfirm(
        'Replace All — Are You Sure?',
        `This will permanently delete all ${_entries.length} current entries and replace them with the ${incoming.length} entries from the imported file. This cannot be undone.`,
        'Replace All',
        () => {
          _entries = incoming;
          _setDirty();
          _currentPage = 1;
          _showAll = false;
          _renderTable();
          _updateStats();
          _showToast(`Replaced with ${incoming.length} entries.`, 'success');
        }
      );
    };

    const msgEl = document.getElementById('import-choice-msg');
    if (msgEl) {
      msgEl.textContent =
        `You already have ${_entries.length} entries.\n\n` +
        `Add New Only — keep everything, append ${newOnly.length} new records` +
        (skipped > 0 ? ` (${skipped} duplicates skipped)` : '') + '.\n\n' +
        `Replace All — permanently wipe your ${_entries.length} entries and load all ${incoming.length} from the file.`;
    }
    document.getElementById('mdb-import-choice-dialog')?.classList.remove('hidden');
  }

  // ── Typed Confirmation ─────────────────────────────────────

  function _showTypedConfirm(title, message, confirmLabel, onConfirm) {
    _typedConfirmCallback = onConfirm;

    const phrase = TYPED_PHRASES[Math.floor(Math.random() * TYPED_PHRASES.length)];

    document.getElementById('mdb-typed-title').textContent             = title;
    document.getElementById('mdb-typed-message').textContent           = message;
    document.getElementById('mdb-typed-phrase').textContent            = phrase;
    document.getElementById('mdb-typed-confirm-btn').textContent       = confirmLabel || 'Confirm';
    document.getElementById('mdb-typed-confirm-btn').disabled          = true;

    const input = document.getElementById('mdb-typed-input');
    input.value = '';

    // Remove stale input handler before adding new one
    if (_typedInputHandler) {
      input.removeEventListener('input', _typedInputHandler);
    }
    _typedInputHandler = () => {
      const btn = document.getElementById('mdb-typed-confirm-btn');
      if (btn) btn.disabled = (input.value !== phrase);
    };
    input.addEventListener('input', _typedInputHandler);

    document.getElementById('mdb-typed-confirm-dialog').classList.remove('hidden');
    setTimeout(() => input.focus(), 60);
  }

  // ── New From Scratch ───────────────────────────────────────

  function _doClearTable() {
    _entries = []; _dirty = false; _renderTable(); _updateStats();
    _showToast('Table cleared. Start fresh.', 'success');
  }

  function _newFromScratch() {
    if (_entries.length === 0) { _doClearTable(); return; }

    _showConfirm(
      'New Table from Scratch',
      `You have ${_entries.length} entries. Save a backup first?`,
      () => {
        // Save First, then typed-confirm the clear
        _saveMtblThen(() => {
          _showTypedConfirm(
            'Clear Table',
            `Backup saved. Type the phrase to confirm clearing all ${_entries.length} entries.`,
            'Clear All',
            _doClearTable
          );
        });
      },
      () => {
        // No save — straight to typed confirm
        _showTypedConfirm(
          'Clear Without Saving',
          `Your ${_entries.length} entries will be permanently deleted. No backup will be made.`,
          'Clear All',
          _doClearTable
        );
      },
      'Save First',
      'Clear Without Saving'
    );
  }

  async function _saveMtblThen(callback) {
    const data = { version: 1, last_modified: new Date().toISOString(), entry_count: _entries.length, entries: _entries };
    try {
      const res = await window.pywebview.api.save_mapping_file(data);
      if (res.ok) { _showToast('Saved to: ' + res.path, 'success'); if (callback) callback(); }
      else _showToast('Save cancelled or failed.', 'warning');
    } catch (e) { _showToast('Save error: ' + e, 'error'); }
  }

  // ── Export ─────────────────────────────────────────────────

  async function _exportExcel() {
    if (!_entries.length) { _showToast('No entries to export.', 'warning'); return; }
    try {
      const res = await window.pywebview.api.export_mapping_excel(_entries);
      if (res.ok) _showToast('Exported to: ' + res.path, 'success');
      else _showToast('Export failed: ' + (res.error || ''), 'error');
    } catch (e) { _showToast('Export error: ' + e, 'error'); }
  }

  async function _exportCSV() {
    if (!_entries.length) { _showToast('No entries to export.', 'warning'); return; }
    try {
      const res = await window.pywebview.api.export_mapping_csv(_entries);
      if (res.ok) _showToast('Exported to: ' + res.path, 'success');
      else _showToast('Export failed: ' + (res.error || ''), 'error');
    } catch (e) { _showToast('Export error: ' + e, 'error'); }
  }

  async function _saveMtbl() {
    const data = { version: 1, last_modified: new Date().toISOString(), entry_count: _entries.length, entries: _entries };
    try {
      const res = await window.pywebview.api.save_mapping_file(data);
      if (res.ok) _showToast('Saved to: ' + res.path, 'success');
      else if (res.error !== 'No location selected') _showToast('Save failed: ' + res.error, 'error');
    } catch (e) { _showToast('Save error: ' + e, 'error'); }
  }

  async function _loadMtbl() {
    if (_dirty) {
      _showConfirm('Unsaved Changes', 'You have unsaved changes. Loading will discard them. Continue?',
        () => _doLoadMtbl(), null);
      return;
    }
    _doLoadMtbl();
  }

  async function _doLoadMtbl() {
    try {
      const res = await window.pywebview.api.load_mapping_file();
      if (!res.ok) return;
      if (res.data && res.data.entries) {
        _entries = res.data.entries;
        _setDirty();
        _currentPage = 1;
        _showAll = false;
        _renderTable();
        _updateStats();
        _showToast(`Loaded ${_entries.length} entries from ${res.path}`, 'success');
      }
    } catch (e) { _showToast('Load error: ' + e, 'error'); }
  }

  // ── Confirm Dialog ─────────────────────────────────────────

  function _showConfirm(title, message, onYes, onNo, yesLabel, noLabel) {
    const d      = document.getElementById('mdb-confirm-dialog');
    const titleEl = document.getElementById('mdb-confirm-title');
    const msgEl   = document.getElementById('mdb-confirm-message');
    if (!d || !titleEl || !msgEl) return;

    titleEl.textContent = title;
    msgEl.textContent   = message;  // white-space:pre-wrap handles newlines

    const btnYes = document.getElementById('mdb-confirm-yes');
    const btnNo  = document.getElementById('mdb-confirm-no');
    btnYes.textContent = yesLabel || 'Yes';
    btnNo.textContent  = noLabel  || 'No';

    // Show/hide No button — if onNo is null and no label, just hide it
    btnNo.style.display = (onNo !== null || noLabel) ? '' : 'none';

    d.classList.remove('hidden');

    function cleanup() {
      d.classList.add('hidden');
      // Clone to wipe listeners, then re-grab references next call
      btnYes.replaceWith(btnYes.cloneNode(true));
      btnNo.replaceWith(btnNo.cloneNode(true));
    }

    document.getElementById('mdb-confirm-yes').addEventListener('click', () => { cleanup(); if (onYes) onYes(); });
    document.getElementById('mdb-confirm-no').addEventListener('click',  () => { cleanup(); if (onNo)  onNo();  });
  }

  // ── Helpers ────────────────────────────────────────────────

  function _esc(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  function _uid() { return Math.random().toString(36).substring(2, 10); }

  function _showToast(msg, type) {
    if (typeof showToast === 'function') showToast(msg, type);
    else console.log(`[settings] ${type}: ${msg}`);
  }

  // ── Bindings ───────────────────────────────────────────────

  function init() {
    if (_initialized) return;
    _initialized = true;

    document.getElementById('mdb-back-btn')?.addEventListener('click', hide);
    document.getElementById('mdb-save-btn')?.addEventListener('click', _saveDatabase);

    // Pagination
    document.getElementById('mdb-page-prev')?.addEventListener('click', () => {
      if (_currentPage > 1) { _currentPage--; _renderTable(); }
    });
    document.getElementById('mdb-page-next')?.addEventListener('click', () => {
      _currentPage++;
      _renderTable();
    });
    document.getElementById('mdb-show-all-btn')?.addEventListener('click', () => {
      _showAll = !_showAll;
      _renderTable();
    });

    // Table click delegation
    const tbody = document.getElementById('mdb-table-body');
    if (tbody) {
      tbody.addEventListener('click', e => {
        if (e.target.closest('.mdb-row-del')) { _handleDeleteClick(e); return; }
        _handleCellClick(e);
      });
    }

    // Column filter buttons
    document.querySelectorAll('.col-filter-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        _openColFilter(btn.dataset.field, btn);
      });
    });

    // Add record
    document.getElementById('mdb-add-btn')?.addEventListener('click', _showAddRecord);
    document.getElementById('add-record-save')?.addEventListener('click', _commitAddRecord);
    document.getElementById('add-record-cancel')?.addEventListener('click', () => {
      document.getElementById('mdb-add-dialog')?.classList.add('hidden');
    });

    // Import
    document.getElementById('mdb-import-btn')?.addEventListener('click', _startImport);
    document.getElementById('import-browse-btn')?.addEventListener('click', _browseExcel);
    document.getElementById('import-execute-btn')?.addEventListener('click', _executeImport);
    document.getElementById('import-cancel-btn')?.addEventListener('click', () => {
      document.getElementById('mdb-import-dialog')?.classList.add('hidden');
    });

    // New from scratch
    document.getElementById('mdb-new-btn')?.addEventListener('click', _newFromScratch);

    // Import choice dialog
    document.getElementById('import-choice-close')?.addEventListener('click', () => {
      document.getElementById('mdb-import-choice-dialog')?.classList.add('hidden');
    });
    document.getElementById('import-choice-add-new')?.addEventListener('click', () => {
      document.getElementById('mdb-import-choice-dialog').classList.add('hidden');
      if (_importChoiceCallbacks.addNew) _importChoiceCallbacks.addNew();
    });
    document.getElementById('import-choice-replace')?.addEventListener('click', () => {
      document.getElementById('mdb-import-choice-dialog').classList.add('hidden');
      if (_importChoiceCallbacks.replaceAll) _importChoiceCallbacks.replaceAll();
    });

    // Typed confirm dialog (wired once)
    document.getElementById('mdb-typed-close')?.addEventListener('click', () => {
      document.getElementById('mdb-typed-confirm-dialog')?.classList.add('hidden');
    });
    document.getElementById('mdb-typed-cancel-btn')?.addEventListener('click', () => {
      document.getElementById('mdb-typed-confirm-dialog')?.classList.add('hidden');
    });
    document.getElementById('mdb-typed-confirm-btn')?.addEventListener('click', () => {
      const input  = document.getElementById('mdb-typed-input');
      const phrase = document.getElementById('mdb-typed-phrase')?.textContent;
      if (!input || input.value !== phrase) return;
      document.getElementById('mdb-typed-confirm-dialog').classList.add('hidden');
      const cb = _typedConfirmCallback;
      _typedConfirmCallback = null;
      if (cb) cb();
    });

    // Export
    document.getElementById('mdb-export-excel')?.addEventListener('click', _exportExcel);
    document.getElementById('mdb-export-csv')?.addEventListener('click', _exportCSV);

    // Save / Load .mtbl
    document.getElementById('mdb-save-mtbl')?.addEventListener('click', _saveMtbl);
    document.getElementById('mdb-load-mtbl')?.addEventListener('click', _loadMtbl);
  }

  function isDirty() { return _dirty; }

  return { init, show, hide, isDirty };
})();
