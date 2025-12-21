window.onload = async function () {
    function setLoading(el) {
      if (!el) return;
      el.innerHTML = `
        <div class="d-flex justify-content-center align-items-center my-5" aria-live="polite" aria-busy="true">
          <div class="spinner-border text-secondary" role="status" aria-label="Chargement">
            <span class="visually-hidden">Chargement...</span>
          </div>
        </div>
      `;
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

    async function fetchMoviesLastUpdated(year, token) {
      const el = document.getElementById('movies-last-updated');
      if (!el) return;

      try {
        const res = await fetch(`/api/movies/last-update?year=${encodeURIComponent(String(year))}`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!res.ok) return;

        const data = await res.json();
        const lastUpdatedIso = data?.lastUpdated;
        if (!lastUpdatedIso) return;

        const d = new Date(lastUpdatedIso);
        if (Number.isNaN(d.getTime())) return;

        el.textContent = d.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
      } catch (_) {
        // Keep the default placeholder (—)
      }
    }

    const activeYear = await fetchActiveYear();
    document.title = `Pool Oscars ${activeYear} - Films`;
    const oscarYearEl = document.getElementById('oscar-year');
    if (oscarYearEl) oscarYearEl.textContent = String(activeYear);

    const oscarEffectiveDate = await fetchOscarEffectiveDate(activeYear);
    const targetDate =
      parseLocalNoonFromIsoDate(oscarEffectiveDate) ||
      new Date(`March 15, ${activeYear} 12:00:00`);

    const oscarDayMonthEl = document.getElementById('oscar-date-day-month');
    if (oscarDayMonthEl) {
      try {
        oscarDayMonthEl.textContent = targetDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
      } catch (_) {
        oscarDayMonthEl.textContent = '15 mars';
      }
    }

    const currentDate = new Date();
    const timeDifference = targetDate - currentDate;
    const daysLeft = Math.floor(timeDifference / (1000 * 60 * 60 * 24));
    document.getElementById('time-left').textContent = `${daysLeft} jours`;

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

    // Populate "Dernière mise à jour des films" banner (per active year)
    await fetchMoviesLastUpdated(activeYear, token);

    try {
      // Fetch movies + watched list in parallel (Render latency is high).
      const [res, watchedRes] = await Promise.all([
        fetch(`/api/movies?year=${encodeURIComponent(String(activeYear))}`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${token}` },
        }),
        fetch('/api/movies/watchedMovies', {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${token}` },
        })
      ]);

      if (!res.ok) {
        localStorage.removeItem('auth_token');
        window.location.href = '/';
        return;
      }

      const movies = await res.json();

      // Sort movies alphabetically by title (server also sorts, but keep client as a fallback)
      movies.sort((a, b) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' }));

      let watchedMovies = [];
      if (watchedRes.ok) {
        watchedMovies = await watchedRes.json();
      }

      const movieImdbIds = new Set(movies.map((m) => m.imdb_id).filter(Boolean));
      const watchedMoviesInYear = watchedMovies.filter((wm) => movieImdbIds.has(wm.imdb_id));

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