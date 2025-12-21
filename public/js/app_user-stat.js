function createPageLoader(options = {}) {
  const title = String(options.title || 'Chargement…');
  // Subtitle kept for backwards-compat with callers, but we no longer render text in the UI.
  const subtitle = String(options.subtitle || 'Préparation de la page…');

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
    // Keep screen reader label up to date.
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

  function setSubtitle(_) {
    // Intentionally no-op (we only show the bar now).
  }

  function getNavHeightPx() {
    const nav = document.querySelector('nav.navbar');
    if (!nav) return 0;
    const rect = nav.getBoundingClientRect();
    const h = Number(rect?.height) || 0;
    return h > 0 ? Math.round(h) : 0;
  }

  function updateOverlayTopOffset() {
    // Scope the offset to this overlay instance (no global CSS var).
    overlay.style.setProperty('--page-loader-top', `${getNavHeightPx()}px`);
  }

  function ensureMounted() {
    if (removed) return;

    // IMPORTANT: even if the overlay is preloaded in HTML (already connected),
    // we still need to compute the navbar offset. Otherwise it defaults to 0px
    // and the blur covers the header.
    updateOverlayTopOffset();
    document.body.classList.add('page-loading');

    if (!overlay.isConnected) document.body.appendChild(overlay);

    // Keep the overlay aligned if the navbar height changes (mobile collapse, resize, etc.)
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

  function fail(_) {
    // Don't block the UI on errors: let the page render its own error message.
    setProgress(Math.max(progress, 95));
    window.setTimeout(() => hideAndRemoveSoon(), 200);
  }

  ensureMounted();
  setProgress(8);

  return { setProgress, setSubtitle, done, fail };
}

window.addEventListener('DOMContentLoaded', async function () {
    const pageLoader = createPageLoader({
      title: 'Chargement des statistiques',
      subtitle: 'Récupération des données…'
    });

    const token = localStorage.getItem('auth_token');
    let winnersCache = null;
    let completionsCache = null;

    async function fetchActiveYear() {
      try {
        const res = await fetch('/api/settings/year', { method: 'GET' });
        if (!res.ok) throw new Error('Failed to fetch active year');
        const data = await res.json();
        const year = Number(data?.year);
        return Number.isInteger(year) ? year : null;
      } catch (_) {
        return null;
      }
    }

    async function fetchWinners() {
      try {
        const res = await fetch('/api/settings/winners', { method: 'GET' });
        if (!res.ok) throw new Error('Failed to fetch winners');
        const data = await res.json().catch(() => ({}));
        return Array.isArray(data?.winners) ? data.winners : [];
      } catch (_) {
        return [];
      }
    }

    async function fetchCompletions() {
      try {
        const res = await fetch('/api/users/completions', {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Failed to fetch completions');
        const data = await res.json().catch(() => ({}));
        return data && typeof data === 'object' ? data : null;
      } catch (_) {
        return null;
      }
    }

    function renderWinners(winners) {
      const tbody = document.getElementById('winners-table-body');
      if (!tbody) return;
      const list = Array.isArray(winners) ? winners : [];
      if (!list.length) {
        tbody.innerHTML = `
          <tr>
            <td colspan="2" class="text-muted">Aucun gagnant défini.</td>
          </tr>
        `;
        return;
      }

      // Group by year (supports ties)
      const byYear = new Map();
      list.forEach((w) => {
        const y = Number(w?.year || 0);
        if (!Number.isInteger(y) || y < 1900 || y > 3000) return;
        const arr = byYear.get(String(y)) || [];
        arr.push({
          year: y,
          name: w?.name || '(utilisateur supprimé)',
          points: w?.points === null || w?.points === undefined || w?.points === '' ? null : Number(w.points),
        });
        byYear.set(String(y), arr);
      });

      const years = Array.from(byYear.keys()).map(Number).sort((a, b) => b - a);
      tbody.innerHTML = '';

      years.forEach((year) => {
        const winnersForYear = byYear.get(String(year)) || [];
        const sorted = winnersForYear.slice().sort((a, b) => {
          const ap = a.points === null || Number.isNaN(a.points) ? null : a.points;
          const bp = b.points === null || Number.isNaN(b.points) ? null : b.points;
          if (ap === null && bp !== null) return 1;
          if (ap !== null && bp === null) return -1;
          if (ap !== null && bp !== null && ap !== bp) return bp - ap;
          return String(a.name || '').localeCompare(String(b.name || ''), 'fr', { sensitivity: 'base' });
        });

        const tr = document.createElement('tr');

        const tdYear = document.createElement('td');
        tdYear.className = 'fw-semibold';
        tdYear.textContent = String(year);
        if (sorted.length > 1) {
          const small = document.createElement('div');
          small.className = 'text-muted small';
          small.textContent = 'égalité';
          tdYear.appendChild(document.createElement('br'));
          tdYear.appendChild(small);
        }

        const tdWinners = document.createElement('td');
        sorted.forEach((w, idx) => {
          const row = document.createElement('div');
          if (idx > 0) row.classList.add('mt-1');

          const name = document.createElement('span');
          name.className = 'fw-semibold';
          name.textContent = w?.name || '(utilisateur supprimé)';
          row.appendChild(name);

          const pts = w.points === null || Number.isNaN(w.points) ? null : w.points;
          if (pts !== null) {
            const ptsSpan = document.createElement('span');
            ptsSpan.className = 'text-muted';
            ptsSpan.textContent = ` — ${pts} pts`;
            row.appendChild(ptsSpan);
          }

          tdWinners.appendChild(row);
        });

        tr.appendChild(tdYear);
        tr.appendChild(tdWinners);
        tbody.appendChild(tr);
      });
    }

    function renderCompletions(completions) {
      const tbody = document.getElementById('completers-table-body');
      if (!tbody) return;

      if (!completions || typeof completions !== 'object') {
        tbody.innerHTML = `
          <tr>
            <td colspan="4" class="text-muted">Impossible de charger les finisseurs 100%.</td>
          </tr>
        `;
        return;
      }

      const years = Array.isArray(completions?.years) ? completions.years : [];
      const totals = completions?.totals && typeof completions.totals === 'object' ? completions.totals : {};
      const byYear = completions?.completersByYear && typeof completions.completersByYear === 'object' ? completions.completersByYear : {};

      if (!years.length) {
        tbody.innerHTML = `
          <tr>
            <td colspan="4" class="text-muted">Aucune année trouvée.</td>
          </tr>
        `;
        return;
      }

      const sortedYears = years
        .map((y) => Number(y))
        .filter((y) => Number.isInteger(y))
        .sort((a, b) => b - a);

      tbody.innerHTML = '';
      sortedYears.forEach((y) => {
        const yearStr = String(y);
        const total = Number(totals?.[yearStr] ?? 0);
        const completers = Array.isArray(byYear?.[yearStr]) ? byYear[yearStr] : [];
        const count = completers.length;

        const tr = document.createElement('tr');

        const tdYear = document.createElement('td');
        tdYear.className = 'fw-semibold';
        tdYear.textContent = yearStr;

        const tdCount = document.createElement('td');
        const badge = document.createElement('span');
        badge.className = 'badge bg-secondary';
        badge.textContent = String(count);
        tdCount.appendChild(badge);

        const tdTotal = document.createElement('td');
        tdTotal.textContent = String(Number.isFinite(total) ? total : 0);

        const tdNames = document.createElement('td');
        if (!count) {
          tdNames.className = 'text-muted';
          tdNames.textContent = '—';
        } else {
          const wrap = document.createElement('div');
          wrap.className = 'd-flex flex-wrap gap-1';
          completers.forEach((u) => {
            const name = document.createElement('span');
            name.className = 'badge bg-light text-dark border';
            name.textContent = u?.name || '(sans nom)';
            wrap.appendChild(name);
          });
          tdNames.appendChild(wrap);
        }

        tr.appendChild(tdYear);
        tr.appendChild(tdCount);
        tr.appendChild(tdTotal);
        tr.appendChild(tdNames);
        tbody.appendChild(tr);
      });
    }

    if (token) {
      try {
        const decoded = JSON.parse(atob(token.split('.')[1])); // Manually decoding JWT
        if (decoded.mustChangePassword) {
          window.location.href = '/change-password.html';
          return;
        }
        const userName = decoded.name;
        document.getElementById('user-name').textContent = userName;
        if (decoded.admin) {
          const adminLink = document.getElementById('admin-control-link');
          if (adminLink) adminLink.classList.remove('d-none');
        }

        // Verify JWT expiration
        const currentTime = Math.floor(Date.now() / 1000);
        if (decoded.exp && decoded.exp < currentTime) {
          console.warn("Token is expired");
          localStorage.removeItem('auth_token');
          window.location.href = '/';
        }
      } catch (error) {
        console.error("Error decoding token:", error);
        localStorage.removeItem('auth_token');
        window.location.href = '/';
      }
    } else {
      window.location.href = '/';
    }

    try {
      pageLoader.setProgress(12);

      // Show loading states immediately (avoid "blank" panels)
      const table = document.querySelector('.user-table');
      const statsError = document.getElementById('stats-error');
      if (table) table.classList.add('d-none');
      if (statsError) statsError.classList.add('d-none');

      pageLoader.setProgress(20);
      const activeYear = await fetchActiveYear();
      if (activeYear) {
        document.title = `Pool Oscars ${activeYear} - Statistiques des utilisateurs`;
        const h2 = document.querySelector('h2');
        if (h2) h2.textContent = `Statistiques des utilisateurs (${activeYear})`;
      }

      const statsUrl = activeYear ? `/api/users/stats?year=${encodeURIComponent(String(activeYear))}` : '/api/users/stats';
      pageLoader.setProgress(32);
      const [statsRes, winners, completions] = await Promise.all([
        fetch(statsUrl, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetchWinners(),
        fetchCompletions(),
      ]);

      winnersCache = winners;
      completionsCache = completions;
      renderWinners(winnersCache);
      renderCompletions(completionsCache);

      if (!statsRes.ok) {
        throw new Error('Failed to fetch user stats');
      }

      pageLoader.setProgress(70);
      const stats = await statsRes.json();
      const userTableBody = document.getElementById('user-table-body');

      // Ensure watchedRatio is treated as a number and sort in descending order
      stats.sort((a, b) => parseFloat(b.watchedRatio) - parseFloat(a.watchedRatio));

      // Clear previous rows to prevent duplication
      userTableBody.innerHTML = '';

      stats.forEach(userStat => {
        const userRow = document.createElement('tr');
        userRow.innerHTML = `
          <td>
            <a href="#" class="user-link" data-movies='${JSON.stringify(userStat.watchedMovies)}'>${userStat.name}</a>
          </td>
          <td>${userStat.watchedCount}</td>
          <td>${userStat.watchedRatio}</td>
        `;
        userTableBody.appendChild(userRow);
      });

      // Show table after loading
      if (table) table.classList.remove('d-none');
      if (statsError) statsError.classList.add('d-none');
      pageLoader.setProgress(92);

      // Add event listener for user links
      document.querySelectorAll('.user-link').forEach(link => {
        link.addEventListener('click', function (event) {
          event.preventDefault();
          const datasetMovies = this.dataset.movies;
          console.log(datasetMovies);
          const movies = JSON.parse(datasetMovies);

          // Clear the current movie list in the modal
          const movieList = document.getElementById('movie-list');
          movieList.innerHTML = '';

          // Populate the modal with the movies the user has watched
          movies.forEach(movie => {
            const movieItem = document.createElement('li');
            movieItem.classList.add('list-group-item');
            movieItem.textContent = movie.title;
            movieList.appendChild(movieItem);
          });

          // Show the modal
          const modal = new bootstrap.Modal(document.getElementById('moviesModal'));
          modal.show();
        });
      });

      pageLoader.done();
    } catch (error) {
      console.error('Error loading user statistics:', error);
      const table = document.querySelector('.user-table');
      const statsError = document.getElementById('stats-error');
      if (table) table.classList.add('d-none');
      if (statsError) {
        statsError.textContent = "Impossible de charger le classement pour le moment.";
        statsError.classList.remove('d-none');
      }
      // Still attempt to render these sections even if stats fail (best effort)
      try {
        if (winnersCache === null) winnersCache = await fetchWinners();
        renderWinners(winnersCache);
      } catch (_) {}
      try {
        if (completionsCache === null) completionsCache = await fetchCompletions();
        renderCompletions(completionsCache);
      } catch (_) {}
      pageLoader.fail();
    }

    // Log-off functionality
    document.getElementById('log-off').addEventListener('click', function() {
      localStorage.removeItem('auth_token');
      window.location.href = '/';
    });
  });