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

async function waitForImagesIn(containerEl, onProgress) {
  if (!containerEl) return;
  const imgs = Array.from(containerEl.querySelectorAll('img'));
  if (imgs.length === 0) return;

  let resolved = 0;
  const total = imgs.length;
  const notify = () => {
    if (typeof onProgress === 'function') onProgress(resolved, total);
  };

  await Promise.race([
    Promise.all(
      imgs.map((img) => new Promise((resolve) => {
        const finish = () => {
          resolved += 1;
          notify();
          resolve();
        };
        if (img.complete) return finish();
        img.addEventListener('load', finish, { once: true });
        img.addEventListener('error', finish, { once: true });
      }))
    ),
    new Promise((resolve) => window.setTimeout(resolve, 7000)), // safety timeout
  ]);
}

window.addEventListener('DOMContentLoaded', async function () {
    const pageLoader = createPageLoader({
      title: 'Chargement des films',
      subtitle: 'Récupération des données…'
    });

    function formatClock(seconds) {
      const s = Math.max(0, Math.floor(Number(seconds) || 0));
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
      return `${m}:${String(sec).padStart(2, '0')}`;
    }

    async function fetchPlaybackProgressByYear(year, token) {
      try {
        const res = await fetch(`/api/movies/progress?year=${encodeURIComponent(String(year))}`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${token}` },
          cache: 'no-store',
        });
        if (!res.ok) return new Map();
        const rows = await res.json().catch(() => []);
        const map = new Map();
        (Array.isArray(rows) ? rows : []).forEach((r) => {
          const movieId = typeof r?.movieId === 'string' ? r.movieId : '';
          if (!movieId) return;
          const time = Number(r?.time);
          const duration = r?.duration === null || r?.duration === undefined ? null : Number(r.duration);
          map.set(movieId, {
            time: Number.isFinite(time) && time >= 0 ? time : 0,
            duration: duration !== null && Number.isFinite(duration) && duration > 0 ? duration : null,
          });
        });
        return map;
      } catch (_) {
        return new Map();
      }
    }

    function setLoadError(el, message) {
      if (!el) return;
      el.innerHTML = `
        <div class="alert alert-danger my-3" role="alert">
          ${message || 'Erreur lors du chargement.'}
        </div>
      `;
    }

    function normalizeRatingValue(v) {
      const n = Number(v);
      if (!Number.isFinite(n)) return null;
      const rounded = Math.round(n);
      if (rounded < 1 || rounded > 5) return null;
      return rounded;
    }

    async function saveUserRating(movieId, rating, token) {
      try {
        const res = await fetch(`/api/movies/${encodeURIComponent(movieId)}/ratings`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ rating }),
        });
        if (!res.ok) return null;
        return await res.json().catch(() => null);
      } catch (_) {
        return null;
      }
    }

    async function deleteUserRating(movieId, token) {
      try {
        const res = await fetch(`/api/movies/${encodeURIComponent(movieId)}/ratings`, {
          method: 'DELETE',
          headers: token ? { 'Authorization': `Bearer ${token}` } : undefined,
        });
        if (!res.ok) return null;
        return await res.json().catch(() => null);
      } catch (_) {
        return null;
      }
    }

    function updateStarUi(wrap, rating) {
      if (!wrap) return;
      const value = Number(rating);
      const user = Number.isFinite(value) ? value : null;
      if (wrap?.dataset) {
        wrap.dataset.currentRating = user ? String(user) : '';
      }
      wrap.querySelectorAll('.movie-star').forEach((btn) => {
        const starValue = Number(btn.getAttribute('data-value'));
        const isActive = user && starValue <= user;
        btn.classList.toggle('is-active', !!isActive);
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
    }

    function updateRatingTexts(cardEl, avgRating, ratingsCount, userRating) {
      if (!cardEl) return;
      const avgEl = cardEl.querySelector('[data-role="avg-rating"]');
      const userEl = cardEl.querySelector('[data-role="user-rating"]');
      const avg = Number.isFinite(Number(avgRating)) ? Number(avgRating) : null;
      const count = Number.isFinite(Number(ratingsCount)) ? Number(ratingsCount) : 0;
      const user = Number.isFinite(Number(userRating)) ? Number(userRating) : null;

      if (avgEl) {
        if (avg && count > 0) {
          avgEl.textContent = `Note utilisateurs ${avg.toFixed(1)}${count ? ` (${count})` : ''}`;
          avgEl.classList.remove('movie-rating-sub--empty');
        } else {
          avgEl.textContent = '';
          avgEl.classList.add('movie-rating-sub--empty');
        }
      }

      if (userEl) {
        userEl.textContent = '';
        userEl.classList.add('movie-rating-sub--empty');
      }
    }

    async function fetchActiveYear() {
      try {
        const res = await fetch('/api/settings/year', { method: 'GET', cache: 'no-cache' });
        if (!res.ok) throw new Error('Failed to fetch active year');
        const data = await res.json();
        const year = Number(data?.year);
        return Number.isInteger(year) ? year : new Date().getFullYear();
      } catch (_) {
        return new Date().getFullYear();
      }
    }

    async function fetchOscarEffectiveDate(year) {
      try {
        const res = await fetch(`/api/settings/oscar-date?year=${encodeURIComponent(String(year))}`, { method: 'GET', cache: 'no-cache' });
        if (!res.ok) throw new Error('Failed to fetch oscar date');
        const data = await res.json();
        const effectiveDate = typeof data?.effectiveDate === 'string' ? data.effectiveDate : null;
        return effectiveDate && /^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) ? effectiveDate : `${year}-03-15`;
      } catch (_) {
        return `${year}-03-15`;
      }
    }

    function parseLocalNoonFromIsoDate(dateStr) {
      // Use local noon to avoid DST/midnight edge cases for "days left" math.
      const d = new Date(`${dateStr}T12:00:00`);
      return Number.isNaN(d.getTime()) ? null : d;
    }

    async function fetchMoviesSummary(year, token) {
      const res = await fetch(`/api/movies/summary?year=${encodeURIComponent(String(year))}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` },
        cache: 'no-cache',
      });
      if (!res.ok) throw new Error('Failed to fetch movies summary');
      return await res.json();
    }

    function applySummaryToHeader(summary) {
      const lastUpdatedEl = document.getElementById('movies-last-updated');
      const ratioEl = document.getElementById('watched-ratio');

      const lastUpdatedIso = summary?.lastUpdated;
      if (lastUpdatedEl) {
        if (lastUpdatedIso) {
          const d = new Date(lastUpdatedIso);
          if (!Number.isNaN(d.getTime())) {
            lastUpdatedEl.textContent = d.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
          } else {
            lastUpdatedEl.textContent = '—';
          }
        } else {
          lastUpdatedEl.textContent = '—';
        }
      }

      const total = Number(summary?.totalMoviesCount) || 0;
      const watched = Number(summary?.watchedMoviesCount) || 0;
      const ratioPct = total > 0 ? ((watched / total) * 100).toFixed(1) : '0.0';
      if (ratioEl) ratioEl.innerText = `Vu: ${watched} / ${total} (${ratioPct}%)`;
    }

    const activeYear = await fetchActiveYear();
    document.title = `Pool Oscars (${activeYear}) - Films`;
    const oscarYearEl = document.getElementById('oscar-year');
    if (oscarYearEl) oscarYearEl.textContent = String(activeYear);

    // Render countdown immediately with a deterministic fallback (then refine from settings).
    const oscarDayMonthEl = document.getElementById('oscar-date-day-month');
    const timeLeftEl = document.getElementById('time-left');
    const fallbackDate = parseLocalNoonFromIsoDate(`${activeYear}-03-15`) || new Date(`March 15, ${activeYear} 12:00:00`);
    if (oscarDayMonthEl) {
      try {
        oscarDayMonthEl.textContent = fallbackDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
      } catch (_) {
        oscarDayMonthEl.textContent = '15 mars';
      }
    }
    if (timeLeftEl) {
      const currentDate = new Date();
      const timeDifference = fallbackDate - currentDate;
      const daysLeft = Math.floor(timeDifference / (1000 * 60 * 60 * 24));
      timeLeftEl.textContent = `${daysLeft} jours`;
    }

    fetchOscarEffectiveDate(activeYear).then((oscarEffectiveDate) => {
      const targetDate =
        parseLocalNoonFromIsoDate(oscarEffectiveDate) ||
        fallbackDate;

      if (oscarDayMonthEl) {
        try {
          oscarDayMonthEl.textContent = targetDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
        } catch (_) {}
      }
      if (timeLeftEl) {
        const currentDate = new Date();
        const timeDifference = targetDate - currentDate;
        const daysLeft = Math.floor(timeDifference / (1000 * 60 * 60 * 24));
        timeLeftEl.textContent = `${daysLeft} jours`;
      }
    }).catch(() => {});

    const token = localStorage.getItem('auth_token');
    if (token) {
      try {
        const decoded = JSON.parse(atob(token.split('.')[1]));
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

        const currentTime = Math.floor(Date.now() / 1000);
        if (decoded.exp && decoded.exp < currentTime) {
          localStorage.removeItem('auth_token');
          window.location.href = '/';
        }
      } catch (error) {
        localStorage.removeItem('auth_token');
        window.location.href = '/';
      }
    } else {
      window.location.href = '/';
    }

    const moviesList = document.getElementById('movies-list');
    pageLoader.setProgress(18);

    let watchedMoviesInYear = [];
    let progressByMovieId = new Map();

    try {
      // Start summary fetch immediately so header can update ASAP.
      const summaryPromise = fetchMoviesSummary(activeYear, token)
        .then((data) => {
          watchedMoviesInYear = Array.isArray(data?.watchedMovies) ? data.watchedMovies : [];
          applySummaryToHeader(data);
          pageLoader.setProgress(32);
          return data;
        })
        .catch(() => {
          // Leave the placeholders (—) if summary fails; movies list can still load.
          const lastUpdatedEl = document.getElementById('movies-last-updated');
          if (lastUpdatedEl) lastUpdatedEl.textContent = '—';
          const ratioEl = document.getElementById('watched-ratio');
          if (ratioEl) ratioEl.textContent = '—';
          return null;
        });

      // Fetch progress in parallel (movies page uses it to show resume/progression).
      const progressPromise = fetchPlaybackProgressByYear(activeYear, token)
        .then((m) => { progressByMovieId = m instanceof Map ? m : new Map(); })
        .catch(() => { progressByMovieId = new Map(); });

      pageLoader.setProgress(28);
      const res = await fetch(`/api/movies?year=${encodeURIComponent(String(activeYear))}`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${token}` },
          cache: 'no-cache',
        });

      if (!res.ok) {
        localStorage.removeItem('auth_token');
        window.location.href = '/';
        return;
      }

      const movies = await res.json();
      pageLoader.setProgress(55);
      // If summary is still in flight, wait for it before rendering watched banners.
      await Promise.all([summaryPromise, progressPromise]);
      pageLoader.setProgress(62);

      // Sort movies alphabetically by title (server also sorts, but keep client as a fallback)
      movies.sort((a, b) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' }));

      const totalMoviesCount = movies.length;
      const watchedMoviesCount = watchedMoviesInYear.length;
      const ratioPct = totalMoviesCount > 0 ? ((watchedMoviesCount / totalMoviesCount) * 100).toFixed(1) : '0.0';
      const ratioText = `Vu: ${watchedMoviesCount} / ${totalMoviesCount} (${ratioPct}%)`;
      document.getElementById('watched-ratio').innerText = ratioText;

      if (moviesList) moviesList.innerHTML = '';

      movies.forEach(movie => {
        const isChecked = watchedMoviesInYear.some(watchedMovie => watchedMovie.imdb_id === movie.imdb_id);
        const watchedMovie = watchedMoviesInYear.find(wm => wm.imdb_id === movie.imdb_id);
        const watchedDate = watchedMovie ? new Date(watchedMovie.watchedDate).toLocaleString() : '';
        const cleanUrl = (v) => {
          const s = (typeof v === 'string' ? v.trim() : '');
          // Treat placeholders as "no link" so you never need to store '#'
          if (!s || s === '#' || s.toLowerCase() === 'about:blank') return '';
          return s;
        };
        const hasVideoSrc = !!cleanUrl(movie?.video_src);
        const hasEmbedSrc = !!cleanUrl(movie?.embed_src);
        const hasNewPlayerSource = hasVideoSrc || hasEmbedSrc;
        const legacyUrl = cleanUrl(movie?.vod_link);
        const hasLegacy = !!legacyUrl;
        const movieId = movie && movie._id ? String(movie._id) : '';
        const userRatingAvg = Number(movie?.user_rating_avg);
        const userRatingCount = Number(movie?.user_rating_count) || 0;
        const userRating = Number(movie?.user_rating);
        const userRatingText =
          Number.isFinite(userRatingAvg) && userRatingAvg > 0
            ? `${userRatingAvg.toFixed(1)}${userRatingCount ? ` (${userRatingCount})` : ''}`
            : '';
        const userRatingOwn =
          Number.isFinite(userRating) && userRating > 0 ? `${userRating}/5` : '';
        const starsHtml = Array.from({ length: 5 }, (_, idx) => {
          const value = idx + 1;
          const isActive = Number.isFinite(userRating) && userRating >= value;
          return `<button type="button" class="movie-star${isActive ? ' is-active' : ''}" data-value="${value}" aria-label="${value} étoile${value > 1 ? 's' : ''}" aria-pressed="${isActive ? 'true' : 'false'}">★</button>`;
        }).join('');

        // Navigation:
        // - Prefer in-app player when we have a non-legacy source
        // - If only legacy exists, open the legacy URL
        // - If there is no source at all, render as non-clickable (no "#")
        const playerUrl = (movie && movie._id && hasNewPlayerSource)
          ? `/player.html?id=${encodeURIComponent(movie._id)}`
          : (hasLegacy ? legacyUrl : '');
        const isClickable = !!playerUrl;

        // Progress: only show for in-app player sources (not legacy vod_link, not "no source").
        // Also avoid showing a meaningless "0:00" if they never really started.
        let progressHtml = '';
        if (hasNewPlayerSource && movieId) {
          const p = progressByMovieId.get(movieId);
          const time = Number(p?.time) || 0;
          const duration = p?.duration === null || p?.duration === undefined ? null : Number(p.duration);
          if (time > 1) {
            if (duration && Number.isFinite(duration) && duration > 0) {
              const pct = Math.max(0, Math.min(100, (time / duration) * 100));
              // Hide "resume/progress" once we're basically at the credits.
              // Backend uses 95% as the "credit roll" threshold too.
              if (pct < 95) {
                progressHtml = `
                  <div class="mt-2">
                    <div class="d-flex justify-content-between align-items-center text-muted small">
                      <span>Reprendre à <span class="fw-semibold text-dark">${formatClock(time)}</span></span>
                      <span>${pct.toFixed(0)}%</span>
                    </div>
                    <div class="progress" style="height: 6px;">
                      <div class="progress-bar" role="progressbar" style="width: ${pct.toFixed(2)}%;" aria-valuenow="${pct.toFixed(0)}" aria-valuemin="0" aria-valuemax="100"></div>
                    </div>
                  </div>
                `;
              }
            } else {
              progressHtml = `
                <div class="mt-2 text-muted small">
                  Reprendre à <span class="fw-semibold text-dark">${formatClock(time)}</span>
                </div>
              `;
            }
          }
        }

        const camBadge = movie?.cam ? '<span class="badge bg-warning text-dark position-absolute top-0 end-0 m-2 cam-badge">CAM</span>' : '';
        const posterBlock = `
          <div class="text-center pt-3 px-3 position-relative movie-poster-wrap">
            ${camBadge}
            <img src="${movie.poster}" class="img-fluid rounded movie-poster" alt="${movie.title}">
          </div>
        `;

        const movieDiv = document.createElement('div');
        movieDiv.classList.add('col-12', 'col-sm-6', 'col-lg-4', 'movie-card');
        movieDiv.setAttribute('data-imdb-id', movie.imdb_id);
        movieDiv.innerHTML = `
          <div class="card h-100 shadow-sm">
            ${isChecked ? '<span class="badge bg-success position-absolute top-0 start-0 m-2 watched-badge">VISIONNÉ</span>' : ''}
            ${
              isClickable
                ? `<a href="${playerUrl}" target="_self" rel="noopener noreferrer" class="text-decoration-none">
                    ${posterBlock}
                  </a>`
                : `${posterBlock}`
            }
            <div class="card-body d-flex flex-column">
              <div class="flex-grow-1">
                <div class="d-flex justify-content-between align-items-start gap-2">
                  <div class="flex-grow-1">
                    <h5 class="card-title mb-1">
                      ${
                        isClickable
                          ? `<a href="${playerUrl}" target="_self" rel="noopener noreferrer" class="text-decoration-none text-dark">${movie.title}</a>`
                          : `<span class="text-dark">${movie.title}</span>`
                      }
                    </h5>
                    <div class="movie-rating-block mt-1">
                      <div class="movie-rating-sub movie-rating-avg${userRatingText ? '' : ' movie-rating-sub--empty'}" data-role="avg-rating">${userRatingText ? `Note utilisateurs ${userRatingText}` : ''}</div>
                    </div>
                  </div>
                  <div class="movie-imdb-wrap">
                    <div class="movie-imdb-block">
                      ${movie.rating ? `<span>⭐ ${movie.rating}</span>` : ''}
                      <a href="https://www.imdb.com/title/${movie.imdb_id}/" target="_blank" rel="noopener noreferrer" aria-label="Voir sur IMDb">
                        <img src="/img/imdb.png" class="imdb-icon" alt="IMDb">
                      </a>
                    </div>
                    <div class="movie-rating-stars" role="group" aria-label="Noter ce film" data-movie-id="${movieId}" data-current-rating="${Number.isFinite(userRating) ? userRating : ''}">
                      ${starsHtml}
                    </div>
                  </div>
                </div>
                ${!isClickable ? '<div class="text-muted small mb-1">Aucune source</div>' : ''}
                <div class="movie-info-box">
                  <details class="movie-info-categories">
                    <summary class="movie-info-summary">
                      <span class="movie-info-summary-title">Catégories nominés</span>
                      <span class="movie-info-summary-arrow" aria-hidden="true">▾</span>
                    </summary>
                    <div class="movie-info-category">${movie.category}</div>
                  </details>
                  <p class="movie-info-desc">${movie.description}</p>
                </div>
              </div>
              <div class="mt-auto">
                ${isChecked ? `<div class="text-muted small"><span class="fw-semibold text-dark">Regardé le:</span> ${watchedDate}</div>` : ''}
                ${progressHtml}
              </div>
            </div>
          </div>`;
        moviesList.appendChild(movieDiv);

        const starsWrap = movieDiv.querySelector('.movie-rating-stars');
        if (starsWrap) {
          if (!token || !movieId) {
            starsWrap.querySelectorAll('.movie-star').forEach((btn) => btn.setAttribute('disabled', 'disabled'));
          } else {
            starsWrap.addEventListener('click', async (event) => {
              const target = event.target;
              if (!target || !target.classList.contains('movie-star')) return;
              const value = normalizeRatingValue(target.getAttribute('data-value'));
              if (!value) return;

              starsWrap.querySelectorAll('.movie-star').forEach((btn) => btn.setAttribute('disabled', 'disabled'));
              const current = Number(starsWrap.dataset.currentRating || '');
              const shouldClear = current && current === value;
              const result = shouldClear
                ? await deleteUserRating(movieId, token)
                : await saveUserRating(movieId, value, token);
              if (result) {
                updateStarUi(starsWrap, result?.userRating);
                updateRatingTexts(movieDiv, result?.averageRating, result?.ratingsCount, result?.userRating);
              }
              starsWrap.querySelectorAll('.movie-star').forEach((btn) => btn.removeAttribute('disabled'));
            });
          }
        }
      });

      pageLoader.setSubtitle('Finalisation de l’affichage…');
      pageLoader.setProgress(80);
      await waitForImagesIn(moviesList, (loaded, total) => {
        // Move 80% -> 98% as posters resolve
        const pct = 80 + (loaded / Math.max(1, total)) * 18;
        pageLoader.setProgress(pct);
      });
      pageLoader.done();
    } catch (e) {
      setLoadError(moviesList, 'Impossible de charger la liste des films. Réessaie dans quelques instants.');
      pageLoader.fail('Impossible de charger les films. Vérifie ta connexion puis réessaie.');
    }

    document.getElementById('log-off').addEventListener('click', function () {
      localStorage.removeItem('auth_token');
      window.location.href = '/';
    });

    const filterSwitch = document.getElementById('flexSwitchCheckDefault');
    const savedFilterState = localStorage.getItem('filter-checkbox');
    const isFilterActive = savedFilterState === 'checked';
    filterSwitch.checked = isFilterActive;

    filterSwitch.addEventListener('change', function () {
      const filterState = filterSwitch.checked ? 'checked' : 'unchecked';
      localStorage.setItem('filter-checkbox', filterState);
      filterMovies();
    });

    function filterMovies() {
      const showUnwatchedOnly = filterSwitch.checked;
      const movieCards = document.querySelectorAll('.movie-card');

      movieCards.forEach(card => {
        const imdbId = card.getAttribute('data-imdb-id');
        const isWatched = watchedMoviesInYear.some(watchedMovie => watchedMovie.imdb_id === imdbId);

        if (showUnwatchedOnly && isWatched) {
          card.style.display = 'none';
        } else {
          card.style.display = 'block';
        }
      });
    }

    filterMovies();
  });