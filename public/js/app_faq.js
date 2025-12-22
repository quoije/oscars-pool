function base64UrlToJson(b64url) {
  const s = String(b64url || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padded = s + '='.repeat((4 - (s.length % 4)) % 4);
  return JSON.parse(atob(padded));
}

function decodeJwtPayload(token) {
  const parts = String(token || '').split('.');
  if (parts.length < 2) return null;
  try { return base64UrlToJson(parts[1]); } catch (_) { return null; }
}

function isExpired(decoded) {
  const exp = Number(decoded?.exp);
  if (!Number.isFinite(exp) || exp <= 0) return false;
  const now = Math.floor(Date.now() / 1000);
  return exp < now;
}

function createPageLoader(options = {}) {
  const title = String(options.title || 'Chargement…');
  let progress = 0;
  let removed = false;
  let navResizeObserver = null;

  // Reuse a preloaded overlay if present (prevents initial "clear" flash).
  const preloadedOverlay = document.getElementById('page-loader-overlay');
  const overlay = preloadedOverlay || document.createElement('div');
  if (!preloadedOverlay) {
    overlay.className = 'page-loader-overlay';
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    overlay.setAttribute('aria-busy', 'true');

    overlay.innerHTML = `
      <div class="page-loader-card page-loader-card--baronly">
        <span class="visually-hidden">${title}</span>
        <div class="page-loader-progress" aria-hidden="true">
          <div class="page-loader-bar" id="page-loader-bar"></div>
        </div>
      </div>
    `;
  } else {
    const label = overlay.querySelector('.visually-hidden');
    if (label) label.textContent = title;
  }

  const barEl = () => overlay.querySelector('#page-loader-bar');

  function clampPct(p) {
    const n = Number(p);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, n));
  }

  function setProgress(p) {
    progress = clampPct(p);
    const bar = barEl();
    if (bar) bar.style.width = `${progress}%`;
  }

  function getNavHeightPx() {
    const nav = document.querySelector('nav.navbar');
    if (!nav) return 0;
    const rect = nav.getBoundingClientRect();
    const h = Number(rect?.height) || 0;
    return h > 0 ? Math.round(h) : 0;
  }

  function updateOverlayTopOffset() {
    overlay.style.setProperty('--page-loader-top', `${getNavHeightPx()}px`);
  }

  function ensureMounted() {
    if (removed) return;
    updateOverlayTopOffset();
    document.body.classList.add('page-loading');
    if (!overlay.isConnected) document.body.appendChild(overlay);

    if (!navResizeObserver) {
      const nav = document.querySelector('nav.navbar');
      if (nav && typeof ResizeObserver !== 'undefined') {
        try {
          navResizeObserver = new ResizeObserver(() => updateOverlayTopOffset());
          navResizeObserver.observe(nav);
        } catch (_) {
          navResizeObserver = null;
        }
      }
    }
  }

  function hideAndRemoveSoon() {
    if (removed) return;
    overlay.classList.add('page-loader-hide');
    overlay.setAttribute('aria-busy', 'false');
    document.body.classList.remove('page-loading');
    window.setTimeout(() => {
      removed = true;
      if (navResizeObserver) {
        try { navResizeObserver.disconnect(); } catch (_) {}
        navResizeObserver = null;
      }
      try { overlay.remove(); } catch (_) {}
    }, 220);
  }

  function done() {
    setProgress(100);
    hideAndRemoveSoon();
  }

  function fail() {
    setProgress(Math.max(progress, 95));
    window.setTimeout(() => hideAndRemoveSoon(), 200);
  }

  ensureMounted();
  setProgress(8);

  return { setProgress, done, fail };
}

async function fetchActiveYear() {
  try {
    const res = await fetch('/api/settings/year', { method: 'GET', cache: 'no-cache' });
    if (!res.ok) throw new Error('Failed to fetch active year');
    const data = await res.json();
    const year = Number(data?.year);
    return Number.isInteger(year) ? year : null;
  } catch (_) {
    return null;
  }
}

window.addEventListener('DOMContentLoaded', async function () {
  const pageLoader = createPageLoader({ title: 'Chargement de la FAQ' });
  pageLoader.setProgress(14);

  const token = localStorage.getItem('auth_token');
  if (!token) {
    window.location.href = '/';
    return;
  }

  const decoded = decodeJwtPayload(token);
  if (!decoded || isExpired(decoded)) {
    try { localStorage.removeItem('auth_token'); } catch (_) {}
    window.location.href = '/';
    return;
  }

  if (decoded.mustChangePassword) {
    window.location.href = '/change-password.html';
    return;
  }

  // Header is usually set by app_header_boot, but keep it consistent if it ran before DOM was ready.
  const nameEl = document.getElementById('user-name');
  if (nameEl && !nameEl.textContent) nameEl.textContent = decoded.name || '';

  if (decoded.admin) {
    const adminLink = document.getElementById('admin-control-link');
    if (adminLink) adminLink.classList.remove('d-none');
  }

  pageLoader.setProgress(40);
  const activeYear = await fetchActiveYear();
  if (activeYear) document.title = `Pool Oscars (${activeYear}) - FAQ`;
  pageLoader.setProgress(90);

  const logoffBtn = document.getElementById('log-off');
  if (logoffBtn) {
    logoffBtn.addEventListener('click', function () {
      localStorage.removeItem('auth_token');
      window.location.href = '/';
    });
  }

  pageLoader.done();
});

