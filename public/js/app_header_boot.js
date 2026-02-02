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

  const name = decoded.name || '';
  const displayName = name;
  const nameTargets = document.querySelectorAll('[data-user-name]');
  if (nameTargets.length) {
    nameTargets.forEach((el) => {
      if (el && !el.textContent) el.textContent = displayName;
    });
  } else {
    const nameEl = document.getElementById('user-name');
    if (nameEl && !nameEl.textContent) {
      nameEl.textContent = displayName;
    }
  }

  const adminLink = document.getElementById('admin-control-link');
  if (adminLink && decoded.admin) {
    adminLink.classList.remove('d-none');
  }

  // Check visibility config for picks button
  const picksButton = document.getElementById('nav-link-picks');
  if (picksButton) {
    // Check cached value first for immediate display
    const cachedConfig = localStorage.getItem('visibility_config_cache');
    let cachedValue = null;
    let cachedTimestamp = null;
    
    if (cachedConfig) {
      try {
        const parsed = JSON.parse(cachedConfig);
        cachedValue = parsed.value;
        cachedTimestamp = parsed.timestamp;
      } catch (e) {
        // Invalid cache, ignore
      }
    }
    
    // Use cached value if it's less than 5 minutes old
    const cacheAge = cachedTimestamp ? Date.now() - cachedTimestamp : Infinity;
    const useCache = cachedValue !== null && cacheAge < 5 * 60 * 1000;
    
    if (useCache) {
      // Show button immediately based on cached value
      if (cachedValue.showPicksButton !== false) {
        picksButton.style.display = '';
      } else {
        picksButton.style.display = 'none';
      }
    } else {
      // Default to hiding while we fetch (new installs should start disabled)
      picksButton.style.display = 'none';
    }
    
    // Fetch fresh value from server
    fetch('/api/settings/visibility-config', { cache: 'no-store' })
      .then(res => res.json())
      .then(config => {
        // Cache the result
        localStorage.setItem('visibility_config_cache', JSON.stringify({
          value: config,
          timestamp: Date.now()
        }));
        
        // Update display based on fresh value
        if (config.showPicksButton !== false) {
          picksButton.style.display = '';
        } else {
          picksButton.style.display = 'none';
        }
      })
      .catch(() => {
        // On error, keep current state (already set from cache or default)
      });
  }

  // Highlight the active page in the navbar.
  (function markActiveNavLink() {
    const currentFile = (String(window.location.pathname || '').split('/').pop() || 'index.html').toLowerCase();
    const links = document.querySelectorAll('nav.navbar .navbar-nav a.nav-link[href]');
    links.forEach((a) => {
      const rawHref = String(a.getAttribute('href') || '');
      const hrefFile = rawHref.split('#')[0].split('?')[0].split('/').pop().toLowerCase();
      const isCurrent = hrefFile && hrefFile === currentFile;
      a.classList.toggle('is-current', isCurrent);
      if (isCurrent) {
        a.setAttribute('aria-current', 'page');
      } else if (a.getAttribute('aria-current') === 'page') {
        a.removeAttribute('aria-current');
      }
    });
  })();
})();

