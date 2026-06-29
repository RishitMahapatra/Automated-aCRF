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

      // Try backend first, fall back to Store for user-created annotations
      let rec = null;
      const res = await window.pywebview.api.get_annotation(annotationId);
      if (res && res.ok && res.record) {
        rec = res.record;
      } else {
        // Fallback: check Store for user-created annotations
        rec = (Store.annotations || []).find(r => r.annotation_id === annotationId) || null;
      }

      if (!rec) {
        console.error('[editpanel] annotation not found:', annotationId);
        close();
        return;
      }

      // Apply local geometry overrides
      if (typeof Canvas !== 'undefined' && Canvas.applyLocalOverrides) {
        rec = Canvas.applyLocalOverrides(rec);
      }

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

      // Apply local UI overrides to the dataset chip record
      const rec = (typeof Canvas !== 'undefined' && Canvas.applyLocalOverrides)
        ? Canvas.applyLocalOverrides(datasetRecord)
        : datasetRecord;

      Store.selectedId = rec.annotation_id || '';
      Store.setSelectedAnnotation(rec);

      _showActivePanel();
      _populateDatasetRecord(rec);
      _clearManualFields();

      const dsInput = document.getElementById('manual-dataset');
      const labelInput = document.getElementById('manual-label');

      if (dsInput) dsInput.value = rec.sdtm_dataset || '';
      if (labelInput) labelInput.value = _extractFullForm(rec.sdtm_label || '');

      _setSuggestionsVisible(false);
      _clearSuggestions();
      _showVariableField(false);
      _setManualLabelsForDatasetMode(rec);
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

    if (panelActive) panelActive.classList.add('hidden');
    if (panelEmpty) panelEmpty.classList.remove('hidden');

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

    const parenMatch = val.match(/^[A-Z0-9_]+\s*\((.*)\)$/);
    if (parenMatch) {
      return String(parenMatch[1] || '').trim();
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
    const expander = document.getElementById('expander-suggestions');
    const divider = document.getElementById('suggestions-divider');
    if (expander) expander.classList.toggle('hidden', !show);
    if (divider) divider.classList.toggle('hidden', !show);
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

  function _normalizeDatasetName(raw) {
    const trimmed = raw.trim();
    const openIdx = trimmed.indexOf('(');
    const closeIdx = trimmed.lastIndexOf(')');
    if (openIdx === -1 && closeIdx === -1) {
      return { ok: true, value: trimmed.toUpperCase() };
    }
    const openCount = (trimmed.match(/\(/g) || []).length;
    const closeCount = (trimmed.match(/\)/g) || []).length;
    if (openCount !== 1 || closeCount !== 1) {
      return { ok: false, error: 'Only one set of parentheses () is allowed.' };
    }
    if (openIdx > closeIdx) {
      return { ok: false, error: 'Parentheses must be in the form (...).' };
    }
    const codePart = trimmed.slice(0, openIdx).trim().toUpperCase();
    const fullPart = trimmed.slice(openIdx);
    return { ok: true, value: codePart ? `${codePart} ${fullPart}`.trim() : fullPart };
  }

  async function _loadSuggestions(annotationId) {
    const list = document.getElementById('suggestions-list');
    if (!list) return;

    const sugHdr = document.getElementById('expander-suggestions-hdr');
    const sugLbl = sugHdr?.querySelector('.expander-label');

    // Skip suggestions for user-created annotations (backend doesn't know them)
    if (typeof Canvas !== 'undefined' && Canvas.isUserCreated && Canvas.isUserCreated(annotationId)) {
      list.innerHTML = '<div class="suggestions-loading muted small">No suggestions available</div>';
      if (sugHdr) sugHdr.classList.add('user-generated');
      if (sugLbl) sugLbl.textContent = 'Suggestions (User Generated)';
      return;
    }

    if (sugHdr) sugHdr.classList.remove('user-generated');
    if (sugLbl) sugLbl.textContent = 'Suggestions';

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

        card.addEventListener('click', async () => {
          // Show confirm dialog
          const overlay = document.getElementById('suggest-confirm-overlay');
          const body = document.getElementById('suggest-confirm-body');
          const yesBtn = document.getElementById('suggest-confirm-yes');
          const cancelBtn = document.getElementById('suggest-confirm-cancel');
          if (!overlay) return;
          if (body) body.innerHTML = `<strong>${escapeHtml(`${s.sdtm_dataset}.${s.sdtm_variable}`)}</strong><br>${escapeHtml(s.sdtm_label || '—')}<br><span style="font-size:11px;opacity:0.65;margin-top:4px;display:block">This will be applied and can be undone with Ctrl+Z</span>`;
          overlay.classList.remove('hidden');

          const confirmed = await new Promise(resolve => {
            const closeOverlay = (val) => { overlay.classList.add('hidden'); resolve(val); };
            yesBtn.addEventListener('click', () => closeOverlay(true), { once: true });
            cancelBtn.addEventListener('click', () => closeOverlay(false), { once: true });
            overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOverlay(false); }, { once: true });
          });

          if (!confirmed || !Store.selectedRecord) return;

          await _applyAndTrack({
            before: _snapshotFromRecord(Store.selectedRecord),
            after: {
              annotation_id: Store.selectedId,
              status: 'USER_CORRECTED',
              sdtm_dataset: s.sdtm_dataset || '',
              sdtm_variable: s.sdtm_variable || '',
              sdtm_label: s.sdtm_label || '',
            },
          });
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
        if (!Store.selectedRecord) return;
        const rec = Store.selectedRecord;
        const annotationId = Store.selectedId;
        window._removeConfirmCallback = async () => {
          await _applyAndTrack({
            before: _snapshotFromRecord(rec),
            after: {
              annotation_id: annotationId,
              status: 'REMOVED',
              sdtm_dataset: '',
              sdtm_variable: '',
              sdtm_label: '',
            },
          }, false);
          close();
        };
        const dlg = document.getElementById('ann-remove-confirm');
        if (dlg) dlg.classList.remove('hidden');
      });
    }

    if (btnManualConfirm) {
      btnManualConfirm.addEventListener('click', async () => {
        if (!Store.selectedRecord) return;

        if (currentMode === 'dataset-chip') {
          const _dsNorm = _normalizeDatasetName(document.getElementById('manual-dataset')?.value || '');
          if (!_dsNorm.ok) { alert(_dsNorm.error); return; }
          const ds = _dsNorm.value;
          const fullForm = (document.getElementById('manual-label')?.value || '').trim();

          if (!ds) {
            alert('Dataset is required.');
            return;
          }

          if (!Store.selectedRecord || !Store.selectedRecord._isDatasetChip) {
            return;
          }

          const before = {
            annotation_id: Store.selectedRecord.annotation_id,
            sdtm_dataset: Store.selectedRecord.sdtm_dataset || '',
            sdtm_label: Store.selectedRecord.sdtm_label || '',
            full_name: _extractFullForm(Store.selectedRecord.sdtm_label || ''),
            mode: 'dataset-chip-edit',
          };

          let nextRecord = Store.selectedRecord;
          if (typeof Canvas !== 'undefined' && Canvas.updateDatasetChip) {
            nextRecord = Canvas.updateDatasetChip(Store.selectedRecord, {
              sdtm_dataset: ds,
              full_name: fullForm,
            }) || Store.selectedRecord;
          }

          const after = {
            annotation_id: nextRecord.annotation_id,
            sdtm_dataset: nextRecord.sdtm_dataset || ds,
            sdtm_label: nextRecord.sdtm_label || (fullForm ? `${ds} (${fullForm})` : ds),
            full_name: fullForm,
            mode: 'dataset-chip-edit',
          };

          _pushToUnifiedStack({
            type: 'dataset-chip-edit',
            before,
            after,
          });

          Store.setSelectedAnnotation(nextRecord);
          _populateDatasetRecord(nextRecord);
          _setManualLabelsForDatasetMode(nextRecord);

          if (typeof Canvas !== 'undefined' && Canvas.highlightSelected) {
            Canvas.highlightSelected();
          }

          return;
        }

        const _dsNorm2 = _normalizeDatasetName(document.getElementById('manual-dataset')?.value || '');
        if (!_dsNorm2.ok) { alert(_dsNorm2.error); return; }
        const ds = _dsNorm2.value;
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
    const suggestionsHdr = document.getElementById('expander-suggestions-hdr');
    const suggestionsBody = document.getElementById('expander-suggestions-body');
    const suggestionsChevron = suggestionsHdr?.querySelector('.expander-chevron');

    if (suggestionsHdr) suggestionsHdr.title = 'AI-suggested SDTM variable mappings — click a suggestion to apply it';

    if (suggestionsHdr && suggestionsBody) {
      suggestionsHdr.addEventListener('click', () => {
        suggestionsBody.classList.toggle('hidden');
        if (suggestionsChevron) suggestionsChevron.classList.toggle('open');
      });
    }

    const manualHdr = document.getElementById('expander-manual-hdr');
    const manualBody = document.getElementById('expander-manual-body');
    const manualChevron = manualHdr?.querySelector('.expander-chevron');

    if (manualHdr) manualHdr.title = 'Manually enter or override the SDTM dataset, variable, and label';

    if (manualHdr && manualBody) {
      manualHdr.addEventListener('click', () => {
        manualBody.classList.toggle('hidden');
        if (manualChevron) manualChevron.classList.toggle('open');
      });
    }

    const colourHdr = document.getElementById('expander-colour-hdr');
    const colourBody = document.getElementById('expander-colour-body');
    const colourChevron = colourHdr?.querySelector('.expander-chevron');

    if (colourHdr) colourHdr.title = 'Change the annotation box fill colour for this dataset';

    if (colourHdr && colourBody) {
      colourHdr.addEventListener('click', () => {
        colourBody.classList.toggle('hidden');
        if (colourChevron) colourChevron.classList.toggle('open');
      });
    }

    const actionsHdr = document.getElementById('expander-actions-hdr');
    const actionsBody = document.getElementById('expander-actions-body');
    const actionsChevron = actionsHdr?.querySelector('.expander-chevron');

    if (actionsHdr && actionsBody) {
      actionsHdr.addEventListener('click', () => {
        actionsBody.classList.toggle('hidden');
        if (actionsChevron) actionsChevron.classList.toggle('open');
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
  }

  // Always update formColourRegistry directly
  if (typeof Canvas !== 'undefined' && Canvas.updateFormColour) {
    Canvas.updateFormColour(
      String(Store.selectedRecord._formCode || '').toUpperCase(),
      String(dataset).toUpperCase(),
      colourKey
    );
  }

  _pushToUnifiedStack({
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

// Try backend colour update
const res = await window.pywebview.api.set_dataset_colour(dataset, colourKey);
if (!res || !res.ok) {
  console.error('[editpanel] set_dataset_colour failed:', res?.error);
  // Even if backend fails, update locally for user-created datasets
}

// Always update formColourRegistry directly for immediate effect
if (typeof Canvas !== 'undefined' && Canvas.updateFormColour) {
  Canvas.updateFormColour(formCode, dataset, colourKey);
}

_pushToUnifiedStack({
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
    // Canvas handles all Ctrl+Z/Y via capture-phase listener; no-op here.
  }

  function _pushToUnifiedStack(action) {
    if (typeof Canvas !== 'undefined' && Canvas.pushUndoAction) {
      Canvas.pushUndoAction(action);
    } else {
      Store.pushHistory(action);
    }
  }

  async function _applyAndTrack(action, reopenPanel = true) {
    const annotationId = action.after.annotation_id;

    // If user-created, update locally only
    if (typeof Canvas !== 'undefined' && Canvas.isUserCreated && Canvas.isUserCreated(annotationId)) {
      const updatedFields = {
        status: action.after.status,
        sdtm_dataset: action.after.sdtm_dataset || '',
        sdtm_variable: action.after.sdtm_variable || '',
        sdtm_label: action.after.sdtm_label || '',
      };
      Canvas.updateUserAnnotation(annotationId, updatedFields);
      _pushToUnifiedStack(action);

      await _refreshAfterUpdate({
        reopenPanel,
        reloadSuggestions: false,
        keepManualBlank: true,
        preserveSelection: true,
        reopenDatasetChip: false,
      });
      return;
    }

    const ok = await _applySnapshot(action.after);
    if (!ok) return;

    _pushToUnifiedStack(action);

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
    if (typeof Canvas !== 'undefined' && Canvas.undoGeometry) {
      await Canvas.undoGeometry();
    }
  }

  async function redo() {
    if (typeof Canvas !== 'undefined' && Canvas.redoGeometry) {
      await Canvas.redoGeometry();
    }
  }

  // Called by Canvas.undoGeometry() for EditPanel-owned action types.
  // Stack management is already done by canvas before this is called.
  async function undoAction(action) {
    if (action.type === 'dataset-chip-edit') {
      const chipId = action.before.annotation_id;
      const chipRecord = (Store.annotations || []).find(r => r.annotation_id === chipId);
      if (chipRecord && typeof Canvas !== 'undefined' && Canvas.updateDatasetChip) {
        const restored = Canvas.updateDatasetChip(chipRecord, {
          sdtm_dataset: action.before.sdtm_dataset || '',
          full_name: action.before.full_name || _extractFullForm(action.before.sdtm_label || ''),
        });
        if (restored) {
          Store.selectedId = restored.annotation_id;
          await openDatasetChip(restored);
        }
      }
      return;
    }

    if (action.type === 'dataset-colour') {
      const ok = await _applyDatasetColourSnapshot(action.before);
      if (!ok) return;

      if (typeof Canvas !== 'undefined' && Canvas.updateFormColour) {
        Canvas.updateFormColour(
          String(action.before.form_code || '').toUpperCase(),
          String(action.before.dataset || '').toUpperCase(),
          action.before.colour || ''
        );
      }

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

    // Generic field edit (no type or unrecognised type)
    const annotationId = action.before?.annotation_id;
    if (typeof Canvas !== 'undefined' && Canvas.isUserCreated && Canvas.isUserCreated(annotationId)) {
      Canvas.updateUserAnnotation(annotationId, {
        status: action.before.status,
        sdtm_dataset: action.before.sdtm_dataset || '',
        sdtm_variable: action.before.sdtm_variable || '',
        sdtm_label: action.before.sdtm_label || '',
      });
      Store.selectedId = annotationId;
      await _refreshAfterUpdate({
        reopenPanel: true,
        reloadSuggestions: false,
        keepManualBlank: true,
        preserveSelection: true,
        reopenDatasetChip: false,
      });
      return;
    }

    const ok = await _applySnapshot(action.before);
    if (!ok) return;
    Store.selectedId = annotationId;
    await _refreshAfterUpdate({
      reopenPanel: true,
      reloadSuggestions: false,
      keepManualBlank: true,
      preserveSelection: true,
      reopenDatasetChip: false,
    });
  }

  // Called by Canvas.redoGeometry() for EditPanel-owned action types.
  async function redoAction(action) {
    if (action.type === 'dataset-chip-edit') {
      const chipId = action.after.annotation_id;
      const chipRecord = (Store.annotations || []).find(r => r.annotation_id === chipId);
      if (chipRecord && typeof Canvas !== 'undefined' && Canvas.updateDatasetChip) {
        const restored = Canvas.updateDatasetChip(chipRecord, {
          sdtm_dataset: action.after.sdtm_dataset || '',
          full_name: action.after.full_name || _extractFullForm(action.after.sdtm_label || ''),
        });
        if (restored) {
          Store.selectedId = restored.annotation_id;
          await openDatasetChip(restored);
        }
      }
      return;
    }

    if (action.type === 'dataset-colour') {
      const ok = await _applyDatasetColourSnapshot(action.after);
      if (!ok) return;

      if (typeof Canvas !== 'undefined' && Canvas.updateFormColour) {
        Canvas.updateFormColour(
          String(action.after.form_code || '').toUpperCase(),
          String(action.after.dataset || '').toUpperCase(),
          action.after.colour || ''
        );
      }

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

    // Generic field edit
    const annotationId = action.after?.annotation_id;
    if (typeof Canvas !== 'undefined' && Canvas.isUserCreated && Canvas.isUserCreated(annotationId)) {
      Canvas.updateUserAnnotation(annotationId, {
        status: action.after.status,
        sdtm_dataset: action.after.sdtm_dataset || '',
        sdtm_variable: action.after.sdtm_variable || '',
        sdtm_label: action.after.sdtm_label || '',
      });
      Store.selectedId = annotationId;
      await _refreshAfterUpdate({
        reopenPanel: true,
        reloadSuggestions: false,
        keepManualBlank: true,
        preserveSelection: true,
        reopenDatasetChip: false,
      });
      return;
    }

    const ok = await _applySnapshot(action.after);
    if (!ok) return;
    Store.selectedId = annotationId;
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

    if (typeof Sidebar !== 'undefined' && Sidebar.refreshUnmappedQueue) {
      await Sidebar.refreshUnmappedQueue();
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
      const patchedRecord = (typeof Canvas !== 'undefined' && Canvas.applyLocalOverrides)
        ? Canvas.applyLocalOverrides(selectedRecord)
        : selectedRecord;
      await openDatasetChip(patchedRecord);
      return;
    }

    let freshRecord = null;
    if (selectedId && !String(selectedId).startsWith('datasetchip::')) {
      // Try backend first
      const fresh = await window.pywebview.api.get_annotation(selectedId);
      if (fresh && fresh.ok && fresh.record) {
        freshRecord = (typeof Canvas !== 'undefined' && Canvas.applyLocalOverrides)
          ? Canvas.applyLocalOverrides(fresh.record)
          : fresh.record;
      } else {
        // Fallback: check Store for user-created annotations
        const storeRec = (Store.annotations || []).find(r => r.annotation_id === selectedId);
        if (storeRec) {
          freshRecord = (typeof Canvas !== 'undefined' && Canvas.applyLocalOverrides)
            ? Canvas.applyLocalOverrides(storeRec)
            : storeRec;
        }
      }

      if (freshRecord) {
        Store.setSelectedAnnotation(freshRecord);
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
    undoAction,
    redoAction,
  };
})();