/**
 * ui/js/editpanel.js
 * ------------------
 * Right-side annotation edit panel with undo/redo support.
 */

const EditPanel = (() => {
  'use strict';

  let currentMode = 'annotation'; // 'annotation' | 'dataset-chip'

  function init() {
    _bindButtons();
    _bindExpanders();
    _bindUndoRedo();
    close();
  }

  async function open(annotationId) {
    try {
      if (!annotationId) {
        close();
        return;
      }

      currentMode = 'annotation';
      Store.selectedId = annotationId;

      const res = await window.pywebview.api.get_annotation(annotationId);
      if (!res || !res.ok || !res.record) {
        console.error('[editpanel] get_annotation failed:', res?.error);
        close();
        return;
      }

      const rec = res.record;
      Store.setSelectedAnnotation(rec);

      _showActivePanel();
      _populateRecord(rec);
      _clearManualFields();
      _setSuggestionsVisible(true);
      _showVariableField(true);
      _setManualLabelsForVariableMode();
      _updatePrimaryActionLabels();
      _setManualOverrideEnabled(true);
      _setActionButtonsEnabled(true);

      await _loadSuggestions(annotationId);

      if (typeof Canvas !== 'undefined' && Canvas.highlightSelected) {
        Canvas.highlightSelected();
      }
    } catch (e) {
      console.error('[editpanel] open error:', e);
      close();
    }
  }

  async function openDatasetChip(datasetRecord) {
    try {
      if (!datasetRecord) {
        close();
        return;
      }

      currentMode = 'dataset-chip';
      Store.selectedId = datasetRecord.annotation_id || '';
      Store.setSelectedAnnotation(datasetRecord);

      _showActivePanel();
      _populateDatasetRecord(datasetRecord);
      _clearManualFields();

      const dsInput = document.getElementById('manual-dataset');
      const labelInput = document.getElementById('manual-label');

      if (dsInput) dsInput.value = datasetRecord.sdtm_dataset || '';
      if (labelInput) labelInput.value = _extractFullForm(datasetRecord.sdtm_label || '');

      _setSuggestionsVisible(false);
      _clearSuggestions();
      _showVariableField(false);
      _setManualLabelsForDatasetMode(datasetRecord);
      _updatePrimaryActionLabels();
      _setManualOverrideEnabled(true);
      _setActionButtonsEnabled(false);

      if (typeof Canvas !== 'undefined' && Canvas.highlightSelected) {
        Canvas.highlightSelected();
      }
    } catch (e) {
      console.error('[editpanel] openDatasetChip error:', e);
      close();
    }
  }

  function close() {
    currentMode = 'annotation';
    Store.clearSelectedAnnotation();

    const panelEmpty = document.getElementById('panel-empty');
    const panelActive = document.getElementById('panel-active');
    const removeConfirm = document.getElementById('remove-confirm');

    if (panelActive) panelActive.classList.add('hidden');
    if (panelEmpty) panelEmpty.classList.remove('hidden');
    if (removeConfirm) removeConfirm.classList.add('hidden');

    _clearSuggestions();
    _clearManualFields();
    _setSuggestionsVisible(true);
    _showVariableField(true);
    _setManualLabelsForVariableMode();
    _updatePrimaryActionLabels();
    _setManualOverrideEnabled(true);
    _setActionButtonsEnabled(true);

    if (typeof Canvas !== 'undefined' && Canvas.highlightSelected) {
      Canvas.highlightSelected();
    }
  }

  function _showActivePanel() {
    const panelEmpty = document.getElementById('panel-empty');
    const panelActive = document.getElementById('panel-active');

    if (panelEmpty) panelEmpty.classList.add('hidden');
    if (panelActive) panelActive.classList.remove('hidden');
  }

  function _populateRecord(rec) {
    const rawVar = document.getElementById('panel-raw-var');
    const component = document.getElementById('panel-component');
    const formCode = document.getElementById('panel-form-code');
    const mapping = document.getElementById('panel-mapping');
    const mappingLabel = document.getElementById('panel-mapping-label');
    const statusDot = document.getElementById('panel-status-dot');

    if (rawVar) rawVar.textContent = rec.raw_variable || 'PENDING';
    if (component) component.textContent = rec.component || '—';
    if (formCode) formCode.textContent = rec.form_code || '—';

    if (mapping) {
      if (rec.sdtm_dataset && rec.sdtm_variable) {
        mapping.textContent = `${rec.sdtm_dataset}.${rec.sdtm_variable}`;
      } else if (rec.status === 'NOT_SUBMITTED') {
        mapping.textContent = 'Not Submitted';
      } else {
        mapping.textContent = 'No mapping';
      }
    }

    if (mappingLabel) {
      mappingLabel.textContent = rec.sdtm_label || rec.status || '—';
    }

    if (statusDot) {
      statusDot.style.background = _statusColour(rec.status);
    }
  }

  function _populateDatasetRecord(rec) {
    const rawVar = document.getElementById('panel-raw-var');
    const component = document.getElementById('panel-component');
    const formCode = document.getElementById('panel-form-code');
    const mapping = document.getElementById('panel-mapping');
    const mappingLabel = document.getElementById('panel-mapping-label');
    const statusDot = document.getElementById('panel-status-dot');

    const ds = rec.sdtm_dataset || 'DATASET';
    const fullForm = _extractFullForm(rec.sdtm_label || '');

    if (rawVar) rawVar.textContent = ds;
    if (component) component.textContent = 'DATASET_HEADER';
    if (formCode) formCode.textContent = rec.form_code || '—';

    if (mapping) {
      mapping.textContent = ds;
    }

    if (mappingLabel) {
      mappingLabel.textContent = fullForm || 'Dataset annotation';
    }

    if (statusDot) {
      statusDot.style.background = '#652BDA';
    }
  }

  function _extractFullForm(text) {
    const val = String(text || '').trim();
    if (!val) return '';

    const eq = val.indexOf('=');
    if (eq >= 0) {
      return val.slice(eq + 1).trim();
    }
    return val;
  }

  function _setManualOverrideEnabled(enabled) {
    const ds = document.getElementById('manual-dataset');
    const variable = document.getElementById('manual-variable');
    const label = document.getElementById('manual-label');
    const btnManualConfirm = document.getElementById('btn-manual-confirm');

    [ds, variable, label, btnManualConfirm].forEach(el => {
      if (!el) return;
      el.disabled = !enabled;
      el.style.opacity = enabled ? '' : '0.55';
      el.style.pointerEvents = enabled ? '' : 'none';
    });
  }

  function _setActionButtonsEnabled(enabled) {
    const btnNotSubmitted = document.getElementById('btn-not-submitted');
    const btnClear = document.getElementById('btn-clear');
    const btnRemove = document.getElementById('btn-remove');

    [btnNotSubmitted, btnClear, btnRemove].forEach(el => {
      if (!el) return;
      el.disabled = !enabled;
      el.style.opacity = enabled ? '' : '0.55';
      el.style.pointerEvents = enabled ? '' : 'none';
    });
  }

  function _showVariableField(show) {
    const variableInput = document.getElementById('manual-variable');
    if (!variableInput) return;

    const manualRow = variableInput.closest('.manual-row');
    if (!manualRow) return;

    if (show) {
      manualRow.classList.remove('dataset-mode');
      variableInput.disabled = false;
      variableInput.style.display = '';
    } else {
      manualRow.classList.add('dataset-mode');
      variableInput.disabled = true;
      variableInput.value = '';
      variableInput.style.display = 'none';
    }
  }

  function _setSuggestionsVisible(show) {
    const list = document.getElementById('suggestions-list');
    if (!list) return;

    const suggestionsLabel = list.previousElementSibling;
    const dividerBelow = list.nextElementSibling;

    if (suggestionsLabel && suggestionsLabel.classList.contains('section-label')) {
      suggestionsLabel.classList.toggle('hidden', !show);
    }

    list.classList.toggle('hidden', !show);

    if (dividerBelow && dividerBelow.classList.contains('divider')) {
      dividerBelow.classList.toggle('hidden', !show);
    }
  }

  function _setManualLabelsForDatasetMode(datasetRecord = null) {
    const datasetInput = document.getElementById('manual-dataset');
    const labelInput = document.getElementById('manual-label');

    if (datasetInput) {
      datasetInput.placeholder = datasetRecord?.sdtm_dataset || 'CM';
      datasetInput.style.width = '100%';
      datasetInput.style.flex = '1';
    }

    if (labelInput) {
      const ff = _extractFullForm(datasetRecord?.sdtm_label || '');
      labelInput.placeholder = ff || 'Concomitant Medication';
    }
  }

  function _setManualLabelsForVariableMode() {
    const datasetInput = document.getElementById('manual-dataset');
    const variableInput = document.getElementById('manual-variable');
    const labelInput = document.getElementById('manual-label');

    if (datasetInput) {
      datasetInput.placeholder = 'Dataset';
      datasetInput.style.width = '90px';
      datasetInput.style.flex = '';
      datasetInput.style.display = '';
    }

    if (variableInput) {
      variableInput.placeholder = 'Variable';
      variableInput.style.display = '';
    }

    if (labelInput) {
      labelInput.placeholder = 'Label (optional)';
    }
  }

  function _updatePrimaryActionLabels() {
    const btnClear = document.getElementById('btn-clear');
    if (btnClear) {
      btnClear.textContent = currentMode === 'annotation' ? 'Unmap' : 'Clear Mapping';
    }
  }

  function _clearManualFields() {
    const ds = document.getElementById('manual-dataset');
    const variable = document.getElementById('manual-variable');
    const label = document.getElementById('manual-label');

    if (ds) ds.value = '';
    if (variable) variable.value = '';
    if (label) label.value = '';
  }

  async function _loadSuggestions(annotationId) {
    const list = document.getElementById('suggestions-list');
    if (!list) return;

    list.innerHTML = '<div class="suggestions-loading muted small">Loading suggestions...</div>';

    try {
      const res = await window.pywebview.api.get_suggestions(annotationId);

      if (!res || !res.ok || !Array.isArray(res.suggestions) || !res.suggestions.length) {
        list.innerHTML = '<div class="suggestions-loading muted small">No suggestions</div>';
        return;
      }

      list.innerHTML = '';

      res.suggestions.forEach((s, i) => {
        const card = document.createElement('div');
        card.className = `suggestion-card${i === 0 ? ' top-card' : ''}`;

        const scoreClass =
          s.score_pct >= 70 ? 'high' :
          s.score_pct >= 40 ? 'mid' : 'low';

        card.innerHTML = `
          <div class="suggestion-top-row">
            <span class="suggestion-var">${escapeHtml(`${s.sdtm_dataset}.${s.sdtm_variable}`)}</span>
            <span class="suggestion-score ${scoreClass}">${s.score_pct}%</span>
          </div>
          <div class="suggestion-label">${escapeHtml(s.sdtm_label || '—')}</div>
        `;

        card.addEventListener('click', () => {
          const ds = document.getElementById('manual-dataset');
          const variable = document.getElementById('manual-variable');
          const label = document.getElementById('manual-label');

          if (ds) ds.value = s.sdtm_dataset || '';
          if (variable) variable.value = s.sdtm_variable || '';
          if (label) label.value = s.sdtm_label || '';
        });

        list.appendChild(card);
      });

    } catch (e) {
      console.error('[editpanel] suggestion load error:', e);
      list.innerHTML = '<div class="suggestions-loading muted small">No suggestions</div>';
    }
  }

  function _clearSuggestions() {
    const list = document.getElementById('suggestions-list');
    if (list) {
      list.innerHTML = '';
    }
  }

  function _bindButtons() {
    const btnPanelClose = document.getElementById('btn-panel-close');
    const btnClosePanel = document.getElementById('btn-close-panel');
    const btnNotSubmitted = document.getElementById('btn-not-submitted');
    const btnClear = document.getElementById('btn-clear');
    const btnRemove = document.getElementById('btn-remove');
    const btnRemoveConfirm = document.getElementById('btn-remove-confirm');
    const btnRemoveCancel = document.getElementById('btn-remove-cancel');
    const btnManualConfirm = document.getElementById('btn-manual-confirm');

    if (btnPanelClose) btnPanelClose.addEventListener('click', () => close());
    if (btnClosePanel) btnClosePanel.addEventListener('click', () => close());

    if (btnNotSubmitted) {
      btnNotSubmitted.addEventListener('click', async () => {
        if (currentMode !== 'annotation') return;
        if (!Store.selectedRecord) return;

        await _applyAndTrack({
          before: _snapshotFromRecord(Store.selectedRecord),
          after: {
            annotation_id: Store.selectedId,
            status: 'NOT_SUBMITTED',
            sdtm_dataset: '',
            sdtm_variable: '',
            sdtm_label: 'Not Submitted',
          },
        });
      });
    }

    if (btnClear) {
      btnClear.addEventListener('click', async () => {
        if (currentMode !== 'annotation') return;
        if (!Store.selectedRecord) return;

        await _applyAndTrack({
          before: _snapshotFromRecord(Store.selectedRecord),
          after: {
            annotation_id: Store.selectedId,
            status: 'UNMAPPED',
            sdtm_dataset: '',
            sdtm_variable: '',
            sdtm_label: '',
          },
        });
      });
    }

    if (btnRemove) {
      btnRemove.addEventListener('click', () => {
        if (currentMode !== 'annotation') return;
        const removeConfirm = document.getElementById('remove-confirm');
        if (removeConfirm) removeConfirm.classList.remove('hidden');
      });
    }

    if (btnRemoveConfirm) {
      btnRemoveConfirm.addEventListener('click', async () => {
        if (currentMode !== 'annotation') return;
        if (!Store.selectedRecord) return;

        const removeConfirm = document.getElementById('remove-confirm');
        if (removeConfirm) removeConfirm.classList.add('hidden');

        await _applyAndTrack({
          before: _snapshotFromRecord(Store.selectedRecord),
          after: {
            annotation_id: Store.selectedId,
            status: 'REMOVED',
            sdtm_dataset: '',
            sdtm_variable: '',
            sdtm_label: '',
          },
        }, false);

        close();
      });
    }

    if (btnRemoveCancel) {
      btnRemoveCancel.addEventListener('click', () => {
        const removeConfirm = document.getElementById('remove-confirm');
        if (removeConfirm) removeConfirm.classList.add('hidden');
      });
    }

    if (btnManualConfirm) {
      btnManualConfirm.addEventListener('click', async () => {
        if (!Store.selectedRecord) return;

        if (currentMode === 'dataset-chip') {
          const ds = (document.getElementById('manual-dataset')?.value || '').trim();
          const fullForm = (document.getElementById('manual-label')?.value || '').trim();

          if (!ds) {
            alert('Dataset is required.');
            return;
          }

          Store.selectedRecord.sdtm_dataset = ds;
          Store.selectedRecord.sdtm_label = fullForm;
          _populateDatasetRecord(Store.selectedRecord);
          _setManualLabelsForDatasetMode(Store.selectedRecord);
          return;
        }

        const ds = (document.getElementById('manual-dataset')?.value || '').trim().toUpperCase();
        const variable = (document.getElementById('manual-variable')?.value || '').trim().toUpperCase();
        const label = (document.getElementById('manual-label')?.value || '').trim();

        if (!ds || !variable) {
          alert('Dataset and Variable are required.');
          return;
        }

        await _applyAndTrack({
          before: _snapshotFromRecord(Store.selectedRecord),
          after: {
            annotation_id: Store.selectedId,
            status: 'USER_CORRECTED',
            sdtm_dataset: ds,
            sdtm_variable: variable,
            sdtm_label: label,
          },
        });
      });
    }
  }

  function _bindExpanders() {
    const manualHdr = document.getElementById('expander-manual-hdr');
    const manualBody = document.getElementById('expander-manual-body');
    const manualChevron = manualHdr?.querySelector('.expander-chevron');

    if (manualHdr && manualBody) {
      manualHdr.addEventListener('click', () => {
        manualBody.classList.toggle('hidden');
        if (manualChevron) manualChevron.classList.toggle('open');
      });
    }

    const colourHdr = document.getElementById('expander-colour-hdr');
    const colourBody = document.getElementById('expander-colour-body');
    const colourChevron = colourHdr?.querySelector('.expander-chevron');

    if (colourHdr && colourBody) {
      colourHdr.addEventListener('click', () => {
        colourBody.classList.toggle('hidden');
        if (colourChevron) colourChevron.classList.toggle('open');
      });
    }

    document.querySelectorAll('.colour-swatch').forEach((swatch) => {
      swatch.addEventListener('click', async () => {
        if (!Store.selectedRecord) return;

        if (currentMode === 'dataset-chip' && Store.selectedRecord._isDatasetChip) {
          const colourKey = swatch.dataset.colourKey;
          const dataset = Store.selectedRecord._datasetCode;

          let beforeColour = '';
          try {
            const prev = await window.pywebview.api.get_dataset_colours();
            const formCode = String(Store.selectedRecord._formCode || '').toUpperCase();
            const beforeKey = `${formCode}::${String(dataset).toUpperCase()}`;
            if (prev && prev.ok && prev.colours) {
              beforeColour = prev.colours[beforeKey] || '';
            }
          } catch (_) {}

          const res = await window.pywebview.api.set_dataset_colour(dataset, colourKey);
          if (!res || !res.ok) {
            console.error('[editpanel] set_dataset_colour failed:', res?.error);
            return;
          }

          Store.pushHistory({
            type: 'dataset-colour',
            before: {
              form_code: Store.selectedRecord._formCode,
              dataset,
              colour: beforeColour,
              mode: 'dataset-chip',
            },
            after: {
              form_code: Store.selectedRecord._formCode,
              dataset,
              colour: colourKey,
              mode: 'dataset-chip',
            },
          });

          await _refreshAfterUpdate({
            reopenPanel: true,
            reloadSuggestions: false,
            keepManualBlank: false,
            preserveSelection: true,
            reopenDatasetChip: true,
          });

          return;
        }

        if (!Store.selectedRecord.sdtm_dataset) return;

        const colourKey = swatch.dataset.colourKey;
        const dataset = Store.selectedRecord.sdtm_dataset;
        const formCode = Store.selectedRecord.form_code || '';

        let beforeColour = '';
        try {
          const prev = await window.pywebview.api.get_dataset_colours();
          const beforeKey = `${String(formCode).toUpperCase()}::${String(dataset).toUpperCase()}`;
          if (prev && prev.ok && prev.colours) {
            beforeColour = prev.colours[beforeKey] || '';
          }
        } catch (_) {}

        const res = await window.pywebview.api.set_dataset_colour(dataset, colourKey);
        if (!res || !res.ok) {
          console.error('[editpanel] set_dataset_colour failed:', res?.error);
          return;
        }

        Store.pushHistory({
          type: 'dataset-colour',
          before: {
            form_code: formCode,
            dataset,
            colour: beforeColour,
            mode: 'annotation',
            annotation_id: Store.selectedId,
          },
          after: {
            form_code: formCode,
            dataset,
            colour: colourKey,
            mode: 'annotation',
            annotation_id: Store.selectedId,
          },
        });

        await _refreshAfterUpdate({
          reopenPanel: true,
          reloadSuggestions: false,
          keepManualBlank: true,
          preserveSelection: true,
          reopenDatasetChip: false,
        });
      });
    });
  }

  function _bindUndoRedo() {
    document.addEventListener('keydown', async (e) => {
      const isMac = navigator.platform.toUpperCase().includes('MAC');
      const ctrl = isMac ? e.metaKey : e.ctrlKey;

      if (!ctrl) return;

      if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        await undo();
      } else if (
        e.key.toLowerCase() === 'y' ||
        (e.key.toLowerCase() === 'z' && e.shiftKey)
      ) {
        e.preventDefault();
        await redo();
      }
    });
  }

  async function _applyAndTrack(action, reopenPanel = true) {
    const ok = await _applySnapshot(action.after);
    if (!ok) return;

    Store.pushHistory(action);

    await _refreshAfterUpdate({
      reopenPanel,
      reloadSuggestions: false,
      keepManualBlank: true,
      preserveSelection: true,
      reopenDatasetChip: false,
    });
  }

  async function _applySnapshot(snapshot) {
    const res = await window.pywebview.api.update_annotation(
      snapshot.annotation_id,
      snapshot.status,
      snapshot.sdtm_dataset || '',
      snapshot.sdtm_variable || '',
      snapshot.sdtm_label || ''
    );

    if (!res || !res.ok) {
      console.error('[editpanel] update failed:', res?.error);
      return false;
    }
    return true;
  }

  async function _applyDatasetColourSnapshot(snapshot) {
    try {
      if (!snapshot?.dataset) return false;

      const res = await window.pywebview.api.set_dataset_colour(
        snapshot.dataset,
        snapshot.colour || ''
      );

      if (!res || !res.ok) {
        console.error('[editpanel] dataset colour restore failed:', res?.error);
        return false;
      }

      return true;
    } catch (e) {
      console.error('[editpanel] _applyDatasetColourSnapshot error:', e);
      return false;
    }
  }

  async function undo() {
    const action = Store.popUndo();
    if (!action) return;

    if (action.type === 'dataset-colour') {
      const ok = await _applyDatasetColourSnapshot(action.before);
      if (!ok) return;

      Store.pushRedo(action);

      if (action.before.mode === 'dataset-chip') {
        Store.selectedId = `datasetchip::${String(action.before.form_code).toUpperCase()}::${String(action.before.dataset).toUpperCase()}`;
      } else if (action.before.annotation_id) {
        Store.selectedId = action.before.annotation_id;
      }

      await _refreshAfterUpdate({
        reopenPanel: true,
        reloadSuggestions: false,
        keepManualBlank: true,
        preserveSelection: true,
        reopenDatasetChip: action.before.mode === 'dataset-chip',
      });
      return;
    }

    const ok = await _applySnapshot(action.before);
    if (!ok) return;

    Store.pushRedo(action);
    Store.selectedId = action.before.annotation_id;

    await _refreshAfterUpdate({
      reopenPanel: true,
      reloadSuggestions: false,
      keepManualBlank: true,
      preserveSelection: true,
      reopenDatasetChip: false,
    });
  }

  async function redo() {
    const action = Store.popRedo();
    if (!action) return;

    if (action.type === 'dataset-colour') {
      const ok = await _applyDatasetColourSnapshot(action.after);
      if (!ok) return;

      Store.pushHistory(action);

      if (action.after.mode === 'dataset-chip') {
        Store.selectedId = `datasetchip::${String(action.after.form_code).toUpperCase()}::${String(action.after.dataset).toUpperCase()}`;
      } else if (action.after.annotation_id) {
        Store.selectedId = action.after.annotation_id;
      }

      await _refreshAfterUpdate({
        reopenPanel: true,
        reloadSuggestions: false,
        keepManualBlank: true,
        preserveSelection: true,
        reopenDatasetChip: action.after.mode === 'dataset-chip',
      });
      return;
    }

    const ok = await _applySnapshot(action.after);
    if (!ok) return;

    Store.pushHistory(action);
    Store.selectedId = action.after.annotation_id;

    await _refreshAfterUpdate({
      reopenPanel: true,
      reloadSuggestions: false,
      keepManualBlank: true,
      preserveSelection: true,
      reopenDatasetChip: false,
    });
  }

  function _snapshotFromRecord(rec) {
    return {
      annotation_id: rec.annotation_id,
      status: rec.status || 'UNMAPPED',
      sdtm_dataset: rec.sdtm_dataset || '',
      sdtm_variable: rec.sdtm_variable || '',
      sdtm_label: rec.sdtm_label || '',
    };
  }

  async function _refreshAfterUpdate(opts = {}) {
    const {
      reopenPanel = true,
      reloadSuggestions = false,
      keepManualBlank = true,
      preserveSelection = true,
      reopenDatasetChip = false,
    } = opts;

    if (typeof Sidebar !== 'undefined' && Sidebar.refreshStats) {
      await Sidebar.refreshStats();
    }

    const selectedId = Store.selectedId;
    const selectedRecord = Store.selectedRecord;

    if (typeof Canvas !== 'undefined' && Canvas.loadPage) {
      await Canvas.loadPage(Store.currentPage);
    }

    if (preserveSelection && selectedId) {
      Store.selectedId = selectedId;
    }

    if (reopenPanel && reopenDatasetChip && selectedRecord?._isDatasetChip) {
      await openDatasetChip(selectedRecord);
      return;
    }

    let freshRecord = null;
    if (selectedId && !String(selectedId).startsWith('datasetchip::')) {
      const fresh = await window.pywebview.api.get_annotation(selectedId);
      if (fresh && fresh.ok && fresh.record) {
        freshRecord = fresh.record;
        Store.setSelectedAnnotation(fresh.record);
      }
    }

    if (reopenPanel && freshRecord) {
      _showActivePanel();
      _populateRecord(freshRecord);

      if (keepManualBlank) {
        _clearManualFields();
      }

      _setSuggestionsVisible(true);
      _showVariableField(true);
      _setManualLabelsForVariableMode();
      _updatePrimaryActionLabels();
      _setManualOverrideEnabled(true);
      _setActionButtonsEnabled(true);

      if (reloadSuggestions) {
        await _loadSuggestions(selectedId);
      }

      if (typeof Canvas !== 'undefined' && Canvas.highlightSelected) {
        Canvas.highlightSelected();
      }
    } else if (!selectedRecord) {
      close();
    } else if (typeof Canvas !== 'undefined' && Canvas.highlightSelected) {
      Canvas.highlightSelected();
    }
  }

  function _statusColour(status) {
    switch (status) {
      case 'RESOLVED': return '#3DB7FF';
      case 'USER_CORRECTED': return '#00E676';
      case 'UNMAPPED': return '#FF8A00';
      case 'NOT_SUBMITTED': return '#8B8D99';
      case 'REMOVED': return '#2A2D4A';
      default: return '#8B8D99';
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text ?? '';
    return div.innerHTML;
  }

  return {
    init,
    open,
    openDatasetChip,
    close,
    undo,
    redo,
  };
})();