/**
 * ui/js/app.js
 * ------------
 * Main frontend bootstrap for the PyWebView CRF Annotation Editor.
 */
const SIDEBAR_MIN_WIDTH = 160;
const SIDEBAR_MAX_WIDTH = 520;

const EDIT_PANEL_MIN_WIDTH = 200;
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
  const target = document.getElementById('pdf-page-wrap');

  if (!target) {
    throw new Error('pdf-page-wrap not found');
  }

  if (typeof html2canvas === 'undefined') {
    throw new Error('html2canvas is not loaded');
  }

  // Wait a tick so latest DOM updates/annotation rendering settle
  await _sleep(80);

  const canvas = await html2canvas(target, {
    backgroundColor: '#ffffff',
    useCORS: true,
    scale: 4,
    logging: false,
    removeContainer: true,
  });

  return canvas.toDataURL('image/png');
}

async function _captureAllPagesForExport() {
  if (!Store.pageCount || Store.pageCount < 1) {
    throw new Error('No pages available for export');
  }

  const originalPage = Store.currentPage;
  const originalZoom = Number(Store.zoomPct || 100);
  const images = [];

  // Hide navigation-only markers before capture
  const markers = Array.from(document.querySelectorAll('.ann-review-marker'));
  markers.forEach(m => { m.style.display = 'none'; });

  try {
    // Export at stable zoom for consistent capture
    if (Store.setZoom && typeof Canvas !== 'undefined' && Canvas.applyZoom) {
      Store.setZoom(100);
      Canvas.applyZoom();
      await _sleep(120);
    }

    for (let page = 1; page <= Store.pageCount; page++) {
      if (typeof Canvas !== 'undefined' && Canvas.loadPage) {
        await Canvas.loadPage(page);
      } else {
        throw new Error('Canvas.loadPage is unavailable');
      }

      // Let image + annotations + chips fully render
      await _sleep(250);

      const img = await _captureCurrentRenderedPage();
      images.push(img);
    }

    return images;
  } finally {
    // Restore markers after capture
    markers.forEach(m => { m.style.display = ''; });

    if (typeof Canvas !== 'undefined' && Canvas.loadPage && originalPage) {
      await Canvas.loadPage(originalPage);
    }

    if (Store.setZoom && typeof Canvas !== 'undefined' && Canvas.applyZoom) {
      Store.setZoom(originalZoom);
      Canvas.applyZoom();
    }
  }
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