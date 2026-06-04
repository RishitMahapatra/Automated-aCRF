// ui/js/sidebar.js

const Sidebar = (() => {
  'use strict';

  function init() {
    console.log('[sidebar] init');
    _bindUpload();
    _bindPipeline();
    _bindNavigation();
  }

  // ===========================================================================
  // UPLOAD
  // ===========================================================================

  function _bindUpload() {
    const dropZone = document.getElementById('drop-zone');
    if (!dropZone) return;

    dropZone.addEventListener('click', async () => {
      try {
        const result = await window.pywebview.api.select_pdf();
        if (!result || !result.ok) {
          return;
        }

        Store.sessionId = result.session_id || result.filename.replace('.pdf', '').replace(/\s+/g, '_');
        Store.pdfLoaded = true;
        Store.pdfName = result.filename;
        Store.currentPage = 1;

        _showFileLoaded(result.filename);
        _setSessionInput(Store.sessionId);
        _setNavSession(Store.sessionId);

        // Get page count immediately after selecting PDF
        const pageRes = await window.pywebview.api.get_page_count();
        if (pageRes && pageRes.ok) {
          Store.pageCount = pageRes.count || 0;
          _setFilePages(Store.pageCount);
          _updatePageDisplay();
          _updateNavPageCount();
        }

        // Hide empty state if needed
        if (typeof Canvas !== 'undefined' && Canvas.showEmpty) {
          Canvas.showEmpty(false);
        }

      } catch (e) {
        console.error('[sidebar] select_pdf error:', e);
      }
    });
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

        // Push session to backend
        await window.pywebview.api.set_session_id(sessionId);

        _resetPipelineSteps();
        _setPipelineStepRunning(0);

        btnRun.disabled = true;
        btnRun.innerHTML = '<span class="btn-icon">⏳</span> Running...';

        // Since backend currently runs everything in one shot,
        // we simulate step progression in UI.
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

        // Refresh page count after pipeline
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
        btnRun.disabled = false;
        btnRun.innerHTML = '<span class="btn-icon">▶</span> Run Pipeline';
      }
    });
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
    const gotoInput = document.getElementById('goto-input');

    if (btnPrev) {
      btnPrev.addEventListener('click', async () => {
        if (!Store.pipelineRan) return;
        if (Store.currentPage <= 1) return;

        Store.currentPage -= 1;
        _updatePageDisplay();
        _updateNavPageCount();

        if (typeof Canvas !== 'undefined' && Canvas.loadPage) {
          await Canvas.loadPage(Store.currentPage);
        }
      });
    }

    if (btnNext) {
      btnNext.addEventListener('click', async () => {
        if (!Store.pipelineRan) return;
        if (Store.currentPage >= Store.pageCount) return;

        Store.currentPage += 1;
        _updatePageDisplay();
        _updateNavPageCount();

        if (typeof Canvas !== 'undefined' && Canvas.loadPage) {
          await Canvas.loadPage(Store.currentPage);
        }
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

  function _updatePageDisplay() {
    const pageDisplay = document.getElementById('page-display');
    if (pageDisplay) {
      const current = Store.pageCount ? Store.currentPage : '—';
      const total = Store.pageCount || '—';
      pageDisplay.textContent = `${current} / ${total}`;
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
  };
})();