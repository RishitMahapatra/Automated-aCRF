/* docs/script.js — GitHub Pages documentation JS */

(function () {
  'use strict';

  /* ─── Reading progress bar ─────────────────────────────────────────────── */
  const progressBar = document.getElementById('progress-bar');
  function updateProgress() {
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const total = document.documentElement.scrollHeight - window.innerHeight;
    const pct = total > 0 ? (scrollTop / total) * 100 : 0;
    if (progressBar) progressBar.style.width = pct + '%';
  }
  window.addEventListener('scroll', updateProgress, { passive: true });
  updateProgress();

  /* ─── Active nav link highlighting ─────────────────────────────────────── */
  const navLinks = document.querySelectorAll('.nav-link');
  const sections = Array.from(document.querySelectorAll('section[id], div[id].section'));

  function getActiveSection() {
    const offset = 120;
    let active = null;
    for (const sec of sections) {
      if (sec.getBoundingClientRect().top <= offset) active = sec;
    }
    return active;
  }

  function highlightNav() {
    const active = getActiveSection();
    navLinks.forEach(link => {
      const href = link.getAttribute('href');
      if (active && href === '#' + active.id) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });
  }

  window.addEventListener('scroll', highlightNav, { passive: true });
  highlightNav();

  /* ─── Smooth scroll for nav links ──────────────────────────────────────── */
  navLinks.forEach(link => {
    link.addEventListener('click', function (e) {
      const href = this.getAttribute('href');
      if (href && href.startsWith('#')) {
        e.preventDefault();
        const target = document.getElementById(href.slice(1));
        if (target) {
          const top = target.getBoundingClientRect().top + window.scrollY - 80;
          window.scrollTo({ top, behavior: 'smooth' });
          // Close mobile sidebar if open
          closeSidebar();
        }
      }
    });
  });

  /* ─── Mobile sidebar toggle ─────────────────────────────────────────────── */
  const hamburger = document.getElementById('hamburger');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');

  function openSidebar() {
    sidebar?.classList.add('open');
    overlay?.classList.add('visible');
    document.body.style.overflow = 'hidden';
  }

  function closeSidebar() {
    sidebar?.classList.remove('open');
    overlay?.classList.remove('visible');
    document.body.style.overflow = '';
  }

  hamburger?.addEventListener('click', openSidebar);
  overlay?.addEventListener('click', closeSidebar);

  /* ─── Copy-to-clipboard on code blocks ─────────────────────────────────── */
  document.querySelectorAll('.code-block').forEach(block => {
    const pre = block.querySelector('pre');
    if (!pre) return;

    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy';
    block.style.position = 'relative';
    block.appendChild(btn);

    btn.addEventListener('click', async () => {
      const code = pre.querySelector('code')?.innerText ?? pre.innerText;
      try {
        await navigator.clipboard.writeText(code);
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy';
          btn.classList.remove('copied');
        }, 2000);
      } catch {
        btn.textContent = 'Error';
      }
    });
  });

  /* ─── Scroll-reveal (subtle fade-in for cards) ──────────────────────────── */
  const revealEls = document.querySelectorAll('.feature-card, .step-card, .callout');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });
    revealEls.forEach(el => { el.classList.add('hidden-reveal'); io.observe(el); });
  } else {
    revealEls.forEach(el => el.classList.add('revealed'));
  }

  /* ─── Back-to-top button ─────────────────────────────────────────────── */
  const btt = document.getElementById('back-to-top');
  if (btt) {
    window.addEventListener('scroll', () => {
      btt.classList.toggle('visible', window.scrollY > 400);
    }, { passive: true });
    btt.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  }
})();
