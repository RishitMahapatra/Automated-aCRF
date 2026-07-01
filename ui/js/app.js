/**
 * ui/js/app.js
 * ------------
 * Main frontend bootstrap for the PyWebView CRF Annotation Editor.
 */
const SIDEBAR_MIN_WIDTH = 84;
const SIDEBAR_MAX_WIDTH = 520;

// ── Dirty / unsaved-changes indicator ──────────────────────────
let _dirty = false;

function _markDirty() {
  _dirty = true;
  document.getElementById('dirty-dot')?.classList.remove('hidden');
  // Mirror to Python so the closing event handler can read it without evaluate_js
  window.pywebview?.api?.set_dirty?.(true);
}

function _clearDirty() {
  _dirty = false;
  document.getElementById('dirty-dot')?.classList.add('hidden');
  window.pywebview?.api?.set_dirty?.(false);
}

window._markSessionDirty  = _markDirty;
window._clearSessionDirty = _clearDirty;
window._isSessionDirty    = () => _dirty;

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
    _bindHelpMenu();
    _bindFileShortcuts();
    _bindSettingsButton();

    // Intercept EditorState.scheduleAutosave so any drag/resize marks the session dirty
    if (typeof EditorState !== 'undefined' && EditorState.scheduleAutosave) {
      const _origSchedule = EditorState.scheduleAutosave;
      EditorState.scheduleAutosave = function(...args) {
        _markDirty();
        return _origSchedule.apply(this, args);
      };
    }

    // Expose save entry-point for sidebar (restart save dialog)
    window._doAcrfSave = _doSaveSession;

    _bindCloseConfirmDialog();

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

async function _captureAllPagesForExport(includeTables) {
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

      await _sleep(300);

      if (!includeTables) {
        const records = Store.annotations || [];
        const firstRec = records[0] || {};
        if ((firstRec.page_type || 'FORM').toUpperCase() === 'TABLE') continue;
      }

      const img = await _captureCurrentRenderedPage();

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

  const dialog   = document.getElementById('export-options-dialog');
  const chk      = document.getElementById('export-include-tables');
  const btnOk    = document.getElementById('export-options-confirm');
  const btnCancel = document.getElementById('export-options-cancel');
  const btnClose = document.getElementById('export-options-close');

  function openDialog() {
    if (!Store.pipelineRan) {
      showToast('Run the pipeline first.', 'warning'); return;
    }
    if (chk) chk.checked = false;
    dialog?.classList.remove('hidden');
  }

  function closeDialog() {
    dialog?.classList.add('hidden');
  }

  async function doExport(includeTables) {
    closeDialog();
    try {
      btn.disabled = true;
      btn.textContent = 'Exporting...';

      const pageData = await _captureAllPagesForExport(includeTables);
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
  }

  btn.addEventListener('click', openDialog);
  btnOk?.addEventListener('click', () => doExport(chk?.checked || false));
  btnCancel?.addEventListener('click', closeDialog);
  btnClose?.addEventListener('click', closeDialog);
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

    // Repopulate canvas geometry overrides and user-created annotations
    // so that dragged/resized boxes appear at the correct positions
    if (typeof Canvas !== 'undefined' && Canvas.restoreSessionGeometry) {
      Canvas.restoreSessionGeometry(saved.objects);
    }

    const chips = saved.objects
      .filter(o => o && o.object_type === 'dataset_chip' && o.visible !== false && o.removed !== true)
      .map(o => ({
        chip_id: o.object_id,
        page: o.page,
        dataset: o?.data?.dataset || '',
        full_name: o?.data?.full_name || '',
        display_text: o.display_text || '',
        rect_pts: o.rect_pts || null,
        _ui_left: o._ui_left || '',
        _ui_top: o._ui_top || '',
        _ui_width: o._ui_width || '',
        _ui_height: o._ui_height || '',
        fill_rgb: o?.style?.fill_rgb || [191, 224, 255],
        visible: true,
        removed: false,
        source: o.source || 'AUTO',
      }));

    if (chips.length) {
      Store.setDatasetChips(chips);
    }

    if (saved.datasetReviews && Array.isArray(saved.datasetReviews) && saved.datasetReviews.length) {
      if (typeof Sidebar !== 'undefined' && Sidebar.setDatasetReviews) {
        Sidebar.setDatasetReviews(saved.datasetReviews);
      }
    }

    if (saved.reviewQueue && Array.isArray(saved.reviewQueue) && saved.reviewQueue.length) {
      if (typeof Sidebar !== 'undefined' && Sidebar.setReviewQueue) {
        Sidebar.setReviewQueue(saved.reviewQueue);
      }
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
    _closeHelpMenu();
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

// ==========================================================================
// HELP MENU
// ==========================================================================

function _bindHelpMenu() {
  const trigger = document.getElementById('help-menu-trigger');
  const dropdown = document.getElementById('help-menu-dropdown');
  if (!trigger || !dropdown) return;

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    _closeFileMenu();
    const isOpen = !dropdown.classList.contains('hidden');
    if (isOpen) {
      _closeHelpMenu();
    } else {
      dropdown.classList.remove('hidden');
      trigger.classList.add('open');
    }
  });

  document.addEventListener('click', (e) => {
    if (!dropdown.classList.contains('hidden')) {
      const wrap = document.getElementById('help-menu-wrap');
      if (wrap && !wrap.contains(e.target)) {
        _closeHelpMenu();
      }
    }
  });

  const links = {
    'hm-docs':          'https://rishitmahapatra.github.io/Automated-aCRF/',
    'hm-user-manual':   'https://github.com/RishitMahapatra/Automated-aCRF/blob/main/USER_MANUAL.md',
    'hm-install-guide': 'https://github.com/RishitMahapatra/Automated-aCRF/blob/main/INSTALLATION_GUIDE.md',
    'hm-codebase':      'https://github.com/RishitMahapatra/Automated-aCRF',
  };

  for (const [id, url] of Object.entries(links)) {
    document.getElementById(id)?.addEventListener('click', () => {
      _closeHelpMenu();
      if (window.pywebview && window.pywebview.api && window.pywebview.api.open_url) {
        window.pywebview.api.open_url(url);
      } else {
        window.open(url, '_blank');
      }
    });
  }
}

function _closeHelpMenu() {
  const dropdown = document.getElementById('help-menu-dropdown');
  const trigger = document.getElementById('help-menu-trigger');
  if (dropdown) dropdown.classList.add('hidden');
  if (trigger) trigger.classList.remove('open');
}

// ==========================================================================
// SETTINGS BUTTON
// ==========================================================================

function _bindSettingsButton() {
  document.getElementById('btn-settings')?.addEventListener('click', () => {
    if (typeof Settings !== 'undefined' && Settings.show) {
      Settings.init();
      Settings.show();
    }
  });
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

function _bindCloseConfirmDialog() {
  const overlay = document.getElementById('close-confirm-overlay');
  if (!overlay) return;

  document.getElementById('close-save-yes')?.addEventListener('click', async () => {
    // If there's no session to save, just close (nothing to lose)
    if (!Store.pdfLoaded || !Store.sessionId) {
      overlay.classList.add('hidden');
      _clearDirty();
      await window.pywebview?.api?.confirm_close?.();
      return;
    }
    overlay.classList.add('hidden');
    const saved = await _doSaveSession();
    if (saved === false) {
      // User cancelled the file picker — re-show so they can choose Discard or try again
      overlay.classList.remove('hidden');
      return;
    }
    _clearDirty();
    await window.pywebview?.api?.confirm_close?.();
  });

  document.getElementById('close-save-skip')?.addEventListener('click', async () => {
    overlay.classList.add('hidden');
    _clearDirty();
    await window.pywebview?.api?.confirm_close?.();
  });

  document.getElementById('close-save-cancel')?.addEventListener('click', () => {
    overlay.classList.add('hidden');
  });
}

window._showCloseDialog = function() {
  const overlay = document.getElementById('close-confirm-overlay');
  if (overlay) {
    overlay.classList.remove('hidden');
  } else {
    // Fallback: no custom dialog — ask natively and close if confirmed
    if (window.confirm('You have unsaved changes. Close without saving?')) {
      _clearDirty();
      window.pywebview?.api?.confirm_close?.();
    }
  }
};

async function _doSaveSession() {
  if (!Store.pdfLoaded || !Store.sessionId) {
    showToast('No active session to save.', 'warning');
    return false;
  }

  try {
    // Flush the full editor state snapshot to disk first
    if (typeof EditorState !== 'undefined' && EditorState.saveNow) {
      await EditorState.saveNow();
    }

    const editorState = await _collectEditorState();
    const frontendAnnotations = _collectAllFrontendAnnotations();

    const res = await window.pywebview.api.save_session_file(editorState, frontendAnnotations);

    if (res && res.ok) {
      _clearDirty();
      showToast('Session saved: ' + (res.path || '').split(/[\\/]/).pop(), 'success');
      return true;
    } else if (res && res.error === 'Save cancelled') {
      return false;
    } else {
      showToast('Save failed: ' + (res?.error || 'Unknown error'), 'error');
      return false;
    }
  } catch (e) {
    console.error('[app] save session error:', e);
    showToast('Save failed: ' + e, 'error');
    return false;
  }
}

async function _doSaveSessionAs() {
  if (!Store.pdfLoaded || !Store.sessionId) {
    showToast('No active session to save.', 'warning');
    return false;
  }

  try {
    // Flush the full editor state snapshot to disk first
    if (typeof EditorState !== 'undefined' && EditorState.saveNow) {
      await EditorState.saveNow();
    }

    const editorState = await _collectEditorState();
    const frontendAnnotations = _collectAllFrontendAnnotations();

    const res = await window.pywebview.api.save_session_file_as(editorState, frontendAnnotations);

    if (res && res.ok) {
      _clearDirty();
      showToast('Session saved: ' + (res.path || '').split(/[\\/]/).pop(), 'success');
      return true;
    } else if (res && res.error === 'Save cancelled') {
      return false;
    } else {
      showToast('Save failed: ' + (res?.error || 'Unknown error'), 'error');
      return false;
    }
  } catch (e) {
    console.error('[app] save-as error:', e);
    showToast('Save failed: ' + e, 'error');
    return false;
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
    Store.pipelineRan = true;

    // Update navbar
    const navSession = document.getElementById('nav-session');
    if (navSession) navSession.textContent = Store.sessionId;

    const sessionInput = document.getElementById('session-input');
    if (sessionInput) sessionInput.value = Store.sessionId;

    // Update file-loaded area
    const fileLoaded = document.getElementById('file-loaded');
    const fileNameLabel = document.getElementById('file-name-label');
    const filePagesLabel = document.getElementById('file-pages-label');
    const dropZone = document.getElementById('drop-zone');
    const emptyState = document.getElementById('empty-state');
    const pdfContainer = document.getElementById('pdf-container');

    if (fileLoaded) fileLoaded.classList.remove('hidden');
    if (fileNameLabel) fileNameLabel.textContent = Store.pdfName || '—';
    if (filePagesLabel) filePagesLabel.textContent = `${Store.pageCount || 0} pages`;
    if (dropZone) dropZone.classList.add('hidden');
    if (emptyState) emptyState.classList.add('hidden');
    if (pdfContainer) pdfContainer.classList.remove('hidden');

    if (typeof Canvas !== 'undefined' && Canvas.showEmpty) {
      Canvas.showEmpty(false);
    }

    // Restore editor state (dataset chips, annotation objects)
    await _restoreEditorStateIfAny();

    // Load the first page with annotations
    if (Store.pageCount > 0 && typeof Canvas !== 'undefined' && Canvas.loadPage) {
      await Canvas.loadPage(1);
    }

    // Refresh all sidebar data
    if (typeof Sidebar !== 'undefined' && Sidebar.refreshStats) {
      await Sidebar.refreshStats();
    }

    if (typeof Sidebar !== 'undefined' && Sidebar.refreshUnmappedQueue) {
      await Sidebar.refreshUnmappedQueue();
    }

    _clearDirty();
    showToast('Session loaded: ' + (res.pdf_name || Store.sessionId), 'success');

  } catch (e) {
    console.error('[app] open session error:', e);
    showToast('Open failed: ' + e, 'error');
  }
}

async function _collectEditorState() {
  // Build the full snapshot via EditorState (merges backend + frontend annotations)
  if (typeof EditorState !== 'undefined' && EditorState.buildSnapshot) {
    try {
      return await EditorState.buildSnapshot();
    } catch (e) {
      console.warn('[app] buildSnapshot failed, falling back:', e);
    }
  }

  return {
    session_id: Store.sessionId,
    pdf_name: Store.pdfName,
    objects: Store.editorObjects || [],
    datasetChips: Store.datasetChips || [],
  };
}

function _collectAllFrontendAnnotations() {
  // Gather every annotation the frontend knows about — including user-created
  // ones that only live in Canvas.userCreatedAnnotations and never reached the backend
  const all = [];
  const seen = new Set();

  // Current page annotations from Store
  (Store.annotations || []).forEach(rec => {
    if (!rec || !rec.annotation_id) return;
    if (seen.has(rec.annotation_id)) return;
    seen.add(rec.annotation_id);
    all.push(rec);
  });

  // All user-created annotations across every page (Canvas has the authoritative list)
  if (typeof Canvas !== 'undefined' && Canvas.getAllUserAnnotations) {
    Canvas.getAllUserAnnotations().forEach(rec => {
      if (!rec || !rec.annotation_id) return;
      if (seen.has(rec.annotation_id)) return;
      seen.add(rec.annotation_id);
      all.push(rec);
    });
  }

  // Also gather from Store.editorObjects (user-drawn annotations stored as objects)
  (Store.editorObjects || []).forEach(obj => {
    if (!obj || !obj.object_id) return;
    if (obj.object_type !== 'annotation') return;
    if (obj.removed || obj.visible === false) return;
    if (seen.has(obj.object_id)) return;
    seen.add(obj.object_id);

    const data = obj.data || {};
    all.push({
      annotation_id: obj.object_id,
      page: obj.page || 1,
      status: data.status || 'UNMAPPED',
      form_code: data.form_code || '',
      raw_variable: data.raw_variable || '',
      raw_label: data.raw_label || '',
      sdtm_dataset: data.sdtm_dataset || '',
      sdtm_variable: data.sdtm_variable || '',
      sdtm_label: data.sdtm_label || '',
      component: data.raw_label || '',
      x0_pts: obj.rect_pts?.x0,
      y0_pts: obj.rect_pts?.y0,
      x1_pts: obj.rect_pts?.x1,
      y1_pts: obj.rect_pts?.y1,
      source: obj.source || 'USER',
    });
  });

  // Dataset chips as pseudo-annotations for persistence
  (Store.datasetChips || []).forEach(chip => {
    if (!chip || !chip.chip_id) return;
    if (chip.removed || chip.visible === false) return;
    if (seen.has(chip.chip_id)) return;
    seen.add(chip.chip_id);

    all.push({
      annotation_id: chip.chip_id,
      page: chip.page || 1,
      page_type: 'DATASET_CHIP',
      status: 'RESOLVED',
      sdtm_dataset: chip.dataset || '',
      sdtm_variable: '',
      sdtm_label: chip.full_name || '',
      component: chip.display_text || '',
      x0_pts: chip.rect_pts?.x0,
      y0_pts: chip.rect_pts?.y0,
      x1_pts: chip.rect_pts?.x1,
      y1_pts: chip.rect_pts?.y1,
      source: chip.source || 'AUTO',
      fill_rgb: chip.fill_rgb || null,
    });
  });

  return all;
}