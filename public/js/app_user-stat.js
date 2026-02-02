function createPageLoader(options = {}) {
  const title = String(options.title || t('common.loading', 'Loading…'));
  // Subtitle kept for backwards-compat with callers, but we no longer render text in the UI.
  const subtitle = String(options.subtitle || t('stats.preparingPage', 'Preparing page…'));

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

function getLocale() {
  return (window.i18n && typeof window.i18n.getLanguage === 'function')
    ? window.i18n.getLanguage()
    : (document.documentElement.lang || 'en');
}

function t(key, fallback, params) {
  try {
    if (window.i18n && typeof window.i18n.t === 'function') {
      return window.i18n.t(key, params || {});
    }
  } catch (_) {}
  let out = (typeof fallback === 'string') ? fallback : String(key);
  if (params && typeof params === 'object') {
    Object.keys(params).forEach((k) => {
      out = out.replace(new RegExp(`\\{${k}\\}`, 'g'), String(params[k]));
    });
  }
  return out;
}

window.addEventListener('DOMContentLoaded', async function () {
    const pageLoader = createPageLoader({
      title: t('stats.loadingStats', 'Loading statistics'),
      subtitle: t('stats.fetchingData', 'Fetching data…')
    });

    const token = localStorage.getItem('auth_token');
    let winnersCache = null;
    let completionsCache = null;

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

    async function fetchWinners() {
      try {
        const res = await fetch('/api/settings/winners', { method: 'GET', cache: 'no-cache' });
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
          headers: { 'Authorization': `Bearer ${token}` },
          cache: 'no-cache',
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
            <td colspan="2" class="text-muted">${t('stats.noWinnersDefined', 'No winners defined.')}</td>
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
          name: w?.name || t('stats.deletedUser', '(deleted user)'),
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
          small.textContent = t('stats.tie', 'tie');
          tdYear.appendChild(document.createElement('br'));
          tdYear.appendChild(small);
        }

        const tdWinners = document.createElement('td');
        sorted.forEach((w, idx) => {
          const row = document.createElement('div');
          if (idx > 0) row.classList.add('mt-1');

          const name = document.createElement('span');
          name.className = 'fw-semibold';
          name.textContent = w?.name || t('stats.deletedUser', '(deleted user)');
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
            <td colspan="3" class="text-muted">${t('stats.unableToLoadCompleters', 'Unable to load 100% completers.')}</td>
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
            <td colspan="3" class="text-muted">${t('stats.noYearsFound', 'No years found.')}</td>
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

        const tr = document.createElement('tr');

        const tdYear = document.createElement('td');
        tdYear.className = 'fw-semibold';
        tdYear.textContent = yearStr;

        const tdTotal = document.createElement('td');
        tdTotal.textContent = String(Number.isFinite(total) ? total : 0);

        const tdNames = document.createElement('td');
        if (!completers.length) {
          tdNames.className = 'text-muted';
          tdNames.textContent = '—';
        } else {
          const wrap = document.createElement('div');
          wrap.className = 'd-flex flex-wrap gap-1';
          completers.forEach((u, idx) => {
            const rank = idx + 1;
            const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '';
            const badge = document.createElement('span');
            badge.className = 'badge bg-light text-dark border';
            // Show rank, medal (if top 3), and name
            const rankPrefix = medal ? `${medal} ` : `#${rank} `;
            // Format completion date if available
            let dateStr = '';
            if (u?.completedAt) {
              const date = new Date(u.completedAt);
              dateStr = ` (${date.toLocaleDateString(getLocale())})`;
            }
            badge.textContent = `${rankPrefix}${u?.name || t('stats.unnamed', '(unnamed)')}${dateStr}`;
            wrap.appendChild(badge);
          });
          tdNames.appendChild(wrap);
        }

        tr.appendChild(tdYear);
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

      // Modal UI (watched movies)
      const moviesModalEl = document.getElementById('moviesModal');
      const movieGridEl = document.getElementById('movie-grid');
      const moviesSummaryEl = document.getElementById('movies-summary');
      const moviesEmptyEl = document.getElementById('movies-empty');
      const moviesModalTitleEl = document.getElementById('moviesModalLabel');

      let currentModalUserName = '';
      let currentModalMovies = [];

      function safeStr(v) {
        return (v === null || v === undefined) ? '' : String(v);
      }

      function parseMaybeNumber(v) {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      }

      function formatWatchedDate(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        try {
          return d.toLocaleDateString(getLocale(), { year: 'numeric', month: 'short', day: 'numeric' });
        } catch (_) {
          return d.toLocaleDateString();
        }
      }

      function normalizePosterUrl(poster) {
        const s = safeStr(poster).trim();
        if (!s || s.toUpperCase() === 'N/A') return '';
        return s;
      }

      function sortMoviesRecent(list) {
        const arr = Array.isArray(list) ? list.slice() : [];
        // watchedDate desc, fallback title
        arr.sort((a, b) => {
          const at = a?.watchedDate ? new Date(a.watchedDate).getTime() : 0;
          const bt = b?.watchedDate ? new Date(b.watchedDate).getTime() : 0;
          if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return bt - at;
          return safeStr(a?.title).localeCompare(safeStr(b?.title), 'fr', { sensitivity: 'base' });
        });
        return arr;
      }

      function renderMoviesModal() {
        if (!movieGridEl || !moviesSummaryEl || !moviesEmptyEl) return;

        const sorted = sortMoviesRecent((Array.isArray(currentModalMovies) ? currentModalMovies : []));

        const total = Array.isArray(currentModalMovies) ? currentModalMovies.length : 0;
        moviesSummaryEl.textContent = total
          ? t('stats.filmCount', '{count} movie{plural}', { count: total, plural: total > 1 ? 's' : '' })
          : t('stats.noFilms', '0 movies');

        movieGridEl.innerHTML = '';
        if (!sorted.length) {
          moviesEmptyEl.classList.remove('d-none');
          return;
        }
        moviesEmptyEl.classList.add('d-none');

        sorted.forEach((movie) => {
          const movieId = safeStr(movie?.movieId).trim();
          const imdbId = safeStr(movie?.imdb_id).trim();
          const title = safeStr(movie?.title).trim() || '(sans titre)';
          const category = safeStr(movie?.category).trim();
          const ratingRaw = safeStr(movie?.rating).trim();
          const rating = parseMaybeNumber(ratingRaw);
          const watchedLabel = formatWatchedDate(movie?.watchedDate);
          const posterUrl = normalizePosterUrl(movie?.poster);

          const cleanUrl = (v) => {
            const s = (typeof v === 'string' ? v.trim() : '');
            if (!s || s === '#' || s.toLowerCase() === 'about:blank') return '';
            return s;
          };

          // Click behavior (requested):
          // - If vod_link is set => go to it
          // - Else if any playable source exists => go to player
          // - Else => not clickable
          const vodLink = cleanUrl(movie?.vod_link);
          const hasPlayableSource = !!cleanUrl(movie?.video_src) || !!cleanUrl(movie?.embed_src) || !!cleanUrl(movie?.video_file);
          const isClickable = !!vodLink || (!!movieId && hasPlayableSource);

          const item = document.createElement('div');
          item.className = 'stats-movie-item';
          if (isClickable) {
            item.classList.add('stats-movie-item--clickable');
            item.setAttribute('role', 'link');
            item.setAttribute('tabindex', '0');
            item.setAttribute('aria-label', vodLink ? t('stats.openLink', 'Open link') + ': ' + title : t('stats.openPlayer', 'Open player') + ': ' + title);
          }

          const poster = document.createElement('img');
          poster.className = 'stats-movie-poster';
          poster.alt = title;
          if (posterUrl) {
            poster.src = posterUrl;
          } else {
            poster.classList.add('stats-movie-poster--empty');
            // Keep src empty; browser will not request anything.
            poster.src = '';
          }
          poster.addEventListener('error', () => {
            poster.classList.add('stats-movie-poster--empty');
            try { poster.removeAttribute('src'); } catch (_) {}
          });

          function openIfPossible(evt) {
            if (!isClickable) return;
            // Don't hijack clicks inside controls (IMDb button, details summary, etc.)
            const target = evt?.target;
            if (target && typeof target.closest === 'function') {
              if (target.closest('a, button, summary, details')) return;
            }

            if (vodLink) {
              // Use a new tab (keeps the app state intact)
              try {
                const w = window.open(vodLink, '_blank', 'noopener,noreferrer');
                if (!w) window.location.href = vodLink;
              } catch (_) {
                window.location.href = vodLink;
              }
              return;
            }

            if (movieId && hasPlayableSource) {
              window.location.href = `/player.html?id=${encodeURIComponent(movieId)}`;
            }
          }

          if (isClickable) {
            item.addEventListener('click', openIfPossible);
            item.addEventListener('keydown', (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openIfPossible(e);
              }
            });
          }

          const main = document.createElement('div');
          main.className = 'flex-grow-1';

          const topRow = document.createElement('div');
          topRow.className = 'd-flex align-items-start justify-content-between gap-2';

          const titleEl = document.createElement('div');
          titleEl.className = 'stats-movie-title';
          titleEl.textContent = title;

          const right = document.createElement('div');
          right.className = 'text-nowrap';

          if (imdbId) {
            const imdbLink = document.createElement('a');
            imdbLink.className = 'btn btn-outline-dark btn-sm stats-movie-imdb';
            imdbLink.href = `https://www.imdb.com/title/${encodeURIComponent(imdbId)}/`;
            imdbLink.target = '_blank';
            imdbLink.rel = 'noopener noreferrer';
            imdbLink.setAttribute('aria-label', (window.i18n && typeof window.i18n.t === 'function') ? window.i18n.t('movies.viewOnImdb') : 'View on IMDb');

            const imdbIcon = document.createElement('span');
            imdbIcon.className = 'imdb-icon';
            imdbIcon.setAttribute('aria-hidden', 'true');
            imdbIcon.textContent = 'IMDb';

            imdbLink.appendChild(imdbIcon);
            right.appendChild(imdbLink);
          }

          topRow.appendChild(titleEl);
          topRow.appendChild(right);

          const meta = document.createElement('div');
          meta.className = 'stats-movie-meta';

          if (rating !== null && rating > 0) {
            const r = document.createElement('span');
            r.className = 'text-muted';
            r.textContent = `⭐ ${rating.toFixed(1)}`;
            meta.appendChild(r);
          } else if (ratingRaw) {
            const r = document.createElement('span');
            r.className = 'text-muted';
            r.textContent = `⭐ ${ratingRaw}`;
            meta.appendChild(r);
          }

          if (watchedLabel) {
            const d = document.createElement('span');
            d.className = 'text-muted';
            d.textContent = t('stats.watchedOn', 'Watched on {date}', { date: watchedLabel });
            meta.appendChild(d);
          }

          main.appendChild(topRow);
          if (meta.childNodes.length) main.appendChild(meta);

          // Optional: keep long strings (like category) out of the main layout.
          if (category) {
            const details = document.createElement('details');
            details.className = 'stats-movie-details';

            const summary = document.createElement('summary');
            summary.textContent = t('common.details', 'Details');
            details.appendChild(summary);

            const body = document.createElement('div');
            body.className = 'stats-movie-details-body text-muted small';
            body.textContent = category;
            details.appendChild(body);

            main.appendChild(details);
          }

          item.appendChild(poster);
          item.appendChild(main);
          movieGridEl.appendChild(item);
        });
      }

      function openMoviesModalForUser(userStat) {
        currentModalUserName = safeStr(userStat?.name).trim();
        currentModalMovies = Array.isArray(userStat?.watchedMovies) ? userStat.watchedMovies : [];

        if (moviesModalTitleEl) {
          const count = currentModalMovies.length;
          moviesModalTitleEl.textContent = currentModalUserName
            ? t('stats.watchedMoviesUser', 'Watched movies — {user} ({count})', { user: currentModalUserName, count: count })
            : t('stats.watchedMovies', 'Watched movies ({count})', { count: count });
        }

        renderMoviesModal();

        if (moviesModalEl) {
          const modal = new bootstrap.Modal(moviesModalEl);
          modal.show();
        }
      }

      if (moviesModalEl) {
        moviesModalEl.addEventListener('shown.bs.modal', () => {
          // no controls to focus
        });
      }

      // Show loading states immediately (avoid "blank" panels)
      const table = document.querySelector('.user-table');
      const statsError = document.getElementById('stats-error');
      if (table) table.classList.add('d-none');
      if (statsError) statsError.classList.add('d-none');

      pageLoader.setProgress(20);
      const activeYear = await fetchActiveYear();
      if (activeYear) {
        document.title = `Pool Oscars (${activeYear}) - ${t('stats.pageTitle', 'User Statistics')}`;
        // Keep the main heading clean; show the year in the "Classement" tab instead.
        const h2 = document.querySelector('h2');
        if (h2) h2.textContent = t('stats.pageTitle', 'User Statistics');
        const badge = document.getElementById('stats-active-year-badge');
        if (badge) {
          badge.textContent = String(activeYear);
          badge.classList.remove('d-none');
        }
      }

      const statsUrl = activeYear ? `/api/users/stats?year=${encodeURIComponent(String(activeYear))}` : '/api/users/stats';
      pageLoader.setProgress(32);
      const [statsRes, winners, completions] = await Promise.all([
        fetch(statsUrl, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${token}` },
          cache: 'no-cache',
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
      
      // Check visibility config for Bon picks column
      let showBonPicksColumn = false;
      try {
        const visibilityRes = await fetch('/api/settings/visibility-config', { cache: 'no-store' });
        if (visibilityRes.ok) {
          const visibilityConfig = await visibilityRes.json();
          showBonPicksColumn = visibilityConfig.showBonPicksColumn !== false;
        }
      } catch (err) {
        console.error('Error loading visibility config:', err);
      }
      
      // Hide/show Bon picks header
      const bonPicksHeader = document.getElementById('bon-picks-header');
      if (bonPicksHeader) {
        bonPicksHeader.style.display = showBonPicksColumn ? '' : 'none';
      }

      // Sort by total points (descending), then by last watched date (earlier = better rank)
      stats.sort((a, b) => {
        const pointsDiff = (b.totalPoints || 0) - (a.totalPoints || 0);
        if (pointsDiff !== 0) return pointsDiff;
        // Tiebreaker: earlier completion wins (user who finished first ranks higher)
        const aDate = a.lastWatchedAt ? new Date(a.lastWatchedAt).getTime() : Infinity;
        const bDate = b.lastWatchedAt ? new Date(b.lastWatchedAt).getTime() : Infinity;
        if (aDate !== bDate) return aDate - bDate;
        // Final tiebreaker: alphabetical
        return String(a.name || '').localeCompare(String(b.name || ''), 'fr', { sensitivity: 'base' });
      });

      // Clear previous rows to prevent duplication
      userTableBody.innerHTML = '';

      // Get total movies count (same for all users in the same year)
      const totalMovies = stats.length > 0 ? (stats[0].totalMoviesCount || 0) : 0;
      
      // Update Films column header with total
      const filmsHeader = document.getElementById('films-header');
      if (filmsHeader && totalMovies > 0) {
        const filmsLabel = (window.i18n && typeof window.i18n.t === 'function') ? window.i18n.t('stats.films') : 'Movies';
        filmsHeader.innerHTML = `${filmsLabel} <small class="text-muted" style="font-weight: normal;">(${totalMovies})</small>`;
      }

      stats.forEach((userStat, index) => {
        const userRow = document.createElement('tr');
        const rank = index + 1;
        const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '';
        
        const rankTd = document.createElement('td');
        rankTd.innerHTML = `<strong>${rank}${medal ? ' ' + medal : ''}</strong>`;

        const nameTd = document.createElement('td');
        const link = document.createElement('a');
        link.href = '#';
        link.className = 'user-link';
        link.textContent = userStat.name;
        link.addEventListener('click', function (event) {
          event.preventDefault();
          openMoviesModalForUser(userStat);
        });
        nameTd.appendChild(link);

        const countTd = document.createElement('td');
        const pointsConfig = userStat.pointsConfig || { pointsPerMovie: 1 };
        countTd.innerHTML = `${userStat.watchedCount ?? 0} <small class="text-muted">(${userStat.moviePoints || 0} pts)</small>`;

        const picksTd = document.createElement('td');
        const pickPointsConfig = userStat.pointsConfig || { pointsPerCorrectPick: 1 };
        picksTd.innerHTML = `${userStat.correctPicks || 0} <small class="text-muted">(${userStat.pickPoints || 0} pts)</small>`;
        if (!showBonPicksColumn) {
          picksTd.style.display = 'none';
        }

        const pointsTd = document.createElement('td');
        pointsTd.className = 'text-center';
        pointsTd.innerHTML = `<strong class="text-success">${userStat.totalPoints || 0}</strong>`;

        userRow.appendChild(rankTd);
        userRow.appendChild(nameTd);
        userRow.appendChild(countTd);
        userRow.appendChild(picksTd);
        userRow.appendChild(pointsTd);
        userTableBody.appendChild(userRow);
      });

      // Show table after loading
      if (table) table.classList.remove('d-none');
      if (statsError) statsError.classList.add('d-none');
      pageLoader.setProgress(92);

      pageLoader.done();
    } catch (error) {
      console.error('Error loading user statistics:', error);
      const table = document.querySelector('.user-table');
      const statsError = document.getElementById('stats-error');
      if (table) table.classList.add('d-none');
      if (statsError) {
        statsError.textContent = t('stats.unableToLoadRanking', 'Unable to load the ranking right now.');
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