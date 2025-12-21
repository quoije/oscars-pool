window.onload = async function () {
    function setLoading(el) {
      if (!el) return;
      el.innerHTML = `
        <div class="loading-indicator" role="status" aria-live="polite" aria-busy="true" aria-label="Chargement">
          <span class="text-muted">Chargement</span>
          <span class="loading-dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>
        </div>
      `;
    }

    function setInlineLoading(el, label = 'Chargement…') {
      // Keep the header clean: no inline spinners, just text.
      if (!el) return;
      el.textContent = label;
      el.setAttribute('aria-live', 'polite');
      el.setAttribute('aria-busy', 'true');
    }

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
    setLoading(moviesList);

    // Make header stats feel responsive (these used to wait for the heavy movies payload).
    setInlineLoading(document.getElementById('movies-last-updated'));
    setInlineLoading(document.getElementById('watched-ratio'));

    let watchedMoviesInYear = [];

    try {
      // Start summary fetch immediately so header can update ASAP.
      const summaryPromise = fetchMoviesSummary(activeYear, token)
        .then((data) => {
          watchedMoviesInYear = Array.isArray(data?.watchedMovies) ? data.watchedMovies : [];
          applySummaryToHeader(data);
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
      // If summary is still in flight, wait for it before rendering watched banners.
      await summaryPromise;

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
    } catch (e) {
      setLoadError(moviesList, 'Impossible de charger la liste des films. Réessaie dans quelques instants.');
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