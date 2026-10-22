/* ==========================================================================
   Kharisma Hub — Interactive Motion Layer
   - Staggered entrance + scroll reveal (safe across dynamic module switches)
   - Count-up numbers for KPI values
   - Button ripple feedback
   - Smooth page-leave transition between MPA pages
   - Fully disabled when the user prefers reduced motion
   ========================================================================== */
(() => {
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const REVEAL_SELECTOR = [
    '.summary-card', '.dashboard-grid .panel', '.module-card', '.attendance-status',
    '.att-meta-card', '.kpi-stat-card', '.employee-card', '.employee-stat', '.department-card',
    '.calendar-stat', '.payroll-stats article', '.leave-stats > article', '.dept-manage-card',
    '.stat-mini-card', '.leave-summary-card', '.employee-profile-card', '.vacancy-box'
  ].join(',');

  const COUNT_SELECTOR = [
    '#dashTotalEmployees', '#dashAttendanceRate', '#dashLeaveRequests',
    '.report-score', '.performance-score', '.employment-total', '.satisfaction-main strong',
    '.status-card-val', '.kpi-stat-card strong', '.employee-stat > strong', '.calendar-stat > strong',
    '.payroll-stats article > strong', '.leave-stats > article > strong', '.applicant-total-bottom strong'
  ].join(',');

  const RIPPLE_SELECTOR = [
    '.module-button', '.att-main-cta-btn', '.att-sub-btn', '.topbar-absen-btn', '.dash-absen-btn',
    '.promo-btn', '.sidebar-promo a', '.nav-link', '.date-filter', '.folder-button', '.kpi-tab-btn',
    '.compose-new', '.send-button', '.top-icon', '.cloud-badge'
  ].join(',');

  /* ---------- Entrance & scroll reveal ---------- */
  function setupReveal() {
    const items = [...document.querySelectorAll(REVEAL_SELECTOR)]
      .filter(el => !el.closest('dialog') && !el.closest('[hidden]') && el.offsetParent !== null && !el.classList.contains('revealed'));
    if (!items.length) return;

    const vh = window.innerHeight || 800;
    let introIndex = 0;
    const observer = 'IntersectionObserver' in window
      ? new IntersectionObserver((entries) => {
          entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add('revealed');
            observer.unobserve(entry.target);
          });
        }, { rootMargin: '0px 0px -40px 0px', threshold: 0.08 })
      : null;

    items.forEach(el => {
      const rect = el.getBoundingClientRect();
      el.classList.add('reveal');
      if (rect.top < vh && rect.bottom > 0) {
        el.style.setProperty('--reveal-delay', `${Math.min(introIndex, 14) * 45}ms`);
        introIndex += 1;
        requestAnimationFrame(() => el.classList.add('revealed'));
      } else if (observer) {
        observer.observe(el);
      } else {
        el.classList.add('revealed');
      }
    });

    // Safety net: never leave anything hidden
    setTimeout(() => items.forEach(el => el.classList.add('revealed')), 2500);
  }

  /* ---------- Count-up numbers ---------- */
  function animateNumber(el) {
    if (el.dataset.khCounted) return;
    const node = [...el.childNodes].find(n => n.nodeType === Node.TEXT_NODE && /\d/.test(n.textContent));
    if (!node) return;
    const raw = node.textContent;
    const match = raw.match(/([+-]?)(\d+(?:[.,]\d+)?)/);
    if (!match) return;
    const numStr = match[2];
    const decimals = (numStr.split(/[.,]/)[1] || '').length;
    const sep = numStr.includes(',') ? ',' : '.';
    const target = parseFloat(numStr.replace(',', '.'));
    if (!Number.isFinite(target) || target === 0 || target > 100000) return;
    el.dataset.khCounted = 'true';
    const prefix = raw.slice(0, match.index + match[1].length);
    const suffix = raw.slice(match.index + match[0].length);
    const duration = 900;
    const start = performance.now();
    const ease = t => 1 - Math.pow(1 - t, 3);
    const step = (now) => {
      if (!node.isConnected) return;
      const p = Math.min(1, (now - start) / duration);
      const value = (target * ease(p)).toFixed(decimals).replace('.', sep);
      node.textContent = `${prefix}${value}${suffix}`;
      if (p < 1) requestAnimationFrame(step);
      else node.textContent = raw;
    };
    requestAnimationFrame(step);
  }

  function setupCountUp() {
    document.querySelectorAll(COUNT_SELECTOR).forEach(el => {
      if (el.closest('[hidden]') || el.offsetParent === null) return;
      animateNumber(el);
    });
  }

  /* ---------- Ripple feedback ---------- */
  function setupRipple() {
    document.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const target = event.target.closest(RIPPLE_SELECTOR);
      if (!target || target.disabled) return;
      const rect = target.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 1.6;
      const ripple = document.createElement('span');
      ripple.className = 'kh-ripple';
      ripple.style.width = ripple.style.height = `${size}px`;
      ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
      ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
      target.classList.add('kh-ripple-host');
      target.appendChild(ripple);
      ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
    }, { passive: true });
  }

  /* ---------- Smooth page transitions (MPA) ---------- */
  function setupPageTransitions() {
    document.addEventListener('click', (event) => {
      const link = event.target.closest('a.nav-link, a.brand');
      if (!link || event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target === '_blank') return;
      const href = link.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      event.preventDefault();
      document.body.classList.add('kh-page-leave');
      setTimeout(() => { window.location.href = url.href; }, 170);
    });
    window.addEventListener('pageshow', () => document.body.classList.remove('kh-page-leave'));
  }

  /* ---------- Topbar scroll state ---------- */
  function setupTopbarScroll() {
    const topbar = document.querySelector('.topbar');
    if (!topbar) return;
    const onScroll = () => topbar.classList.toggle('is-scrolled', window.scrollY > 6);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  let refreshTimer = null;
  function refresh() {
    if (prefersReduced) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      setupReveal();
      setupCountUp();
    }, 50);
  }

  function init() {
    document.body.classList.add('kh-motion-ready');
    setupTopbarScroll();
    if (prefersReduced) return;
    setupRipple();
    setupPageTransitions();
    requestAnimationFrame(() => {
      setupReveal();
      setupCountUp();
    });

    const mv = document.querySelector('#moduleView');
    if (mv && 'MutationObserver' in window) {
      const mo = new MutationObserver(() => refresh());
      mo.observe(mv, { childList: true, subtree: false });
    }
  }

  window.KhMotion = { refresh, setupReveal, setupCountUp };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 0));
  } else {
    setTimeout(init, 0);
  }
})();
