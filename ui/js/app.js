/**
 * ui/js/app.js
 * ------------
 * Main frontend bootstrap for the PyWebView CRF Annotation Editor.
 */
const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 520;

const EDIT_PANEL_MIN_WIDTH = 260;
const EDIT_PANEL_MAX_WIDTH = 560;


async function initApp() {
  console.log('[app] Initializing CRF Annotation Editor...');

  try {
    if (typeof Sidebar !== 'undefined' && Sidebar.init) {
      Sidebar.init();
    }

    if (typeof Canvas !== 'undefined' && Canvas.init) {
      Canvas.init();
    }

    if (typeof EditPanel !== 'undefined' && EditPanel.init) {
      EditPanel.init();
    }

    _restoreThemePreference();
    _bindThemeToggle();
    _bindSidebarResizer();
    _bindEditPanelResizer();
    _bindZoomControls();
    _bindCtrlWheelZoom();
    _bindExportButton();
    await _restoreStateIfAny();
    await _restoreEditorStateIfAny();

    console.log('[app] Ready.');
  } catch (e) {
    console.error('[app] Initialization failed:', e);
  }
}

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function _hexToRgb(hex) {
  const clean = String(hex || '').replace('#', '').trim();
  if (clean.length !== 6) return [191, 224, 255];
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function _cssColorToCanvasFill(cssColor) {
  return cssColor || '#fffad9';
}

function _drawRoundedRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

async function _captureCurrentRenderedPage() {
  const pdfImg = document.getElementById('pdf-img');
  const annotationLayer = document.getElementById('annotation-layer');

  if (!pdfImg || !annotationLayer || !Store.pageImage) {
    throw new Error('Current page is not rendered');
  }

  const imgWidth = Number(Store.imgWidth || pdfImg.naturalWidth || 0);
  const imgHeight = Number(Store.imgHeight || pdfImg.naturalHeight || 0);

  if (!imgWidth || !imgHeight) {
    throw new Error('Missing page image dimensions');
  }

  const canvas = document.createElement('canvas');
  canvas.width = imgWidth;
  canvas.height = imgHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }

  const img = new Image();
  img.src = Store.pageImage;

  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
  });

  ctx.drawImage(img, 0, 0, imgWidth, imgHeight);

  const boxes = Array.from(annotationLayer.querySelectorAll('.ann-box'));
  const layerRect = annotationLayer.getBoundingClientRect();
  const scaleX = imgWidth / Math.max(1, layerRect.width);
  const scaleY = imgHeight / Math.max(1, layerRect.height);

  boxes.forEach(box => {
    const rect = box.getBoundingClientRect();
    const boxId = String(box.dataset.id || '');

    const x = (rect.left - layerRect.left) * scaleX;
    const y = (rect.top - layerRect.top) * scaleY;
    const w = rect.width * scaleX;
    const h = rect.height * scaleY;

    const style = window.getComputedStyle(box);
    const bg = _cssColorToCanvasFill(style.backgroundColor);
    const border = style.borderColor || '#000000';
    const textColor = style.color || '#000000';

    ctx.save();

    _drawRoundedRect(ctx, x, y, w, h, 2);
    ctx.fillStyle = bg;
    ctx.fill();

    ctx.lineWidth = 1.5;
    ctx.strokeStyle = border;
    ctx.stroke();

    // EXPORT-ONLY: never draw resize icon text
    const handle = box.querySelector('.ann-resize-handle');
    const handleText = handle ? (handle.textContent || '').trim() : '';

    let text = (box.textContent || '').trim();
    if (handleText && text.endsWith(handleText)) {
      text = text.slice(0, text.length - handleText.length).trim();
    }

    if (text) {
      // EXPORT-ONLY: enforce uniform typography
      const exportFontPx = 11;
      const exportFontWeight = '500';
      const exportFontFamily = 'Arial';
      const exportLetterSpacingPx = 0;

      ctx.fillStyle = textColor;
      ctx.font = `${exportFontWeight} ${exportFontPx * scaleY}px ${exportFontFamily}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const textX = x + w / 2;
      const textY = y + h / 2;

      // Match a stable inner text width for export
      const maxTextWidth = Math.max(10, w - (14 * scaleX));

      if (exportLetterSpacingPx === 0) {
        ctx.fillText(text, textX, textY, maxTextWidth);
      } else {
        const chars = Array.from(text);
        ctx.font = `${exportFontWeight} ${exportFontPx * scaleY}px ${exportFontFamily}`;

        let totalWidth = 0;
        chars.forEach((ch, idx) => {
          totalWidth += ctx.measureText(ch).width;
          if (idx < chars.length - 1) {
            totalWidth += exportLetterSpacingPx * scaleX;
          }
        });

        let cursorX = textX - totalWidth / 2;
        chars.forEach((ch, idx) => {
          ctx.fillText(ch, cursorX, textY);
          cursorX += ctx.measureText(ch).width;
          if (idx < chars.length - 1) {
            cursorX += exportLetterSpacingPx * scaleX;
          }
        });
      }
    }

    ctx.restore();
  });

  return canvas.toDataURL('image/png');
}

async function _captureAllPagesForExport() {
  if (!Store.pageCount || Store.pageCount < 1) {
    throw new Error('No pages available for export');
  }

  const originalPage = Store.currentPage;
  const images = [];

  for (let page = 1; page <= Store.pageCount; page++) {
    if (typeof Canvas !== 'undefined' && Canvas.loadPage) {
      await Canvas.loadPage(page);
    } else {
      throw new Error('Canvas.loadPage is unavailable');
    }

    await _sleep(120);

    const img = await _captureCurrentRenderedPage();
    images.push(img);
  }

  if (typeof Canvas !== 'undefined' && Canvas.loadPage && originalPage) {
    await Canvas.loadPage(originalPage);
  }

  return images;
}



function _bindExportButton() {
  const btn = document.getElementById('btn-export-pdf');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    try {
      if (!Store.pipelineRan) {
        alert('Run the pipeline first.');
        return;
      }

      btn.disabled = true;
      const oldText = btn.textContent;
      btn.textContent = 'Exporting...';

      const pageImages = await _captureAllPagesForExport();
      if (!pageImages || !pageImages.length) {
        alert('No page images captured for export.');
        return;
      }

      const res = await window.pywebview.api.export_pdf_from_images(pageImages);

      if (res && res.ok) {
        alert('PDF exported successfully:\n' + res.path);
      } else {
        alert('Export failed: ' + (res?.error || 'Unknown error'));
      }

    } catch (e) {
      console.error('[app] screenshot export error:', e);
      alert('Export failed: ' + e);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Export ↗';
    }
  });
}


async function _restoreStateIfAny() {
  try {
    const state = await window.pywebview.api.get_state();
    if (!state || !state.ok) return;

    if (!state.pdf_loaded) {
      if (typeof Canvas !== 'undefined' && Canvas.showEmpty) {
        Canvas.showEmpty(true);
      }
      return;
    }

    Store.pdfLoaded = true;
    Store.pdfName = state.pdf_name || '';
    Store.pdfPath = state.pdf_path || '';
    Store.sessionId = state.session_id || '';
    Store.pageCount = state.page_count || 0;

    // Update visible UI bits
    const navSession = document.getElementById('nav-session');
    if (navSession) {
      navSession.textContent = Store.sessionId || 'No session';
    }

    const sessionInput = document.getElementById('session-input');
    if (sessionInput) {
      sessionInput.value = Store.sessionId || '';
    }

    const fileLoaded = document.getElementById('file-loaded');
    const fileNameLabel = document.getElementById('file-name-label');
    const filePagesLabel = document.getElementById('file-pages-label');
    const dropZone = document.getElementById('drop-zone');

    if (fileLoaded) fileLoaded.classList.remove('hidden');
    if (fileNameLabel) fileNameLabel.textContent = Store.pdfName || '—';
    if (filePagesLabel) filePagesLabel.textContent = `${Store.pageCount || 0} pages`;
    if (dropZone) dropZone.classList.add('hidden');

    const pageDisplay = document.getElementById('page-display');
    if (pageDisplay) {
      pageDisplay.textContent = `${Store.currentPage} / ${Store.pageCount || '—'}`;
    }

    const navPageCount = document.getElementById('nav-page-count');
    if (navPageCount) {
      navPageCount.textContent = `${Store.currentPage} / ${Store.pageCount || '—'}`;
    }

    // Try loading stats + first page
    if (Store.pageCount > 0) {
      Store.pipelineRan = true;

      if (typeof Sidebar !== 'undefined' && Sidebar.refreshStats) {
        await Sidebar.refreshStats();
      }

      if (typeof Canvas !== 'undefined' && Canvas.loadPage) {
        await Canvas.loadPage(Store.currentPage);
      }
    }

  } catch (e) {
    console.error('[app] restore state error:', e);
  }
}
async function _restoreEditorStateIfAny() {
  try {
    if (typeof EditorState === 'undefined' || !EditorState.restoreIfAny) return;

    const saved = await EditorState.restoreIfAny();
    if (!saved || !Array.isArray(saved.objects)) return;

    Store.setEditorObjects(saved.objects);

    const chips = saved.objects
      .filter(o => o && o.object_type === 'dataset_chip' && o.visible !== false && o.removed !== true)
      .map(o => ({
        chip_id: o.object_id,
        page: o.page,
        dataset: o?.data?.dataset || '',
        full_name: o?.data?.full_name || '',
        display_text: o.display_text || '',
        rect_pts: o.rect_pts || null,
        fill_rgb: o?.style?.fill_rgb || [191, 224, 255],
        visible: true,
        removed: false,
        source: o.source || 'AUTO',
      }));

    if (chips.length) {
      Store.setDatasetChips(chips);
    }

  } catch (e) {
    console.error('[app] restore editor state error:', e);
  }
}

// Wait until pywebview bridge is ready
if (window.pywebview && window.pywebview.api) {
  initApp();
} else {
  window.addEventListener('pywebviewready', initApp);
}

function _bindThemeToggle() {
  const btn = document.getElementById('btn-theme-toggle');
  if (!btn) return;

  btn.addEventListener('click', () => {
    const isLight = document.body.classList.toggle('theme-light');
    try {
      localStorage.setItem('crf_theme', isLight ? 'light' : 'dark');
    } catch (e) {
      console.warn('[app] could not persist theme:', e);
    }
    _syncThemeToggleTooltip();
  });

  _syncThemeToggleTooltip();
}

function _bindSidebarResizer() {
  const resizer = document.getElementById('sidebar-resizer');
  const sidebar = document.getElementById('sidebar');
  if (!resizer || !sidebar) return;

  let dragging = false;

  const onMouseMove = (e) => {
    if (!dragging) return;

    const layout = document.getElementById('layout');
    if (!layout) return;

    const layoutRect = layout.getBoundingClientRect();
    let nextWidth = e.clientX - layoutRect.left;

    if (nextWidth < SIDEBAR_MIN_WIDTH) nextWidth = SIDEBAR_MIN_WIDTH;
    if (nextWidth > SIDEBAR_MAX_WIDTH) nextWidth = SIDEBAR_MAX_WIDTH;

    sidebar.style.width = `${nextWidth}px`;
    sidebar.style.flex = `0 0 ${nextWidth}px`;
  };

  const stopDragging = () => {
    if (!dragging) return;
    dragging = false;
    resizer.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';

    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', stopDragging);
  };

  resizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragging = true;
    resizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', stopDragging);
  });
}



function _bindEditPanelResizer() {
  const resizer = document.getElementById('edit-panel-resizer');
  const editPanel = document.getElementById('edit-panel');
  if (!resizer || !editPanel) return;

  let dragging = false;

  const onMouseMove = (e) => {
    if (!dragging) return;

    const viewportWidth = window.innerWidth;
    let nextWidth = viewportWidth - e.clientX;

    if (nextWidth < EDIT_PANEL_MIN_WIDTH) nextWidth = EDIT_PANEL_MIN_WIDTH;
    if (nextWidth > EDIT_PANEL_MAX_WIDTH) nextWidth = EDIT_PANEL_MAX_WIDTH;

    editPanel.style.width = `${nextWidth}px`;
    editPanel.style.flex = `0 0 ${nextWidth}px`;
  };

  const stopDragging = () => {
    if (!dragging) return;
    dragging = false;
    resizer.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';

    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', stopDragging);
  };

  resizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragging = true;
    resizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', stopDragging);
  });
}


function _bindZoomControls() {
    const btnZoomIn = document.getElementById('btn-zoom-in');
    const btnZoomOut = document.getElementById('btn-zoom-out');

    if (btnZoomIn) {
      btnZoomIn.addEventListener('click', () => {
        if (!Store?.setZoom || !Canvas?.applyZoom) return;

        const current = Number(Store.zoomPct || 100);
        const step = Number(Store.zoomStep || 10);
        const max = Number(Store.zoomMax || 200);

        Store.setZoom(Math.min(max, current + step));
        Canvas.applyZoom();
      });
    }

    if (btnZoomOut) {
      btnZoomOut.addEventListener('click', () => {
        if (!Store?.setZoom || !Canvas?.applyZoom) return;

        const current = Number(Store.zoomPct || 100);
        const step = Number(Store.zoomStep || 10);
        const min = Number(Store.zoomMin || 50);

        Store.setZoom(Math.max(min, current - step));
        Canvas.applyZoom();
      });
    }
  }


function _bindCtrlWheelZoom() {
    const canvasArea = document.getElementById('canvas-area');
    if (!canvasArea) return;

    canvasArea.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;

      e.preventDefault();

      if (!Store?.setZoom || !Canvas?.applyZoom) return;

      const current = Number(Store.zoomPct || 100);
      const step = Number(Store.zoomStep || 10);
      const min = Number(Store.zoomMin || 50);
      const max = Number(Store.zoomMax || 200);

      if (e.deltaY < 0) {
        Store.setZoom(Math.min(max, current + step));
      } else if (e.deltaY > 0) {
        Store.setZoom(Math.max(min, current - step));
      }

      Canvas.applyZoom();
    }, { passive: false });
  }

function _restoreThemePreference() {
  try {
    const saved = localStorage.getItem('crf_theme');
    if (saved === 'light') {
      document.body.classList.add('theme-light');
    } else {
      document.body.classList.remove('theme-light');
    }
  } catch (e) {
    document.body.classList.remove('theme-light');
  }

  _syncThemeToggleTooltip();
}

function _syncThemeToggleTooltip() {
  const btn = document.getElementById('btn-theme-toggle');
  if (!btn) return;

  const isLight = document.body.classList.contains('theme-light');
  btn.title = isLight ? 'Switch to dark mode' : 'Switch to light mode';
  btn.setAttribute('aria-label', btn.title);
}