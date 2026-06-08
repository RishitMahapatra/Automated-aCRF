// ui/js/sidebar.js

const Sidebar = (() => {
  'use strict';

  let pipelineRunning = false;

  function init() {
    console.log('[sidebar] init');
    _bindUpload();
    _bindPipeline();
    _bindNavigation();
    _bindKeyboardNavigation();
    _bindClearFile();
    _bindRestartSession();
  }

  // ===========================================================================
  // UPLOAD
  // ===========================================================================

  function _bindUpload() {
    const dropZone = document.getElementById('drop-zone');
    if (!dropZone) return;

    dropZone.addEventListener('click', async () => {
      try {
        if (pipelineRunning) {
          return;
        }

        const result = await window.pywebview.api.select_pdf();
        if (!result || !result.ok) {
          return;
        }

        Store.sessionId = result.session_id || result.filename.replace('.pdf', '').replace(/\s+/g, '_');
        // Clear old session/page visuals before loading the new file state
        const pdfImg = document.getElementById('pdf-img');
        const annotationLayer = document.getElementById('annotation-layer');
        const tableBanner = document.getElementById('table-banner');

        if (pdfImg) {
          pdfImg.removeAttribute('src');
          pdfImg.src = '';
        }

        if (annotationLayer) {
          annotationLayer.innerHTML = '';
        }

        if (tableBanner) {
          tableBanner.classList.add('hidden');
        }

        if (typeof EditPanel !== 'undefined' && EditPanel.close) {
          EditPanel.close();
        }
        Store.pdfLoaded = true;
        Store.pdfName = result.filename;
        Store.currentPage = 1;

        _showFileLoaded(result.filename);
        _setSessionInput(Store.sessionId);
        _setNavSession(Store.sessionId);

        const pageRes = await window.pywebview.api.get_page_count();
        if (pageRes && pageRes.ok) {
          Store.pageCount = pageRes.count || 0;
          _setFilePages(Store.pageCount);
          _updatePageDisplay();
          _updateNavPageCount();
        }

        if (typeof Canvas !== 'undefined' && Canvas.showEmpty) {
          Canvas.showEmpty(false);
        }

      } catch (e) {
        console.error('[sidebar] select_pdf error:', e);
      }
    });
  }

  function _bindClearFile() {
    const btnClearFile = document.getElementById('btn-clear-file');
    if (!btnClearFile) return;

    btnClearFile.addEventListener('click', async (e) => {
      e.stopPropagation();

      if (pipelineRunning) {
        return;
      }

      _resetUiToInitialState();
    });
  }
  function _bindRestartSession() {
    const btnRestart = document.getElementById('btn-restart-session');
    if (!btnRestart) return;

    btnRestart.addEventListener('click', async () => {
      try {
        if (pipelineRunning) {
          return;
        }

        const res = await window.pywebview.api.restart_session();
        if (!res || !res.ok) {
          console.error('[sidebar] restart_session failed:', res?.error);
          return;
        }

        Store.resetSession();

        const dropZone = document.getElementById('drop-zone');
        const fileLoaded = document.getElementById('file-loaded');
        const sessionInput = document.getElementById('session-input');
        const navSession = document.getElementById('nav-session');
        const fileNameLabel = document.getElementById('file-name-label');
        const filePagesLabel = document.getElementById('file-pages-label');
        const pageDisplay = document.getElementById('page-display');
        const pageDisplaySticky = document.getElementById('page-display-sticky');
        const navPageCount = document.getElementById('nav-page-count');

        if (dropZone) dropZone.classList.remove('hidden');
        if (fileLoaded) fileLoaded.classList.add('hidden');
        if (sessionInput) sessionInput.value = '';
        if (navSession) navSession.textContent = 'No session';
        if (fileNameLabel) fileNameLabel.textContent = '—';
        if (filePagesLabel) filePagesLabel.textContent = '— pages';
        if (pageDisplay) pageDisplay.textContent = '— / —';
        if (pageDisplaySticky) pageDisplaySticky.textContent = '— / —';
        if (navPageCount) navPageCount.textContent = '— / —';

        _resetPipelineSteps();
        _resetStatsDisplay();

        if (typeof Canvas !== 'undefined' && Canvas.showEmpty) {
          Canvas.showEmpty(true);
        }

        if (typeof EditPanel !== 'undefined' && EditPanel.close) {
          EditPanel.close();
        }

      } catch (e) {
        console.error('[sidebar] restart_session error:', e);
      }
    });
  }

  function _resetUiToInitialState() {
    Store.resetSession();

    const dropZone = document.getElementById('drop-zone');
    const fileLoaded = document.getElementById('file-loaded');
    const sessionInput = document.getElementById('session-input');
    const navSession = document.getElementById('nav-session');
    const fileNameLabel = document.getElementById('file-name-label');
    const filePagesLabel = document.getElementById('file-pages-label');
    const pageDisplay = document.getElementById('page-display');
    const pageDisplaySticky = document.getElementById('page-display-sticky');
    const navPageCount = document.getElementById('nav-page-count');
    const toolbarFormCode = document.getElementById('toolbar-form-code');
    const toolbarDpi = document.getElementById('toolbar-dpi');
    const toolbarZoom = document.getElementById('toolbar-zoom');
    const navPageType = document.getElementById('nav-page-type');
    const pdfImg = document.getElementById('pdf-img');
    const annotationLayer = document.getElementById('annotation-layer');
    const tableBanner = document.getElementById('table-banner');

    if (dropZone) dropZone.classList.remove('hidden');
    if (fileLoaded) fileLoaded.classList.add('hidden');

    if (sessionInput) sessionInput.value = '';
    if (navSession) navSession.textContent = 'No session';

    if (fileNameLabel) fileNameLabel.textContent = '—';
    if (filePagesLabel) filePagesLabel.textContent = '— pages';

    if (pageDisplay) pageDisplay.textContent = '— / —';
    if (pageDisplaySticky) pageDisplaySticky.textContent = '— / —';
    if (navPageCount) navPageCount.textContent = '— / —';

    if (toolbarFormCode) toolbarFormCode.textContent = '—';
    if (toolbarDpi) toolbarDpi.textContent = '150 DPI';
    if (toolbarZoom) toolbarZoom.textContent = '100%';

    if (navPageType) {
      navPageType.textContent = 'FORM';
      navPageType.classList.remove('badge-table');
      navPageType.classList.add('badge-form');
    }

    if (pdfImg) {
      pdfImg.removeAttribute('src');
      pdfImg.src = '';
    }

    if (annotationLayer) {
      annotationLayer.innerHTML = '';
    }

    if (tableBanner) {
      tableBanner.classList.add('hidden');
    }

    _resetPipelineSteps();
    _resetStatsDisplay();

    if (typeof Canvas !== 'undefined' && Canvas.showEmpty) {
      Canvas.showEmpty(true);
    }

    if (typeof EditPanel !== 'undefined' && EditPanel.close) {
      EditPanel.close();
    }
  }

  function _showFileLoaded(filename) {
    const fileLoaded = document.getElementById('file-loaded');
    const fileNameLabel = document.getElementById('file-name-label');

    if (fileLoaded) {
      fileLoaded.classList.remove('hidden');
    }
    if (fileNameLabel) {
      fileNameLabel.textContent = filename || '—';
    }

    const dropZone = document.getElementById('drop-zone');
    if (dropZone) {
      dropZone.classList.add('hidden');
    }
  }

  function _setSessionInput(sessionId) {
    const sessionInput = document.getElementById('session-input');
    if (sessionInput) {
      sessionInput.value = sessionId || '';
    }
  }

  function _setNavSession(sessionId) {
    const navSession = document.getElementById('nav-session');
    if (navSession) {
      navSession.textContent = sessionId || 'No session';
    }
  }

  function _setFilePages(count) {
    const filePagesLabel = document.getElementById('file-pages-label');
    if (filePagesLabel) {
      filePagesLabel.textContent = `${count || 0} pages`;
    }
  }

  // ===========================================================================
  // PIPELINE
  // ===========================================================================

  function _bindPipeline() {
    const btnRun = document.getElementById('btn-run');
    if (!btnRun) return;

    btnRun.addEventListener('click', async () => {
      try {
        if (pipelineRunning) {
          return;
        }

        if (!Store.pdfLoaded) {
          alert('Upload a PDF first.');
          return;
        }

        const sessionInput = document.getElementById('session-input');
        const sessionId = (sessionInput?.value || Store.sessionId || '').trim();

        if (!sessionId) {
          alert('Enter a session ID.');
          return;
        }

        Store.sessionId = sessionId;
        await window.pywebview.api.set_session_id(sessionId);

        pipelineRunning = true;
        _setPipelineControlsLocked(true);

        _resetPipelineSteps();
        _setPipelineStepRunning(0);

        btnRun.disabled = true;
        btnRun.innerHTML = '<span class="btn-icon">⏳</span> Running...';

        const result = await window.pywebview.api.run_pipeline();

        _setPipelineStepDone(0);
        _setPipelineStepRunning(1);
        _setPipelineStepDone(1);
        _setPipelineStepRunning(2);

        if (!result || !result.ok) {
          _setPipelineStepError(2);
          alert('Pipeline failed: ' + (result?.error || 'Unknown error'));
          return;
        }

        _setPipelineStepDone(2);

        const pageRes = await window.pywebview.api.get_page_count();
        if (pageRes && pageRes.ok) {
          Store.pageCount = pageRes.count || 0;
        }

        Store.currentPage = 1;
        Store.pipelineRan = true;

        _updatePageDisplay();
        _updateNavPageCount();

        await refreshStats();

        if (typeof Canvas !== 'undefined' && Canvas.loadPage) {
          await Canvas.loadPage(Store.currentPage);
        }

      } catch (e) {
        console.error('[sidebar] run_pipeline error:', e);
        alert('Pipeline failed: ' + e);
      } finally {
        pipelineRunning = false;
        _setPipelineControlsLocked(false);

        btnRun.disabled = false;
        btnRun.innerHTML = '<span class="btn-icon">▶</span> Run Pipeline';
      }
    });
  }

  function _setPipelineControlsLocked(locked) {
    const btnClearFile = document.getElementById('btn-clear-file');
    const dropZone = document.getElementById('drop-zone');
    const sessionInput = document.getElementById('session-input');

    if (btnClearFile) {
      btnClearFile.disabled = !!locked;
      btnClearFile.style.opacity = locked ? '0.45' : '';
      btnClearFile.style.pointerEvents = locked ? 'none' : '';
    }

    if (dropZone) {
      dropZone.style.pointerEvents = locked ? 'none' : '';
      dropZone.style.opacity = locked ? '0.65' : '';
    }

    if (sessionInput) {
      sessionInput.disabled = !!locked;
    }
  }

  function _resetPipelineSteps() {
    for (let i = 0; i < 3; i++) {
      const dot = document.getElementById(`step-dot-${i}`);
      const line = document.getElementById(`step-line-${i}`);
      const status = document.getElementById(`step-status-${i}`);

      if (dot) dot.className = 'step-dot';
      if (line) line.className = 'step-line';
      if (status) {
        status.textContent = 'Waiting';
        status.className = 'step-status';
      }
    }
  }

  function _setPipelineStepRunning(idx) {
    const dot = document.getElementById(`step-dot-${idx}`);
    const status = document.getElementById(`step-status-${idx}`);

    if (dot) dot.classList.add('active');
    if (status) {
      status.textContent = 'Running';
      status.className = 'step-status running';
    }
  }

  function _setPipelineStepDone(idx) {
    const dot = document.getElementById(`step-dot-${idx}`);
    const line = document.getElementById(`step-line-${idx}`);
    const status = document.getElementById(`step-status-${idx}`);

    if (dot) {
      dot.classList.remove('active');
      dot.classList.add('done');
    }
    if (line) {
      line.classList.add('done');
    }
    if (status) {
      status.textContent = 'Done';
      status.className = 'step-status done';
    }
  }

  function _setPipelineStepError(idx) {
    const status = document.getElementById(`step-status-${idx}`);
    const dot = document.getElementById(`step-dot-${idx}`);

    if (dot) {
      dot.classList.remove('active');
    }
    if (status) {
      status.textContent = 'Error';
      status.className = 'step-status';
    }
  }

  // ===========================================================================
  // NAVIGATION
  // ===========================================================================

  function _bindNavigation() {
    const btnPrev = document.getElementById('btn-prev');
    const btnNext = document.getElementById('btn-next');
    const btnPrevSticky = document.getElementById('btn-prev-sticky');
    const btnNextSticky = document.getElementById('btn-next-sticky');
    const gotoInput = document.getElementById('goto-input');

    if (btnPrev) {
      btnPrev.addEventListener('click', async () => {
        await goPrev();
      });
    }

    if (btnNext) {
      btnNext.addEventListener('click', async () => {
        await goNext();
      });
    }
    if (btnPrevSticky) {
      btnPrevSticky.addEventListener('click', async () => {
        await goPrev();
      });
    }

    if (btnNextSticky) {
      btnNextSticky.addEventListener('click', async () => {
        await goNext();
      });
    }
    if (gotoInput) {
      gotoInput.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter') return;

        const page = parseInt(gotoInput.value, 10);
        if (!page || page < 1 || page > Store.pageCount) return;

        Store.currentPage = page;
        _updatePageDisplay();
        _updateNavPageCount();

        if (typeof Canvas !== 'undefined' && Canvas.loadPage) {
          await Canvas.loadPage(Store.currentPage);
        }
      });
    }
  }

  function _bindKeyboardNavigation() {
    document.addEventListener('keydown', async (e) => {
      if (!Store.pipelineRan) return;

      const tag = (e.target?.tagName || '').toLowerCase();
      const isTypingTarget =
        tag === 'input' ||
        tag === 'textarea' ||
        e.target?.isContentEditable;

      if (isTypingTarget) return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        await goPrev();
      }

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        await goNext();
      }
    });
  }

  async function goPrev() {
    if (!Store.pipelineRan) return;
    if (Store.currentPage <= 1) return;

    Store.currentPage -= 1;
    _updatePageDisplay();
    _updateNavPageCount();

    if (typeof Canvas !== 'undefined' && Canvas.loadPage) {
      await Canvas.loadPage(Store.currentPage);
    }
  }

  async function goNext() {
    if (!Store.pipelineRan) return;
    if (Store.currentPage >= Store.pageCount) return;

    Store.currentPage += 1;
    _updatePageDisplay();
    _updateNavPageCount();

    if (typeof Canvas !== 'undefined' && Canvas.loadPage) {
      await Canvas.loadPage(Store.currentPage);
    }
  }

  function _updatePageDisplay() {
    const pageDisplay = document.getElementById('page-display');
    const pageDisplaySticky = document.getElementById('page-display-sticky');

    const current = Store.pageCount ? Store.currentPage : '—';
    const total = Store.pageCount || '—';
    const text = `${current} / ${total}`;

    if (pageDisplay) {
      pageDisplay.textContent = text;
    }

    if (pageDisplaySticky) {
      pageDisplaySticky.textContent = text;
    }
  }

  function _updateNavPageCount() {
    const navPageCount = document.getElementById('nav-page-count');
    if (navPageCount) {
      const current = Store.pageCount ? Store.currentPage : '—';
      const total = Store.pageCount || '—';
      navPageCount.textContent = `${current} / ${total}`;
    }
  }

  // ===========================================================================
  // STATS
  // ===========================================================================

  async function refreshStats() {
    try {
      const stats = await window.pywebview.api.get_stats();
      if (!stats || !stats.ok) return;

      Store.stats = {
        total: stats.total || 0,
        resolved: stats.resolved || 0,
        user_corrected: stats.user_corrected || 0,
        unmapped: stats.unmapped || 0,
        not_submitted: stats.not_submitted || 0,
        removed: stats.removed || 0,
        resolution_pct: stats.resolution_pct || 0,
      };

      _setText('stat-resolved', Store.stats.resolved);
      _setText('stat-unmapped', Store.stats.unmapped);
      _setText('stat-corrected', Store.stats.user_corrected);
      _setText('stat-removed', Store.stats.removed);
      _updateRing(Store.stats.resolution_pct);

    } catch (e) {
      console.error('[sidebar] refreshStats error:', e);
    }
  }

  function _resetStatsDisplay() {
    _setText('stat-resolved', 0);
    _setText('stat-unmapped', 0);
    _setText('stat-corrected', 0);
    _setText('stat-removed', 0);
    _updateRing(0);
  }

  function _setText(id, val) {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = val ?? 0;
    }
  }

  function _updateRing(pct) {
    const fill = document.getElementById('ring-fill');
    const label = document.getElementById('ring-pct');

    if (fill) {
      const radius = 28;
      const circumference = 2 * Math.PI * radius;
      const offset = circumference * (1 - (pct || 0) / 100);
      fill.style.strokeDasharray = `${circumference}`;
      fill.style.strokeDashoffset = `${offset}`;
    }

    if (label) {
      label.textContent = `${Math.round(pct || 0)}%`;
    }
  }

  return {
    init,
    refreshStats,
    goPrev,
    goNext,
    isPipelineRunning: () => pipelineRunning,
  };
})();