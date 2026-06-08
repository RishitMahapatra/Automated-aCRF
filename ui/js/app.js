/**
 * ui/js/app.js
 * ------------
 * Main frontend bootstrap for the PyWebView CRF Annotation Editor.
 */

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
    _bindExportButton();
    await _restoreStateIfAny();

    console.log('[app] Ready.');
  } catch (e) {
    console.error('[app] Initialization failed:', e);
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

      const res = await window.pywebview.api.export_pdf();
      if (res && res.ok) {
        alert('PDF exported successfully:\n' + res.path);
      } else {
        alert('Export failed: ' + (res?.error || 'Unknown error'));
      }
    } catch (e) {
      console.error('[app] export error:', e);
      alert('Export failed: ' + e);
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