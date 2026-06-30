/**
 * ui/js/canvas.js
 * ----------------
 * Live editor overlay rendering.
 */

const Canvas = (() => {
  'use strict';

  const DEFAULT_DPI = 150;

  const PALETTE = [
    '#FFFF96', // yellow  = rgb(255,255,150)
    '#BFFFFF', // blue    = rgb(191,255,255)
    '#96FF96', // green   = rgb(150,255,150)
    '#FFBE9B', // orange  = rgb(255,190,155)
    '#BFFFFF', // cobalt  -> same as blue
    '#FFBE9B', // orange  -> same as orange
    '#CC79A7', // purple  -> kept as-is for compatibility
  ];

  const COLOUR_KEY_TO_HEX = {
    yellow: '#FFFF96',     // rgb(255,255,150)
    blue: '#BFFFFF',       // rgb(191,255,255)
    teal: '#96FF96',       // rgb(150,255,150)  -> used as green
    vermillion: '#FFBE9B', // rgb(255,190,155)  -> used as orange
    cobalt: '#BFFFFF',     // compatibility
    orange: '#FFBE9B',     // compatibility
    purple: '#CC79A7',     // unchanged unless you want to replace it too
  };

  const DATASET_LABELS = {
  DM: 'DM (Demographics)',
  CM: 'CM (Concomitant Medications)',
  AE: 'AE (Adverse Events)',
  EX: 'EX (Exposure)',
  MH: 'MH (Medical History)',
  VS: 'VS (Vital Signs)',
  LB: 'LB (Laboratory)',
  DS: 'DS (Disposition)',
  PE: 'PE (Physical Examination)',
  EG: 'EG (ECG)',
  QS: 'QS (Questionnaires)',
  SC: 'SC (Subject Characteristics)',
  SU: 'SU (Substance Use)',
  FA: 'FA (Findings About)',
  PR: 'PR (Procedures)',
  SUPPCM: 'SUPPCM (Supplemental Qualifiers for CM)',
  SUPPAE: 'SUPPAE (Supplemental Qualifiers for AE)',
  SUPPDM: 'SUPPDM (Supplemental Qualifiers for DM)',
  SUPPEX: 'SUPPEX (Supplemental Qualifiers for EX)',
  SUPPMH: 'SUPPMH (Supplemental Qualifiers for MH)',
  SUPPVS: 'SUPPVS (Supplemental Qualifiers for VS)',
  SUPPLB: 'SUPPLB (Supplemental Qualifiers for LB)',
  SUPPDS: 'SUPPDS (Supplemental Qualifiers for DS)',
};

  let formColourRegistry = {};
  let dragState = null;
  let resizeState = null;


  const annotationGeometryOverrides = {};
  const datasetChipUiOverrides = {};
  // Geometry undo/redo stacks (max 5 actions)
const GEOMETRY_HISTORY_LIMIT = 50;
const geometryUndoStack = [];
const geometryRedoStack = [];

function _pushGeometryUndo(action) {
  geometryUndoStack.push(action);
  if (geometryUndoStack.length > GEOMETRY_HISTORY_LIMIT) {
    geometryUndoStack.shift();
  }
  geometryRedoStack.length = 0;
}

async function undoGeometry() {
  if (!geometryUndoStack.length) return;
  const action = geometryUndoStack.pop();
  geometryRedoStack.push(action);
  if (geometryRedoStack.length > GEOMETRY_HISTORY_LIMIT) {
    geometryRedoStack.shift();
  }

  if (action.type === 'annotation') {
    if (action.before) {
      annotationGeometryOverrides[action.id] = { ...action.before };
    } else {
      delete annotationGeometryOverrides[action.id];
    }
    if (Array.isArray(Store.annotations)) {
      const idx = Store.annotations.findIndex(r => r.annotation_id === action.id);
      if (idx >= 0 && !action.before) {
        delete Store.annotations[idx]._hasGeometryOverride;
      }
    }
  } else if (action.type === 'dataset-chip') {
    if (action.before) {
      datasetChipUiOverrides[action.chipKey] = { ...action.before };
    } else {
      delete datasetChipUiOverrides[action.chipKey];
    }
  } else if (action.type === 'add-annotation') {
    const idx = Store.annotations.findIndex(r => r.annotation_id === action.id);
    if (idx >= 0) Store.annotations.splice(idx, 1);
    delete annotationGeometryOverrides[action.id];
    _removeUserAnnotation(action.id);
  } else if (action.type === 'add-dataset-chip') {
    const idx = Store.annotations.findIndex(r => r.annotation_id === action.id);
    if (idx >= 0) Store.annotations.splice(idx, 1);
    delete datasetChipUiOverrides[action.chipKey];
    _removeUserAnnotation(action.id);
    if (formColourRegistry[action.formCode]) {
      delete formColourRegistry[action.formCode][action.dsShort];
    }
  } else if (action.type === 'status-change') {
    const { id, beforeStatus, beforeDataset, beforeVariable, beforeLabel, isUserCreated } = action;
    if (isUserCreated) {
      updateUserAnnotation(id, { status: beforeStatus, sdtm_dataset: beforeDataset, sdtm_variable: beforeVariable, sdtm_label: beforeLabel });
    } else {
      try {
        await window.pywebview.api.update_annotation(id, beforeStatus, beforeDataset, beforeVariable, beforeLabel);
      } catch (e) {
        console.error('[undo] status-change failed:', e);
      }
    }
    await loadPage(Store.currentPage);
    if (typeof Sidebar !== 'undefined') { await Sidebar.refreshStats(); await Sidebar.refreshUnmappedQueue(); }
    return;
  } else if (action.type === 'remove-annotation') {
    const { id, record, wasUserCreated } = action;
    if (wasUserCreated) {
      Store.annotations.push({ ...record });
      _addUserAnnotation({ ...record });
      if (action.geometryOverride) {
        annotationGeometryOverrides[id] = action.geometryOverride;
      }
      if (id.startsWith('userdschip_') && action.chipUiOverride) {
        const fc = (record.form_code || '').toUpperCase();
        const ds = (record.sdtm_dataset || '').toUpperCase();
        datasetChipUiOverrides[`${fc}::${ds}`] = action.chipUiOverride;
        if (action.chipColour && fc) {
          if (!formColourRegistry[fc]) formColourRegistry[fc] = {};
          formColourRegistry[fc][ds] = action.chipColour;
        }
      }
    } else {
      try {
        await window.pywebview.api.update_annotation(id, action.beforeStatus, action.beforeDataset, action.beforeVariable, action.beforeLabel);
      } catch (e) {
        console.error('[undo] remove-annotation failed:', e);
      }
    }
    await loadPage(Store.currentPage);
    if (typeof Sidebar !== 'undefined') { await Sidebar.refreshStats(); await Sidebar.refreshUnmappedQueue(); }
    return;
  } else {
    // EditPanel-owned action types (dataset-colour, dataset-chip-edit, field edits)
    if (typeof EditPanel !== 'undefined' && EditPanel.undoAction) {
      await EditPanel.undoAction(action);
    }
    return;
  }

  _refreshAnnotationLayer();
}

async function redoGeometry() {
  if (!geometryRedoStack.length) return;
  const action = geometryRedoStack.pop();
  geometryUndoStack.push(action);
  if (geometryUndoStack.length > GEOMETRY_HISTORY_LIMIT) {
    geometryUndoStack.shift();
  }

  if (action.type === 'annotation') {
    if (action.after) {
      annotationGeometryOverrides[action.id] = { ...action.after };
    } else {
      delete annotationGeometryOverrides[action.id];
    }
  } else if (action.type === 'dataset-chip') {
    if (action.after) {
      datasetChipUiOverrides[action.chipKey] = { ...action.after };
    } else {
      delete datasetChipUiOverrides[action.chipKey];
    }
  } else if (action.type === 'add-annotation') {
    const restored = { ...action.record };
    Store.annotations.push(restored);
    _addUserAnnotation(restored);
    annotationGeometryOverrides[action.id] = {
      x0_pts: action.record.x0_pts,
      y0_pts: action.record.y0_pts,
      x1_pts: action.record.x1_pts,
      y1_pts: action.record.y1_pts,
    };
  } else if (action.type === 'add-dataset-chip') {
    const restored = { ...action.record };
    Store.annotations.push(restored);
    _addUserAnnotation(restored);
    datasetChipUiOverrides[action.chipKey] = { ...action.uiOverride };
    if (!formColourRegistry[action.formCode]) formColourRegistry[action.formCode] = {};
    formColourRegistry[action.formCode][action.dsShort] = COLOUR_KEY_TO_HEX[action.colourKey] || PALETTE[0];
  } else if (action.type === 'status-change') {
    const { id, afterStatus, afterDataset, afterVariable, afterLabel, isUserCreated } = action;
    if (isUserCreated) {
      updateUserAnnotation(id, { status: afterStatus, sdtm_dataset: afterDataset, sdtm_variable: afterVariable, sdtm_label: afterLabel });
    } else {
      try {
        await window.pywebview.api.update_annotation(id, afterStatus, afterDataset, afterVariable, afterLabel);
      } catch (e) {
        console.error('[redo] status-change failed:', e);
      }
    }
    await loadPage(Store.currentPage);
    if (typeof Sidebar !== 'undefined') { await Sidebar.refreshStats(); await Sidebar.refreshUnmappedQueue(); }
    return;
  } else if (action.type === 'remove-annotation') {
    const { id, wasUserCreated, record } = action;
    if (wasUserCreated) {
      const idx = (Store.annotations || []).findIndex(r => r.annotation_id === id);
      if (idx >= 0) Store.annotations.splice(idx, 1);
      delete annotationGeometryOverrides[id];
      _removeUserAnnotation(id);
      if (id.startsWith('userdschip_')) {
        const fc = (record?.form_code || '').toUpperCase();
        const ds = (record?.sdtm_dataset || '').toUpperCase();
        delete datasetChipUiOverrides[`${fc}::${ds}`];
        if (formColourRegistry[fc]) delete formColourRegistry[fc][ds];
      }
    } else {
      try {
        await window.pywebview.api.update_annotation(id, 'REMOVED', '', '', '');
      } catch (e) {
        console.error('[redo] remove-annotation failed:', e);
      }
    }
    await loadPage(Store.currentPage);
    if (typeof Sidebar !== 'undefined') { await Sidebar.refreshStats(); await Sidebar.refreshUnmappedQueue(); }
    return;
  } else {
    // EditPanel-owned action types (dataset-colour, dataset-chip-edit, field edits)
    if (typeof EditPanel !== 'undefined' && EditPanel.redoAction) {
      await EditPanel.redoAction(action);
    }
    return;
  }

  _refreshAnnotationLayer();
}
function _refreshAnnotationLayer() {
  if (Array.isArray(Store.annotations)) {
    const patched = Store.annotations.map(rec => {
      const base = { ...rec };
      delete base._hasGeometryOverride;
      return applyOverridesToRecord(base);
    });
    Store.setAnnotations(patched);
  }

  const annotationLayer = document.getElementById('annotation-layer');
  if (annotationLayer) {
    annotationLayer.innerHTML = '';
    renderComponentBands();
    renderAnnotations();
    renderHeaderChips();
  }

  if (Store.selectedRecord) {
    Store.setSelectedAnnotation(applyOverridesToRecord({ ...Store.selectedRecord }));
  }
  highlightSelected();
}

function _bindGeometryUndoRedo() {
  document.addEventListener('keydown', async (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

    const isMac = navigator.platform.toUpperCase().includes('MAC');
    const ctrl = isMac ? e.metaKey : e.ctrlKey;
    if (!ctrl) return;

    if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      await undoGeometry();
    } else if (
      e.key.toLowerCase() === 'y' ||
      (e.key.toLowerCase() === 'z' && e.shiftKey)
    ) {
      e.preventDefault();
      e.stopPropagation();
      await redoGeometry();
    }
  }, true);
}
// ─── PERSISTENT USER ANNOTATIONS ─────────────────────────────────────

  const userCreatedAnnotations = [];

  function _addUserAnnotation(rec) {
    userCreatedAnnotations.push(rec);
  }

  function _removeUserAnnotation(id) {
    const idx = userCreatedAnnotations.findIndex(r => r.annotation_id === id);
    if (idx >= 0) userCreatedAnnotations.splice(idx, 1);
  }

  function _getUserAnnotationsForPage(pageNumber) {
    return userCreatedAnnotations.filter(r => r.page === pageNumber);
  }

  function isUserCreated(annotationId) {
    return userCreatedAnnotations.some(r => r.annotation_id === annotationId);
  }

  function updateUserAnnotation(annotationId, fields) {
    const idx = userCreatedAnnotations.findIndex(r => r.annotation_id === annotationId);
    if (idx >= 0) {
      userCreatedAnnotations[idx] = { ...userCreatedAnnotations[idx], ...fields };
    }
    const storeIdx = (Store.annotations || []).findIndex(r => r.annotation_id === annotationId);
    if (storeIdx >= 0) {
      Store.annotations[storeIdx] = { ...Store.annotations[storeIdx], ...fields };
    }

    if (typeof EditorState !== 'undefined' && EditorState.scheduleAutosave) {
      EditorState.scheduleAutosave();
    }
  }
  function updateFormColour(formCode, dataset, colourKey) {
    const fc = (formCode || '').toUpperCase();
    const ds = (dataset || '').toUpperCase();
    const hex = COLOUR_KEY_TO_HEX[colourKey] || PALETTE[0];

    if (!formColourRegistry[fc]) formColourRegistry[fc] = {};
    formColourRegistry[fc][ds] = hex;

    if (!Store.formDatasetColours) {
      Store.formDatasetColours = {};
    }
    Store.formDatasetColours[`${fc}::${ds}`] = hex;

    if (typeof EditorState !== 'undefined' && EditorState.scheduleAutosave) {
      EditorState.scheduleAutosave();
    }
  }
//dataset annotation
function updateDatasetChip(chipRecord, fields = {}) {
    if (!chipRecord) return null;

    const formCode = String(chipRecord._formCode || chipRecord.form_code || '').toUpperCase();
    const oldDs = String(chipRecord._datasetCode || chipRecord.sdtm_dataset || '').toUpperCase();

    const nextDataset = String(fields.sdtm_dataset || oldDs || '').trim().toUpperCase();
    const nextFullName = String(fields.full_name || '').trim();

    const nextDisplayText = nextFullName
      ? `${nextDataset} (${nextFullName})`
      : (DATASET_LABELS[nextDataset] || nextDataset);

    const oldKey = `${formCode}::${oldDs}`;
    const nextKey = `${formCode}::${nextDataset}`;

    // Preserve existing UI position/size
    const existingUi =
      datasetChipUiOverrides[oldKey] ||
      datasetChipUiOverrides[nextKey] || {
        _ui_left: chipRecord._ui_left || '50%',
        _ui_top: chipRecord._ui_top || '1%',
        _ui_width: chipRecord._ui_width || '',
        _ui_height: chipRecord._ui_height || '',
      };

    // Move UI override key if dataset code changed
    if (oldKey !== nextKey && datasetChipUiOverrides[oldKey]) {
      delete datasetChipUiOverrides[oldKey];
    }
    datasetChipUiOverrides[nextKey] = { ...existingUi };

    // Preserve colour if dataset key changed
    if (!formColourRegistry[formCode]) formColourRegistry[formCode] = {};
    const oldColour = formColourRegistry[formCode][oldDs] || PALETTE[0];
    if (oldDs !== nextDataset && formColourRegistry[formCode][oldDs]) {
      delete formColourRegistry[formCode][oldDs];
    }
    formColourRegistry[formCode][nextDataset] = oldColour;

    // Keep DATASET_LABELS in sync
    if (nextDataset) {
      DATASET_LABELS[nextDataset] = nextDisplayText;
    }

    // Update Store.datasetChips entry
    const oldChipId = `datasetchip::${formCode}::${oldDs}`;
    const nextChipId = `datasetchip::${formCode}::${nextDataset}`;

    const fillHex = formColourRegistry[formCode][nextDataset] || PALETTE[0];
    const clean = String(fillHex || '').replace('#', '').trim();
    const fillRgb = clean.length === 6
      ? [
          parseInt(clean.slice(0, 2), 16),
          parseInt(clean.slice(2, 4), 16),
          parseInt(clean.slice(4, 6), 16),
        ]
      : [191, 255, 255];

    const existingChip =
      (Store.datasetChips || []).find(c => c.chip_id === oldChipId || c.chip_id === nextChipId) || {};

    if (oldChipId !== nextChipId) {
      Store.removeDatasetChip(oldChipId);
    }

    Store.upsertDatasetChip({
      ...existingChip,
      chip_id: nextChipId,
      page: chipRecord.page || Store.currentPage,
      dataset: nextDataset,
      full_name: nextFullName,
      display_text: nextDisplayText,
      rect_pts: existingChip.rect_pts || null,
      _ui_left: existingUi._ui_left || '50%',
      _ui_top: existingUi._ui_top || '1%',
      _ui_width: existingUi._ui_width || '',
      _ui_height: existingUi._ui_height || '',
      fill_hex: fillHex,
      fill_rgb: fillRgb,
      visible: true,
      removed: false,
      source: existingChip.source || chipRecord.source || 'AUTO',
    });

    // Update matching placeholder annotation record in Store.annotations
    const placeholderId = chipRecord.annotation_id;
    const idx = (Store.annotations || []).findIndex(r => r.annotation_id === placeholderId);
    if (idx >= 0) {
      Store.annotations[idx] = {
        ...Store.annotations[idx],
        form_code: formCode,
        raw_variable: nextDisplayText,
        sdtm_dataset: nextDataset,
        sdtm_variable: '',
        sdtm_label: nextDisplayText,
        status: 'USER_CORRECTED',
        _datasetCode: nextDataset,
        _formCode: formCode,
        _ui_left: existingUi._ui_left || '50%',
        _ui_top: existingUi._ui_top || '1%',
        _ui_width: existingUi._ui_width || '',
        _ui_height: existingUi._ui_height || '',
      };
    }

    // Update selected record
    const nextRecord = {
      ...chipRecord,
      annotation_id: placeholderId,
      form_code: formCode,
      raw_variable: nextDisplayText,
      sdtm_dataset: nextDataset,
      sdtm_variable: '',
      sdtm_label: nextDisplayText,
      status: 'USER_CORRECTED',
      _isDatasetChip: true,
      _datasetCode: nextDataset,
      _formCode: formCode,
      _ui_left: existingUi._ui_left || '50%',
      _ui_top: existingUi._ui_top || '1%',
      _ui_width: existingUi._ui_width || '',
      _ui_height: existingUi._ui_height || '',
      full_name: nextFullName,
    };

    Store.setSelectedAnnotation(nextRecord);

    if (typeof EditorState !== 'undefined' && EditorState.scheduleAutosave) {
      EditorState.scheduleAutosave();
    }

    _refreshAnnotationLayer();
    return nextRecord;
  }

  // ─── RIGHT-CLICK ADD ANNOTATION ───────────────────────────────────────

  let pendingClickPts = null;
  let pendingAnnotationCtxRec = null;
  let pendingDatasetCtxRec = null;

  function _showAnnotationContextMenu(ctxMenu, x, y, rec) {
    const statusUp = String(rec?.status || '').toUpperCase();
    const alreadyInQueue = statusUp === 'NEEDS_REVIEW' || statusUp === 'UNMAPPED';
    const isInReview = statusUp === 'NEEDS_REVIEW';

    document.getElementById('ctx-add-annotation').style.display = '';
    document.getElementById('ctx-edit-annotation').style.display = '';
    document.getElementById('ctx-mark-unmapped').style.display = '';
    document.getElementById('ctx-mark-not-submitted').style.display = '';
    document.getElementById('ctx-show-in-queue').style.display = '';
    document.getElementById('ctx-remove-annotation').style.display = '';
    document.getElementById('ctx-add-comment').style.display = '';

    const addToReviewBtn = document.getElementById('ctx-add-to-review');
    if (addToReviewBtn) {
      addToReviewBtn.style.display = '';
      addToReviewBtn.disabled = alreadyInQueue;
      addToReviewBtn.style.opacity = alreadyInQueue ? '0.4' : '';
      addToReviewBtn.style.cursor = alreadyInQueue ? 'default' : '';
      addToReviewBtn.title = alreadyInQueue ? 'Already in review queue' : '';
    }

    // Show "Remove from Review" only for annotations that are currently NEEDS_REVIEW
    const removeFromReviewBtn = document.getElementById('ctx-remove-from-review');
    if (removeFromReviewBtn) removeFromReviewBtn.style.display = isInReview ? '' : 'none';

    ctxMenu.classList.remove('hidden');
    const menuH = ctxMenu.getBoundingClientRect().height || 310;
    ctxMenu.style.left = `${Math.min(x, window.innerWidth - 200)}px`;
    ctxMenu.style.top = `${Math.min(y, window.innerHeight - menuH - 8)}px`;
  }

  function _showBlankContextMenu(ctxMenu, x, y) {
    document.getElementById('ctx-add-annotation').style.display = '';
    document.getElementById('ctx-edit-annotation').style.display = 'none';
    document.getElementById('ctx-mark-unmapped').style.display = 'none';
    document.getElementById('ctx-mark-not-submitted').style.display = 'none';
    document.getElementById('ctx-add-to-review').style.display = 'none';
    document.getElementById('ctx-remove-from-review').style.display = 'none';
    document.getElementById('ctx-show-in-queue').style.display = 'none';
    document.getElementById('ctx-add-comment').style.display = 'none';
    document.getElementById('ctx-remove-annotation').style.display = 'none';
    ctxMenu.style.left = `${x}px`;
    ctxMenu.style.top = `${y}px`;
    ctxMenu.classList.remove('hidden');
  }

  function _bindContextMenu() {
    const canvasArea = document.getElementById('canvas-area');
    const ctxMenu = document.getElementById('ctx-menu');
    if (!canvasArea || !ctxMenu) return;

    canvasArea.addEventListener('contextmenu', (e) => {
      e.preventDefault();

      // Edge cases
      if (dragState || resizeState) return;
      if (!Store.pdfLoaded || !Store.pageImage) return;
      if (!Store.pipelineRan) return;

      const records = Store.annotations || [];
      const first = records[0] || {};
      if ((first.page_type || 'FORM') === 'TABLE') return;

      // Always compute click position in pts so "Add Annotation" always has a target
      const pageWrap = document.getElementById('pdf-page-wrap');
      if (!pageWrap) return;
      const pageRect = pageWrap.getBoundingClientRect();
      const clickXPx = e.clientX - pageRect.left;
      const clickYPx = e.clientY - pageRect.top;
      const scaledW = pageRect.width || 1;
      const scaledH = pageRect.height || 1;
      const x_pts = (clickXPx / scaledW) * Store.pageWidthPts;
      const y_pts = (clickYPx / scaledH) * Store.pageHeightPts;
      pendingClickPts = {
        x_pts: _clamp(x_pts, 4, Store.pageWidthPts - 4),
        y_pts: _clamp(y_pts, 4, Store.pageHeightPts - 4),
        page: Store.currentPage,
      };

      // Dataset chip takes priority
      const chipEl = e.target.closest('.ann-chip');
      if (chipEl) {
        const ds = chipEl.dataset.datasetCode || '';
        const formCode = chipEl.dataset.formCode || '';
        pendingDatasetCtxRec = _buildDatasetChipCtxRec(ds, formCode);
        const dsMenu = document.getElementById('ctx-menu-dataset');
        if (dsMenu) {
          dsMenu.style.left = `${Math.min(e.clientX, window.innerWidth - 200)}px`;
          dsMenu.style.top = `${Math.min(e.clientY, window.innerHeight - 220)}px`;
          dsMenu.classList.remove('hidden');
        }
        return;
      }

      // Check if right-clicked on an annotation box (not a dataset chip)
      const annBox = e.target.closest('.ann-box:not(.ann-chip)');

      if (annBox) {
        // Clicked on annotation box — show annotation-specific menu (Add Annotation also available)
        const annotationId = annBox.dataset.id;
        pendingAnnotationCtxRec = (Store.annotations || []).find(r => r.annotation_id === annotationId) || null;
        _showAnnotationContextMenu(ctxMenu, e.clientX, e.clientY, pendingAnnotationCtxRec);
      } else {
        // Clicked on blank canvas or component band — show "Add Annotation" menu
        pendingAnnotationCtxRec = null;
        _showBlankContextMenu(ctxMenu, e.clientX, e.clientY);
      }
    });

    document.addEventListener('click', (e) => {
      if (!ctxMenu.contains(e.target)) {
        ctxMenu.classList.add('hidden');
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        ctxMenu.classList.add('hidden');
      }
    });

    const btnAdd = document.getElementById('ctx-add-annotation');
    if (btnAdd) {
      btnAdd.addEventListener('click', () => {
        ctxMenu.classList.add('hidden');
        _openAddAnnotationDialog();
      });
    }

    const btnCancel = document.getElementById('ctx-cancel');
    if (btnCancel) {
      btnCancel.addEventListener('click', () => {
        ctxMenu.classList.add('hidden');
      });
    }

    // Annotation-specific menu item actions
    document.getElementById('ctx-edit-annotation')?.addEventListener('click', async () => {
      ctxMenu.classList.add('hidden');
      if (pendingAnnotationCtxRec && typeof EditPanel !== 'undefined' && EditPanel.open) {
        await EditPanel.open(pendingAnnotationCtxRec.annotation_id);
      }
    });

    document.getElementById('ctx-mark-unmapped')?.addEventListener('click', async () => {
      ctxMenu.classList.add('hidden');
      if (!pendingAnnotationCtxRec) return;
      const rec = pendingAnnotationCtxRec;
      const id = rec.annotation_id;
      const isUserCreated = String(id).startsWith('user_') || String(id).startsWith('userdschip_');
      _pushGeometryUndo({
        type: 'status-change',
        id,
        beforeStatus: rec.status || 'RESOLVED',
        beforeDataset: rec.sdtm_dataset || '',
        beforeVariable: rec.sdtm_variable || '',
        beforeLabel: rec.sdtm_label || '',
        afterStatus: 'UNMAPPED',
        afterDataset: '',
        afterVariable: '',
        afterLabel: '',
        isUserCreated,
      });
      if (isUserCreated) {
        updateUserAnnotation(id, { status: 'UNMAPPED', sdtm_dataset: '', sdtm_variable: '', sdtm_label: '' });
      } else {
        await window.pywebview.api.update_annotation(id, 'UNMAPPED', '', '', '');
      }
      if (typeof Canvas !== 'undefined') await Canvas.loadPage(Store.currentPage);
      if (typeof Sidebar !== 'undefined') { await Sidebar.refreshStats(); await Sidebar.refreshUnmappedQueue(); }
    });

    document.getElementById('ctx-mark-not-submitted')?.addEventListener('click', async () => {
      ctxMenu.classList.add('hidden');
      if (!pendingAnnotationCtxRec) return;
      const rec = pendingAnnotationCtxRec;
      const id = rec.annotation_id;
      const isUserCreated = String(id).startsWith('user_') || String(id).startsWith('userdschip_');
      _pushGeometryUndo({
        type: 'status-change',
        id,
        beforeStatus: rec.status || 'RESOLVED',
        beforeDataset: rec.sdtm_dataset || '',
        beforeVariable: rec.sdtm_variable || '',
        beforeLabel: rec.sdtm_label || '',
        afterStatus: 'NOT_SUBMITTED',
        afterDataset: '',
        afterVariable: '',
        afterLabel: 'Not Submitted',
        isUserCreated,
      });
      if (isUserCreated) {
        updateUserAnnotation(id, { status: 'NOT_SUBMITTED', sdtm_dataset: '', sdtm_variable: '', sdtm_label: 'Not Submitted' });
      } else {
        await window.pywebview.api.update_annotation(id, 'NOT_SUBMITTED', '', '', 'Not Submitted');
      }
      if (typeof Canvas !== 'undefined') await Canvas.loadPage(Store.currentPage);
      if (typeof Sidebar !== 'undefined') { await Sidebar.refreshStats(); await Sidebar.refreshUnmappedQueue(); }
    });

    document.getElementById('ctx-add-to-review')?.addEventListener('click', async () => {
      ctxMenu.classList.add('hidden');
      if (!pendingAnnotationCtxRec) return;
      const rec = pendingAnnotationCtxRec;
      const id = rec.annotation_id;
      const isUserCreated = String(id).startsWith('user_') || String(id).startsWith('userdschip_');
      _pushGeometryUndo({
        type: 'status-change',
        id,
        beforeStatus: rec.status || 'RESOLVED',
        beforeDataset: rec.sdtm_dataset || '',
        beforeVariable: rec.sdtm_variable || '',
        beforeLabel: rec.sdtm_label || '',
        afterStatus: 'NEEDS_REVIEW',
        afterDataset: rec.sdtm_dataset || '',
        afterVariable: rec.sdtm_variable || '',
        afterLabel: rec.sdtm_label || '',
        isUserCreated,
      });
      if (isUserCreated) {
        updateUserAnnotation(id, { status: 'NEEDS_REVIEW', sdtm_dataset: rec.sdtm_dataset || '', sdtm_variable: rec.sdtm_variable || '', sdtm_label: rec.sdtm_label || '' });
      } else {
        await window.pywebview.api.update_annotation(id, 'NEEDS_REVIEW', rec.sdtm_dataset || '', rec.sdtm_variable || '', rec.sdtm_label || '');
      }
      if (typeof Canvas !== 'undefined') await Canvas.loadPage(Store.currentPage);
      if (typeof Sidebar !== 'undefined') { await Sidebar.refreshStats(); await Sidebar.refreshUnmappedQueue(); }
    });

    document.getElementById('ctx-remove-from-review')?.addEventListener('click', async () => {
      ctxMenu.classList.add('hidden');
      if (!pendingAnnotationCtxRec) return;
      const rec = pendingAnnotationCtxRec;
      const id = rec.annotation_id;
      const isUserCreated = String(id).startsWith('user_') || String(id).startsWith('userdschip_');
      _pushGeometryUndo({
        type: 'status-change',
        id,
        beforeStatus: 'NEEDS_REVIEW',
        beforeDataset: rec.sdtm_dataset || '',
        beforeVariable: rec.sdtm_variable || '',
        beforeLabel: rec.sdtm_label || '',
        afterStatus: 'UNMAPPED',
        afterDataset: '',
        afterVariable: '',
        afterLabel: '',
        isUserCreated,
      });
      if (isUserCreated) {
        updateUserAnnotation(id, { status: 'UNMAPPED', sdtm_dataset: '', sdtm_variable: '', sdtm_label: '' });
      } else {
        await window.pywebview.api.update_annotation(id, 'UNMAPPED', '', '', '');
      }
      pendingAnnotationCtxRec = null;
      if (typeof Canvas !== 'undefined') await Canvas.loadPage(Store.currentPage);
      if (typeof Sidebar !== 'undefined') { await Sidebar.refreshStats(); await Sidebar.refreshUnmappedQueue(); }
    });

    document.getElementById('ctx-show-in-queue')?.addEventListener('click', () => {
      ctxMenu.classList.add('hidden');
      if (!pendingAnnotationCtxRec) return;
      if (typeof Sidebar !== 'undefined' && Sidebar.highlightInQueue) {
        Sidebar.highlightInQueue(pendingAnnotationCtxRec.annotation_id, pendingAnnotationCtxRec.status);
      }
      pendingAnnotationCtxRec = null;
    });

    document.getElementById('ctx-add-comment')?.addEventListener('click', () => {
      ctxMenu.classList.add('hidden');
      if (!pendingAnnotationCtxRec) return;
      const rec = pendingAnnotationCtxRec;
      pendingAnnotationCtxRec = null;
      // Open the shared comment dialog (owned by Sidebar)
      if (typeof Sidebar !== 'undefined' && Sidebar.openCommentForAnnotation) {
        Sidebar.openCommentForAnnotation(rec);
      }
    });

    document.getElementById('ctx-remove-annotation')?.addEventListener('click', () => {
      ctxMenu.classList.add('hidden');
      if (!pendingAnnotationCtxRec) return;
      const rec = pendingAnnotationCtxRec;
      window._removeConfirmCallback = async () => {
        const id = rec.annotation_id;
        const isUserAnn = String(id).startsWith('user_');
        const isUserChip = String(id).startsWith('userdschip_');
        const wasUserCreated = isUserAnn || isUserChip;

        // Capture undo state before removing
        const fc = (rec.form_code || '').toUpperCase();
        const ds = (rec.sdtm_dataset || '').toUpperCase();
        const undoAction = {
          type: 'remove-annotation',
          id,
          wasUserCreated,
          record: { ...rec },
          beforeStatus: rec.status || 'RESOLVED',
          beforeDataset: ds,
          beforeVariable: rec.sdtm_variable || '',
          beforeLabel: rec.sdtm_label || '',
          geometryOverride: annotationGeometryOverrides[id] ? { ...annotationGeometryOverrides[id] } : null,
          chipUiOverride: isUserChip ? (datasetChipUiOverrides[`${fc}::${ds}`] ? { ...datasetChipUiOverrides[`${fc}::${ds}`] } : null) : null,
          chipColour: isUserChip ? (formColourRegistry[fc]?.[ds] || null) : null,
        };

        if (wasUserCreated) {
          // Remove locally — backend doesn't know about user-created records
          const idx = (Store.annotations || []).findIndex(r => r.annotation_id === id);
          if (idx >= 0) Store.annotations.splice(idx, 1);
          delete annotationGeometryOverrides[id];
          _removeUserAnnotation(id);
          if (isUserChip) {
            delete datasetChipUiOverrides[`${fc}::${ds}`];
            if (formColourRegistry[fc]) delete formColourRegistry[fc][ds];
          }
        } else {
          await window.pywebview.api.update_annotation(id, 'REMOVED', '', '', '');
        }

        _pushGeometryUndo(undoAction);

        if (typeof Canvas !== 'undefined') await Canvas.loadPage(Store.currentPage);
        if (typeof Sidebar !== 'undefined') { await Sidebar.refreshStats(); await Sidebar.refreshUnmappedQueue(); }
        if (typeof EditPanel !== 'undefined' && EditPanel.close) EditPanel.close();
        pendingAnnotationCtxRec = null;
      };
      const dlg = document.getElementById('ann-remove-confirm');
      if (dlg) dlg.classList.remove('hidden');
    });

    // Remove confirm dialog bindings
    document.getElementById('ann-remove-confirm-btn')?.addEventListener('click', async () => {
      document.getElementById('ann-remove-confirm')?.classList.add('hidden');
      if (window._removeConfirmCallback) {
        await window._removeConfirmCallback();
        window._removeConfirmCallback = null;
      }
    });

    document.getElementById('ann-remove-cancel-btn')?.addEventListener('click', () => {
      document.getElementById('ann-remove-confirm')?.classList.add('hidden');
    });

    document.getElementById('ann-remove-close')?.addEventListener('click', () => {
      document.getElementById('ann-remove-confirm')?.classList.add('hidden');
    });

    // ── Dataset chip context menu ──────────────────────────────
    const dsMenu = document.getElementById('ctx-menu-dataset');

    if (dsMenu) {
      document.addEventListener('click', (e) => {
        if (!dsMenu.contains(e.target)) dsMenu.classList.add('hidden');
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') dsMenu.classList.add('hidden');
      });
    }

    document.getElementById('ctx-ds-cancel')?.addEventListener('click', () => {
      dsMenu?.classList.add('hidden');
      pendingDatasetCtxRec = null;
    });

    document.getElementById('ctx-ds-edit')?.addEventListener('click', async () => {
      dsMenu?.classList.add('hidden');
      if (!pendingDatasetCtxRec) return;
      if (typeof EditPanel !== 'undefined' && EditPanel.openDatasetChip) {
        await EditPanel.openDatasetChip(pendingDatasetCtxRec.datasetRecord);
      }
      pendingDatasetCtxRec = null;
    });

    document.getElementById('ctx-ds-add-review')?.addEventListener('click', async () => {
      dsMenu?.classList.add('hidden');
      if (!pendingDatasetCtxRec) return;
      if (typeof Sidebar !== 'undefined' && Sidebar.addDatasetReview) {
        await Sidebar.addDatasetReview(
          pendingDatasetCtxRec.form_code,
          pendingDatasetCtxRec.sdtm_dataset,
          pendingDatasetCtxRec.sdtm_label,
          pendingDatasetCtxRec.page
        );
      }
      pendingDatasetCtxRec = null;
    });

    document.getElementById('ctx-ds-show-queue')?.addEventListener('click', () => {
      dsMenu?.classList.add('hidden');
      if (!pendingDatasetCtxRec) return;
      const reviewId = `dsreview_${pendingDatasetCtxRec.form_code}_${pendingDatasetCtxRec.sdtm_dataset}`;
      if (typeof Sidebar !== 'undefined' && Sidebar.highlightInQueue) {
        Sidebar.highlightInQueue(reviewId, 'NEEDS_REVIEW');
      }
      pendingDatasetCtxRec = null;
    });

    document.getElementById('ctx-ds-remove')?.addEventListener('click', () => {
      dsMenu?.classList.add('hidden');
      if (!pendingDatasetCtxRec) return;
      const rec = pendingDatasetCtxRec;

      if (!rec._isUserCreated) {
        alert('Pipeline-detected dataset chips cannot be removed directly.\nUse "Mark as Removed" on individual annotations instead.');
        pendingDatasetCtxRec = null;
        return;
      }

      window._removeConfirmCallback = async () => {
        const id = rec._userCreatedId;
        const idx = (Store.annotations || []).findIndex(r => r.annotation_id === id);
        if (idx >= 0) Store.annotations.splice(idx, 1);
        const chipKey = `${rec.form_code}::${rec.sdtm_dataset}`;
        delete datasetChipUiOverrides[chipKey];
        _removeUserAnnotation(id);
        if (formColourRegistry[rec.form_code]) {
          delete formColourRegistry[rec.form_code][rec.sdtm_dataset];
        }
        if (typeof Canvas !== 'undefined') await Canvas.loadPage(Store.currentPage);
        if (typeof Sidebar !== 'undefined') { await Sidebar.refreshStats(); await Sidebar.refreshUnmappedQueue(); }
        pendingDatasetCtxRec = null;
      };

      const dlg = document.getElementById('ann-remove-confirm');
      if (dlg) dlg.classList.remove('hidden');
    });
  }

  function _buildDatasetChipCtxRec(ds, formCode) {
    const dsUpper = (ds || '').toUpperCase();
    const formUpper = (formCode || '').toUpperCase();
    const records = Store.annotations || [];

    const userChip = userCreatedAnnotations.find(r =>
      String(r.annotation_id || '').startsWith('userdschip_') &&
      (r.sdtm_dataset || '').toUpperCase() === dsUpper &&
      (r.form_code || '').toUpperCase() === formUpper
    );

    const label = (typeof DATASET_LABELS !== 'undefined' && DATASET_LABELS[dsUpper])
      ? DATASET_LABELS[dsUpper]
      : `${dsUpper} (${dsUpper})`;

    return {
      annotation_id: `datasetchip::${formUpper}::${dsUpper}`,
      sdtm_dataset: dsUpper,
      form_code: formUpper,
      page: Store.currentPage,
      sdtm_label: label,
      _isDatasetChip: true,
      _isUserCreated: !!userChip,
      _userCreatedId: userChip ? userChip.annotation_id : null,
      datasetRecord: buildDatasetSelectionRecord(dsUpper, formUpper, records),
    };
  }

  function _openAddAnnotationDialog() {
    const overlay = document.getElementById('add-ann-overlay');
    if (!overlay) return;

    const varDataset = document.getElementById('add-ann-var-dataset');
    const varName = document.getElementById('add-ann-var-name');
    const dsShort = document.getElementById('add-ann-ds-short');
    const dsName = document.getElementById('add-ann-ds-name');
    const errorEl = document.getElementById('add-ann-error');

    if (varDataset) varDataset.value = '';
    if (varName) varName.value = '';
    if (dsShort) dsShort.value = '';
    if (dsName) dsName.value = '';
    if (errorEl) { errorEl.textContent = ''; errorEl.classList.add('hidden'); }

    const radioVar = document.querySelector('input[name="add-ann-type"][value="variable"]');
    if (radioVar) radioVar.checked = true;
    _toggleAddAnnFields('variable');

    document.querySelectorAll('.add-ann-swatch').forEach(s => s.classList.remove('selected'));

    overlay.classList.remove('hidden');
  }

  function _closeAddAnnotationDialog() {
    const overlay = document.getElementById('add-ann-overlay');
    if (overlay) overlay.classList.add('hidden');
    pendingClickPts = null;
  }

  function _toggleAddAnnFields(type) {
    const varFields = document.getElementById('add-ann-variable-fields');
    const dsFields = document.getElementById('add-ann-dataset-fields');
    const unmappedFields = document.getElementById('add-ann-unmapped-fields');
    const nsFields = document.getElementById('add-ann-ns-fields');

    if (varFields) varFields.classList.toggle('hidden', type !== 'variable');
    if (dsFields) dsFields.classList.toggle('hidden', type !== 'dataset');
    if (unmappedFields) unmappedFields.classList.toggle('hidden', type !== 'unmapped');
    if (nsFields) nsFields.classList.toggle('hidden', type !== 'not_submitted');
  }

  function _getSelectedAddType() {
    const checked = document.querySelector('input[name="add-ann-type"]:checked');
    return checked ? checked.value : 'variable';
  }

  function _getSelectedColour() {
    const selected = document.querySelector('.add-ann-swatch.selected');
    return selected ? selected.dataset.colour : null;
  }

  function _showAddError(msg) {
    const errorEl = document.getElementById('add-ann-error');
    if (errorEl) {
      errorEl.textContent = msg;
      errorEl.classList.remove('hidden');
    }
  }

  function _createAnnotationAtClick() {
    if (!pendingClickPts) {
      _showAddError('No position captured. Try right-clicking again.');
      return;
    }

    const type = _getSelectedAddType();
    if (type === 'variable') {
      _createVariableAnnotation();
    } else if (type === 'dataset') {
      _createDatasetAnnotation();
    } else if (type === 'unmapped') {
      _createStatusAnnotation('unmapped');
    } else if (type === 'not_submitted') {
      _createStatusAnnotation('not_submitted');
    }
  }

  function _createVariableAnnotation() {
    const datasetRaw = (document.getElementById('add-ann-var-dataset')?.value || '').trim().toUpperCase();
    const variableRaw = (document.getElementById('add-ann-var-name')?.value || '').trim().toUpperCase();

    if (!datasetRaw) { _showAddError('Dataset is required.'); return; }
    if (!variableRaw) { _showAddError('Variable name is required.'); return; }
    if (/\s/.test(datasetRaw)) { _showAddError('Dataset cannot contain spaces.'); return; }
    if (/\s/.test(variableRaw)) { _showAddError('Variable cannot contain spaces.'); return; }

    const records = Store.annotations || [];
    const first = records[0] || {};
    const formCode = (first.form_code || 'UNKNOWN').toUpperCase();

    const annotationId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    const label = `${datasetRaw}.${variableRaw}`;
    const fontSizePts = 12.0;
    const padX = 6.0;
    const padY = 5.0;
    const textWidthPts = Math.max(20, 0.60 * fontSizePts * label.length + 3.0);
    const boxW = textWidthPts + padX * 6.0;
    const boxH = fontSizePts + padY * 2;

    const x0 = _clamp(pendingClickPts.x_pts - boxW / 2, 0, Store.pageWidthPts - boxW);
    const y0 = _clamp(pendingClickPts.y_pts - boxH / 2, 0, Store.pageHeightPts - boxH);
    const x1 = x0 + boxW;
    const y1 = y0 + boxH;

    // Assign colour from registry or create new
    let colour = formColourRegistry?.[formCode]?.[datasetRaw];
    if (!colour) {
      if (!formColourRegistry[formCode]) formColourRegistry[formCode] = {};
      const existingCount = Object.keys(formColourRegistry[formCode]).length;
      colour = PALETTE[existingCount % PALETTE.length];
      formColourRegistry[formCode][datasetRaw] = colour;
    }

    const newRec = {
      annotation_id: annotationId,
      page: Store.currentPage,
      page_type: 'FORM',
      form_code: formCode,
      component: '',
      raw_variable: variableRaw,
      sdtm_dataset: datasetRaw,
      sdtm_variable: variableRaw,
      sdtm_label: '',
      status: 'USER_CORRECTED',
      x0_pts: x0,
      y0_pts: y0,
      x1_pts: x1,
      y1_pts: y1,
      confidence: 1.0,
      _isUserCreated: true,
      _hasGeometryOverride: true,
    };

    annotationGeometryOverrides[annotationId] = { x0_pts: x0, y0_pts: y0, x1_pts: x1, y1_pts: y1 };

    Store.annotations.push(newRec);
    _addUserAnnotation(newRec);

    _pushGeometryUndo({
      type: 'add-annotation',
      id: annotationId,
      record: { ...newRec },
    });

    _refreshAnnotationLayer();

    Store.setSelectedAnnotation(newRec);
    highlightSelected();

    _closeAddAnnotationDialog();

    if (typeof EditorState !== 'undefined' && EditorState.scheduleAutosave) {
      EditorState.scheduleAutosave();
    }

    if (typeof EditPanel !== 'undefined' && EditPanel.open) {
      EditPanel.open(annotationId);
    }
  }

  function _createDatasetAnnotation() {
    const dsShort = (document.getElementById('add-ann-ds-short')?.value || '').trim().toUpperCase();
    const dsName = (document.getElementById('add-ann-ds-name')?.value || '').trim();
    const colourKey = _getSelectedColour();

    if (!dsShort) { _showAddError('Dataset shorthand is required.'); return; }
    if (/\s/.test(dsShort)) { _showAddError('Dataset shorthand cannot contain spaces.'); return; }
    if (!dsName) { _showAddError('Dataset full name is required.'); return; }
    if (!colourKey) { _showAddError('Please select a colour.'); return; }

    const records = Store.annotations || [];
    const first = records[0] || {};
    const formCode = (first.form_code || 'UNKNOWN').toUpperCase();

    const annotationId = `userdschip_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    const colour = COLOUR_KEY_TO_HEX[colourKey] || PALETTE[0];
    if (!formColourRegistry[formCode]) formColourRegistry[formCode] = {};
    formColourRegistry[formCode][dsShort] = colour;

    const chipLabel = `${dsShort} (${dsName})`;
    const chipKey = `${formCode}::${dsShort}`;

    const leftPct = ((pendingClickPts.x_pts / Store.pageWidthPts) * 100).toFixed(2);
    const topPct = ((pendingClickPts.y_pts / Store.pageHeightPts) * 100).toFixed(2);

    datasetChipUiOverrides[chipKey] = {
      _ui_left: `${leftPct}%`,
      _ui_top: `${topPct}%`,
      _ui_width: '',
      _ui_height: '',
    };

    Store.upsertDatasetChip({
      chip_id: `datasetchip::${formCode}::${dsShort}`,
      page: Store.currentPage,
      dataset: dsShort,
      full_name: dsName,
      display_text: chipLabel,
      rect_pts: null,
      _ui_left: `${leftPct}%`,
      _ui_top: `${topPct}%`,
      _ui_width: '',
      _ui_height: '',
      fill_hex: colour,
      fill_rgb: (() => {
        const clean = colour.replace('#', '');
        return [
          parseInt(clean.slice(0, 2), 16),
          parseInt(clean.slice(2, 4), 16),
          parseInt(clean.slice(4, 6), 16),
        ];
      })(),
      visible: true,
      removed: false,
      source: 'USER_ADDED',
    });

    if (!DATASET_LABELS[dsShort]) {
      DATASET_LABELS[dsShort] = chipLabel;
    }

    const placeholderRec = {
      annotation_id: annotationId,
      page: Store.currentPage,
      page_type: 'FORM',
      form_code: formCode,
      component: 'DATASET_HEADER',
      raw_variable: chipLabel,
      sdtm_dataset: dsShort,
      sdtm_variable: '',
      sdtm_label: chipLabel,
      status: 'RESOLVED',
      x0_pts: pendingClickPts.x_pts,
      y0_pts: pendingClickPts.y_pts,
      x1_pts: pendingClickPts.x_pts + 50,
      y1_pts: pendingClickPts.y_pts + 15,
      confidence: 1.0,
      _isUserCreated: true,
      _isDatasetChipPlaceholder: true,
    };

    Store.annotations.push(placeholderRec);
    _addUserAnnotation(placeholderRec);

    _pushGeometryUndo({
      type: 'add-dataset-chip',
      chipKey: chipKey,
      id: annotationId,
      record: { ...placeholderRec },
      uiOverride: { ...datasetChipUiOverrides[chipKey] },
      colourKey: colourKey,
      dsShort: dsShort,
      dsName: dsName,
      formCode: formCode,
    });

    _refreshAnnotationLayer();
    _closeAddAnnotationDialog();

    if (typeof EditorState !== 'undefined' && EditorState.scheduleAutosave) {
      EditorState.scheduleAutosave();
    }
  }

  function _createStatusAnnotation(type) {
    const status = type === 'unmapped' ? 'UNMAPPED' : 'NOT_SUBMITTED';
    const displayLabel = status === 'NOT_SUBMITTED' ? 'NOT SUBMITTED' : 'UNMAPPED';

    const records = Store.annotations || [];
    const first = records[0] || {};
    const formCode = (first.form_code || 'UNKNOWN').toUpperCase();

    const annotationId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const fontSizePts = 12.0;
    const padX = 6.0;
    const padY = 5.0;
    const textWidthPts = Math.max(20, 0.60 * fontSizePts * displayLabel.length + 3.0);
    const boxW = textWidthPts + padX * 6.0;
    const boxH = fontSizePts + padY * 2;

    const x0 = _clamp(pendingClickPts.x_pts - boxW / 2, 0, Store.pageWidthPts - boxW);
    const y0 = _clamp(pendingClickPts.y_pts - boxH / 2, 0, Store.pageHeightPts - boxH);
    const x1 = x0 + boxW;
    const y1 = y0 + boxH;

    const newRec = {
      annotation_id: annotationId,
      page: Store.currentPage,
      page_type: 'FORM',
      form_code: formCode,
      component: '',
      raw_variable: '',
      sdtm_dataset: '',
      sdtm_variable: '',
      sdtm_label: status === 'NOT_SUBMITTED' ? 'Not Submitted' : '',
      status,
      x0_pts: x0,
      y0_pts: y0,
      x1_pts: x1,
      y1_pts: y1,
      confidence: 0.0,
      _isUserCreated: true,
      _hasGeometryOverride: true,
    };

    annotationGeometryOverrides[annotationId] = { x0_pts: x0, y0_pts: y0, x1_pts: x1, y1_pts: y1 };
    Store.annotations.push(newRec);
    _addUserAnnotation(newRec);

    _pushGeometryUndo({
      type: 'add-annotation',
      id: annotationId,
      record: { ...newRec },
    });

    _refreshAnnotationLayer();

    Store.selectedId = annotationId;
    Store.setSelectedAnnotation(newRec);
    highlightSelected();
    _closeAddAnnotationDialog();

    if (typeof EditorState !== 'undefined' && EditorState.scheduleAutosave) {
      EditorState.scheduleAutosave();
    }

    if (typeof Sidebar !== 'undefined' && Sidebar.refreshUnmappedQueue) {
      Sidebar.refreshUnmappedQueue();
    }
  }

  function _bindAddAnnotationDialog() {
    const radios = document.querySelectorAll('input[name="add-ann-type"]');
    radios.forEach(radio => {
      radio.addEventListener('change', (e) => {
        _toggleAddAnnFields(e.target.value);
      });
    });

    document.querySelectorAll('.add-ann-swatch').forEach(swatch => {
      swatch.addEventListener('click', () => {
        document.querySelectorAll('.add-ann-swatch').forEach(s => s.classList.remove('selected'));
        swatch.classList.add('selected');
      });
    });

    const btnConfirm = document.getElementById('add-ann-confirm');
    if (btnConfirm) {
      btnConfirm.addEventListener('click', () => {
        _createAnnotationAtClick();
      });
    }

    const btnCancel = document.getElementById('add-ann-cancel');
    const btnClose = document.getElementById('add-ann-close');
    if (btnCancel) btnCancel.addEventListener('click', _closeAddAnnotationDialog);
    if (btnClose) btnClose.addEventListener('click', _closeAddAnnotationDialog);

    const overlay = document.getElementById('add-ann-overlay');
    if (overlay) {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) _closeAddAnnotationDialog();
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const ov = document.getElementById('add-ann-overlay');
        if (ov && !ov.classList.contains('hidden')) {
          _closeAddAnnotationDialog();
        }
      }
    });
  }

  /**
   * PUBLIC HELPER — Apply all local geometry and dataset-chip UI position
   * overrides to any record fetched from the backend.
   */
  function applyLocalOverrides(rec) {
    if (!rec) return rec;
    return applyOverridesToRecord(rec);
  }

  async function loadPage(pageNumber) {
    try {
      if (!pageNumber || pageNumber < 1) return;
      if (!Store.pdfLoaded) return;

      const imgRes = await window.pywebview.api.get_page_image(pageNumber, DEFAULT_DPI);
      if (!imgRes || !imgRes.ok) {
        console.error('[canvas] failed to load page image:', imgRes?.error);
        showEmpty(true);
        return;
      }

      Store.currentPage = pageNumber;
      Store.setPageImage(
        imgRes.image,
        imgRes.page_width_pts,
        imgRes.page_height_pts,
        imgRes.width,
        imgRes.height
      );

      let backendRecords = [];
const annRes = await window.pywebview.api.get_page_annotations(pageNumber);
if (!annRes || !annRes.ok) {
  console.error('[canvas] failed to load annotations:', annRes?.error);
} else {
  backendRecords = (annRes.records || []).map(rec => applyOverridesToRecord(rec));
}

// Merge with user-created annotations for this page
const userRecs = _getUserAnnotationsForPage(pageNumber).map(rec => applyOverridesToRecord({ ...rec }));
const backendIds = new Set(backendRecords.map(r => r.annotation_id));
const uniqueUserRecs = userRecs.filter(r => !backendIds.has(r.annotation_id));
Store.setAnnotations([...backendRecords, ...uniqueUserRecs]);

      await _ensureColourRegistry();

      renderPage();
      renderComponentBands();
      renderAnnotations();
      renderHeaderChips();
      updatePageMeta();
      applyZoom();
    } catch (e) {
      console.error('[canvas] loadPage error:', e);
      showEmpty(true);
    }
  }

  async function _ensureColourRegistry() {
  try {
    const allRes = await window.pywebview.api.get_annotations();
    if (!allRes || !allRes.ok || !Array.isArray(allRes.records)) return;

    const colourRes = await window.pywebview.api.get_dataset_colours();
    const savedColours = (colourRes && colourRes.ok && colourRes.colours) ? colourRes.colours : {};

    // Save user-created dataset colours before rebuild
    const preservedUserColours = {};
    for (const rec of userCreatedAnnotations) {
      const formCode = (rec.form_code || '').toUpperCase();
      const ds = (rec.sdtm_dataset || '').toUpperCase();
      if (formCode && ds && formColourRegistry[formCode] && formColourRegistry[formCode][ds]) {
        if (!preservedUserColours[formCode]) preservedUserColours[formCode] = {};
        preservedUserColours[formCode][ds] = formColourRegistry[formCode][ds];
      }
    }

    const seenByForm = {};

    for (const rec of allRes.records) {
      if ((rec.page_type || 'FORM') !== 'FORM') continue;
      if ((rec.status || '') === 'REMOVED') continue;

      const formCode = (rec.form_code || '').toUpperCase();
      const ds = (rec.sdtm_dataset || '').toUpperCase();
      if (!formCode || !ds) continue;

      if (!formColourRegistry[formCode]) formColourRegistry[formCode] = {};
      if (!seenByForm[formCode]) seenByForm[formCode] = [];

      if (!seenByForm[formCode].includes(ds)) {
        seenByForm[formCode].push(ds);

        // Only assign if not already in registry (preserve existing assignments)
        if (!formColourRegistry[formCode][ds]) {
          const savedKey = `${formCode}::${ds}`;
          const savedColourName = String(savedColours[savedKey] || '').trim().toLowerCase();

          if (savedColourName && COLOUR_KEY_TO_HEX[savedColourName]) {
            formColourRegistry[formCode][ds] = COLOUR_KEY_TO_HEX[savedColourName];
          } else {
            const idx = seenByForm[formCode].length - 1;
            formColourRegistry[formCode][ds] = PALETTE[idx % PALETTE.length];
          }
        }
      }
    }

    // Restore user-created dataset colours that backend doesn't know about
    for (const formCode of Object.keys(preservedUserColours)) {
      if (!formColourRegistry[formCode]) formColourRegistry[formCode] = {};
      for (const ds of Object.keys(preservedUserColours[formCode])) {
        if (!formColourRegistry[formCode][ds]) {
          formColourRegistry[formCode][ds] = preservedUserColours[formCode][ds];
        }
      }
    }

    // Also ensure any user-created annotations' datasets are in the registry
    for (const rec of userCreatedAnnotations) {
      const formCode = (rec.form_code || '').toUpperCase();
      const ds = (rec.sdtm_dataset || '').toUpperCase();
      if (!formCode || !ds) continue;

      if (!formColourRegistry[formCode]) formColourRegistry[formCode] = {};
      if (!formColourRegistry[formCode][ds]) {
        const existingCount = Object.keys(formColourRegistry[formCode]).length;
        formColourRegistry[formCode][ds] = PALETTE[existingCount % PALETTE.length];
      }
    }
    // Mirror flattened colour registry into Store for export snapshot styling
    const flat = {};
    for (const fc of Object.keys(formColourRegistry || {})) {
      for (const ds of Object.keys(formColourRegistry[fc] || {})) {
        flat[`${fc}::${ds}`] = formColourRegistry[fc][ds];
      }
    }
    Store.formDatasetColours = flat;
  } catch (e) {
    console.error('[canvas] colour registry error:', e);
  }
}

  function applyOverridesToRecord(rec) {
    if (!rec) return rec;

    const next = { ...rec };

    if (next.annotation_id && annotationGeometryOverrides[next.annotation_id]) {
      const g = annotationGeometryOverrides[next.annotation_id];
      next.x0_pts = g.x0_pts;
      next.y0_pts = g.y0_pts;
      next.x1_pts = g.x1_pts;
      next.y1_pts = g.y1_pts;
      next._hasGeometryOverride = true;
    }

    if (next._isDatasetChip) {
      const key = `${String(next._formCode || '').toUpperCase()}::${String(next._datasetCode || '').toUpperCase()}`;
      const ui = datasetChipUiOverrides[key];
      if (ui) {
        next._ui_left = ui._ui_left || '';
        next._ui_top = ui._ui_top || '';
        next._ui_width = ui._ui_width || '';
        next._ui_height = ui._ui_height || '';
      }
    }

    return next;
  }

  function renderPage() {
    const emptyState = document.getElementById('empty-state');
    const pdfContainer = document.getElementById('pdf-container');
    const pdfPageWrap = document.getElementById('pdf-page-wrap');
    const pdfImg = document.getElementById('pdf-img');
    const annotationLayer = document.getElementById('annotation-layer');

    if (!Store.pageImage || !pdfImg || !pdfContainer || !annotationLayer || !pdfPageWrap) {
      showEmpty(true);
      return;
    }

    if (emptyState) emptyState.classList.add('hidden');
    pdfContainer.classList.remove('hidden');

    pdfImg.src = Store.pageImage;
    pdfImg.onload = () => {
      applyZoom();
    };

    pdfPageWrap.style.position = 'relative';
    pdfPageWrap.style.display = 'block';

    annotationLayer.innerHTML = '';
  }

  function applyZoom() {
    const pageWrap = document.getElementById('pdf-page-wrap');
    const pdfImg = document.getElementById('pdf-img');
    const toolbarZoom = document.getElementById('toolbar-zoom');

    if (!pageWrap || !pdfImg) return;

    const zoom = Number(Store.zoomPct || 100);
    const scale = zoom / 100;
    const naturalWidth = Store.imgWidth || 0;
    const naturalHeight = Store.imgHeight || 0;

    if (naturalWidth > 0 && naturalHeight > 0) {
      pageWrap.style.width = `${Math.round(naturalWidth * scale)}px`;
      pageWrap.style.height = `${Math.round(naturalHeight * scale)}px`;
    }

    pageWrap.style.transform = '';
    pageWrap.style.transformOrigin = '';
    pageWrap.style.setProperty('--zoom-scale', String(scale));
    pdfImg.style.width = '100%';
    pdfImg.style.height = '100%';

    if (toolbarZoom) {
      toolbarZoom.textContent = `${zoom}%`;
    }
  }

  function zoomIn() {
    const oldZoom = Number(Store.zoomPct || 100);
    Store.setZoom(oldZoom + (Store.zoomStep || 10));
    applyZoom();
  }

  function zoomOut() {
    const oldZoom = Number(Store.zoomPct || 100);
    Store.setZoom(oldZoom - (Store.zoomStep || 10));
    applyZoom();
  }

  function _clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  function _getPageWrap() {
    return document.getElementById('pdf-page-wrap');
  }

  function _getPageRect() {
    const pageWrap = _getPageWrap();
    if (!pageWrap) return null;
    return pageWrap.getBoundingClientRect();
  }

  /**
   * Ctrl+Scroll wheel zoom toward mouse pointer position.
   */
  function _bindScrollZoom() {
    const canvasArea = document.getElementById('canvas-area');
    if (!canvasArea) return;

    canvasArea.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;

      e.preventDefault();
      e.stopPropagation();

      const pageWrap = document.getElementById('pdf-page-wrap');
      if (!pageWrap) return;

      const oldZoom = Number(Store.zoomPct || 100);
      const delta = e.deltaY > 0 ? -Store.zoomStep : Store.zoomStep;
      const newZoom = _clamp(oldZoom + delta, Store.zoomMin, Store.zoomMax);
      if (newZoom === oldZoom) return;

      // Capture pointer position in page-natural coords before zoom
      const pageRect = pageWrap.getBoundingClientRect();
      const oldScale = oldZoom / 100;
      const pointerXInPage = (e.clientX - pageRect.left) / oldScale;
      const pointerYInPage = (e.clientY - pageRect.top) / oldScale;

      // Apply physical zoom
      Store.setZoom(newZoom);
      applyZoom();

      // Adjust scroll so the same page point stays under the cursor.
      // Formula: scrollLeft += (newPageRect.left - canvasRect.left) + pointerXInPage * newScale - pointerXInViewport
      const newPageRect = pageWrap.getBoundingClientRect();
      const canvasRect = canvasArea.getBoundingClientRect();
      const newScale = newZoom / 100;
      const pointerXInViewport = e.clientX - canvasRect.left;
      const pointerYInViewport = e.clientY - canvasRect.top;

      canvasArea.scrollLeft += (newPageRect.left - canvasRect.left) + pointerXInPage * newScale - pointerXInViewport;
      canvasArea.scrollTop  += (newPageRect.top  - canvasRect.top)  + pointerYInPage * newScale - pointerYInViewport;
    }, { passive: false });
  }

  function _startAnnotationDrag(e, box, rec) {
    const pageRect = _getPageRect();
    if (!pageRect) return;

    const boxRect = box.getBoundingClientRect();

    dragState = {
      box,
      rec,
      startClientX: e.clientX,
      startClientY: e.clientY,
      offsetX: e.clientX - boxRect.left,
      offsetY: e.clientY - boxRect.top,
      boxWidthPx: boxRect.width,
      boxHeightPx: boxRect.height,
      moved: false,
      isDatasetChip: !!rec._isDatasetChip,
      // ADD THESE:
    beforeGeometry: rec.annotation_id && annotationGeometryOverrides[rec.annotation_id]
      ? { ...annotationGeometryOverrides[rec.annotation_id] }
      : null,
    beforeChipUi: null,
    chipKey: null,
    };
    // Capture dataset chip state before drag
    if (rec._isDatasetChip) {
      const key = `${String(rec._formCode || '').toUpperCase()}::${String(rec._datasetCode || '').toUpperCase()}`;
      dragState.chipKey = key;
      dragState.beforeChipUi = datasetChipUiOverrides[key]
        ? { ...datasetChipUiOverrides[key] }
        : null;
    }

    box.style.cursor = 'grabbing';
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
    box.style.boxShadow = '0 0 0 2px rgba(255,255,255,0.45), 0 8px 20px rgba(0,0,0,0.35)';
    box.style.zIndex = '50';
  }

  function _moveAnnotationDrag(e) {
    if (!dragState || resizeState) return;

    const pageRect = _getPageRect();
    if (!pageRect) return;

    let newLeft = e.clientX - pageRect.left - dragState.offsetX;
    let newTop = e.clientY - pageRect.top - dragState.offsetY;

    newLeft = _clamp(newLeft, 0, pageRect.width - dragState.boxWidthPx);
    newTop = _clamp(newTop, 0, pageRect.height - dragState.boxHeightPx);

    const leftPct = (newLeft / pageRect.width) * 100;
    const topPct = (newTop / pageRect.height) * 100;

    dragState.box.style.left = `${leftPct}%`;
    dragState.box.style.top = `${topPct}%`;

    const dx = Math.abs(e.clientX - dragState.startClientX);
    const dy = Math.abs(e.clientY - dragState.startClientY);
    if (dx > 3 || dy > 3) {
      dragState.moved = true;
    }
  }

  function _endAnnotationDrag() {
    if (!dragState) return;

    if (dragState.moved) {
      if (dragState.isDatasetChip) {
        _persistDatasetChipVisualState(dragState.rec, dragState.box);
        _pushGeometryUndo({
          type: 'dataset-chip',
          chipKey: dragState.chipKey,
          before: dragState.beforeChipUi,
          after: datasetChipUiOverrides[dragState.chipKey]
            ? { ...datasetChipUiOverrides[dragState.chipKey] }
            : null,
        });
      } else {
        _persistBoxGeometry(dragState.rec, dragState.box);
        const id = dragState.rec.annotation_id;
        _pushGeometryUndo({
          type: 'annotation',
          id: id,
          before: dragState.beforeGeometry,
          after: annotationGeometryOverrides[id]
            ? { ...annotationGeometryOverrides[id] }
            : null,
        });
      }
    }

    dragState.box.style.cursor = 'grab';
    dragState.box.style.boxShadow = '';
    dragState.box.style.zIndex = dragState.isDatasetChip ? '12' : '10';

    document.body.style.cursor = '';
    document.body.style.userSelect = '';

    dragState = null;
  } 

  function _bindGlobalAnnotationDragEvents() {
    document.addEventListener('mousemove', (e) => {
      _moveAnnotationDrag(e);
    });

    document.addEventListener('mouseup', () => {
      _endAnnotationDrag();
    });
  }

  function _startAnnotationResize(e, box, rec) {
    const pageRect = _getPageRect();
    if (!pageRect) return;

    const boxRect = box.getBoundingClientRect();

    resizeState = {
      box,
      rec,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startWidthPx: boxRect.width,
      startHeightPx: boxRect.height,
      startLeftPx: boxRect.left - pageRect.left,
      startTopPx: boxRect.top - pageRect.top,
      isDatasetChip: !!rec._isDatasetChip,
      // ADD THESE:
    beforeGeometry: rec.annotation_id && annotationGeometryOverrides[rec.annotation_id]
      ? { ...annotationGeometryOverrides[rec.annotation_id] }
      : null,
    beforeChipUi: null,
    chipKey: null,
    };
    if (rec._isDatasetChip) {
      const key = `${String(rec._formCode || '').toUpperCase()}::${String(rec._datasetCode || '').toUpperCase()}`;
      resizeState.chipKey = key;
      resizeState.beforeChipUi = datasetChipUiOverrides[key]
        ? { ...datasetChipUiOverrides[key] }
        : null;
    }

    box.style.boxShadow = '0 0 0 2px rgba(255,255,255,0.45), 0 8px 20px rgba(0,0,0,0.35)';
    box.style.zIndex = '50';
    document.body.style.cursor = 'nwse-resize';
    document.body.style.userSelect = 'none';
  }

  function _moveAnnotationResize(e) {
    if (!resizeState) return;

    const pageRect = _getPageRect();
    if (!pageRect) return;

    let nextWidthPx = resizeState.startWidthPx + (e.clientX - resizeState.startClientX);
    let nextHeightPx = resizeState.startHeightPx + (e.clientY - resizeState.startClientY);

    const minWidthPx = 28;
    const minHeightPx = 14;

    const maxWidthPx = pageRect.width - resizeState.startLeftPx;
    const maxHeightPx = pageRect.height - resizeState.startTopPx;

    nextWidthPx = _clamp(nextWidthPx, minWidthPx, maxWidthPx);
    nextHeightPx = _clamp(nextHeightPx, minHeightPx, maxHeightPx);

    const leftPct = (resizeState.startLeftPx / pageRect.width) * 100;
    const topPct = (resizeState.startTopPx / pageRect.height) * 100;
    const widthPct = (nextWidthPx / pageRect.width) * 100;
    const heightPct = (nextHeightPx / pageRect.height) * 100;

    resizeState.box.style.left = `${leftPct}%`;
    resizeState.box.style.top = `${topPct}%`;
    resizeState.box.style.width = `${widthPct}%`;
    resizeState.box.style.height = `${heightPct}%`;
  }

 function _endAnnotationResize() {
    if (!resizeState) return;

    if (resizeState.isDatasetChip) {
      _persistDatasetChipVisualState(resizeState.rec, resizeState.box);
      _pushGeometryUndo({
        type: 'dataset-chip',
        chipKey: resizeState.chipKey,
        before: resizeState.beforeChipUi,
        after: datasetChipUiOverrides[resizeState.chipKey]
          ? { ...datasetChipUiOverrides[resizeState.chipKey] }
          : null,
      });
    } else {
      _persistBoxGeometry(resizeState.rec, resizeState.box);
      const id = resizeState.rec.annotation_id;
      _pushGeometryUndo({
        type: 'annotation',
        id: id,
        before: resizeState.beforeGeometry,
        after: annotationGeometryOverrides[id]
          ? { ...annotationGeometryOverrides[id] }
          : null,
      });
    }

    resizeState.box.style.boxShadow = '';
    resizeState.box.style.zIndex = resizeState.isDatasetChip ? '12' : '10';

    document.body.style.cursor = '';
    document.body.style.userSelect = '';

    resizeState = null;
  }
  function _bindGlobalAnnotationResizeEvents() {
    document.addEventListener('mousemove', (e) => {
      _moveAnnotationResize(e);
    });

    document.addEventListener('mouseup', () => {
      _endAnnotationResize();
    });
  }

function _persistBoxGeometry(rec, box) {
    if (!rec || !box || !rec.annotation_id) return;

    const leftPct = parseFloat(box.style.left) || 0;
    const topPct = parseFloat(box.style.top) || 0;
    const widthPct = parseFloat(box.style.width) || 0;
    const heightPct = parseFloat(box.style.height) || 0;

    const pageW = Number(Store.pageWidthPts || 0);
    const pageH = Number(Store.pageHeightPts || 0);
    if (!pageW || !pageH) return;

    const x0 = (leftPct / 100) * pageW;
    const y0 = (topPct / 100) * pageH;
    const x1 = ((leftPct + widthPct) / 100) * pageW;
    const y1 = ((topPct + heightPct) / 100) * pageH;

    annotationGeometryOverrides[rec.annotation_id] = {
      x0_pts: x0,
      y0_pts: y0,
      x1_pts: x1,
      y1_pts: y1,
    };

    if (Array.isArray(Store.annotations)) {
      const idx = Store.annotations.findIndex(r => r.annotation_id === rec.annotation_id);
      if (idx >= 0) {
        Store.annotations[idx].ui_rect_pts = { x0, y0, x1, y1 };
        Store.annotations[idx] = applyOverridesToRecord(Store.annotations[idx]);
      }
    }

    if (Store.selectedRecord && Store.selectedRecord.annotation_id === rec.annotation_id) {
      const nextSelected = {
        ...Store.selectedRecord,
        ui_rect_pts: { x0, y0, x1, y1 },
      };
      Store.setSelectedAnnotation(applyOverridesToRecord(nextSelected));
    }

    if (rec._isUserCreated) {
      const uIdx = userCreatedAnnotations.findIndex(r => r.annotation_id === rec.annotation_id);
      if (uIdx >= 0) {
        userCreatedAnnotations[uIdx].ui_rect_pts = { x0, y0, x1, y1 };
        userCreatedAnnotations[uIdx] = applyOverridesToRecord(userCreatedAnnotations[uIdx]);
      }
    }

    if (typeof EditorState !== 'undefined' && EditorState.scheduleAutosave) {
      EditorState.scheduleAutosave();
    }
  }

function _persistDatasetChipVisualState(rec, box) {
    if (!rec || !box || !rec._isDatasetChip) return;

    const key = `${String(rec._formCode || '').toUpperCase()}::${String(rec._datasetCode || '').toUpperCase()}`;
    const left = box.style.left || '50%';
    const top = box.style.top || '1%';
    const width = box.style.width || '';
    const height = box.style.height || '';

    datasetChipUiOverrides[key] = {
      _ui_left: left,
      _ui_top: top,
      _ui_width: width,
      _ui_height: height,
    };

    rec._ui_left = left;
    rec._ui_top = top;
    rec._ui_width = width;
    rec._ui_height = height;

    const chipId = `datasetchip::${String(rec._formCode || '').toUpperCase()}::${String(rec._datasetCode || '').toUpperCase()}`;
    const fillHex =
      Store.formDatasetColours?.[
        `${String(rec._formCode || '').toUpperCase()}::${String(rec._datasetCode || '').toUpperCase()}`
      ] || '#BFE0FF';

    Store.upsertDatasetChip({
      chip_id: chipId,
      page: rec.page || Store.currentPage,
      dataset: rec._datasetCode || rec.sdtm_dataset || '',
      full_name: rec.sdtm_label || '',
      display_text: rec.sdtm_label || rec.raw_variable || rec._datasetCode || '',
      rect_pts: null,
      _ui_left: left,
      _ui_top: top,
      _ui_width: width,
      _ui_height: height,
      fill_hex: fillHex,
      visible: true,
      removed: false,
      source: rec._isUserCreated ? 'USER_ADDED' : 'AUTO',
    });

    if (Store.selectedRecord && Store.selectedRecord.annotation_id === rec.annotation_id) {
      Store.setSelectedAnnotation(applyOverridesToRecord({
        ...Store.selectedRecord,
        _ui_left: left,
        _ui_top: top,
        _ui_width: width,
        _ui_height: height,
      }));
    }

    if (typeof EditorState !== 'undefined' && EditorState.scheduleAutosave) {
      EditorState.scheduleAutosave();
    }
  }

  function renderComponentBands() {
    const annotationLayer = document.getElementById('annotation-layer');
    if (!annotationLayer) return;

    const records = Store.annotations || [];
    if (!records.length) return;

    const first = records[0] || {};
    if ((first.page_type || 'FORM') !== 'FORM') return;

    const pageW = Store.pageWidthPts;
    const pageH = Store.pageHeightPts;
    if (!pageW || !pageH) return;

    const groups = [];
    const seen = new Set();

    for (const rec of records) {
      if ((rec.page_type || 'FORM') !== 'FORM') continue;
      if ((rec.status || '') === 'REMOVED') continue;

      const id = rec.annotation_id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      groups.push(rec);
    }

    for (const rec of groups) {
      const y0 = parseFloat(rec.y0_pts) || 0;
      const y1 = parseFloat(rec.y1_pts) || 0;
      if (y0 === 0 && y1 === 0) continue;
      if (rec._hasGeometryOverride && rec._isUserCreated) continue;

      const band = document.createElement('div');
      band.className = 'component-band';
      band.dataset.id = rec.annotation_id;

      const topPct = ((y0 / pageH) * 100).toFixed(3);
      const heightPct = (((y1 - y0) / pageH) * 100).toFixed(3);

      band.style.position = 'absolute';
      band.style.left = '0.8%';
      band.style.width = '98.4%';
      band.style.top = `${topPct}%`;
      band.style.height = `${heightPct}%`;
      band.style.background = 'transparent';
      band.style.border = '1px solid transparent';
      band.style.pointerEvents = 'all';
      band.style.cursor = 'pointer';
      band.style.zIndex = '4';
      band.style.boxSizing = 'border-box';
      band.style.transition = 'background 0.08s ease, border-color 0.08s ease, box-shadow 0.08s ease';

      band.addEventListener('mouseenter', () => {
        if (Store.selectedId === rec.annotation_id) return;
        band.style.background = 'rgba(142, 84, 255, 0.16)';
        band.style.border = '1px solid rgba(74, 0, 130, 0.85)';
        band.style.boxShadow = 'inset 0 0 0 1px rgba(74, 0, 130, 0.25)';
      });

      band.addEventListener('mouseleave', () => {
        if (Store.selectedId === rec.annotation_id) return;
        band.style.background = 'transparent';
        band.style.border = '1px solid transparent';
        band.style.boxShadow = 'none';
      });

      band.addEventListener('click', async (e) => {
        e.stopPropagation();
        _queueHighlightId = null;  // direct click clears queue highlight mode
        Store.setSelectedAnnotation(rec);
        highlightSelected();

        if (typeof EditPanel !== 'undefined' && EditPanel.open) {
          await EditPanel.open(rec.annotation_id);
        }
      });

      annotationLayer.appendChild(band);
    }
  }

  function renderAnnotations() {
    const annotationLayer = document.getElementById('annotation-layer');
    if (!annotationLayer) return;

    const records = Store.annotations || [];
    if (!records.length) return;

    const first = records[0] || {};
    const pageType = first.page_type || 'FORM';

    const tableBanner = document.getElementById('table-banner');
    if (tableBanner) {
      if (pageType === 'TABLE') tableBanner.classList.remove('hidden');
      else tableBanner.classList.add('hidden');
    }

    if (pageType === 'TABLE') return;

    const pageW = Store.pageWidthPts;
    const pageH = Store.pageHeightPts;
    if (!pageW || !pageH) return;

    records
  .filter(r => (r.page_type || 'FORM') === 'FORM' && (r.status || '') !== 'REMOVED' && !r._isDatasetChipPlaceholder)
  .forEach(rec => {
        const y0 = parseFloat(rec.y0_pts) || 0;
        const y1 = parseFloat(rec.y1_pts) || 0;
        if (y0 === 0 && y1 === 0) return;

        const box = buildAnnotationBox(rec, pageW, pageH);
        annotationLayer.appendChild(box);
      });

    highlightSelected();
  }

  function buildAnnotationBox(rec, pageW, pageH) {
    const box = document.createElement('div');
    box.className = `ann-box ${statusClass(rec.status)}`;
    box.dataset.id = rec.annotation_id;

    const label = getAnnotationLabel(rec);
    const geom = computeBoxGeometry(rec, pageW, pageH, label);

    box.style.position = 'absolute';
    box.style.left = `${geom.leftPct}%`;
    box.style.top = `${geom.topPct}%`;
    box.style.width = `${geom.widthPct}%`;
    box.style.height = `${geom.heightPct}%`;
    box.style.pointerEvents = 'all';
    box.style.cursor = 'grab';
    box.style.zIndex = '10';
    box.style.paddingLeft = '7px';
    box.style.paddingRight = '7px';
    box.style.display = 'flex';
    box.style.paddingBottom="4px";
    box.style.paddingTop="4px";
    box.style.alignItems = 'center';
    box.style.borderRadius="0px";

    applyBoxVisualStyle(box, rec);

    const labelSpan = document.createElement('span');
    labelSpan.className = 'ann-box-label';
    labelSpan.textContent = label;
    labelSpan.title = label;
    labelSpan.style.whiteSpace = 'nowrap';
    labelSpan.style.overflow = 'visible';
    labelSpan.style.textOverflow = 'clip';
    labelSpan.style.pointerEvents = 'none';
    labelSpan.style.paddingBottom = "3px";
    box.appendChild(labelSpan);""

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'ann-resize-handle';
    resizeHandle.innerHTML = '↘';

    resizeHandle.style.position = 'absolute';
    resizeHandle.style.right = '2px';
    resizeHandle.style.bottom = '0px';
    resizeHandle.style.width = '12px';
    resizeHandle.style.height = '12px';
    resizeHandle.style.display = 'flex';
    resizeHandle.style.alignItems = 'center';
    resizeHandle.style.justifyContent = 'center';
    resizeHandle.style.fontSize = '10px';
    resizeHandle.style.lineHeight = '10px';
    resizeHandle.style.fontWeight = '700';
    resizeHandle.style.color = '#B388FF';
    resizeHandle.style.background = 'rgba(101, 43, 218, 0.12)';
    resizeHandle.style.border = '1px solid rgba(179, 136, 255, 0.45)';
    resizeHandle.style.borderRadius = '3px';
    resizeHandle.style.cursor = 'nwse-resize';
    resizeHandle.style.zIndex = '3';
    resizeHandle.style.boxSizing = 'border-box';
    resizeHandle.style.opacity = '0';
    resizeHandle.style.pointerEvents = 'auto';
    resizeHandle.style.transition = 'opacity 0.12s ease, background 0.12s ease, border-color 0.12s ease, transform 0.12s ease';

    resizeHandle.addEventListener('mouseenter', () => {
      resizeHandle.style.background = 'rgba(101, 43, 218, 0.22)';
      resizeHandle.style.borderColor = 'rgba(179, 136, 255, 0.75)';
      resizeHandle.style.transform = 'scale(1.04)';
    });

    resizeHandle.addEventListener('mouseleave', () => {
      resizeHandle.style.background = 'rgba(101, 43, 218, 0.12)';
      resizeHandle.style.borderColor = 'rgba(179, 136, 255, 0.45)';
      resizeHandle.style.transform = 'scale(1)';
    });

    resizeHandle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      _startAnnotationResize(e, box, rec);
    });

    box.addEventListener('mouseenter', () => {
      resizeHandle.style.opacity = '1';
    });

    box.addEventListener('mouseleave', () => {
      if (box.dataset.selected === 'true') return;
      resizeHandle.style.opacity = '0';
    });

    box.appendChild(resizeHandle);

    box.addEventListener('click', async (e) => {
      e.stopPropagation();
      Store.setSelectedAnnotation(rec);
      highlightSelected();

      if (typeof EditPanel !== 'undefined' && EditPanel.open) {
        await EditPanel.open(rec.annotation_id);
      }
    });

    box.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      _startAnnotationDrag(e, box, rec);
    });

    return box;
  }

  function computeBoxGeometry(rec, pageW, pageH, label) {
    if (rec._hasGeometryOverride && rec.annotation_id && annotationGeometryOverrides[rec.annotation_id]) {
      const g = annotationGeometryOverrides[rec.annotation_id];
      return {
        leftPct: ((g.x0_pts / pageW) * 100).toFixed(3),
        topPct: ((g.y0_pts / pageH) * 100).toFixed(3),
        widthPct: (((g.x1_pts - g.x0_pts) / pageW) * 100).toFixed(3),
        heightPct: (((g.y1_pts - g.y0_pts) / pageH) * 100).toFixed(3),
      };
    }

    const y0 = parseFloat(rec.y0_pts) || 0;
    const y1 = parseFloat(rec.y1_pts) || 0;

    const fontSizePts = 12.0;
    const padX = 6.0;
    const padY = 5.0;
    const textWidthPts = Math.max(20, 0.60 * fontSizePts * (label || '').length + 3.0);

    const boxW = textWidthPts + padX * 6.0;
    const boxH = fontSizePts + padY * 2;

    const centreX = pageW / 2.0;
    const pdfX0 = Math.max(centreX - boxW / 2.0, 4.0);
    const pdfX1 = Math.min(centreX + boxW / 2.0, pageW - 4.0);

    const compCy = (y0 + y1) / 2.0;
    const pdfY0 = Math.max(compCy - boxH / 2.0, y0 + 1.0);
    const pdfY1 = Math.min(compCy + boxH / 2.0, y1 - 1.0);

    return {
      leftPct: ((pdfX0 / pageW) * 100).toFixed(3),
      topPct: ((pdfY0 / pageH) * 100).toFixed(3),
      widthPct: (((pdfX1 - pdfX0) / pageW) * 100).toFixed(3),
      heightPct: (((pdfY1 - pdfY0) / pageH) * 100).toFixed(3),
    };
  }

  function getAnnotationLabel(rec) {
    if ((rec.status || '') === 'NOT_SUBMITTED') {
      return 'Not Submitted';
    }

    if (rec.sdtm_variable) {
      return rec.sdtm_variable;
    }

    return 'UNMAPPED';
  }

  function applyBoxVisualStyle(box, rec) {
    const status = (rec.status || 'UNMAPPED').toUpperCase();

    if (status === 'NOT_SUBMITTED') {
      box.style.background = '#B4B4B4';
      box.style.border = '1.5px solid #000000';
      box.style.color = '#000000';
      return;
    }

    if (status === 'UNMAPPED' || !rec.sdtm_dataset || !rec.sdtm_variable) {
      box.style.background = '#FDECEC';
      box.style.border = '1.5px solid #CC0000';
      box.style.color = '#CC0000';
      return;
    }

    const formCode = (rec.form_code || '').toUpperCase();
    const ds = (rec.sdtm_dataset || '').toUpperCase();
    const bg = formColourRegistry?.[formCode]?.[ds] || PALETTE[0];

    box.style.background = bg;
    box.style.border = status === 'USER_CORRECTED'
      ? '1.5px solid #00B4D8'
      : '1.5px solid #0072B2';
    box.style.color = '#0050A0';
  }

  function renderHeaderChips() {
    const annotationLayer = document.getElementById('annotation-layer');
    if (!annotationLayer) return;

    const records = Store.annotations || [];
    if (!records.length) return;

    const first = records[0] || {};
    if ((first.page_type || 'FORM') !== 'FORM') return;

    const formCode = (first.form_code || '').toUpperCase();
    const datasets = [];
    const seen = new Set();

    for (const rec of records) {
      if ((rec.status || '') === 'REMOVED') continue;
      const ds = (rec.sdtm_dataset || '').toUpperCase();
      if (!ds || seen.has(ds)) continue;
      seen.add(ds);
      datasets.push(ds);
    }

    if (!datasets.length) return;

    let topPct = 1.0;
    for (const ds of datasets) {
      const chip = document.createElement('div');
      chip.className = 'ann-box ann-chip';
      chip.dataset.datasetCode = ds;
      chip.dataset.formCode = formCode;
      chip.dataset.kind = 'dataset-chip';
      chip.dataset.id = `datasetchip::${formCode}::${ds}`;

      const label = DATASET_LABELS[ds] || `${ds} (${ds})`;
      const bg = formColourRegistry?.[formCode]?.[ds] || PALETTE[0];
      const datasetRecord = applyOverridesToRecord(buildDatasetSelectionRecord(ds, formCode, records));

      chip.textContent = label;
      chip.title = label;

      chip.style.position = 'absolute';
      chip.style.left = datasetRecord._ui_left || '50%';
      chip.style.top = datasetRecord._ui_top || `${topPct}%`;
      chip.style.background = bg;
      chip.style.border = '1.5px solid #000000';
      chip.style.color = '#000000';
      chip.style.fontSize = '11px';
      chip.style.fontWeight = '600';
      chip.style.paddingTop = '2px';
      chip.style.paddingRight = '6px';
      chip.style.paddingBottom = '4px';
      chip.style.paddingLeft = '6px';
      chip.style.boxSizing = 'border-box';
      chip.style.borderRadius = '0px';
      chip.style.pointerEvents = 'all';
      chip.style.cursor = 'grab';
      chip.style.whiteSpace = 'nowrap';
      chip.style.zIndex = '12';
      chip.style.boxShadow = '0 1px 3px rgba(0,0,0,0.18)';

      if (datasetRecord._ui_width) {
        chip.style.width = datasetRecord._ui_width;
      } else {
        chip.style.width = 'auto';
      }

      if (datasetRecord._ui_height) {
        chip.style.height = datasetRecord._ui_height;
      } else {
        chip.style.height = 'auto';
      }

      chip.addEventListener('click', async (e) => {
        e.stopPropagation();

        Store.setSelectedAnnotation(datasetRecord);
        highlightSelected();

        if (typeof EditPanel !== 'undefined' && EditPanel.openDatasetChip) {
          await EditPanel.openDatasetChip(datasetRecord);
        } else if (typeof EditPanel !== 'undefined' && EditPanel.open) {
          const fallback = records.find(r =>
            (r.form_code || '').toUpperCase() === formCode &&
            (r.sdtm_dataset || '').toUpperCase() === ds &&
            (r.status || '') !== 'REMOVED'
          );
          if (fallback) {
            await EditPanel.open(fallback.annotation_id);
          }
        }
      });

      chip.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        _startAnnotationDrag(e, chip, datasetRecord);
      });

      // Resize handle — same behaviour as variable annotation boxes
      const dsResizeHandle = document.createElement('div');
      dsResizeHandle.className = 'ann-resize-handle';
      dsResizeHandle.innerHTML = '↘';
      dsResizeHandle.style.cssText = `
        position:absolute;right:2px;bottom:0px;width:12px;height:12px;
        display:flex;align-items:center;justify-content:center;
        font-size:10px;line-height:10px;font-weight:700;
        color:#B388FF;background:rgba(101,43,218,0.12);
        border:1px solid rgba(179,136,255,0.45);border-radius:3px;
        cursor:nwse-resize;z-index:3;box-sizing:border-box;
        opacity:0;pointer-events:auto;
        transition:opacity 0.12s ease,background 0.12s ease,border-color 0.12s ease,transform 0.12s ease;
      `;
      dsResizeHandle.addEventListener('mouseenter', () => {
        dsResizeHandle.style.background = 'rgba(101,43,218,0.22)';
        dsResizeHandle.style.borderColor = 'rgba(179,136,255,0.75)';
        dsResizeHandle.style.transform = 'scale(1.04)';
      });
      dsResizeHandle.addEventListener('mouseleave', () => {
        dsResizeHandle.style.background = 'rgba(101,43,218,0.12)';
        dsResizeHandle.style.borderColor = 'rgba(179,136,255,0.45)';
        dsResizeHandle.style.transform = 'scale(1)';
      });
      dsResizeHandle.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        _startAnnotationResize(e, chip, datasetRecord);
      });
      chip.addEventListener('mouseenter', () => { dsResizeHandle.style.opacity = '1'; });
      chip.addEventListener('mouseleave', () => { dsResizeHandle.style.opacity = '0'; });
      chip.appendChild(dsResizeHandle);

      annotationLayer.appendChild(chip);
      topPct += 3.8;
    }
  }

  function buildDatasetSelectionRecord(datasetCode, formCode, records) {
    const formUpper = (formCode || '').toUpperCase();
    const dsUpper = (datasetCode || '').toUpperCase();

    const matched = (records || []).filter(r =>
      (r.form_code || '').toUpperCase() === formUpper &&
      (r.sdtm_dataset || '').toUpperCase() === dsUpper &&
      (r.status || '') !== 'REMOVED'
    );

    const first = matched[0] || {};

    return {
      annotation_id: `datasetchip::${formUpper}::${dsUpper}`,
      raw_variable: DATASET_LABELS[dsUpper] || `${dsUpper} (${dsUpper})`,
      component: 'DATASET_HEADER',
      form_code: formUpper,
      page_type: 'FORM',
      page: first.page || Store.currentPage,
      status: 'RESOLVED',
      sdtm_dataset: dsUpper,
      sdtm_variable: '',
      sdtm_label: DATASET_LABELS[dsUpper] || `${dsUpper} (${dsUpper})`,
      _isDatasetChip: true,
      _datasetCode: dsUpper,
      _formCode: formUpper,
      _ui_left: '',
      _ui_top: '',
      _ui_width: '',
      _ui_height: '',
    };
  }

  function statusClass(status) {
    return (status || 'UNMAPPED').toLowerCase().replace(/_/g, '-');
  }

  let _queueHighlightId = null;

  function highlightSelected() {
    document.querySelectorAll('.ann-box').forEach(box => {
      const selected = box.dataset.id === Store.selectedId;
      box.classList.toggle('selected', selected);
      box.dataset.selected = selected ? 'true' : 'false';

      const handle = box.querySelector('.ann-resize-handle');
      if (handle) {
        handle.style.opacity = selected ? '1' : '0';
      }
    });

    document.querySelectorAll('.component-band').forEach(band => {
      const selected = band.dataset.id === Store.selectedId;
      // Always use full-width purple band for all selections (queue or direct click)
      band.classList.toggle('queue-selected', selected);
      // Clear all inline overrides — CSS class handles the visual state
      band.style.background = '';
      band.style.border = '';
      band.style.boxShadow = '';
      band.style.left = '';
      band.style.width = '';
      band.style.borderRadius = '';
    });
  }

  /**
   * Called from the queue sidebar when a queue item is clicked.
   * Selects the annotation and highlights its component band (purple) using
   * the component's full height/width dimensions rather than the small label box.
   */
  function highlightQueueAnnotation(annotationId) {
    if (!annotationId) return;

    _queueHighlightId = annotationId;

    const annotations = Store.annotations || [];
    const rec = annotations.find(r => r.annotation_id === annotationId);

    if (rec) {
      Store.setSelectedAnnotation(rec);
    } else {
      Store.selectedId = annotationId;
    }

    highlightSelected();

    const band = document.querySelector(`.component-band[data-id="${CSS.escape(annotationId)}"]`);
    if (band) {
      // Shake animation — remove then re-add to restart
      band.classList.remove('queue-shake');
      void band.offsetWidth;
      band.classList.add('queue-shake');
      band.addEventListener('animationend', () => band.classList.remove('queue-shake'), { once: true });

      band.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function highlightDatasetChip(formCode, dsCode) {
    if (!formCode || !dsCode) return;
    const chip = document.querySelector(
      `.ann-chip[data-form-code="${CSS.escape(formCode.toUpperCase())}"][data-dataset-code="${CSS.escape(dsCode.toUpperCase())}"]`
    );
    if (!chip) return;
    chip.classList.remove('queue-shake');
    void chip.offsetWidth;
    chip.classList.add('queue-shake');
    chip.addEventListener('animationend', () => chip.classList.remove('queue-shake'), { once: true });
    chip.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function updatePageMeta() {
    const records = Store.annotations || [];
    const first = records[0] || {};

    const formCode = first.form_code || '—';
    const pageType = first.page_type || 'FORM';

    const toolbarFormCode = document.getElementById('toolbar-form-code');
    if (toolbarFormCode) {
      toolbarFormCode.textContent = formCode;
    }

    const navPageType = document.getElementById('nav-page-type');
    if (navPageType) {
      navPageType.textContent = pageType;
      navPageType.classList.remove('badge-form', 'badge-table');
      navPageType.classList.add(pageType === 'TABLE' ? 'badge-table' : 'badge-form');
    }

    const toolbarDpi = document.getElementById('toolbar-dpi');
    if (toolbarDpi) {
      toolbarDpi.textContent = `${DEFAULT_DPI} DPI`;
    }

    const toolbarZoom = document.getElementById('toolbar-zoom');
    if (toolbarZoom) {
      toolbarZoom.textContent = `${Store.zoomPct || 100}%`;
    }
  }

  function showEmpty(show = true) {
    const emptyState = document.getElementById('empty-state');
    const pdfContainer = document.getElementById('pdf-container');
    const tableBanner = document.getElementById('table-banner');

    if (show) {
      if (emptyState) emptyState.classList.remove('hidden');
      if (pdfContainer) pdfContainer.classList.add('hidden');
      if (tableBanner) tableBanner.classList.add('hidden');
    } else {
      if (emptyState) emptyState.classList.add('hidden');
      if (pdfContainer) pdfContainer.classList.remove('hidden');
    }
  }

  function init() {
    const annotationLayer = document.getElementById('annotation-layer');
    const pdfImg = document.getElementById('pdf-img');

    _bindGlobalAnnotationDragEvents();
    _bindGlobalAnnotationResizeEvents();
    _bindScrollZoom();
    _bindGeometryUndoRedo();
    _bindContextMenu();
  _bindAddAnnotationDialog();

    if (annotationLayer) {
      annotationLayer.addEventListener('click', (e) => {
        if (e.target === annotationLayer) {
          Store.clearSelectedAnnotation();
          highlightSelected();

          if (typeof EditPanel !== 'undefined' && EditPanel.close) {
            EditPanel.close();
          }
        }
      });
    }

    if (pdfImg) {
      pdfImg.addEventListener('click', () => {
        Store.clearSelectedAnnotation();
        highlightSelected();

        if (typeof EditPanel !== 'undefined' && EditPanel.close) {
          EditPanel.close();
        }
      });
    }

    // Sync toolbar zoom text and --zoom-scale variable to initial Store value
    applyZoom();
  }

  /**
   * Restore geometry overrides and user-created annotations from a saved
   * editor-state objects array. Call this before loadPage() on session open
   * so that dragged/resized positions and user-drawn boxes are correct.
   */
  function restoreSessionGeometry(objects) {
    if (!Array.isArray(objects)) return;

    // Clear stale state
    for (const k in annotationGeometryOverrides) delete annotationGeometryOverrides[k];
    for (const k in datasetChipUiOverrides) delete datasetChipUiOverrides[k];
    userCreatedAnnotations.length = 0;

    for (const obj of objects) {
      if (!obj || !obj.object_id) continue;

      if (obj.object_type === 'annotation') {
        // Restore pixel-accurate position override from saved rect_pts
        if (obj.rect_pts &&
            obj.rect_pts.x0 != null && obj.rect_pts.y0 != null &&
            obj.rect_pts.x1 != null && obj.rect_pts.y1 != null) {
          annotationGeometryOverrides[obj.object_id] = {
            x0_pts: Number(obj.rect_pts.x0),
            y0_pts: Number(obj.rect_pts.y0),
            x1_pts: Number(obj.rect_pts.x1),
            y1_pts: Number(obj.rect_pts.y1),
          };
        }

        // Re-add user-created annotations to the local array
        if (obj.source === 'USER' || String(obj.object_id).startsWith('user_')) {
          const data = obj.data || {};
          const r = annotationGeometryOverrides[obj.object_id] || {};
          _addUserAnnotation({
            annotation_id: obj.object_id,
            page: Number(obj.page || 1),
            status: data.status || 'UNMAPPED',
            form_code: data.form_code || '',
            raw_variable: data.raw_variable || '',
            raw_label: data.raw_label || '',
            sdtm_dataset: data.sdtm_dataset || '',
            sdtm_variable: data.sdtm_variable || '',
            sdtm_label: data.sdtm_label || '',
            component: data.raw_label || '',
            x0_pts: r.x0_pts,
            y0_pts: r.y0_pts,
            x1_pts: r.x1_pts,
            y1_pts: r.y1_pts,
            source: 'USER',
            _hasGeometryOverride: !!annotationGeometryOverrides[obj.object_id],
          });
        }

      } else if (obj.object_type === 'dataset_chip') {
        // Restore CSS position for dragged/resized dataset chips
        if (obj._ui_left || obj._ui_top) {
          // chip_id format: "datasetchip::FORMCODE::DSCODE"
          const raw = String(obj.object_id).replace(/^datasetchip::/, '');
          const sep = raw.indexOf('::');
          if (sep > 0) {
            const fc = raw.slice(0, sep).toUpperCase();
            const ds = raw.slice(sep + 2).toUpperCase();
            datasetChipUiOverrides[`${fc}::${ds}`] = {
              _ui_left: obj._ui_left || '50%',
              _ui_top: obj._ui_top || '1%',
              _ui_width: obj._ui_width || '',
              _ui_height: obj._ui_height || '',
            };
          }
        }
      }
    }
  }

  return {
  init,
  loadPage,
  renderPage,
  renderAnnotations,
  showEmpty,
  highlightSelected,
  highlightQueueAnnotation,
  highlightDatasetChip,
  applyZoom,
  zoomIn,
  zoomOut,
  applyOverridesToRecord,
  applyLocalOverrides,
  undoGeometry,
  redoGeometry,
  pushUndoAction: _pushGeometryUndo,
  isUserCreated,
  updateUserAnnotation,
  updateDatasetChip,
  updateFormColour,
  restoreSessionGeometry,
};
})();