/**
 * settings.js — Mapping Manager
 * Full-page settings view for managing the internal SDTM mapping database.
 */

const Settings = (() => {
  'use strict';

  // ── State ──────────────────────────────────────────────────
  let _entries = [];
  let _dirty = false;
  let _searchTerm = '';
  let _currentPage = 1;
  let _initialized = false;
  const PAGE_SIZE = 50;

  // Merge state
  let _mergeIncoming = [];
  let _mergeConflicts = [];
  let _mergeAdded = [];
  let _mergeUnchanged = 0;
  let _currentConflictIdx = 0;

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
    document.getElementById('settings-page').classList.add('hidden');
    document.getElementById('layout').classList.remove('hidden');
  }

  // ── Database I/O ───────────────────────────────────────────

  async function _loadDatabase() {
    try {
      const res = await window.pywebview.api.load_mapping_db();
      if (res.ok && res.data && res.data.entries) {
        _entries = res.data.entries;
      } else {
        _entries = [];
      }
      _dirty = false;
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

  // ── Table Rendering ────────────────────────────────────────

  function _getFiltered() {
    if (!_searchTerm) return _entries;
    const q = _searchTerm.toLowerCase();
    return _entries.filter(e =>
      (e.src_dataset || '').toLowerCase().includes(q) ||
      (e.raw_variable || '').toLowerCase().includes(q) ||
      (e.sdtm_dataset || '').toLowerCase().includes(q) ||
      (e.sdtm_variable || '').toLowerCase().includes(q) ||
      (e.sdtm_label || '').toLowerCase().includes(q) ||
      (e.raw_label || '').toLowerCase().includes(q)
    );
  }

  function _renderTable() {
    const tbody = document.getElementById('mdb-table-body');
    if (!tbody) return;
    const filtered = _getFiltered();
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (_currentPage > totalPages) _currentPage = totalPages;
    const start = (_currentPage - 1) * PAGE_SIZE;
    const page = filtered.slice(start, start + PAGE_SIZE);

    tbody.innerHTML = '';
    if (page.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:32px;">No entries found</td></tr>';
      _updatePagination(0, 0, 0);
      return;
    }

    page.forEach((e, i) => {
      const globalIdx = start + i;
      const tr = document.createElement('tr');
      tr.dataset.idx = globalIdx;
      tr.innerHTML = `
        <td class="mdb-cell mdb-cell-num">${globalIdx + 1}</td>
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

    _updatePagination(filtered.length, start + 1, Math.min(start + PAGE_SIZE, filtered.length));
  }

  function _updatePagination(total, from, to) {
    const info = document.getElementById('mdb-page-info');
    if (info) {
      info.textContent = total === 0
        ? 'No entries'
        : `Showing ${from}–${to} of ${total} entries`;
    }
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const prevBtn = document.getElementById('mdb-page-prev');
    const nextBtn = document.getElementById('mdb-page-next');
    if (prevBtn) prevBtn.disabled = _currentPage <= 1;
    if (nextBtn) nextBtn.disabled = _currentPage >= totalPages;
  }

  function _updateStats() {
    const el = document.getElementById('mdb-stats');
    if (!el) return;
    const domains = new Set(_entries.map(e => e.src_dataset).filter(Boolean));
    let lastMod = '—';
    // Try to read from file if no entries
    el.textContent = `${_entries.length} entries · ${domains.size} domains`;
    if (_dirty) el.textContent += ' · Unsaved changes';
  }

  // ── Inline Editing ─────────────────────────────────────────

  function _handleCellClick(e) {
    const cell = e.target.closest('.mdb-cell-edit');
    if (!cell || cell.querySelector('input')) return;

    const tr = cell.closest('tr');
    const idx = parseInt(tr.dataset.idx, 10);
    const field = cell.dataset.field;
    const entry = _getFilteredEntry(idx);
    if (!entry) return;

    const oldVal = entry[field] || '';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'mdb-inline-input';
    input.value = oldVal;
    cell.textContent = '';
    cell.appendChild(input);
    input.focus();
    input.select();

    function commit() {
      const newVal = input.value.trim();
      cell.textContent = _esc(newVal);
      if (newVal !== oldVal) {
        entry[field] = (field === 'sdtm_label' || field === 'raw_label')
          ? newVal
          : newVal.toUpperCase();
        _dirty = true;
        _updateStats();
      }
    }

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
      if (ev.key === 'Escape') { input.value = oldVal; input.blur(); }
    });
  }

  function _getFilteredEntry(globalIdx) {
    const filtered = _getFiltered();
    const entry = filtered[globalIdx];
    return entry || null;
  }

  function _handleDeleteClick(e) {
    const btn = e.target.closest('.mdb-row-del');
    if (!btn) return;
    const tr = btn.closest('tr');
    const idx = parseInt(tr.dataset.idx, 10);
    const entry = _getFilteredEntry(idx);
    if (!entry) return;

    _showConfirm(
      'Delete Entry',
      `Delete mapping: ${entry.src_dataset}.${entry.raw_variable} → ${entry.sdtm_dataset}.${entry.sdtm_variable}?`,
      () => {
        const realIdx = _entries.indexOf(entry);
        if (realIdx !== -1) {
          _entries.splice(realIdx, 1);
          _dirty = true;
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
    d.classList.remove('hidden');
    ['add-src-ds', 'add-raw-var', 'add-raw-label', 'add-sdtm-ds', 'add-sdtm-var', 'add-sdtm-label']
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    document.getElementById('add-src-ds')?.focus();
  }

  function _commitAddRecord() {
    const srcDs   = (document.getElementById('add-src-ds')?.value || '').trim().toUpperCase();
    const rawVar  = (document.getElementById('add-raw-var')?.value || '').trim().toUpperCase();
    const sdtmDs  = (document.getElementById('add-sdtm-ds')?.value || '').trim().toUpperCase();
    const sdtmVar = (document.getElementById('add-sdtm-var')?.value || '').trim().toUpperCase();
    const rawLbl  = (document.getElementById('add-raw-label')?.value || '').trim();
    const sdtmLbl = (document.getElementById('add-sdtm-label')?.value || '').trim();

    if (!rawVar || !sdtmVar || !srcDs || !sdtmDs) {
      _showToast('Source Dataset, Raw Variable, SDTM Dataset, and SDTM Variable are required.', 'warning');
      return;
    }

    const dup = _entries.find(e =>
      e.src_dataset === srcDs && e.raw_variable === rawVar
    );
    if (dup) {
      _showToast(`Duplicate: ${srcDs}.${rawVar} already exists in the table.`, 'warning');
      return;
    }

    _entries.push({
      id: _uid(),
      src_dataset: srcDs,
      raw_variable: rawVar,
      raw_label: rawLbl,
      sdtm_dataset: sdtmDs,
      sdtm_variable: sdtmVar,
      sdtm_label: sdtmLbl,
      source: 'manual',
    });
    _dirty = true;
    document.getElementById('mdb-add-dialog')?.classList.add('hidden');
    _currentPage = Math.ceil(_entries.length / PAGE_SIZE);
    _renderTable();
    _updateStats();
    _showToast('Record added.', 'success');
  }

  // ── Import Wizard ──────────────────────────────────────────

  async function _startImport() {
    try {
      const res = await window.pywebview.api.select_excel_for_import();
      if (!res.ok) return;
      document.getElementById('import-file-path').textContent = res.path;
      document.getElementById('import-file-path').dataset.path = res.path;
      document.getElementById('mdb-import-dialog').classList.remove('hidden');
      // Reset config fields
      ['imp-header-row', 'imp-data-start', 'imp-src-ds-col', 'imp-raw-var-col',
       'imp-raw-label-col', 'imp-sdtm-ds-col', 'imp-sdtm-var-col', 'imp-sdtm-label-col']
        .forEach(id => {
          const el = document.getElementById(id);
          if (el) el.value = el.dataset.default || '';
        });
      document.getElementById('import-preview-body').innerHTML = '';
    } catch (e) {
      _showToast('Error selecting file: ' + e, 'error');
    }
  }

  async function _previewImport() {
    const path = document.getElementById('import-file-path')?.dataset.path;
    if (!path) return;
    const headerRow = parseInt(document.getElementById('imp-header-row')?.value || '1', 10);
    try {
      const res = await window.pywebview.api.read_excel_preview(path, headerRow);
      if (!res.ok) { _showToast('Preview error: ' + res.error, 'error'); return; }
      const body = document.getElementById('import-preview-body');
      body.innerHTML = '';
      (res.rows || []).forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td class="mdb-cell mdb-cell-num">${r.row_num}</td>` +
          r.cells.map(c => `<td class="mdb-cell">${_esc(c)}</td>`).join('');
        if (r.row_num === headerRow) tr.classList.add('import-header-row');
        body.appendChild(tr);
      });
    } catch (e) {
      _showToast('Preview error: ' + e, 'error');
    }
  }

  async function _executeImport() {
    const path = document.getElementById('import-file-path')?.dataset.path;
    if (!path) return;

    const config = {
      header_row:       parseInt(document.getElementById('imp-header-row')?.value || '1', 10),
      data_start_row:   parseInt(document.getElementById('imp-data-start')?.value || '2', 10),
      src_dataset_col:  parseInt(document.getElementById('imp-src-ds-col')?.value || '0', 10),
      raw_variable_col: parseInt(document.getElementById('imp-raw-var-col')?.value || '0', 10),
      raw_label_col:    parseInt(document.getElementById('imp-raw-label-col')?.value || '0', 10),
      sdtm_dataset_col: parseInt(document.getElementById('imp-sdtm-ds-col')?.value || '0', 10),
      sdtm_variable_col:parseInt(document.getElementById('imp-sdtm-var-col')?.value || '0', 10),
      sdtm_label_col:   parseInt(document.getElementById('imp-sdtm-label-col')?.value || '0', 10),
    };

    if (!config.src_dataset_col || !config.raw_variable_col ||
        !config.sdtm_dataset_col || !config.sdtm_variable_col) {
      _showToast('Source Dataset, Raw Variable, SDTM Dataset, and SDTM Variable columns are required.', 'warning');
      return;
    }

    try {
      const res = await window.pywebview.api.import_excel_mapping(path, config);
      if (!res.ok) { _showToast('Import error: ' + res.error, 'error'); return; }
      document.getElementById('mdb-import-dialog').classList.add('hidden');

      if (_entries.length === 0) {
        _entries = res.entries;
        _dirty = true;
        _renderTable();
        _updateStats();
        _showToast(`Imported ${res.count} entries.`, 'success');
      } else {
        // There's existing data — go to merge flow
        _startMerge(res.entries);
      }
    } catch (e) {
      _showToast('Import error: ' + e, 'error');
    }
  }

  // ── Merge ──────────────────────────────────────────────────

  function _startMerge(incoming) {
    _mergeIncoming = incoming;
    _mergeConflicts = [];
    _mergeAdded = [];
    _mergeUnchanged = 0;

    const existingKeys = new Set(
      _entries.map(e => `${e.src_dataset}||${e.raw_variable}`)
    );
    const existingMap = {};
    _entries.forEach(e => { existingMap[`${e.src_dataset}||${e.raw_variable}`] = e; });

    incoming.forEach(inc => {
      const key = `${inc.src_dataset}||${inc.raw_variable}`;
      if (!existingKeys.has(key)) {
        _mergeAdded.push(inc);
      } else {
        const existing = existingMap[key];
        const changed = existing.sdtm_dataset !== inc.sdtm_dataset ||
                        existing.sdtm_variable !== inc.sdtm_variable ||
                        (existing.sdtm_label || '') !== (inc.sdtm_label || '');
        if (changed) {
          _mergeConflicts.push({ existing, incoming: inc, resolution: null });
        } else {
          _mergeUnchanged++;
        }
      }
    });

    _currentConflictIdx = 0;
    _renderMergeDialog();
    document.getElementById('mdb-merge-dialog').classList.remove('hidden');
  }

  function _renderMergeDialog() {
    document.getElementById('merge-stat-unchanged').textContent = _mergeUnchanged;
    document.getElementById('merge-stat-added').textContent = _mergeAdded.length;
    document.getElementById('merge-stat-conflicts').textContent = _mergeConflicts.length;

    const container = document.getElementById('merge-conflicts-list');
    container.innerHTML = '';

    if (_mergeConflicts.length === 0) {
      container.innerHTML = '<div style="color:var(--green);padding:12px;">No conflicts — all clear.</div>';
      document.getElementById('merge-nav').classList.add('hidden');
      return;
    }

    document.getElementById('merge-nav').classList.remove('hidden');

    _mergeConflicts.forEach((c, i) => {
      const div = document.createElement('div');
      div.className = 'merge-conflict-item' + (i === _currentConflictIdx ? ' merge-conflict-active' : '');
      div.id = `merge-conflict-${i}`;

      const resolved = c.resolution !== null;
      const resClass = resolved ? (c.resolution === 'keep' ? 'merge-resolved-keep' : 'merge-resolved-use') : '';

      div.innerHTML = `
        <div class="merge-conflict-header">
          <span class="merge-conflict-key">${_esc(c.existing.src_dataset)}.${_esc(c.existing.raw_variable)}</span>
          <span class="merge-conflict-num">${i + 1} / ${_mergeConflicts.length}</span>
        </div>
        <div class="merge-diff">
          <div class="merge-diff-row merge-diff-old ${c.resolution === 'use' ? 'merge-dim' : ''}">
            <span class="merge-diff-label">Current</span>
            <span class="merge-diff-val">${_esc(c.existing.sdtm_dataset)}.${_esc(c.existing.sdtm_variable)}</span>
            <span class="merge-diff-sublabel">${_esc(c.existing.sdtm_label || '—')}</span>
          </div>
          <div class="merge-diff-row merge-diff-new ${c.resolution === 'keep' ? 'merge-dim' : ''}">
            <span class="merge-diff-label">Incoming</span>
            <span class="merge-diff-val">${_esc(c.incoming.sdtm_dataset)}.${_esc(c.incoming.sdtm_variable)}</span>
            <span class="merge-diff-sublabel">${_esc(c.incoming.sdtm_label || '—')}</span>
          </div>
        </div>
        <div class="merge-conflict-actions">
          <button class="btn merge-btn-keep ${c.resolution === 'keep' ? 'merge-btn-selected' : ''}" data-cidx="${i}" data-action="keep">Keep Current</button>
          <button class="btn merge-btn-use ${c.resolution === 'use' ? 'merge-btn-selected' : ''}" data-cidx="${i}" data-action="use">Use Incoming</button>
        </div>
      `;
      container.appendChild(div);
    });

    _scrollToConflict(_currentConflictIdx);
    _updateMergeNav();
  }

  function _scrollToConflict(idx) {
    const el = document.getElementById(`merge-conflict-${idx}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function _updateMergeNav() {
    const label = document.getElementById('merge-nav-label');
    if (label) {
      label.textContent = `Conflict ${_currentConflictIdx + 1} of ${_mergeConflicts.length}`;
    }
  }

  function _nextConflict() {
    if (_mergeConflicts.length === 0) return;
    _currentConflictIdx = (_currentConflictIdx + 1) % _mergeConflicts.length;
    _highlightConflict();
  }

  function _prevConflict() {
    if (_mergeConflicts.length === 0) return;
    _currentConflictIdx = (_currentConflictIdx - 1 + _mergeConflicts.length) % _mergeConflicts.length;
    _highlightConflict();
  }

  function _highlightConflict() {
    document.querySelectorAll('.merge-conflict-item').forEach((el, i) => {
      el.classList.toggle('merge-conflict-active', i === _currentConflictIdx);
    });
    _scrollToConflict(_currentConflictIdx);
    _updateMergeNav();
  }

  function _handleMergeAction(e) {
    const btn = e.target.closest('[data-cidx]');
    if (!btn) return;
    const idx = parseInt(btn.dataset.cidx, 10);
    const action = btn.dataset.action;
    _mergeConflicts[idx].resolution = action;
    _renderMergeDialog();
  }

  function _applyMerge() {
    const unresolved = _mergeConflicts.filter(c => c.resolution === null);
    if (unresolved.length > 0) {
      _showToast(`${unresolved.length} conflict(s) still unresolved. Please resolve all before applying.`, 'warning');
      _currentConflictIdx = _mergeConflicts.indexOf(unresolved[0]);
      _highlightConflict();
      return;
    }

    // Apply added entries
    _mergeAdded.forEach(e => {
      e.id = _uid();
      e.source = 'merge';
      _entries.push(e);
    });

    // Apply conflict resolutions
    _mergeConflicts.forEach(c => {
      if (c.resolution === 'use') {
        c.existing.sdtm_dataset = c.incoming.sdtm_dataset;
        c.existing.sdtm_variable = c.incoming.sdtm_variable;
        c.existing.sdtm_label = c.incoming.sdtm_label || '';
        c.existing.raw_label = c.incoming.raw_label || c.existing.raw_label || '';
      }
    });

    _dirty = true;
    document.getElementById('mdb-merge-dialog').classList.add('hidden');
    _renderTable();
    _updateStats();
    _showToast(`Merge complete: ${_mergeAdded.length} added, ${_mergeConflicts.length} resolved, ${_mergeUnchanged} unchanged.`, 'success');
  }

  // ── New From Scratch ───────────────────────────────────────

  function _newFromScratch() {
    if (_entries.length === 0) {
      _entries = [];
      _dirty = false;
      _renderTable();
      _updateStats();
      return;
    }

    _showConfirm(
      'New Table from Scratch',
      'This will clear all current entries. Do you want to save the current table first?',
      () => {
        // Save first, then clear
        _saveMtblThen(() => {
          _entries = [];
          _dirty = false;
          _renderTable();
          _updateStats();
          _showToast('Table cleared. Start fresh.', 'success');
        });
      },
      () => {
        // Discard and clear
        _entries = [];
        _dirty = false;
        _renderTable();
        _updateStats();
        _showToast('Table cleared. Start fresh.', 'success');
      },
      'Save First',
      'Discard'
    );
  }

  async function _saveMtblThen(callback) {
    const data = {
      version: 1,
      last_modified: new Date().toISOString(),
      entry_count: _entries.length,
      entries: _entries,
    };
    try {
      const res = await window.pywebview.api.save_mapping_file(data);
      if (res.ok) {
        _showToast('Saved to: ' + res.path, 'success');
        if (callback) callback();
      } else {
        _showToast('Save cancelled or failed.', 'warning');
      }
    } catch (e) {
      _showToast('Save error: ' + e, 'error');
    }
  }

  // ── Export ─────────────────────────────────────────────────

  async function _exportExcel() {
    if (_entries.length === 0) { _showToast('No entries to export.', 'warning'); return; }
    try {
      const res = await window.pywebview.api.export_mapping_excel(_entries);
      if (res.ok) _showToast('Exported to: ' + res.path, 'success');
      else _showToast('Export failed: ' + (res.error || ''), 'error');
    } catch (e) { _showToast('Export error: ' + e, 'error'); }
  }

  async function _exportCSV() {
    if (_entries.length === 0) { _showToast('No entries to export.', 'warning'); return; }
    try {
      const res = await window.pywebview.api.export_mapping_csv(_entries);
      if (res.ok) _showToast('Exported to: ' + res.path, 'success');
      else _showToast('Export failed: ' + (res.error || ''), 'error');
    } catch (e) { _showToast('Export error: ' + e, 'error'); }
  }

  async function _saveMtbl() {
    const data = {
      version: 1,
      last_modified: new Date().toISOString(),
      entry_count: _entries.length,
      entries: _entries,
    };
    try {
      const res = await window.pywebview.api.save_mapping_file(data);
      if (res.ok) _showToast('Saved to: ' + res.path, 'success');
      else if (res.error !== 'No location selected') _showToast('Save failed: ' + res.error, 'error');
    } catch (e) { _showToast('Save error: ' + e, 'error'); }
  }

  async function _loadMtbl() {
    if (_dirty) {
      _showConfirm(
        'Unsaved Changes',
        'You have unsaved changes. Loading a file will discard them. Continue?',
        () => _doLoadMtbl(),
        null
      );
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
        _dirty = true;
        _currentPage = 1;
        _renderTable();
        _updateStats();
        _showToast(`Loaded ${_entries.length} entries from ${res.path}`, 'success');
      }
    } catch (e) { _showToast('Load error: ' + e, 'error'); }
  }

  // ── Confirm Dialog ─────────────────────────────────────────

  function _showConfirm(title, message, onYes, onNo, yesLabel, noLabel) {
    const d = document.getElementById('mdb-confirm-dialog');
    document.getElementById('mdb-confirm-title').textContent = title;
    document.getElementById('mdb-confirm-message').textContent = message;
    const btnYes = document.getElementById('mdb-confirm-yes');
    const btnNo  = document.getElementById('mdb-confirm-no');
    btnYes.textContent = yesLabel || 'Yes';
    btnNo.textContent  = noLabel || 'No';
    d.classList.remove('hidden');

    function cleanup() {
      d.classList.add('hidden');
      btnYes.replaceWith(btnYes.cloneNode(true));
      btnNo.replaceWith(btnNo.cloneNode(true));
    }

    document.getElementById('mdb-confirm-yes').addEventListener('click', () => {
      cleanup();
      if (onYes) onYes();
    });
    document.getElementById('mdb-confirm-no').addEventListener('click', () => {
      cleanup();
      if (onNo) onNo();
    });
  }

  // ── Helpers ────────────────────────────────────────────────

  function _esc(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  function _uid() {
    return Math.random().toString(36).substring(2, 10);
  }

  function _showToast(msg, type) {
    if (typeof showToast === 'function') {
      showToast(msg, type);
    } else {
      console.log(`[settings] ${type}: ${msg}`);
    }
  }

  // ── Bindings ───────────────────────────────────────────────

  function init() {
    if (_initialized) return;
    _initialized = true;

    // Back to editor
    document.getElementById('mdb-back-btn')?.addEventListener('click', hide);

    // Save
    document.getElementById('mdb-save-btn')?.addEventListener('click', _saveDatabase);

    // Search
    const search = document.getElementById('mdb-search');
    if (search) {
      search.addEventListener('input', () => {
        _searchTerm = search.value.trim();
        _currentPage = 1;
        _renderTable();
      });
    }

    // Pagination
    document.getElementById('mdb-page-prev')?.addEventListener('click', () => {
      if (_currentPage > 1) { _currentPage--; _renderTable(); }
    });
    document.getElementById('mdb-page-next')?.addEventListener('click', () => {
      _currentPage++;
      _renderTable();
    });

    // Table click delegation
    const tbody = document.getElementById('mdb-table-body');
    if (tbody) {
      tbody.addEventListener('click', (e) => {
        if (e.target.closest('.mdb-row-del')) { _handleDeleteClick(e); return; }
        _handleCellClick(e);
      });
    }

    // Add record
    document.getElementById('mdb-add-btn')?.addEventListener('click', _showAddRecord);
    document.getElementById('add-record-save')?.addEventListener('click', _commitAddRecord);
    document.getElementById('add-record-cancel')?.addEventListener('click', () => {
      document.getElementById('mdb-add-dialog')?.classList.add('hidden');
    });

    // Import
    document.getElementById('mdb-import-btn')?.addEventListener('click', _startImport);
    document.getElementById('import-preview-btn')?.addEventListener('click', _previewImport);
    document.getElementById('import-execute-btn')?.addEventListener('click', _executeImport);
    document.getElementById('import-cancel-btn')?.addEventListener('click', () => {
      document.getElementById('mdb-import-dialog')?.classList.add('hidden');
    });

    // Merge dialog
    document.getElementById('mdb-merge-btn')?.addEventListener('click', _startImport);
    document.getElementById('merge-apply-btn')?.addEventListener('click', _applyMerge);
    document.getElementById('merge-cancel-btn')?.addEventListener('click', () => {
      document.getElementById('mdb-merge-dialog')?.classList.add('hidden');
    });
    document.getElementById('merge-next-btn')?.addEventListener('click', _nextConflict);
    document.getElementById('merge-prev-btn')?.addEventListener('click', _prevConflict);
    document.getElementById('merge-conflicts-list')?.addEventListener('click', _handleMergeAction);

    // New from scratch
    document.getElementById('mdb-new-btn')?.addEventListener('click', _newFromScratch);

    // Export
    document.getElementById('mdb-export-excel')?.addEventListener('click', _exportExcel);
    document.getElementById('mdb-export-csv')?.addEventListener('click', _exportCSV);

    // Save / Load .mtbl
    document.getElementById('mdb-save-mtbl')?.addEventListener('click', _saveMtbl);
    document.getElementById('mdb-load-mtbl')?.addEventListener('click', _loadMtbl);
  }

  return { init, show, hide };
})();
