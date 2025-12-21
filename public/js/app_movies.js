function createPageLoader(options = {}) {
  const title = String(options.title || 'Chargement…');
  // Subtitle kept for backwards-compat with callers, but we no longer render text in the UI.
  const subtitle = String(options.subtitle || 'Préparation de la page…');

  let progress = 0;
  let removed = false;
  let navResizeObserver = null;

  const overlay = document.createElement('div');
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
    if (!overlay.isConnected) {
      updateOverlayTopOffset();
      document.body.classList.add('page-loading');
      document.body.appendChild(overlay);

      // Keep the overlay aligned if the navbar height changes (mobile collapse, resize, etc.)
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

window.onload = async function () {
    const pageLoader = createPageLoader({
      title: 'Chargement des films',
      subtitle: 'Récupération des données…'
    });

    function setLoadError(el, message) {
      if (!el) return;
      el.innerHTML = `
        <div class="alert alert-danger my-3" role="alert">
          ${message || 'Erreur lors du chargement.'}
        </div>
      `;
    }

    async function fetchActiveYear() {
      try {
        const res = await fetch('/api/settings/year', { method: 'GET' });
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
        const res = await fetch(`/api/settings/oscar-date?year=${encodeURIComponent(String(year))}`, { method: 'GET' });
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
    document.title = `Pool Oscars ${activeYear} - Films`;
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

      pageLoader.setProgress(28);
      const res = await fetch(`/api/movies?year=${encodeURIComponent(String(activeYear))}`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${token}` },
        });

      if (!res.ok) {
        localStorage.removeItem('auth_token');
        window.location.href = '/';
        return;
      }

      const movies = await res.json();
      pageLoader.setProgress(55);
      // If summary is still in flight, wait for it before rendering watched banners.
      await summaryPromise;
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
        const hasVideoSrc = !!(movie && typeof movie.video_src === 'string' && movie.video_src.trim());
        const hasEmbedSrc = !!(movie && typeof movie.embed_src === 'string' && movie.embed_src.trim());
        const hasNewPlayerSource = hasVideoSrc || hasEmbedSrc;
        const hasLegacy = !!(movie && typeof movie.vod_link === 'string' && movie.vod_link.trim());

        // If the movie only has legacy `vod_link`, skip the player entirely and open the original URL in a new tab.
        const playerUrl = (movie && movie._id && hasNewPlayerSource)
          ? `/player.html?id=${encodeURIComponent(movie._id)}`
          : (hasLegacy ? movie.vod_link : (movie && movie._id ? `/player.html?id=${encodeURIComponent(movie._id)}` : '#'));

        const movieDiv = document.createElement('div');
        movieDiv.classList.add('col-md-4', 'mb-4', 'movie-card');
        movieDiv.setAttribute('data-imdb-id', movie.imdb_id);
        movieDiv.innerHTML = `
          <div class="card">
            ${isChecked ? '<div class="watched-banner">VISIONNÉ</div>' : ''}
            <a href="${playerUrl}" target="_self" rel="noopener noreferrer">
              <img src="${movie.poster}" class="card-img-top" alt="${movie.title}" style="width: 75%; display: block; margin: 0 auto; padding: 10px;">
            </a>
            <div class="card-body">
              <h5 class="card-title d-flex justify-content-between align-items-center">
                <a href="${playerUrl}" target="_self" rel="noopener noreferrer" class="text-decoration-none text-dark">${movie.title}</a>
                <span>⭐ ${movie.rating} <a href="https://www.imdb.com/title/${movie.imdb_id}/"><img src="/img/imdb.png"></a></span>
              </h5>
              <p class="fw-bold fst-italic card-text" style="font-size: 0.75rem;">${movie.category}</p>
              <p class="card-text">${movie.description}</p>
              ${isChecked ? `<p class="card-text"><strong>Regardé le:</strong> ${watchedDate}</p>` : ''}
            </div>
          </div>`;
        moviesList.appendChild(movieDiv);
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
  };