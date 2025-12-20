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
      const statsRes = await fetch(statsUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!statsRes.ok) {
        throw new Error('Failed to fetch user stats');
      }

      const stats = await statsRes.json();
      const userTableBody = document.getElementById('user-table-body');
      const table = document.querySelector('.user-table');
      const spinner = document.getElementById('loading-spinner');

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
    }

    // Log-off functionality
    document.getElementById('log-off').addEventListener('click', function() {
      localStorage.removeItem('auth_token');
      window.location.href = '/';
    });
  };