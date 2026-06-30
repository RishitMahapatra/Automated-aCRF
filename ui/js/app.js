/**
 * ui/js/app.js
 * ------------
 * Main frontend bootstrap for the PyWebView CRF Annotation Editor.
 */
const SIDEBAR_MIN_WIDTH = 84;
const SIDEBAR_MAX_WIDTH = 520;

const EDIT_PANEL_MIN_WIDTH = 200;
const EDIT_PANEL_MAX_WIDTH = 560;

function showToast(message, type = 'info', duration = 4500) {
  const container = document.getElementById('toast-container');
  if (!container) { console.warn('[toast]', message); return; }
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  const safeMsg = String(message).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  toast.innerHTML = `<span class="toast-msg">${safeMsg}</span><button class="toast-close" title="Dismiss">×</button>`;
  toast.querySelector('.toast-close').addEventListener('click', () => {
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 300);
  });
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast-visible'));
  setTimeout(() => {
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function showInfoDialog(title, body) {
  const overlay = document.getElementById('info-dialog-overlay');
  const titleEl = document.getElementById('info-dialog-title');
  const bodyEl = document.getElementById('info-dialog-body');
  const okBtn = document.getElementById('info-dialog-ok');
  if (!overlay) { alert(body); return; }
  if (titleEl) titleEl.textContent = title;
  if (bodyEl) bodyEl.textContent = body;
  overlay.classList.remove('hidden');
  const close = () => overlay.classList.add('hidden');
  okBtn?.addEventListener('click', close, { once: true });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); }, { once: true });
}

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
    _bindFileMenu();
    _bindFileShortcuts();
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
    scale: 2,   // 300 DPI — professional print quality, 4× smaller than scale:4
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
  const pageData = [];

  try {
    // Render at 100% zoom so CSS font-size = 25px = 12pt at 150 DPI
    if (Store.setZoom && typeof Canvas !== 'undefined' && Canvas.applyZoom) {
      Store.setZoom(100);
      Canvas.applyZoom();
      await _sleep(150);
    }

    for (let page = 1; page <= Store.pageCount; page++) {
      if (typeof Canvas !== 'undefined' && Canvas.loadPage) {
        await Canvas.loadPage(page);
      } else {
        throw new Error('Canvas.loadPage is unavailable');
      }

      // Let image + annotations + chips fully render
      await _sleep(300);

      const img = await _captureCurrentRenderedPage();

      // Store original PDF page dimensions in points alongside the image so
      // the backend can create correctly-sized PDF pages (not pixel-sized).
      pageData.push({
        image: img,
        widthPts: Store.pageWidthPts || 0,
        heightPts: Store.pageHeightPts || 0,
      });
    }

    return pageData;
  } finally {
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
        showToast('Run the pipeline first.', 'warning'); return;
      }

      btn.disabled = true;
      const oldText = btn.textContent;
      btn.textContent = 'Exporting...';

      const pageData = await _captureAllPagesForExport();
      if (!pageData || !pageData.length) {
        showToast('No page images captured for export.', 'error'); return;
      }

      const res = await window.pywebview.api.export_pdf_from_images(pageData);

      if (res && res.ok) {
        showToast('PDF exported to: ' + res.path, 'success', 7000);
      } else {
        showToast('Export failed: ' + (res?.error || 'Unknown error'), 'error');
      }

    } catch (e) {
      console.error('[app] screenshot export error:', e);
      showToast('Export failed: ' + e, 'error');
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

function _updateSidebarTabMode(sidebar) {
  if (!sidebar) return;
  const w = parseFloat(sidebar.style.width) || sidebar.getBoundingClientRect().width;
  sidebar.classList.toggle('sidebar-icon-only', w < 145);
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
    _updateSidebarTabMode(sidebar);
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

  // Set initial icon-only state based on current sidebar width
  _updateSidebarTabMode(sidebar);
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

// ==========================================================================
// FILE MENU
// ==========================================================================

function _bindFileMenu() {
  const trigger = document.getElementById('file-menu-trigger');
  const dropdown = document.getElementById('file-menu-dropdown');
  if (!trigger || !dropdown) return;

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = !dropdown.classList.contains('hidden');
    if (isOpen) {
      _closeFileMenu();
    } else {
      dropdown.classList.remove('hidden');
      trigger.classList.add('open');
    }
  });

  document.addEventListener('click', (e) => {
    if (!dropdown.classList.contains('hidden')) {
      const wrap = document.getElementById('file-menu-wrap');
      if (wrap && !wrap.contains(e.target)) {
        _closeFileMenu();
      }
    }
  });

  document.getElementById('fm-new-session')?.addEventListener('click', () => {
    _closeFileMenu();
    document.getElementById('btn-restart-session')?.click();
  });

  document.getElementById('fm-open')?.addEventListener('click', () => {
    _closeFileMenu();
    _doOpenSession();
  });

  document.getElementById('fm-save')?.addEventListener('click', () => {
    _closeFileMenu();
    _doSaveSession();
  });

  document.getElementById('fm-save-as')?.addEventListener('click', () => {
    _closeFileMenu();
    _doSaveSessionAs();
  });

  document.getElementById('fm-export')?.addEventListener('click', () => {
    _closeFileMenu();
    document.getElementById('btn-export-pdf')?.click();
  });

  document.getElementById('fm-restart')?.addEventListener('click', () => {
    _closeFileMenu();
    document.getElementById('btn-restart-session')?.click();
  });
}

function _closeFileMenu() {
  const dropdown = document.getElementById('file-menu-dropdown');
  const trigger = document.getElementById('file-menu-trigger');
  if (dropdown) dropdown.classList.add('hidden');
  if (trigger) trigger.classList.remove('open');
}

function _bindFileShortcuts() {
  document.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (!ctrl) return;

    if (e.key === 's' || e.key === 'S') {
      e.preventDefault();
      if (e.shiftKey) {
        _doSaveSessionAs();
      } else {
        _doSaveSession();
      }
    }

    if (e.key === 'o' || e.key === 'O') {
      if (!e.shiftKey) {
        e.preventDefault();
        _doOpenSession();
      }
    }

    if (e.key === 'e' || e.key === 'E') {
      if (!e.shiftKey) {
        e.preventDefault();
        document.getElementById('btn-export-pdf')?.click();
      }
    }
  });
}

async function _doSaveSession() {
  if (!Store.pdfLoaded || !Store.sessionId) {
    showToast('No active session to save.', 'warning');
    return;
  }

  try {
    const editorState = _collectEditorState();
    const res = await window.pywebview.api.save_session_file(editorState);

    if (res && res.ok) {
      showToast('Session saved: ' + (res.path || '').split(/[\\/]/).pop(), 'success');
    } else if (res && res.error === 'Save cancelled') {
      // user cancelled, no toast
    } else {
      showToast('Save failed: ' + (res?.error || 'Unknown error'), 'error');
    }
  } catch (e) {
    console.error('[app] save session error:', e);
    showToast('Save failed: ' + e, 'error');
  }
}

async function _doSaveSessionAs() {
  if (!Store.pdfLoaded || !Store.sessionId) {
    showToast('No active session to save.', 'warning');
    return;
  }

  try {
    const editorState = _collectEditorState();
    const res = await window.pywebview.api.save_session_file_as(editorState);

    if (res && res.ok) {
      showToast('Session saved: ' + (res.path || '').split(/[\\/]/).pop(), 'success');
    } else if (res && res.error === 'Save cancelled') {
      // user cancelled
    } else {
      showToast('Save failed: ' + (res?.error || 'Unknown error'), 'error');
    }
  } catch (e) {
    console.error('[app] save-as error:', e);
    showToast('Save failed: ' + e, 'error');
  }
}

async function _doOpenSession() {
  try {
    const res = await window.pywebview.api.open_session_file();

    if (!res || !res.ok) {
      if (res && res.error !== 'No file selected') {
        showToast('Open failed: ' + (res?.error || 'Unknown error'), 'error');
      }
      return;
    }

    Store.resetSession();

    Store.sessionId = res.session_id;
    Store.pdfLoaded = true;
    Store.pdfName = res.pdf_name || '';
    Store.pdfPath = res.pdf_path || '';
    Store.pageCount = res.page_count || 0;
    Store.pipelineRan = (res.annotation_count || 0) > 0;

    const navSession = document.getElementById('nav-session');
    if (navSession) navSession.textContent = Store.sessionId;

    const sessionInput = document.getElementById('session-input');
    if (sessionInput) sessionInput.value = Store.sessionId;

    const fileLoaded = document.getElementById('file-loaded');
    const fileNameLabel = document.getElementById('file-name-label');
    const filePagesLabel = document.getElementById('file-pages-label');
    const dropZone = document.getElementById('drop-zone');
    const emptyState = document.getElementById('empty-state');

    if (fileLoaded) fileLoaded.classList.remove('hidden');
    if (fileNameLabel) fileNameLabel.textContent = Store.pdfName || '—';
    if (filePagesLabel) filePagesLabel.textContent = `${Store.pageCount || 0} pages`;
    if (dropZone) dropZone.classList.add('hidden');
    if (emptyState) emptyState.classList.add('hidden');

    if (typeof Canvas !== 'undefined' && Canvas.showEmpty) {
      Canvas.showEmpty(false);
    }

    if (Store.pageCount > 0 && typeof Canvas !== 'undefined' && Canvas.loadPage) {
      await Canvas.loadPage(1);
    }

    if (typeof Sidebar !== 'undefined' && Sidebar.refreshStats) {
      await Sidebar.refreshStats();
    }

    if (typeof Sidebar !== 'undefined' && Sidebar.refreshUnmappedQueue) {
      await Sidebar.refreshUnmappedQueue();
    }

    await _restoreEditorStateIfAny();

    showToast('Session loaded: ' + (res.pdf_name || Store.sessionId), 'success');

  } catch (e) {
    console.error('[app] open session error:', e);
    showToast('Open failed: ' + e, 'error');
  }
}

function _collectEditorState() {
  const state = {
    objects: Store.editorObjects || [],
    datasetChips: Store.datasetChips || [],
    undoStack: Store.undoStack || [],
    redoStack: Store.redoStack || [],
  };
  return state;
}