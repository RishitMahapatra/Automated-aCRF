/**
 * ui/js/canvas.js
 * ----------------
 * Live editor overlay rendering.
 */

const Canvas = (() => {
  'use strict';

  const DEFAULT_DPI = 150;

  const PALETTE = [
    '#F0E442',
    '#56B4E9',
    '#009E73',
    '#D55E00',
    '#0072B2',
    '#E69F00',
    '#CC79A7',
  ];

  const COLOUR_KEY_TO_HEX = {
    yellow: '#F0E442',
    blue: '#56B4E9',
    teal: '#009E73',
    vermillion: '#D55E00',
    cobalt: '#0072B2',
    orange: '#E69F00',
    purple: '#CC79A7',
  };

  const DATASET_LABELS = {
    DM: 'DM=Demographics',
    CM: 'CM=Concomitant Medications',
    AE: 'AE=Adverse Events',
    EX: 'EX=Exposure',
    MH: 'MH=Medical History',
    VS: 'VS=Vital Signs',
    LB: 'LB=Laboratory',
    DS: 'DS=Disposition',
    PE: 'PE=Physical Examination',
    EG: 'EG=ECG',
    QS: 'QS=Questionnaires',
    SC: 'SC=Subject Characteristics',
    SU: 'SU=Substance Use',
    FA: 'FA=Findings About',
    PR: 'PR=Procedures',
    SUPPCM: 'SUPPCM=Supplemental Qualifiers for CM',
    SUPPAE: 'SUPPAE=Supplemental Qualifiers for AE',
    SUPPDM: 'SUPPDM=Supplemental Qualifiers for DM',
    SUPPEX: 'SUPPEX=Supplemental Qualifiers for EX',
    SUPPMH: 'SUPPMH=Supplemental Qualifiers for MH',
    SUPPVS: 'SUPPVS=Supplemental Qualifiers for VS',
    SUPPLB: 'SUPPLB=Supplemental Qualifiers for LB',
    SUPPDS: 'SUPPDS=Supplemental Qualifiers for DS',
  };

  let formColourRegistry = {};
  let dragState = null;
  let resizeState = null;

  const annotationGeometryOverrides = {};
  const datasetChipUiOverrides = {};

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

      const annRes = await window.pywebview.api.get_page_annotations(pageNumber);
      if (!annRes || !annRes.ok) {
        console.error('[canvas] failed to load annotations:', annRes?.error);
        Store.setAnnotations([]);
      } else {
        const patched = (annRes.records || []).map(rec => applyOverridesToRecord(rec));
        Store.setAnnotations(patched);
      }

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

      formColourRegistry = {};
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
      // Mark that this record has a user-defined box position
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
    pdfPageWrap.style.display = 'inline-block';

    annotationLayer.innerHTML = '';
  }

  function applyZoom() {
    const pageWrap = document.getElementById('pdf-page-wrap');
    const pdfImg = document.getElementById('pdf-img');
    const annotationLayer = document.getElementById('annotation-layer');
    const toolbarZoom = document.getElementById('toolbar-zoom');

    if (!pageWrap || !pdfImg || !annotationLayer) return;

    const zoom = Number(Store.zoomPct || 100);
    const scale = zoom / 100;

    pageWrap.style.position = 'relative';
    pageWrap.style.transformOrigin = 'top left';
    pageWrap.style.transform = `scale(${scale})`;

    const naturalWidth = pdfImg.offsetWidth || pdfImg.clientWidth || 0;
    const naturalHeight = pdfImg.offsetHeight || pdfImg.clientHeight || 0;

    if (naturalWidth > 0) pageWrap.style.width = `${naturalWidth}px`;
    if (naturalHeight > 0) pageWrap.style.height = `${naturalHeight}px`;

    const pdfContainer = document.getElementById('pdf-container');
    if (pdfContainer && naturalWidth > 0 && naturalHeight > 0) {
      pdfContainer.style.height = `${naturalHeight * scale}px`;
    }

    if (toolbarZoom) {
      toolbarZoom.textContent = `${zoom}%`;
    }
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
    };

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

    if (dragState.isDatasetChip) {
      _persistDatasetChipVisualState(dragState.rec, dragState.box);
    } else {
      _persistBoxGeometry(dragState.rec, dragState.box);
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
    };

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
    } else {
      _persistBoxGeometry(resizeState.rec, resizeState.box);
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

    rec.x0_pts = x0;
    rec.y0_pts = y0;
    rec.x1_pts = x1;
    rec.y1_pts = y1;
    rec._hasGeometryOverride = true;

    if (Array.isArray(Store.annotations)) {
      const idx = Store.annotations.findIndex(r => r.annotation_id === rec.annotation_id);
      if (idx >= 0) {
        Store.annotations[idx] = applyOverridesToRecord({
          ...Store.annotations[idx],
          x0_pts: x0,
          y0_pts: y0,
          x1_pts: x1,
          y1_pts: y1,
        });
      }
    }

    if (Store.selectedRecord && Store.selectedRecord.annotation_id === rec.annotation_id) {
      Store.setSelectedAnnotation(applyOverridesToRecord({
        ...Store.selectedRecord,
        x0_pts: x0,
        y0_pts: y0,
        x1_pts: x1,
        y1_pts: y1,
      }));
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

    if (Store.selectedRecord && Store.selectedRecord.annotation_id === rec.annotation_id) {
      Store.setSelectedAnnotation(applyOverridesToRecord({
        ...Store.selectedRecord,
        _ui_left: left,
        _ui_top: top,
        _ui_width: width,
        _ui_height: height,
      }));
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
      .filter(r => (r.page_type || 'FORM') === 'FORM' && (r.status || '') !== 'REMOVED')
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

    applyBoxVisualStyle(box, rec);

    const labelSpan = document.createElement('span');
    labelSpan.className = 'ann-box-label';
    labelSpan.textContent = label;
    labelSpan.title = label;
    labelSpan.style.whiteSpace = 'nowrap';
    labelSpan.style.overflow = 'visible';
    labelSpan.style.textOverflow = 'clip';
    labelSpan.style.pointerEvents = 'none';
    box.appendChild(labelSpan);

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

  /**
   * KEY FIX: This function now checks if the record has a geometry override
   * (from drag/resize). If it does, it uses the stored x0/y0/x1/y1 directly
   * instead of recalculating from the centring formula.
   */
  function computeBoxGeometry(rec, pageW, pageH, label) {
    // If this record has been dragged/resized, use the override coordinates directly
    if (rec._hasGeometryOverride && rec.annotation_id && annotationGeometryOverrides[rec.annotation_id]) {
      const g = annotationGeometryOverrides[rec.annotation_id];
      return {
        leftPct: ((g.x0_pts / pageW) * 100).toFixed(3),
        topPct: ((g.y0_pts / pageH) * 100).toFixed(3),
        widthPct: (((g.x1_pts - g.x0_pts) / pageW) * 100).toFixed(3),
        heightPct: (((g.y1_pts - g.y0_pts) / pageH) * 100).toFixed(3),
      };
    }

    // Default: compute centred position from component band y-coordinates
    const y0 = parseFloat(rec.y0_pts) || 0;
    const y1 = parseFloat(rec.y1_pts) || 0;

    const fontSizePts = 7.0;
    const padX = 4.0;
    const padY = 2.0;
    const textWidthPts = Math.max(20, 0.58 * fontSizePts * (label || '').length + 2.0);

    const boxW = textWidthPts + padX * 2;
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

    if (rec.sdtm_dataset && rec.sdtm_variable) {
      return `${rec.sdtm_dataset}.${rec.sdtm_variable}`;
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

      const label = DATASET_LABELS[ds] || `${ds}=${ds}`;
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
      chip.style.padding = '2px 6px';
      chip.style.borderRadius = '2px';
      chip.style.pointerEvents = 'all';
      chip.style.cursor = 'grab';
      chip.style.whiteSpace = 'nowrap';
      chip.style.zIndex = '12';
      chip.style.boxShadow = '0 1px 3px rgba(0,0,0,0.18)';

      if (datasetRecord._ui_width) chip.style.width = datasetRecord._ui_width;
      if (datasetRecord._ui_height) chip.style.height = datasetRecord._ui_height;

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
      raw_variable: DATASET_LABELS[dsUpper] || dsUpper,
      component: 'DATASET_HEADER',
      form_code: formUpper,
      page_type: 'FORM',
      page: first.page || Store.currentPage,
      status: 'RESOLVED',
      sdtm_dataset: dsUpper,
      sdtm_variable: '',
      sdtm_label: DATASET_LABELS[dsUpper] || dsUpper,
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
      if (selected) {
        band.style.background = 'rgba(142, 84, 255, 0.20)';
        band.style.border = '1px solid rgba(74, 0, 130, 0.95)';
        band.style.boxShadow = 'inset 0 0 0 1px rgba(74, 0, 130, 0.30)';
      } else {
        band.style.background = 'transparent';
        band.style.border = '1px solid transparent';
        band.style.boxShadow = 'none';
      }
    });
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
  }

  return {
    init,
    loadPage,
    renderPage,
    renderAnnotations,
    showEmpty,
    highlightSelected,
    applyZoom,
    applyOverridesToRecord,
    applyLocalOverrides,
  };
})();