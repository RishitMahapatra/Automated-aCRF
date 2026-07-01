// ui/js/editor_state.js

const EditorState = (() => {
  'use strict';

  let autosaveTimer = null;

  function _normRgbArray(arr, fallback = [255, 250, 217]) {
    if (!Array.isArray(arr) || arr.length !== 3) return fallback;
    return arr.map(v => {
      const n = Number(v);
      if (Number.isNaN(n)) return 0;
      return Math.max(0, Math.min(255, Math.round(n)));
    });
  }

  function _annotationDisplayText(rec) {
    const status = String(rec?.status || '').toUpperCase();

    if (status === 'NOT_SUBMITTED') return 'Not Submitted';

    const ds = String(rec?.sdtm_dataset || '').trim();
    const vr = String(rec?.sdtm_variable || '').trim();
    const lb = String(rec?.sdtm_label || '').trim();
    const rawVar = String(rec?.raw_variable || '').trim();
    const component = String(rec?.component || '').trim();

    if (ds && vr) return `${ds}.${vr}`;
    if (lb) return lb;
    if (rawVar) return rawVar;
    if (component) return component;

    return '';
  }

  function _annotationStyle(rec) {
    const status = String(rec?.status || '').toUpperCase();

    if (status === 'UNMAPPED') {
      return {
        fill_rgb: [255, 232, 232],
        stroke_rgb: [180, 40, 40],
        text_rgb: [0, 0, 0],
        border_width: 0.8,
        font_size: 10,
      };
    }

    if (status === 'NOT_SUBMITTED') {
      return {
        fill_rgb: [235, 235, 235],
        stroke_rgb: [120, 120, 120],
        text_rgb: [0, 0, 0],
        border_width: 0.8,
        font_size: 10,
      };
    }

    if (status === 'USER_CORRECTED') {
      return {
        fill_rgb: [225, 248, 255],
        stroke_rgb: [0, 140, 180],
        text_rgb: [0, 0, 0],
        border_width: 1.0,
        font_size: 10,
      };
    }

    return {
      fill_rgb: [255, 250, 217],
      stroke_rgb: [50, 50, 50],
      text_rgb: [0, 0, 0],
      border_width: 0.8,
      font_size: 10,
    };
  }

  function _chipStyle(chip) {
    return {
      fill_rgb: _normRgbArray(chip?.fill_rgb, [191, 224, 255]),
      stroke_rgb: [50, 50, 50],
      text_rgb: [0, 0, 0],
      border_width: 0.8,
      font_size: 10,
    };
  }

  function _annotationRectPts(rec) {
    if (rec?.ui_rect_pts) {
      return {
        x0: Number(rec.ui_rect_pts.x0),
        y0: Number(rec.ui_rect_pts.y0),
        x1: Number(rec.ui_rect_pts.x1),
        y1: Number(rec.ui_rect_pts.y1),
      };
    }

    if (
      rec?.x0_pts != null &&
      rec?.y0_pts != null &&
      rec?.x1_pts != null &&
      rec?.y1_pts != null
    ) {
      return {
        x0: Number(rec.x0_pts),
        y0: Number(rec.y0_pts),
        x1: Number(rec.x1_pts),
        y1: Number(rec.y1_pts),
      };
    }

    return null;
  }

  async function _getAllAnnotationsForExport() {
    try {
      const res = await window.pywebview.api.get_annotations();
      const backend = (res && res.ok && Array.isArray(res.records)) ? res.records : [];

      const localById = new Map();
      (Store.annotations || []).forEach(rec => {
        if (rec && rec.annotation_id) {
          localById.set(rec.annotation_id, rec);
        }
      });

      const merged = backend.map(rec => {
        const local = localById.get(rec.annotation_id);
        if (!local) return rec;

        return {
          ...rec,
          ...local,
          ui_rect_pts: local.ui_rect_pts || rec.ui_rect_pts,
          visible: local.visible !== undefined ? local.visible : rec.visible,
        };
      });

      const backendIds = new Set(backend.map(r => r.annotation_id));
      const localOnly = (Store.annotations || []).filter(
        rec => rec && rec.annotation_id && !backendIds.has(rec.annotation_id)
      );

      return [...merged, ...localOnly];
    } catch (e) {
      console.error('[EditorState] _getAllAnnotationsForExport error:', e);
      return Array.isArray(Store.annotations) ? Store.annotations : [];
    }
  }

  async function buildSnapshot() {
    const objects = [];

    const pages = {};
    if (Store.currentPage) {
      pages[String(Store.currentPage)] = {
        page_number: Store.currentPage,
        page_width_pts: Store.pageWidthPts || 0,
        page_height_pts: Store.pageHeightPts || 0,
        img_width: Store.imgWidth || 0,
        img_height: Store.imgHeight || 0,
      };
    }

    const allAnnotations = await _getAllAnnotationsForExport();

    allAnnotations.forEach(rec => {
      if (!rec) return;

      const status = String(rec.status || '').toUpperCase();
      if (status === 'REMOVED') return;
      if (rec.visible === false) return;

      const rectPts = _annotationRectPts(rec);
      if (!rectPts) return;

      const exportText = _annotationDisplayText(rec);

      objects.push({
        object_id: rec.annotation_id,
        object_type: 'annotation',
        page: Number(rec.page || Store.currentPage || 1),
        visible: true,
        removed: false,
        source: rec.source || 'AUTO',
        display_text: exportText,
        rect_pts: rectPts,
        style: _annotationStyle(rec),
        data: {
          annotation_id: rec.annotation_id,
          status: rec.status || '',
          form_code: rec.form_code || '',
          raw_variable: rec.raw_variable || '',
          raw_label: rec.raw_label || rec.component || '',
          sdtm_dataset: rec.sdtm_dataset || '',
          sdtm_variable: rec.sdtm_variable || '',
          sdtm_label: rec.sdtm_label || '',
          export_text: exportText,
        },
      });
    });

    (Store.datasetChips || []).forEach(chip => {
      if (!chip) return;
      if (chip.visible === false || chip.removed === true) return;
      // Save chip if it has PDF coords OR if it has a user-dragged CSS position
      const hasCssPos = chip._ui_left || chip._ui_top;
      if (!chip.rect_pts && !hasCssPos) return;

      objects.push({
        object_id: chip.chip_id,
        object_type: 'dataset_chip',
        page: Number(chip.page || Store.currentPage || 1),
        visible: true,
        removed: false,
        source: chip.source || 'AUTO',
        display_text: chip.display_text || '',
        rect_pts: chip.rect_pts ? {
          x0: Number(chip.rect_pts.x0),
          y0: Number(chip.rect_pts.y0),
          x1: Number(chip.rect_pts.x1),
          y1: Number(chip.rect_pts.y1),
        } : null,
        // Persist CSS positions so dragged chips restore at the right location
        _ui_left: chip._ui_left || '',
        _ui_top: chip._ui_top || '',
        _ui_width: chip._ui_width || '',
        _ui_height: chip._ui_height || '',
        style: _chipStyle(chip),
        data: {
          dataset: chip.dataset || '',
          full_name: chip.full_name || '',
          export_text: chip.display_text || '',
        },
      });
    });

    const datasetReviews = (typeof Sidebar !== 'undefined' && Sidebar.getDatasetReviews)
      ? Sidebar.getDatasetReviews()
      : [];

    const reviewQueue = (typeof Sidebar !== 'undefined' && Sidebar.getReviewQueue)
      ? Sidebar.getReviewQueue()
      : [];

    return {
      session_id: Store.sessionId,
      pdf_name: Store.pdfName,
      pages,
      objects,
      datasetReviews,
      reviewQueue,
    };
  }

  async function saveNow() {
    try {
      const snapshot = await buildSnapshot();
      return await window.pywebview.api.save_editor_state(snapshot);
    } catch (e) {
      console.error('[EditorState] saveNow error:', e);
      return { ok: false, error: String(e) };
    }
  }

  function scheduleAutosave(delayMs = 400) {
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
    }

    autosaveTimer = setTimeout(async () => {
      await saveNow();
    }, delayMs);
  }

  async function restoreIfAny() {
    try {
      const res = await window.pywebview.api.load_editor_state();
      if (!res || !res.ok || !res.exists || !res.state) return null;
      return res.state;
    } catch (e) {
      console.error('[EditorState] restoreIfAny error:', e);
      return null;
    }
  }

  return {
    buildSnapshot,
    saveNow,
    scheduleAutosave,
    restoreIfAny,
  };
})();