// ui/js/sidebar.js

const Sidebar = (() => {
  'use strict';

  let pipelineRunning = false;
  let _queueCtxRec = null;
  let _currentCommentRec = null;
  let _commentCalloutVisible = false;
  let _datasetReviews = [];
  let _reviewNotSubmittedSet = new Set(); // NOT_SUBMITTED annotation IDs shown in active review queue
  let _queueDismissedSet = new Set();     // NEEDS_REVIEW IDs explicitly removed from queue view

  const DOMAIN_BADGE_COLORS = {
    DM:'#3B6FD4', CM:'#2E9E5B', AE:'#D4522E', LB:'#7B42CC',
    VS:'#CC4275', EX:'#CC8A2E', MH:'#2E9E9E', DS:'#8E9E2E',
    PE:'#9E2ECC', EG:'#2ECCAA', QS:'#CC9E2E', SC:'#2EAACC',
  };

  let _progressInterval = null;

  function init() {
    console.log('[sidebar] init');
    _bindTabs();
    _bindUpload();
    _bindPipeline();
    _bindNavigation();
    _bindKeyboardNavigation();
    _bindClearFile();
    _bindRestartSession();
    _bindAnalysisQueueFilters();
    _bindAnalysisQueueSearch();
    _bindQueueInnerTabs();
    _bindQueueContextMenu();
    _bindCommentViewer();
    _bindCommentDialog();
  }

  // ==========================================================
  // TABS
  // ==========================================================

  function _bindTabs() {
    const tabs = Array.from(document.querySelectorAll('.sidebar-tab'));
    if (!tabs.length) return;

    const panels = {
      workspace: document.getElementById('sidebar-panel-workspace'),
      stats: document.getElementById('sidebar-panel-stats'),
      analysis: document.getElementById('sidebar-panel-analysis'),
    };

    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const key = tab.dataset.tab;

        tabs.forEach((t) => t.classList.remove('active'));
        Object.values(panels).forEach((p) => p && p.classList.remove('active'));

        tab.classList.add('active');
        if (panels[key]) {
          panels[key].classList.add('active');
        }
      });
    });
  }

  // ==========================================================
  // UPLOAD
  // ==========================================================

  function _bindUpload() {
    const dropZone = document.getElementById('drop-zone');
    if (!dropZone) return;

    dropZone.addEventListener('click', async () => {
      try {
        if (pipelineRunning) return;

        const result = await window.pywebview.api.select_pdf();
        if (!result || !result.ok) return;

        Store.sessionId =
          result.session_id ||
          result.filename.replace('.pdf', '').replace(/\s+/g, '_');

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
          _renderPageButtons();
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
      if (pipelineRunning) return;
      _resetUiToInitialState();
    });
  }

  function _bindRestartSession() {
    const btnRestart = document.getElementById('btn-restart-session');
    if (!btnRestart) return;

    btnRestart.addEventListener('click', () => {
      if (pipelineRunning) return;
      if (!Store.pdfLoaded) {
        const noPdfOverlay = document.getElementById('restart-nopdf-overlay');
        if (noPdfOverlay) noPdfOverlay.classList.remove('hidden');
        return;
      }
      const confirmOverlay = document.getElementById('restart-confirm-overlay');
      if (confirmOverlay) confirmOverlay.classList.remove('hidden');
    });

    document.getElementById('restart-nopdf-ok')?.addEventListener('click', () => {
      document.getElementById('restart-nopdf-overlay')?.classList.add('hidden');
    });

    document.getElementById('restart-confirm-cancel')?.addEventListener('click', () => {
      document.getElementById('restart-confirm-overlay')?.classList.add('hidden');
    });

    document.getElementById('restart-confirm-yes')?.addEventListener('click', () => {
      document.getElementById('restart-confirm-overlay')?.classList.add('hidden');
      if (typeof window._isSessionDirty === 'function' && window._isSessionDirty()) {
        const saveOverlay = document.getElementById('restart-save-overlay');
        if (saveOverlay) saveOverlay.classList.remove('hidden');
      } else {
        _doRestartSession();
      }
    });

    document.getElementById('restart-save-cancel')?.addEventListener('click', () => {
      document.getElementById('restart-save-overlay')?.classList.add('hidden');
    });

    document.getElementById('restart-save-skip')?.addEventListener('click', async () => {
      document.getElementById('restart-save-overlay')?.classList.add('hidden');
      await _doRestartSession();
    });

    document.getElementById('restart-save-yes')?.addEventListener('click', async () => {
      document.getElementById('restart-save-overlay')?.classList.add('hidden');
      try {
        const saved = await window._doAcrfSave?.();
        if (saved === false) return; // user cancelled save dialog — abort restart
      } catch (e) {
        console.error('[sidebar] save before restart failed:', e);
        return; // abort restart on error
      }
      await _doRestartSession();
    });
  }

  function _setRestartButtonState() {
    const btn = document.getElementById('btn-restart-session');
    if (!btn) return;
    const shouldDisable = pipelineRunning;
    btn.disabled = shouldDisable;
    btn.style.opacity = shouldDisable ? '0.45' : '';
    btn.style.pointerEvents = shouldDisable ? 'none' : '';
  }

  async function _doRestartSession() {
    try {
      const res = await window.pywebview.api.restart_session();
      if (!res || !res.ok) {
        console.error('[sidebar] restart_session failed:', res?.error);
        return;
      }

      Store.resetSession();
      Store.sessionId = `session_${Date.now()}`;

      const dropZone = document.getElementById('drop-zone');
      const fileLoaded = document.getElementById('file-loaded');
      const sessionInput = document.getElementById('session-input');
      const navSession = document.getElementById('nav-session');
      const fileNameLabel = document.getElementById('file-name-label');
      const filePagesLabel = document.getElementById('file-pages-label');
      const pageDisplaySticky = document.getElementById('page-display-sticky');
      const navPageCount = document.getElementById('nav-page-count');
      const commentsBox = document.getElementById('analysis-comments');

      if (dropZone) dropZone.classList.remove('hidden');
      if (fileLoaded) fileLoaded.classList.add('hidden');
      if (sessionInput) sessionInput.value = '';
      if (navSession) navSession.textContent = 'No session';
      if (fileNameLabel) fileNameLabel.textContent = '—';
      if (filePagesLabel) filePagesLabel.textContent = '— pages';
      if (pageDisplaySticky) pageDisplaySticky.textContent = '— / —';
      if (navPageCount) navPageCount.textContent = '— / —';
      if (commentsBox) commentsBox.value = '';

      _resetPipelineSteps();
      _resetStatsDisplay();

      clearInterval(_progressInterval);
      _progressInterval = null;
      const progressWrap = document.getElementById('pipeline-progress-wrap');
      if (progressWrap) progressWrap.classList.add('hidden');

      _datasetReviews = [];
      _reviewNotSubmittedSet.clear();
      _queueDismissedSet.clear();

      const btnRun = document.getElementById('btn-run');
      if (btnRun) {
        btnRun.disabled = false;
        btnRun.innerHTML = '<span class="btn-icon">▶</span> Run Pipeline';
        btnRun.title = '';
      }

      const pdfImg = document.getElementById('pdf-img');
      const annotationLayerEl = document.getElementById('annotation-layer');
      if (pdfImg) { pdfImg.removeAttribute('src'); pdfImg.src = ''; }
      if (annotationLayerEl) annotationLayerEl.innerHTML = '';

      if (typeof Canvas !== 'undefined' && Canvas.showEmpty) Canvas.showEmpty(true);
      if (typeof EditPanel !== 'undefined' && EditPanel.close) EditPanel.close();

      _closeCommentViewer();
      window._clearSessionDirty?.();
    } catch (e) {
      console.error('[sidebar] _doRestartSession error:', e);
    }
  }

  function _resetUiToInitialState() {
    Store.resetSession();
    const pageDisplaySticky = document.getElementById('page-display-sticky');
    const navPageCount = document.getElementById('nav-page-count');

    if (dropZone) dropZone.classList.remove('hidden');
    if (fileLoaded) fileLoaded.classList.add('hidden');

    if (sessionInput) sessionInput.value = '';
    if (navSession) navSession.textContent = 'No session';

    if (fileNameLabel) fileNameLabel.textContent = '—';
    if (filePagesLabel) filePagesLabel.textContent = '— pages';

    
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

    if (pageButtonsGrid) {
      pageButtonsGrid.innerHTML = '';
    }

    if (commentsBox) {
      commentsBox.value = '';
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

  // ==========================================================
  // PIPELINE
  // ==========================================================

  function _bindPipeline() {
    const btnRun = document.getElementById('btn-run');
    if (!btnRun) return;

    btnRun.addEventListener('click', async () => {
      try {
        if (pipelineRunning) return;

        if (!Store.pdfLoaded) {
          document.getElementById('restart-nopdf-overlay')?.classList.remove('hidden'); return;
        }

        const sessionInput = document.getElementById('session-input');
        const sessionId = (sessionInput?.value || Store.sessionId || '').trim();

        if (!sessionId) {
          showToast('Enter a session ID.', 'warning'); return;
        }

        Store.sessionId = sessionId;
        await window.pywebview.api.set_session_id(sessionId);

        pipelineRunning = true;
        _setPipelineControlsLocked(true);

        _resetPipelineSteps();
        _setPipelineStepRunning(0);

        btnRun.disabled = true;
        btnRun.innerHTML = '<span class="btn-icon"> </span> Running...';

        _startProgress('Extracting components...');

        const result = await window.pywebview.api.run_pipeline();

        _setPipelineStepDone(0);
        _setPipelineStepRunning(1);
        _setPipelineStepDone(1);
        _setPipelineStepRunning(2);

        if (!result || !result.ok) {
          _errorProgress();
          _setPipelineStepError(2);
          showToast('Pipeline failed: ' + (result?.error || 'Unknown error'), 'error');
          return;
        }

        _setPipelineStepDone(2);
        _completeProgress();

        const pageRes = await window.pywebview.api.get_page_count();
        if (pageRes && pageRes.ok) {
          Store.pageCount = pageRes.count || 0;
          _renderPageButtons();
        }

        Store.currentPage = 1;
        Store.pipelineRan = true;
        window._markSessionDirty?.();

        _updatePageDisplay();
        _updateNavPageCount();

        await refreshStats();
        await refreshUnmappedQueue();

        if (typeof Canvas !== 'undefined' && Canvas.loadPage) {
          await Canvas.loadPage(Store.currentPage);
        }
      } catch (e) {
        console.error('[sidebar] run_pipeline error:', e);
        showToast('Pipeline failed: ' + e, 'error');
      } finally {
        pipelineRunning = false;
        _setPipelineControlsLocked(false);

        if (Store.pipelineRan) {
          // Keep frozen after a successful run — only restart clears this
          btnRun.disabled = true;
          btnRun.innerHTML = '<span class="btn-icon">✓</span> Pipeline Complete';
          btnRun.title = 'Restart session to run again';
        } else {
          btnRun.disabled = false;
          btnRun.innerHTML = '<span class="btn-icon">▶</span> Run Pipeline';
          btnRun.title = '';
        }
      }
    });
  }

  function _startProgress(label) {
    const wrap = document.getElementById('pipeline-progress-wrap');
    const bar = document.getElementById('pipeline-progress-bar');
    const lbl = document.getElementById('pipeline-progress-label');
    if (!wrap || !bar) return;
    clearInterval(_progressInterval);
    _progressInterval = null;
    bar.style.transition = 'none';
    bar.style.width = '0%';
    bar.style.background = '';
    if (lbl) lbl.textContent = label || 'Running...';
    wrap.classList.remove('hidden');
    let val = 0;
    setTimeout(() => {
      bar.style.transition = 'width 0.5s ease';
      _progressInterval = setInterval(() => {
        if (val < 78) {
          val += Math.random() * 4 + 0.5;
          if (val > 78) val = 78;
          bar.style.width = `${val}%`;
          if (lbl) {
            if (val < 30) lbl.textContent = 'Extracting components...';
            else if (val < 60) lbl.textContent = 'Matching SDTM variables...';
            else lbl.textContent = 'Drawing annotations...';
          }
        }
      }, 400);
    }, 50);
  }

  function _completeProgress() {
    clearInterval(_progressInterval);
    _progressInterval = null;
    const bar = document.getElementById('pipeline-progress-bar');
    const wrap = document.getElementById('pipeline-progress-wrap');
    const lbl = document.getElementById('pipeline-progress-label');
    if (bar) { bar.style.transition = 'width 0.3s ease'; bar.style.width = '100%'; }
    if (lbl) lbl.textContent = 'Pipeline complete!';
    setTimeout(() => {
      if (wrap) wrap.classList.add('hidden');
      if (bar) { bar.style.transition = 'none'; bar.style.width = '0%'; }
    }, 1200);
  }

  function _errorProgress() {
    clearInterval(_progressInterval);
    _progressInterval = null;
    const bar = document.getElementById('pipeline-progress-bar');
    const wrap = document.getElementById('pipeline-progress-wrap');
    const lbl = document.getElementById('pipeline-progress-label');
    if (bar) bar.style.background = '#DC3545';
    if (lbl) lbl.textContent = 'Pipeline failed';
    setTimeout(() => {
      if (wrap) wrap.classList.add('hidden');
      if (bar) { bar.style.background = ''; bar.style.width = '0%'; }
    }, 2000);
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

    _setRestartButtonState();
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

  // ==========================================================
  // NAVIGATION
  // ==========================================================

function _bindNavigation() {
  const btnPrevSticky = document.getElementById('btn-prev-sticky');
  const btnNextSticky = document.getElementById('btn-next-sticky');
  const btnZoomInSticky = document.getElementById('btn-zoom-in-sticky');
  const btnZoomOutSticky = document.getElementById('btn-zoom-out-sticky');
  const pageDisplaySticky = document.getElementById('page-display-sticky');

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

  if (btnZoomInSticky) {
    btnZoomInSticky.addEventListener('click', async () => {
      await _handleZoomChange(+1);
    });
  }

  if (btnZoomOutSticky) {
    btnZoomOutSticky.addEventListener('click', async () => {
      await _handleZoomChange(-1);
    });
  }

  if (pageDisplaySticky) {
    _bindPageNumberEdit(pageDisplaySticky);
  }
}

function _bindPageNumberEdit(span) {
  span.style.cursor = 'pointer';
  span.title = 'Click to jump to page';

  span.addEventListener('click', () => {
    if (!Store.pipelineRan) return;
    if (span.querySelector('input')) return; // already editing

    const currentText = span.textContent || '';
    span.textContent = '';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = String(Store.currentPage);
    input.className = 'page-number-input';
    input.style.cssText = 'width:3.5em;text-align:center;font-size:inherit;font-family:inherit;border:1px solid #888;border-radius:3px;padding:1px 4px;background:#fff;color:#222;';
    input.setAttribute('aria-label', 'Page number');

    const hint = document.createElement('span');
    hint.className = 'page-number-hint';
    hint.style.cssText = 'color:#c00;font-size:0.78em;margin-left:4px;white-space:nowrap;';
    hint.textContent = '';

    span.appendChild(input);
    span.appendChild(hint);
    input.select();

    // Flag prevents double-commit when Enter fires both keydown and blur
    let handled = false;

    function _revert() {
      if (handled) return;
      handled = true;
      span.textContent = currentText;
    }

    async function _commit() {
      if (handled) return;
      const raw = input.value.trim();
      const num = parseInt(raw, 10);
      if (!raw || isNaN(num) || !/^\d+$/.test(raw)) {
        if (typeof showInfoDialog !== 'undefined') showInfoDialog('Invalid Page Number', 'Please enter a valid page number between 1 and ' + (Store.pageCount || 1) + '.');
        input.select();
        return;
      }
      handled = true;
      const page = Math.max(1, Math.min(Store.pageCount || 1, num));
      Store.currentPage = page;
      _updatePageDisplay();
      _updateNavPageCount();
      if (typeof Canvas !== 'undefined' && Canvas.loadPage) {
        await Canvas.loadPage(Store.currentPage);
      }
    }

    input.addEventListener('input', () => {
      const raw = input.value;
      if (raw !== '' && !/^\d*$/.test(raw)) {
        hint.textContent = '';
      } else {
        hint.textContent = '';
      }
    });

    input.addEventListener('keydown', async (e) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'z') {
        // Let browser handle native text undo inside this field
        e.stopPropagation();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        await _commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        _revert();
      }
    });

    input.addEventListener('blur', async () => {
      if (handled) return; // already committed or reverted
      const raw = input.value.trim();
      if (!raw || !/^\d+$/.test(raw)) {
        _revert();
      } else {
        await _commit();
      }
    });
  });
}

async function _handleZoomChange(direction) {
  try {
    if (!Store.pipelineRan) return;

    if (typeof Canvas !== 'undefined') {
      if (direction > 0 && typeof Canvas.zoomIn === 'function') {
        await Canvas.zoomIn();
        return;
      }

      if (direction < 0 && typeof Canvas.zoomOut === 'function') {
        await Canvas.zoomOut();
        return;
      }
    }

    const current = Number(Store.zoomPct || 100);
    const step = Number(Store.zoomStep || 10);
    const min = Number(Store.zoomMin || 50);
    const max = Number(Store.zoomMax || 200);

    let next = current + direction * step;
    next = Math.max(min, Math.min(max, next));

    if (next === current) return;

    Store.zoomPct = next;

    const toolbarZoom = document.getElementById('toolbar-zoom');
    if (toolbarZoom) {
      toolbarZoom.textContent = `${Store.zoomPct}%`;
    }

    const pdfWrap = document.getElementById('pdf-page-wrap');
    if (pdfWrap) {
      pdfWrap.style.transform = `scale(${Store.zoomPct / 100})`;
      pdfWrap.style.transformOrigin = 'top center';
    }
  } catch (e) {
    console.error('[sidebar] zoom error:', e);
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
  const pageDisplaySticky = document.getElementById('page-display-sticky');

  const current = Store.pageCount ? Store.currentPage : '—';
  const total = Store.pageCount || '—';
  const text = `${current} / ${total}`;

  if (pageDisplaySticky) {
    pageDisplaySticky.textContent = text;
  }

  _renderPageButtons();
}
  

  function _updateNavPageCount() {
    const navPageCount = document.getElementById('nav-page-count');
    if (navPageCount) {
      const current = Store.pageCount ? Store.currentPage : '—';
      const total = Store.pageCount || '—';
      navPageCount.textContent = `${current} / ${total}`;
    }
  }

  function _renderPageButtons() {
  const grid = document.getElementById('page-buttons-grid');
  if (!grid) return;
  grid.innerHTML = '';
}

  // ==========================================================
  // STATS
  // ==========================================================

  async function refreshStats() {
    try {
      const stats = await window.pywebview.api.get_stats();
      if (!stats || !stats.ok) return;

      Store.stats = {
        total: stats.total || 0,
        active: stats.active || 0,
        resolved: stats.resolved || 0,
        user_corrected: stats.user_corrected || 0,
        needs_review: stats.needs_review || 0,
        unmapped: stats.unmapped || 0,
        not_submitted: stats.not_submitted || 0,
        removed: stats.removed || 0,
        resolution_pct: stats.resolution_pct || 0,
      };

      _setText('stat-resolved', Store.stats.resolved);
      _setText('stat-unmapped', Store.stats.unmapped);
      _setText('stat-corrected', Store.stats.user_corrected);
      _setText('stat-removed', Store.stats.removed);

      // Deep Analysis: use active (non-removed) records as total
      _setText('analysis-total', Store.stats.active || Store.stats.total);
      // "Review" = needs_review + unmapped (pending action)
      _setText('analysis-reviewed', (Store.stats.needs_review || 0) + (Store.stats.unmapped || 0));
      // "Resolved" = resolved + user_corrected + not_submitted (all actioned/closed)
      _setText(
        'analysis-ignored',
        (Store.stats.resolved || 0) + (Store.stats.user_corrected || 0) + (Store.stats.not_submitted || 0)
      );

      const allResolved = (Store.stats.resolved || 0) + (Store.stats.user_corrected || 0) + (Store.stats.not_submitted || 0);
      const activePct = Store.stats.active > 0 ? Math.round(allResolved / Store.stats.active * 100) : 0;
      _updateRing(Math.min(activePct, 100));
    } catch (e) {
      console.error('[sidebar] refreshStats error:', e);
    }
  }

  function _resetStatsDisplay() {
    _setText('stat-resolved', 0);
    _setText('stat-unmapped', 0);
    _setText('stat-corrected', 0);
    _setText('stat-removed', 0);

    _setText('analysis-total', 0);
    _setText('analysis-reviewed', 0);
    _setText('analysis-ignored', 0);

    const queueSummary = document.getElementById('unmapped-queue-summary');
    if (queueSummary) queueSummary.textContent = '0 pending';

    const activeList = document.getElementById('unmapped-queue-list-active');
    const resolvedList = document.getElementById('unmapped-queue-list-resolved');
    if (activeList) activeList.innerHTML = '';
    if (resolvedList) resolvedList.innerHTML = '';

    _updateRing(0);
  }

  function _setText(id, val) {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = val ?? 0;
    }
  }

  function _updateRing(pct) {
    const p = Math.max(0, Math.min(100, pct || 0));
    const outerCirc = 427.3;
    const innerCirc = 320.4;
    const TRANSITION = 'stroke-dashoffset 900ms cubic-bezier(0.34, 1.56, 0.64, 1)';

    const fill = document.getElementById('ring-fill');
    const fillInner = document.getElementById('ring-fill-inner');

    // Strip transition so the reset to 0% is instant
    if (fill) fill.style.transition = 'none';
    if (fillInner) fillInner.style.transition = 'none';

    // Reset both arcs to fully empty (dashoffset = full circumference)
    if (fill) { fill.style.strokeDasharray = `${outerCirc}`; fill.style.strokeDashoffset = `${outerCirc}`; }
    if (fillInner) { fillInner.style.strokeDasharray = `${innerCirc}`; fillInner.style.strokeDashoffset = `${innerCirc}`; }

    // Force reflow so browser commits the reset before restoring transition
    (fill || fillInner)?.getBoundingClientRect();

    // Restore transition and animate to the new target value
    if (fill) fill.style.transition = TRANSITION;
    if (fillInner) fillInner.style.transition = TRANSITION;
    if (fill) fill.style.strokeDashoffset = `${outerCirc * (1 - p / 100)}`;
    if (fillInner) fillInner.style.strokeDashoffset = `${innerCirc * (1 - p / 100)}`;

    const label = document.getElementById('ring-pct');
    if (label) label.textContent = `${Math.round(p)}%`;
  }

  // ==========================================================
  // ANALYSIS / UNMAPPED QUEUE
  // ==========================================================

  function _bindQueueInnerTabs() {
    const tabs = Array.from(document.querySelectorAll('.queue-inner-tab'));
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        tabs.forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        const key = tab.dataset.queueTab;
        document.getElementById('queue-pane-active')?.classList.toggle('hidden', key !== 'active');
        document.getElementById('queue-pane-resolved')?.classList.toggle('hidden', key !== 'resolved');
      });
    });
  }

  function _bindAnalysisQueueFilters() {
    const chips = Array.from(document.querySelectorAll('.unmapped-filter-chip'));
    if (!chips.length) return;

    chips.forEach((chip) => {
      chip.addEventListener('click', () => {
        chips.forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        _applyQueueFilters();
      });
    });
  }

  function _bindAnalysisQueueSearch() {
    document.getElementById('unmapped-queue-search')?.addEventListener('input', _applyQueueFilters);
    document.getElementById('resolved-queue-search')?.addEventListener('input', _applyResolvedFilter);
  }

  function _rowMatchesQuery(row, query) {
    if (!query) return true;
    const raw = (row.dataset.rawVar || '').toLowerCase();
    const domain = (row.dataset.domain || '').toLowerCase();
    const page = String(row.dataset.page || '').toLowerCase();
    const sdtmLabel = (row.dataset.sdtmLabel || '').toLowerCase();
    return raw.includes(query) || domain.includes(query) || page.includes(query) || sdtmLabel.includes(query);
  }

  function _applyQueueFilters() {
    const listEl = document.getElementById('unmapped-queue-list-active');
    if (!listEl) return;

    const activeFilter =
      document.querySelector('.unmapped-filter-chip.active')?.dataset.filter || 'all';
    const query = (document.getElementById('unmapped-queue-search')?.value || '').trim().toLowerCase();

    Array.from(listEl.querySelectorAll('.qr-row')).forEach((row) => {
      const status = row.dataset.queueStatus || 'unreviewed';
      let matchesFilter;
      if (activeFilter === 'all') {
        matchesFilter = true;
      } else if (activeFilter === 'dataset') {
        matchesFilter = row.dataset.isDataset === 'true';
      } else {
        matchesFilter = status === activeFilter && row.dataset.isDataset !== 'true';
      }
      row.style.display = matchesFilter && _rowMatchesQuery(row, query) ? '' : 'none';
    });
  }

  function _applyResolvedFilter() {
    const listEl = document.getElementById('unmapped-queue-list-resolved');
    if (!listEl) return;
    const query = (document.getElementById('resolved-queue-search')?.value || '').trim().toLowerCase();
    Array.from(listEl.querySelectorAll('.qr-row')).forEach((row) => {
      row.style.display = _rowMatchesQuery(row, query) ? '' : 'none';
    });
  }

  function _buildQueueRow(rec) {
    const row = document.createElement('div');

    const statusUpper = String(rec.status || '').toUpperCase();
    const annotationId = String(rec.annotation_id || '');
    const isNeedsReview = statusUpper === 'NEEDS_REVIEW';
    const isUnmapped = statusUpper === 'UNMAPPED';
    const isNsInReview = statusUpper === 'NOT_SUBMITTED' && _reviewNotSubmittedSet.has(annotationId);
    const isResolved = (statusUpper === 'USER_CORRECTED') || (statusUpper === 'NOT_SUBMITTED' && !isNsInReview);

    const hasComment = !!(rec.comment && String(rec.comment).trim());
    // Blue "comment" style: in active review queue AND has a comment
    const isCommentRow = (isNeedsReview || isNsInReview) && hasComment;

    // Status class suffix
    let statusCls = 'unmapped';
    if (isCommentRow) statusCls = 'comment';
    else if (isNeedsReview) statusCls = 'review';
    else if (isNsInReview) statusCls = 'nsreview';
    else if (isResolved) statusCls = 'resolved';

    // Status icon
    let statusIcon = '';
    if (isUnmapped) statusIcon = '<span style="color:#DC3545">&#9888;</span>';
    else if (isNeedsReview) statusIcon = '<span style="color:#FFC107">&#9210;</span>';
    else if (isNsInReview) statusIcon = '<span style="color:#6B7280">&#9210;</span>';
    else if (statusUpper === 'USER_CORRECTED') statusIcon = '<span style="color:#00E676">&#10003;</span>';
    else if (statusUpper === 'NOT_SUBMITTED') statusIcon = '<span style="color:#888">&ndash;</span>';

    const page = rec.page_number ?? rec.page ?? rec.page_num ?? '—';

    // Primary SDTM label
    let sdtmLabel = '—';
    let sdtmDataset = '';

    if (rec.is_dataset_review) {
      sdtmDataset = rec.sdtm_dataset || '';
      sdtmLabel = `DATASET: ${rec.raw_variable || rec.sdtm_dataset || '—'}`;
    } else if (isNsInReview) {
      sdtmDataset = rec.sdtm_dataset || '';
      sdtmLabel = rec.sdtm_variable
        ? (sdtmDataset ? `${sdtmDataset}.${rec.sdtm_variable}` : rec.sdtm_variable)
        : `Not Submitted (${rec.raw_variable || '—'})`;
    } else if (isNeedsReview && rec.sdtm_variable) {
      sdtmDataset = rec.sdtm_dataset || '';
      sdtmLabel = sdtmDataset ? `${sdtmDataset}.${rec.sdtm_variable}` : rec.sdtm_variable;
    } else if (isNeedsReview) {
      sdtmLabel = `Unmapped (${rec.raw_variable || '—'})`;
    } else if (isUnmapped && rec.best_sdtm_variable) {
      sdtmDataset = rec.best_sdtm_dataset || '';
      sdtmLabel = sdtmDataset ? `${sdtmDataset}.${rec.best_sdtm_variable}` : rec.best_sdtm_variable;
    } else if (isUnmapped) {
      sdtmLabel = `Unmapped (${rec.raw_variable || '—'})`;
    } else if (isResolved) {
      sdtmDataset = rec.sdtm_dataset || '';
      if (rec.sdtm_variable) {
        sdtmLabel = sdtmDataset ? `${sdtmDataset}.${rec.sdtm_variable}` : rec.sdtm_variable;
      } else {
        sdtmLabel = statusUpper === 'NOT_SUBMITTED' ? 'Not Submitted' : '—';
      }
    }

    const rawVar = rec.raw_variable || '—';
    const filterStatus = (isNeedsReview || isNsInReview) ? 'review' : isUnmapped ? 'unreviewed' : 'resolved';
    const domainBadge = (sdtmDataset || 'NA').toUpperCase();
    const badgeColor = DOMAIN_BADGE_COLORS[domainBadge] || '#5B6BA3';

    row.className = `qr-row qr-status-${statusCls}`;
    row.dataset.queueStatus = filterStatus;
    row.dataset.rawVar = String(rawVar);
    row.dataset.domain = String(domainBadge);
    row.dataset.page = String(page);
    row.dataset.annotationId = annotationId;
    row.dataset.sdtmLabel = String(sdtmLabel);
    row.dataset.isDataset = rec.is_dataset_review ? 'true' : '';

    const commentBadgeHtml = isCommentRow
      ? `<span class="qr-comment-badge">Comments</span>`
      : '';
    const commentBtnHtml = (hasComment && !isCommentRow)
      ? `<button class="qr-comment-btn" title="View comment">&#x1F4AC;</button>`
      : '';

    row.innerHTML = `
      <div class="qr-left">
        <span class="qr-status-icon">${statusIcon}</span>
      </div>
      <div class="qr-body">
        <div class="qr-title-row">
          <span class="qr-label">${_escapeHtml(sdtmLabel)}</span>
          ${commentBadgeHtml}
          <span class="qr-domain-badge" style="background:${_escapeHtml(badgeColor)}">${_escapeHtml(domainBadge)}</span>
        </div>
        <div class="qr-sub">RAW: ${_escapeHtml(rawVar)}</div>
      </div>
      <div class="qr-actions">
        ${commentBtnHtml}
        <span class="qr-page-num">p${_escapeHtml(String(page))}</span>
      </div>
    `;

    // Bind comment button — opens the comment viewer panel
    if (hasComment && !isCommentRow) {
      const commentBtn = row.querySelector('.qr-comment-btn');
      if (commentBtn) {
        commentBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          _openCommentViewer(rec);
        });
        commentBtn.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          _openCommentViewer(rec);
        });
      }
    }

    row.addEventListener('click', async (e) => {
      if (e.target.classList.contains('qr-comment-btn')) return;

      const annotationId = String(rec.annotation_id || '');

      // Dataset review row — highlight the chip on canvas without navigating
      if (rec.is_dataset_review) {
        const parts = annotationId.replace(/^dsreview_/, '').split('_');
        const dsFormCode = parts[0] || '';
        const dsDsCode = parts.slice(1).join('_') || '';
        if (typeof Canvas !== 'undefined' && Canvas.highlightDatasetChip) {
          Canvas.highlightDatasetChip(dsFormCode, dsDsCode);
        }
        return;
      }

      const numericPage = Number(page);
      if (!numericPage || Number.isNaN(numericPage)) return;

      Store.currentPage = numericPage;
      _updatePageDisplay();
      _updateNavPageCount();

      if (typeof Canvas !== 'undefined' && Canvas.loadPage) {
        await Canvas.loadPage(Store.currentPage);
      }

      if (annotationId && typeof Canvas !== 'undefined' && Canvas.highlightQueueAnnotation) {
        setTimeout(() => Canvas.highlightQueueAnnotation(annotationId), 80);
      }
    });

    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      _showQueueContextMenu(e.clientX, e.clientY, rec);
    });

    return row;
  }

  function _bindCommentViewer() {
    document.getElementById('comment-viewer-close')?.addEventListener('click', _closeCommentViewer);
  }

  function _openCommentViewer(rec) {
    const viewer = document.getElementById('comment-viewer');
    const body = document.getElementById('comment-viewer-body');
    if (!viewer || !body) return;
    body.textContent = rec.comment || '';
    viewer.classList.remove('hidden');
    viewer.classList.add('comment-viewer-full');
  }

  function _closeCommentViewer() {
    const viewer = document.getElementById('comment-viewer');
    if (viewer) { viewer.classList.add('hidden'); viewer.classList.remove('comment-viewer-full'); }
  }

  function _bindCommentDialog() {
    const dialog = document.getElementById('comment-dialog');
    if (!dialog) return;

    const input = document.getElementById('comment-dialog-input');
    const placeholder = document.getElementById('comment-dialog-placeholder');

    const updatePlaceholder = () => {
      if (placeholder && input) {
        placeholder.style.opacity = input.value ? '0' : '1';
      }
    };

    if (input) {
      input.addEventListener('input', updatePlaceholder);
      input.addEventListener('focus', updatePlaceholder);
      input.addEventListener('blur', updatePlaceholder);
    }

    const closeDialog = () => {
      dialog.classList.add('hidden');
      _currentCommentRec = null;
      if (input) input.value = '';
      if (placeholder) placeholder.style.opacity = '1';
    };

    document.getElementById('comment-dialog-close')?.addEventListener('click', closeDialog);
    document.getElementById('comment-dialog-cancel')?.addEventListener('click', closeDialog);

    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) closeDialog();
    });

    document.getElementById('comment-dialog-save')?.addEventListener('click', async () => {
      if (!_currentCommentRec) return;
      const comment = input ? input.value : '';
      const rec = _currentCommentRec;
      const annotationId = String(rec.annotation_id || '');
      const isUserCreatedRec = annotationId.startsWith('user_');
      const statusUpper = String(rec.status || '').toUpperCase();

      if (rec.is_dataset_review) {
        const idx = _datasetReviews.findIndex(r => r.annotation_id === annotationId);
        if (idx >= 0) _datasetReviews[idx].comment = comment;
        window._markSessionDirty?.();
        await refreshUnmappedQueue();
      } else {
        try {
          if (isUserCreatedRec) {
            if (typeof Canvas !== 'undefined' && Canvas.updateUserAnnotation) {
              Canvas.updateUserAnnotation(annotationId, { comment });
            }
          } else {
            await window.pywebview.api.update_comment(annotationId, comment);
          }

          // Auto-add to review when comment is non-empty
          if (comment.trim()) {
            if (statusUpper === 'NOT_SUBMITTED') {
              if (!_reviewNotSubmittedSet.has(annotationId)) {
                _reviewNotSubmittedSet.add(annotationId);
              }
            } else if (statusUpper !== 'NEEDS_REVIEW') {
              // Convert to NEEDS_REVIEW so it appears in review queue with blue badge
              if (isUserCreatedRec) {
                if (typeof Canvas !== 'undefined' && Canvas.updateUserAnnotation) {
                  Canvas.updateUserAnnotation(annotationId, { status: 'NEEDS_REVIEW', comment });
                }
              } else {
                await window.pywebview.api.update_annotation(
                  annotationId, 'NEEDS_REVIEW',
                  rec.sdtm_dataset || '', rec.sdtm_variable || '', rec.sdtm_label || ''
                );
              }
            }
          }

          window._markSessionDirty?.();
          await refreshStats();
          await refreshUnmappedQueue();
          if (typeof Canvas !== 'undefined' && Canvas.loadPage) await Canvas.loadPage(Store.currentPage);
        } catch (e) {
          console.error('[sidebar] save comment error:', e);
        }
      }
      closeDialog();
    });
  }

  async function refreshUnmappedQueue() {
    try {
      const res = await window.pywebview.api.get_annotations();
      const activeListEl = document.getElementById('unmapped-queue-list-active');
      const resolvedListEl = document.getElementById('unmapped-queue-list-resolved');
      const summaryEl = document.getElementById('unmapped-queue-summary');

      if (!activeListEl || !res || !res.ok) return;

      const records = Array.isArray(res.records) ? res.records : [];

      // Merge in user-created annotations from canvas (all pages — getAllUserAnnotations covers every page)
      const backendIds = new Set(records.map(r => r.annotation_id));
      let userCreatedAll = [];
      if (typeof Canvas !== 'undefined' && Canvas.getAllUserAnnotations) {
        userCreatedAll = Canvas.getAllUserAnnotations().filter(r => !backendIds.has(r.annotation_id));
      } else {
        userCreatedAll = (Store.annotations || []).filter(r =>
          String(r.annotation_id || '').startsWith('user_') && !backendIds.has(r.annotation_id)
        );
      }
      const allRecords = [...records, ...userCreatedAll];

      // FORM pages only — TABLE pages are reference-only
      const formRecords = allRecords.filter((r) => {
        return String(r.page_type || 'FORM').toUpperCase() !== 'TABLE';
      });

      const _isUserCreatedRec = (r) => String(r.annotation_id || '').startsWith('user_');

      // Active queue: UNMAPPED + NEEDS_REVIEW (not dismissed) + NOT_SUBMITTED in _reviewNotSubmittedSet
      const activeBackend = formRecords.filter((r) => {
        const s = String(r.status || '').toUpperCase();
        const id = String(r.annotation_id || '');
        if (s === 'UNMAPPED') return true;
        if (s === 'NEEDS_REVIEW') return !_queueDismissedSet.has(id);
        if (s === 'NOT_SUBMITTED') return _reviewNotSubmittedSet.has(id);
        return false;
      }).sort((a, b) => (_isUserCreatedRec(a) ? 1 : 0) - (_isUserCreatedRec(b) ? 1 : 0));

      const activeDatasetReviews = _datasetReviews.filter(r => {
        const s = String(r.status || '').toUpperCase();
        return s === 'NEEDS_REVIEW';
      });

      const activeQueue = [...activeBackend, ...activeDatasetReviews];

      // Resolved queue: USER_CORRECTED + NOT_SUBMITTED not in _reviewNotSubmittedSet
      const resolvedBackend = formRecords.filter((r) => {
        const s = String(r.status || '').toUpperCase();
        const id = String(r.annotation_id || '');
        if (s === 'USER_CORRECTED') return true;
        if (s === 'NOT_SUBMITTED') return !_reviewNotSubmittedSet.has(id);
        return false;
      }).sort((a, b) => (_isUserCreatedRec(a) ? 1 : 0) - (_isUserCreatedRec(b) ? 1 : 0));

      const resolvedDatasetReviews = _datasetReviews.filter(r => {
        const s = String(r.status || '').toUpperCase();
        return s === 'USER_CORRECTED' || s === 'NOT_SUBMITTED';
      });

      const resolvedQueue = [...resolvedBackend, ...resolvedDatasetReviews];

      if (summaryEl) {
        summaryEl.textContent = `${activeQueue.length} pending`;
      }

      // Populate active pane
      activeListEl.innerHTML = '';
      if (!activeQueue.length) {
        activeListEl.innerHTML = `<div class="muted small" style="padding:8px 4px;">No pending items</div>`;
      } else {
        activeQueue.slice(0, 300).forEach((rec) => {
          activeListEl.appendChild(_buildQueueRow(rec));
        });
      }

      // Populate resolved pane
      if (resolvedListEl) {
        resolvedListEl.innerHTML = '';
        if (!resolvedQueue.length) {
          resolvedListEl.innerHTML = `<div class="muted small" style="padding:8px 4px;">No resolved items yet</div>`;
        } else {
          resolvedQueue.slice(0, 300).forEach((rec) => {
            resolvedListEl.appendChild(_buildQueueRow(rec));
          });
        }
      }

      _applyQueueFilters();
    } catch (e) {
      console.error('[sidebar] refreshUnmappedQueue error:', e);
    }
  }

  // Queue context menu
  function _bindQueueContextMenu() {
    const menu = document.getElementById('queue-ctx-menu');
    if (!menu) return;

    document.addEventListener('click', (e) => {
      if (!menu.classList.contains('hidden') && !menu.contains(e.target)) {
        menu.classList.add('hidden');
      }
    });

    document.getElementById('qctx-resolve')?.addEventListener('click', async () => {
      if (!_queueCtxRec) return;
      menu.classList.add('hidden');
      await _resolveQueueItem(_queueCtxRec);
      _queueCtxRec = null;
    });

    document.getElementById('qctx-ignore')?.addEventListener('click', async () => {
      if (!_queueCtxRec) return;
      menu.classList.add('hidden');
      await _ignoreQueueItem(_queueCtxRec);
      _queueCtxRec = null;
    });

    document.getElementById('qctx-mark-review')?.addEventListener('click', async () => {
      if (!_queueCtxRec) return;
      menu.classList.add('hidden');
      await _markForReviewQueueItem(_queueCtxRec);
      _queueCtxRec = null;
    });

    document.getElementById('qctx-remove-from-review')?.addEventListener('click', async () => {
      if (!_queueCtxRec) return;
      menu.classList.add('hidden');
      const rec = _queueCtxRec;
      const annotationId = String(rec.annotation_id || '');
      _queueCtxRec = null;
      await removeFromReview(annotationId, rec);
    });

    document.getElementById('qctx-convert-unmapped')?.addEventListener('click', async () => {
      if (!_queueCtxRec) return;
      menu.classList.add('hidden');
      const rec = _queueCtxRec;
      const annotationId = String(rec.annotation_id || '');
      const isUserCreatedRec = annotationId.startsWith('user_');
      _queueCtxRec = null;

      // Remove from review sets if present
      _reviewNotSubmittedSet.delete(annotationId);
      _queueDismissedSet.delete(annotationId);

      if (typeof Canvas !== 'undefined' && Canvas.pushUndoAction) {
        Canvas.pushUndoAction({
          type: 'status-change',
          id: annotationId,
          beforeStatus: rec.status || '',
          beforeDataset: rec.sdtm_dataset || '',
          beforeVariable: rec.sdtm_variable || '',
          beforeLabel: rec.sdtm_label || '',
          afterStatus: 'UNMAPPED',
          afterDataset: '',
          afterVariable: '',
          afterLabel: '',
          isUserCreated: isUserCreatedRec,
        });
      }

      if (isUserCreatedRec) {
        if (typeof Canvas !== 'undefined' && Canvas.updateUserAnnotation) {
          Canvas.updateUserAnnotation(annotationId, { status: 'UNMAPPED', sdtm_dataset: '', sdtm_variable: '', sdtm_label: '' });
        }
        await refreshStats();
        await refreshUnmappedQueue();
        if (typeof Canvas !== 'undefined' && Canvas.loadPage) {
          await Canvas.loadPage(Store.currentPage);
        }
      } else {
        const res = await window.pywebview.api.update_annotation(annotationId, 'UNMAPPED', '', '', '');
        if (res && res.ok) {
          await refreshStats();
          await refreshUnmappedQueue();
          if (typeof Canvas !== 'undefined' && Canvas.loadPage) {
            await Canvas.loadPage(Store.currentPage);
          }
        }
      }
    });

    document.getElementById('qctx-add-comment')?.addEventListener('click', () => {
      if (!_queueCtxRec) return;
      menu.classList.add('hidden');
      _openCommentForRecord(_queueCtxRec);
      _queueCtxRec = null;
    });

    document.getElementById('qctx-cancel')?.addEventListener('click', () => {
      menu.classList.add('hidden');
      _queueCtxRec = null;
    });
  }

  function _showQueueContextMenu(x, y, rec) {
    _queueCtxRec = rec;
    const menu = document.getElementById('queue-ctx-menu');
    if (!menu) return;

    const statusUpper = String(rec.status || '').toUpperCase();
    const annotId = String(rec.annotation_id || '');
    const isNsInReview = statusUpper === 'NOT_SUBMITTED' && _reviewNotSubmittedSet.has(annotId);
    const isAlreadyResolved = (statusUpper === 'USER_CORRECTED') || (statusUpper === 'NOT_SUBMITTED' && !isNsInReview);
    const isAlreadyUnmapped = statusUpper === 'UNMAPPED';

    const resolveBtn = document.getElementById('qctx-resolve');
    const ignoreBtn = document.getElementById('qctx-ignore');
    const markReviewBtn = document.getElementById('qctx-mark-review');
    const convertUnmappedBtn = document.getElementById('qctx-convert-unmapped');

    const isDatasetReview = !!rec.is_dataset_review;

    // Already in review = NEEDS_REVIEW, UNMAPPED, or NOT_SUBMITTED in review set
    const isAlreadyNeedsReview = statusUpper === 'NEEDS_REVIEW' || statusUpper === 'UNMAPPED' || isNsInReview;

    if (resolveBtn) resolveBtn.style.display = isAlreadyResolved ? 'none' : '';
    if (ignoreBtn) ignoreBtn.style.display = isAlreadyResolved ? 'none' : '';
    if (markReviewBtn) {
      markReviewBtn.style.display = '';
      markReviewBtn.disabled = isAlreadyNeedsReview;
      markReviewBtn.style.opacity = isAlreadyNeedsReview ? '0.4' : '';
      markReviewBtn.style.cursor = isAlreadyNeedsReview ? 'default' : '';
      markReviewBtn.title = isAlreadyNeedsReview ? 'Already in review queue' : '';
    }
    // Dataset reviews and pure unmapped cannot be converted to unmapped
    if (convertUnmappedBtn) convertUnmappedBtn.style.display =
      (isAlreadyUnmapped || isAlreadyResolved || isDatasetReview) ? 'none' : '';

    // "Remove from Review" for NEEDS_REVIEW or NOT_SUBMITTED-in-review
    const removeFromReviewBtn = document.getElementById('qctx-remove-from-review');
    if (removeFromReviewBtn) removeFromReviewBtn.style.display =
      (statusUpper === 'NEEDS_REVIEW' || isNsInReview) ? '' : 'none';

    menu.classList.remove('hidden');
    // Position after un-hiding so getBoundingClientRect is accurate
    const menuH = menu.getBoundingClientRect().height || 280;
    menu.style.left = `${Math.min(x, window.innerWidth - 200)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - menuH - 8)}px`;
  }

  function _updateDatasetReviewStatus(annotationId, newStatus) {
    const idx = _datasetReviews.findIndex(r => r.annotation_id === annotationId);
    if (idx >= 0) _datasetReviews[idx].status = newStatus;
  }

  async function _resolveQueueItem(rec) {
    const annotationId = String(rec.annotation_id || '');
    if (!annotationId) return;

    if (rec.is_dataset_review) {
      _updateDatasetReviewStatus(annotationId, 'USER_CORRECTED');
      await refreshUnmappedQueue();
      return;
    }

    const isUserCreatedRec = annotationId.startsWith('user_');
    const dataset = rec.sdtm_dataset || rec.best_sdtm_dataset || '';
    const variable = rec.sdtm_variable || rec.best_sdtm_variable || '';
    const label = rec.sdtm_label || '';

    // Clear from review sets
    _reviewNotSubmittedSet.delete(annotationId);
    _queueDismissedSet.delete(annotationId);

    if (typeof Canvas !== 'undefined' && Canvas.pushUndoAction) {
      Canvas.pushUndoAction({
        type: 'status-change',
        id: annotationId,
        beforeStatus: rec.status || '',
        beforeDataset: rec.sdtm_dataset || '',
        beforeVariable: rec.sdtm_variable || '',
        beforeLabel: rec.sdtm_label || '',
        afterStatus: 'USER_CORRECTED',
        afterDataset: dataset,
        afterVariable: variable,
        afterLabel: label,
        isUserCreated: isUserCreatedRec,
      });
    }

    if (isUserCreatedRec) {
      if (typeof Canvas !== 'undefined' && Canvas.updateUserAnnotation) {
        Canvas.updateUserAnnotation(annotationId, { status: 'USER_CORRECTED', sdtm_dataset: dataset, sdtm_variable: variable, sdtm_label: label });
      }
      await refreshStats();
      await refreshUnmappedQueue();
      if (typeof Canvas !== 'undefined' && Canvas.loadPage) await Canvas.loadPage(Store.currentPage);
    } else {
      const res = await window.pywebview.api.update_annotation(
        annotationId, 'USER_CORRECTED', dataset, variable, label
      );
      if (res && res.ok) {
        await refreshStats();
        await refreshUnmappedQueue();
        if (typeof Canvas !== 'undefined' && Canvas.loadPage) await Canvas.loadPage(Store.currentPage);
      }
    }
  }

  async function _ignoreQueueItem(rec) {
    const annotationId = String(rec.annotation_id || '');
    if (!annotationId) return;

    if (rec.is_dataset_review) {
      _updateDatasetReviewStatus(annotationId, 'NOT_SUBMITTED');
      await refreshUnmappedQueue();
      return;
    }

    const isUserCreatedRec = annotationId.startsWith('user_');

    // Clear from review sets
    _reviewNotSubmittedSet.delete(annotationId);
    _queueDismissedSet.delete(annotationId);

    if (typeof Canvas !== 'undefined' && Canvas.pushUndoAction) {
      Canvas.pushUndoAction({
        type: 'status-change',
        id: annotationId,
        beforeStatus: rec.status || '',
        beforeDataset: rec.sdtm_dataset || '',
        beforeVariable: rec.sdtm_variable || '',
        beforeLabel: rec.sdtm_label || '',
        afterStatus: 'NOT_SUBMITTED',
        afterDataset: '',
        afterVariable: '',
        afterLabel: 'Not Submitted',
        isUserCreated: isUserCreatedRec,
      });
    }

    if (isUserCreatedRec) {
      if (typeof Canvas !== 'undefined' && Canvas.updateUserAnnotation) {
        Canvas.updateUserAnnotation(annotationId, { status: 'NOT_SUBMITTED', sdtm_dataset: '', sdtm_variable: '', sdtm_label: 'Not Submitted' });
      }
      await refreshStats();
      await refreshUnmappedQueue();
      if (typeof Canvas !== 'undefined' && Canvas.loadPage) await Canvas.loadPage(Store.currentPage);
    } else {
      const res = await window.pywebview.api.update_annotation(
        annotationId, 'NOT_SUBMITTED', '', '', 'Not Submitted'
      );
      if (res && res.ok) {
        await refreshStats();
        await refreshUnmappedQueue();
        if (typeof Canvas !== 'undefined' && Canvas.loadPage) await Canvas.loadPage(Store.currentPage);
      }
    }
  }

  async function _markForReviewQueueItem(rec) {
    const annotationId = String(rec.annotation_id || '');
    if (!annotationId) return;

    if (rec.is_dataset_review) {
      _updateDatasetReviewStatus(annotationId, 'NEEDS_REVIEW');
      await refreshUnmappedQueue();
      return;
    }

    const isUserCreatedRec = annotationId.startsWith('user_');
    const statusUpper = String(rec.status || '').toUpperCase();

    // NOT_SUBMITTED: add to NS review set without changing status
    if (statusUpper === 'NOT_SUBMITTED') {
      await addNotSubmittedToReview(annotationId, rec);
      return;
    }

    // Re-mark dismissed item: just remove from dismissed set
    if (_queueDismissedSet.has(annotationId)) {
      _queueDismissedSet.delete(annotationId);
      await refreshStats();
      await refreshUnmappedQueue();
      return;
    }

    const dataset = rec.sdtm_dataset || rec.best_sdtm_dataset || '';
    const variable = rec.sdtm_variable || rec.best_sdtm_variable || '';

    if (typeof Canvas !== 'undefined' && Canvas.pushUndoAction) {
      Canvas.pushUndoAction({
        type: 'status-change',
        id: annotationId,
        beforeStatus: rec.status || '',
        beforeDataset: rec.sdtm_dataset || '',
        beforeVariable: rec.sdtm_variable || '',
        beforeLabel: rec.sdtm_label || '',
        afterStatus: 'NEEDS_REVIEW',
        afterDataset: dataset,
        afterVariable: variable,
        afterLabel: rec.sdtm_label || '',
        isUserCreated: isUserCreatedRec,
      });
    }

    if (isUserCreatedRec) {
      if (typeof Canvas !== 'undefined' && Canvas.updateUserAnnotation) {
        Canvas.updateUserAnnotation(annotationId, { status: 'NEEDS_REVIEW', sdtm_dataset: dataset, sdtm_variable: variable, sdtm_label: rec.sdtm_label || '' });
      }
      await refreshStats();
      await refreshUnmappedQueue();
      if (typeof Canvas !== 'undefined' && Canvas.loadPage) await Canvas.loadPage(Store.currentPage);
    } else {
      const res = await window.pywebview.api.update_annotation(
        annotationId, 'NEEDS_REVIEW', dataset, variable, rec.sdtm_label || ''
      );
      if (res && res.ok) {
        await refreshStats();
        await refreshUnmappedQueue();
        if (typeof Canvas !== 'undefined' && Canvas.loadPage) await Canvas.loadPage(Store.currentPage);
      }
    }
  }

  async function addNotSubmittedToReview(annotationId, rec) {
    if (_reviewNotSubmittedSet.has(annotationId)) {
      // Already in review — just navigate to it
      document.getElementById('tab-analysis')?.click();
      document.querySelector('.queue-inner-tab[data-queue-tab="active"]')?.click();
      setTimeout(() => highlightInQueue(annotationId, 'NOT_SUBMITTED'), 100);
      return;
    }
    _reviewNotSubmittedSet.add(annotationId);
    await refreshUnmappedQueue();
    document.getElementById('tab-analysis')?.click();
    document.querySelector('.queue-inner-tab[data-queue-tab="active"]')?.click();
    setTimeout(() => highlightInQueue(annotationId, 'NOT_SUBMITTED'), 100);
  }

  async function removeFromReview(annotationId, rec) {
    const statusUpper = String(rec.status || '').toUpperCase();
    if (rec.is_dataset_review) {
      _updateDatasetReviewStatus(annotationId, 'UNMAPPED');
    } else if (_reviewNotSubmittedSet.has(annotationId)) {
      _reviewNotSubmittedSet.delete(annotationId);
    } else {
      // NEEDS_REVIEW or other: hide from active queue without status change
      _queueDismissedSet.add(annotationId);
    }
    await refreshStats();
    await refreshUnmappedQueue();
  }

  async function addDatasetReview(formCode, dsCode, dsLabel, page) {
    const id = `dsreview_${String(formCode).toUpperCase()}_${String(dsCode).toUpperCase()}`;
    // Don't duplicate — just highlight the existing entry
    if (_datasetReviews.find(r => r.annotation_id === id)) {
      document.getElementById('tab-analysis')?.click();
      document.querySelector('.queue-inner-tab[data-queue-tab="active"]')?.click();
      setTimeout(() => highlightInQueue(id, 'NEEDS_REVIEW'), 100);
      return;
    }
    _datasetReviews.push({
      annotation_id: id,
      raw_variable: dsLabel || dsCode,
      sdtm_dataset: String(dsCode).toUpperCase(),
      sdtm_variable: '',
      sdtm_label: dsLabel || dsCode,
      status: 'NEEDS_REVIEW',
      page: page || Store.currentPage,
      form_code: String(formCode).toUpperCase(),
      is_dataset_review: true,
      comment: '',
    });
    await refreshUnmappedQueue();
    // Switch to Analysis > Active tab so user sees the new item
    document.getElementById('tab-analysis')?.click();
    document.querySelector('.queue-inner-tab[data-queue-tab="active"]')?.click();
    setTimeout(() => highlightInQueue(id, 'NEEDS_REVIEW'), 100);
  }

  async function _openCommentForRecord(rec) {
    const dialog = document.getElementById('comment-dialog');
    const titleEl = document.getElementById('comment-dialog-title');
    const input = document.getElementById('comment-dialog-input');
    const placeholder = document.getElementById('comment-dialog-placeholder');
    if (!dialog || !input) return;

    _currentCommentRec = rec;
    const label = rec.sdtm_variable || rec.best_sdtm_variable || rec.raw_variable || 'Annotation';
    if (titleEl) titleEl.textContent = `Comment — ${label}`;

    // For regular (non-dataset-review) annotations, fetch the latest comment
    // from the backend so we always show the most up-to-date value even if
    // Store.annotations hasn't been refreshed since the last save.
    let latestComment = rec.comment || '';
    if (!rec.is_dataset_review && rec.annotation_id) {
      try {
        const r = await window.pywebview.api.get_annotation(String(rec.annotation_id));
        if (r && r.ok && r.record) {
          latestComment = r.record.comment || '';
          _currentCommentRec = { ...rec, comment: latestComment };
        }
      } catch (_) { /* fall back to cached value */ }
    }

    input.value = latestComment;
    if (placeholder) placeholder.style.opacity = input.value ? '0' : '1';
    dialog.classList.remove('hidden');
    setTimeout(() => input.focus(), 50);
  }

  function highlightInQueue(annotationId, status) {
    const analysisTab = document.getElementById('tab-analysis');
    if (analysisTab) analysisTab.click();

    const statusUpper = String(status || '').toUpperCase();
    const isActive = statusUpper === 'UNMAPPED' || statusUpper === 'NEEDS_REVIEW' ||
      (statusUpper === 'NOT_SUBMITTED' && _reviewNotSubmittedSet.has(String(annotationId)));

    const innerTabs = document.querySelectorAll('.queue-inner-tab');
    innerTabs.forEach((t) => {
      if ((isActive && t.dataset.queueTab === 'active') || (!isActive && t.dataset.queueTab === 'resolved')) {
        t.click();
      }
    });

    setTimeout(() => {
      // Try primary list first, fall back to the other list if not found
      const primaryId = isActive ? 'unmapped-queue-list-active' : 'unmapped-queue-list-resolved';
      const fallbackId = isActive ? 'unmapped-queue-list-resolved' : 'unmapped-queue-list-active';

      let row = document.getElementById(primaryId)?.querySelector(`[data-annotation-id="${CSS.escape(annotationId)}"]`);

      if (!row) {
        // Try fallback list and switch tab if needed
        row = document.getElementById(fallbackId)?.querySelector(`[data-annotation-id="${CSS.escape(annotationId)}"]`);
        if (row) {
          innerTabs.forEach((t) => {
            if ((!isActive && t.dataset.queueTab === 'active') || (isActive && t.dataset.queueTab === 'resolved')) {
              t.click();
            }
          });
        }
      }

      if (!row) return;
      // Ensure row is visible (not filtered out)
      row.style.display = '';
      row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      row.classList.add('qr-highlighted');
      setTimeout(() => row.classList.remove('qr-highlighted'), 2200);
    }, 200);
  }

  function _escapeHtml(str) {
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function getDatasetReviews() {
    return _datasetReviews.map(r => ({ ...r }));
  }

  function setDatasetReviews(reviews) {
    if (!Array.isArray(reviews)) return;
    _datasetReviews = reviews.map(r => ({ ...r }));
  }

  function openCommentForAnnotation(rec) {
    _openCommentForRecord(rec);
  }

  function isInActiveReview(annotationId) {
    if (!annotationId) return false;
    return _reviewNotSubmittedSet.has(String(annotationId));
  }

  function isDismissedFromReview(annotationId) {
    if (!annotationId) return false;
    return _queueDismissedSet.has(String(annotationId));
  }

  return {
    init,
    refreshStats,
    refreshUnmappedQueue,
    highlightInQueue,
    addDatasetReview,
    addNotSubmittedToReview,
    removeFromReview,
    isInActiveReview,
    isDismissedFromReview,
    getDatasetReviews,
    setDatasetReviews,
    openCommentForAnnotation,
    goPrev,
    goNext,
    isPipelineRunning: () => pipelineRunning,
  };

})();