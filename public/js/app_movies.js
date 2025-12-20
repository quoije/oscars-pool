window.onload = async function () {
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

    const targetDate = new Date(`March 15, ${activeYear}`);
    const currentDate = new Date();
    const timeDifference = targetDate - currentDate;
    const daysLeft = Math.floor(timeDifference / (1000 * 60 * 60 * 24));
    document.getElementById('time-left').textContent = `${daysLeft} jours`;

    const token = localStorage.getItem('auth_token');
    if (token) {
      try {
        const decoded = JSON.parse(atob(token.split('.')[1]));
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

    // Populate "Dernière mise à jour des films" banner (per active year)
    await fetchMoviesLastUpdated(activeYear, token);

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

    // Sort movies alphabetically by title
    movies.sort((a, b) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' }));

    const watchedRes = await fetch('/api/movies/watchedMovies', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` },
    });

    let watchedMovies = [];
    if (watchedRes.ok) {
      watchedMovies = await watchedRes.json();
    }

    const moviesList = document.getElementById('movies-list');
    const movieImdbIds = new Set(movies.map((m) => m.imdb_id).filter(Boolean));
    const watchedMoviesInYear = watchedMovies.filter((wm) => movieImdbIds.has(wm.imdb_id));

    const totalMoviesCount = movies.length;
    const watchedMoviesCount = watchedMoviesInYear.length;
    const ratioPct = totalMoviesCount > 0 ? ((watchedMoviesCount / totalMoviesCount) * 100).toFixed(1) : '0.0';
    const ratioText = `Vu: ${watchedMoviesCount} / ${totalMoviesCount} (${ratioPct}%)`;
    document.getElementById('watched-ratio').innerText = ratioText;

    movies.forEach(movie => {
      const isChecked = watchedMoviesInYear.some(watchedMovie => watchedMovie.imdb_id === movie.imdb_id);
      const watchedMovie = watchedMoviesInYear.find(wm => wm.imdb_id === movie.imdb_id);
      const watchedDate = watchedMovie ? new Date(watchedMovie.watchedDate).toLocaleString() : '';

      const movieDiv = document.createElement('div');
      movieDiv.classList.add('col-md-4', 'mb-4', 'movie-card');
      movieDiv.setAttribute('data-imdb-id', movie.imdb_id);
      movieDiv.innerHTML = `
        <div class="card">
          ${isChecked ? '<div class="watched-banner">VISIONNÉ</div>' : ''}
          <a href="${movie.vod_link}"><img src="${movie.poster}" class="card-img-top" alt="${movie.title}" style="width: 75%; display: block; margin: 0 auto; padding: 10px;"></a>
          <div class="card-body">
            <h5 class="card-title d-flex justify-content-between align-items-center">
              ${movie.title}
              <span>⭐ ${movie.rating} <a href="https://www.imdb.com/title/${movie.imdb_id}/"><img src="/img/imdb.png"></a></span>
            </h5>
            <p class="fw-bold fst-italic card-text" style="font-size: 0.75rem;">${movie.category}</p>
            <p class="card-text">${movie.description}</p>
            ${isChecked ? `<p class="card-text"><strong>Regardé le:</strong> ${watchedDate}</p>` : ''}
          </div>
        </div>`;
      moviesList.appendChild(movieDiv);
    });

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