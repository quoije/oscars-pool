// Runs early (defer) to populate the navbar before page-specific JS.
// Goal: avoid "late" header updates that look like flicker.
(function () {
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

  const token = localStorage.getItem('auth_token');
  if (!token) return;

  const decoded = decodeJwtPayload(token);
  if (!decoded) return;

  // Fast-path redirect checks (match page scripts behavior).
  if (decoded.mustChangePassword && !/\/change-password\.html(\?|#|$)/.test(window.location.pathname)) {
    window.location.href = '/change-password.html';
    return;
  }
  if (isExpired(decoded)) {
    try { localStorage.removeItem('auth_token'); } catch (_) {}
    if (!/\/index\.html$/.test(window.location.pathname) && window.location.pathname !== '/') {
      window.location.href = '/';
    }
    return;
  }

  const nameEl = document.getElementById('user-name');
  if (nameEl && !nameEl.textContent) {
    nameEl.textContent = decoded.name || '';
  }

  const adminLink = document.getElementById('admin-control-link');
  if (adminLink && decoded.admin) {
    adminLink.classList.remove('d-none');
  }
})();

