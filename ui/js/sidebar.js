// ui/js/sidebar.js

const Sidebar = (() => {
  'use strict';

  let pipelineRunning = false;

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

    btnRestart.addEventListener('click', async () => {
      try {
        if (pipelineRunning) return;

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
        const pageDisplaySticky = document.getElementById('page-display-sticky');
        const navPageCount = document.getElementById('nav-page-count'); 
        const commentsBox = document.getElementById('analysis-comments');

        if (dropZone) dropZone.classList.remove('hidden');
        if (fileLoaded) fileLoaded.classList.add('hidden');
        if (sessionInput) sessionInput.value = '';
        if (navSession) navSession.textContent = 'No session';
        if (fileNameLabel) fileNameLabel.textContent = '—';
        if (filePagesLabel) filePagesLabel.textContent = '— pages';
        if (pageDisplay) pageDisplay.textContent = '— / —';
        if (pageDisplaySticky) pageDisplaySticky.textContent = '— / —';
        if (navPageCount) navPageCount.textContent = '— / —';
        
        if (commentsBox) commentsBox.value = '';

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
        btnRun.innerHTML = '<span class="btn-icon"> </span> Running...';

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
          _renderPageButtons();
        }

        Store.currentPage = 1;
        Store.pipelineRan = true;

        _updatePageDisplay();
        _updateNavPageCount();

        await refreshStats();
        await refreshUnmappedQueue();

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

  // ==========================================================
  // NAVIGATION
  // ==========================================================

function _bindNavigation() {
  const btnPrevSticky = document.getElementById('btn-prev-sticky');
  const btnNextSticky = document.getElementById('btn-next-sticky');
  const btnZoomInSticky = document.getElementById('btn-zoom-in-sticky');
  const btnZoomOutSticky = document.getElementById('btn-zoom-out-sticky');

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

      _setText('analysis-total', Store.stats.total);
      _setText('analysis-reviewed', Store.stats.unmapped);
      _setText(
        'analysis-ignored',
        (Store.stats.resolved || 0) + (Store.stats.user_corrected || 0) + (Store.stats.not_submitted || 0)
      );

      const queueSummary = document.getElementById('unmapped-queue-summary');
      if (queueSummary) {
        queueSummary.textContent = `${Store.stats.unmapped || 0} unmapped`;
      }

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

    _setText('analysis-total', 0);
    _setText('analysis-reviewed', 0);
    _setText('analysis-ignored', 0);

    const queueSummary = document.getElementById('unmapped-queue-summary');
    if (queueSummary) {
      queueSummary.textContent = '0 unmapped';
    }

    const queueList = document.getElementById('unmapped-queue-list');
    if (queueList) {
      queueList.innerHTML = '';
    }

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

  // ==========================================================
  // ANALYSIS / UNMAPPED QUEUE
  // ==========================================================

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
    const input = document.getElementById('unmapped-queue-search');
    if (!input) return;

    input.addEventListener('input', () => {
      _applyQueueFilters();
    });
  }

  function _applyQueueFilters() {
    const listEl = document.getElementById('unmapped-queue-list');
    if (!listEl) return;

    const activeFilter =
      document.querySelector('.unmapped-filter-chip.active')?.dataset.filter || 'all';
    const query = (document.getElementById('unmapped-queue-search')?.value || '')
      .trim()
      .toLowerCase();

    const rows = Array.from(listEl.querySelectorAll('.unmapped-row'));
    rows.forEach((row) => {
      const status = row.dataset.queueStatus || 'unreviewed';
      const raw = (row.dataset.rawVar || '').toLowerCase();
      const domain = (row.dataset.domain || '').toLowerCase();
      const page = String(row.dataset.page || '').toLowerCase();

      const matchesFilter =
        activeFilter === 'all' ? true : status === activeFilter;

      const matchesSearch =
        !query ||
        raw.includes(query) ||
        domain.includes(query) ||
        page.includes(query) ||
        (`page ${page}`).includes(query);

      row.style.display = matchesFilter && matchesSearch ? '' : 'none';
    });
  }

  async function refreshUnmappedQueue() {
    try {
      const res = await window.pywebview.api.get_annotations();
      const listEl = document.getElementById('unmapped-queue-list');
      const summaryEl = document.getElementById('unmapped-queue-summary');

      if (!listEl || !res || !res.ok) return;

      const records = Array.isArray(res.records) ? res.records : [];

      const queue = records.filter((r) => {
        const status = String(r.status || '').toUpperCase();
        return status === 'UNMAPPED' || status === 'NOT_SUBMITTED';
      });

      if (summaryEl) {
        summaryEl.textContent = `${queue.length} unmapped`;
      }

      listEl.innerHTML = '';

      if (!queue.length) {
        listEl.innerHTML = `
          <div class="muted small" style="padding:8px 2px;">
            No unmapped variables
          </div>
        `;
        return;
      }

      queue.slice(0, 300).forEach((rec) => {
        const row = document.createElement('div');

        const statusUpper = String(rec.status || '').toUpperCase();
        const isIgnored = statusUpper === 'NOT_SUBMITTED';

        row.className = isIgnored
          ? 'unmapped-row unmapped-row-resolved'
          : 'unmapped-row unmapped-row-review';

        const rawVar =
          rec.raw_variable ||
          rec.sdtm_variable ||
          rec.variable_name ||
          rec.label ||
          '—';

        const domain =
          rec.domain_hint ||
          rec.sdtm_dataset ||
          rec.dataset ||
          'NA';

        const page =
          rec.page_number ??
          rec.page ??
          rec.page_num ??
          '—';

        const statusText = isIgnored ? 'Ignored' : 'Needs Review';
        const filterStatus = isIgnored ? 'ignored' : 'review';

        row.dataset.queueStatus = filterStatus;
        row.dataset.rawVar = String(rawVar || '');
        row.dataset.domain = String(domain || '');
        row.dataset.page = String(page || '');

        row.innerHTML = `
          <div class="unmapped-status-dot"></div>
          <div class="unmapped-row-left">
            <span class="unmapped-var">${_escapeHtml(String(rawVar))}</span>
            <div class="unmapped-meta">
              <span class="unmapped-domain-badge">${_escapeHtml(String(domain))}</span>
              <span>${_escapeHtml(statusText)}</span>
            </div>
          </div>
          <span class="unmapped-page">Page ${_escapeHtml(String(page))}</span>
        `;

        row.addEventListener('click', async () => {
          const numericPage = Number(page);
          if (!numericPage || Number.isNaN(numericPage)) return;

          Store.currentPage = numericPage;
          _updatePageDisplay();
          _updateNavPageCount();

          const statsTab = document.getElementById('tab-stats');
          if (statsTab) statsTab.click();

          if (typeof Canvas !== 'undefined' && Canvas.loadPage) {
            await Canvas.loadPage(Store.currentPage);
          }
        });

        listEl.appendChild(row);
      });

      _applyQueueFilters();
    } catch (e) {
      console.error('[sidebar] refreshUnmappedQueue error:', e);
    }
  }

  function _escapeHtml(str) {
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  return {
    init,
    refreshStats,
    refreshUnmappedQueue,
    goPrev,
    goNext,
    isPipelineRunning: () => pipelineRunning,
  };
})();