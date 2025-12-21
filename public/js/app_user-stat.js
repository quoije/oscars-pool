window.onload = async function () {
    const token = localStorage.getItem('auth_token');

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
      const winnersList = document.getElementById('winners-list');
      if (!winnersList) return;
      const list = Array.isArray(winners) ? winners : [];
      if (!list.length) {
        winnersList.innerHTML = '<div class="list-group-item text-muted">Aucun gagnant défini.</div>';
        return;
      }

      // Ensure sorted by year desc
      list.sort((a, b) => Number(b?.year || 0) - Number(a?.year || 0));
      winnersList.innerHTML = '';

      list.forEach((w) => {
        const year = Number(w?.year);
        const name = w?.name || '(utilisateur supprimé)';
        const points = w?.points === null || w?.points === undefined || w?.points === '' ? null : Number(w.points);
        const pointsLabel = points === null || Number.isNaN(points) ? '' : ` — ${points} pts`;
        const item = document.createElement('div');
        item.className = 'list-group-item d-flex justify-content-between align-items-center';
        item.innerHTML = `
          <div><strong>${year || '—'}</strong> : ${name}${pointsLabel}</div>
        `;
        winnersList.appendChild(item);
      });
    }

    function renderCompletions(completions) {
      const root = document.getElementById('completers-by-year');
      if (!root) return;

      if (!completions || typeof completions !== 'object') {
        root.innerHTML = '<div class="text-muted">Impossible de charger les finisseurs 100%.</div>';
        return;
      }

      const years = Array.isArray(completions?.years) ? completions.years : [];
      const totals = completions?.totals && typeof completions.totals === 'object' ? completions.totals : {};
      const byYear = completions?.completersByYear && typeof completions.completersByYear === 'object' ? completions.completersByYear : {};

      if (!years.length) {
        root.innerHTML = '<div class="text-muted">Aucune année trouvée.</div>';
        return;
      }

      // Build a simple accordion
      const accordionId = 'completersAccordion';
      root.innerHTML = `<div class="accordion" id="${accordionId}"></div>`;
      const acc = root.querySelector('.accordion');

      years.forEach((y, idx) => {
        const yearStr = String(y);
        const total = Number(totals?.[yearStr] ?? 0);
        const completers = Array.isArray(byYear?.[yearStr]) ? byYear[yearStr] : [];
        const count = completers.length;

        const collapseId = `completers-${yearStr}`;
        const headingId = `heading-${yearStr}`;
        const show = idx === 0 ? 'show' : '';
        const collapsed = idx === 0 ? '' : 'collapsed';
        const expanded = idx === 0 ? 'true' : 'false';

        const bodyHtml = count
          ? `<ul class="list-group list-group-flush">
               ${completers.map((u) => `<li class="list-group-item">${u?.name || '(sans nom)'}</li>`).join('')}
             </ul>`
          : `<div class="text-muted">Aucun utilisateur à 100%.</div>`;

        const item = document.createElement('div');
        item.className = 'accordion-item';
        item.innerHTML = `
          <h2 class="accordion-header" id="${headingId}">
            <button class="accordion-button ${collapsed}" type="button" data-bs-toggle="collapse" data-bs-target="#${collapseId}" aria-expanded="${expanded}" aria-controls="${collapseId}">
              ${yearStr} — ${count} finisseur(s) (total films: ${total})
            </button>
          </h2>
          <div id="${collapseId}" class="accordion-collapse collapse ${show}" aria-labelledby="${headingId}" data-bs-parent="#${accordionId}">
            <div class="accordion-body">
              ${bodyHtml}
            </div>
          </div>
        `;
        acc.appendChild(item);
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
      const activeYear = await fetchActiveYear();
      if (activeYear) {
        document.title = `Pool Oscars ${activeYear} - Statistiques des utilisateurs`;
        const h2 = document.querySelector('h2');
        if (h2) h2.textContent = `Statistiques des utilisateurs (${activeYear})`;
      }

      const statsUrl = activeYear ? `/api/users/stats?year=${encodeURIComponent(String(activeYear))}` : '/api/users/stats';
      const [statsRes, winners, completions] = await Promise.all([
        fetch(statsUrl, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetchWinners(),
        fetchCompletions(),
      ]);

      if (!statsRes.ok) {
        throw new Error('Failed to fetch user stats');
      }

      const stats = await statsRes.json();
      const userTableBody = document.getElementById('user-table-body');
      const table = document.querySelector('.user-table');
      const spinner = document.getElementById('loading-spinner');

      renderWinners(winners);
      renderCompletions(completions);

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

      // Hide spinner and show table after loading
      spinner.style.display = 'none';
      table.style.display = 'table';

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
    } catch (error) {
      console.error('Error loading user statistics:', error);
      // Still attempt to render these sections even if stats fail (best effort)
      try { renderWinners(await fetchWinners()); } catch (_) {}
      try { renderCompletions(await fetchCompletions()); } catch (_) {}
    }

    // Log-off functionality
    document.getElementById('log-off').addEventListener('click', function() {
      localStorage.removeItem('auth_token');
      window.location.href = '/';
    });
  };