window.onload = async function () {
    const token = localStorage.getItem('auth_token');

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

    const activeYear = await fetchActiveYear();
    document.title = `Pool Oscars ${activeYear} - Checklist`;
    const oscarYearEl = document.getElementById('oscar-year');
    if (oscarYearEl) oscarYearEl.textContent = String(activeYear);

    const targetDate = new Date(`March 15, ${activeYear}`);
    const currentDate = new Date();
    const timeDifference = targetDate - currentDate;
    const daysLeft = Math.floor(timeDifference / (1000 * 60 * 60 * 24));
    document.getElementById('time-left').textContent = `${daysLeft} jours`;

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

    const res = await fetch(`/api/movies?year=${encodeURIComponent(String(activeYear))}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
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
      headers: { 'Authorization': `Bearer ${token}` }
    });

    let watchedMovies = [];
    if (watchedRes.ok) {
      watchedMovies = await watchedRes.json();
    }

    const movieImdbIds = new Set(movies.map((m) => m.imdb_id).filter(Boolean));
    let watchedMoviesInYear = watchedMovies.filter((wm) => movieImdbIds.has(wm.imdb_id));

    const totalMoviesCount = movies.length;
    const watchedMoviesCount = watchedMoviesInYear.length;
    const ratioPct = totalMoviesCount > 0 ? ((watchedMoviesCount / totalMoviesCount) * 100).toFixed(1) : '0.0';
    document.getElementById('watched-ratio').innerText = `Vu: ${watchedMoviesCount} / ${totalMoviesCount} (${ratioPct}%)`;

    function launchConfetti() {
      const duration = 3 * 1000; // 3 seconds
      const animationEnd = Date.now() + duration;
      const colors = ['#bb0000', '#ffffff', '#FFD700'];

      function frame() {
        const timeLeft = animationEnd - Date.now();
        if (timeLeft <= 0) return;
        confetti({
          particleCount: 5,
          angle: 60,
          spread: 55,
          origin: { x: 0 }
        });
        confetti({
          particleCount: 5,
          angle: 120,
          spread: 55,
          origin: { x: 1 }
        });
        requestAnimationFrame(frame);
      }
      frame();
    }

    function updateProgressBar(watchedCount, totalCount) {
      const progressBar = document.getElementById('progress-bar');
      const percentage = (watchedCount / totalCount) * 100;
      console.log(percentage);
      progressBar.style.width = `${percentage}%`;

      if (percentage <= 50) {
        progressBar.style.backgroundColor = `rgb(${255}, ${Math.floor((percentage / 50) * 255)}, 0)`;
      } else {
        progressBar.style.backgroundColor = `rgb(${Math.floor(255 - ((percentage - 50) / 50) * 255)}, 255, 0)`;
      }

      progressBar.setAttribute('aria-valuenow', Math.round(percentage));

      const videoModal = new bootstrap.Modal(document.getElementById("videoModal"));

      if (percentage === 100) {
        videoModal.show();
        launchConfetti();
        document.getElementById("rewardVideo").play();
      }
    }

    updateProgressBar(watchedMoviesCount, totalMoviesCount);

    const movieTableBody = document.getElementById('movie-table-body');
    movies.forEach(movie => {
      const watchedMovie = watchedMoviesInYear.find(wm => wm.imdb_id === movie.imdb_id);
      const watchedDate = watchedMovie ? new Date(watchedMovie.watchedDate).toLocaleString() : '';
      const movieRow = document.createElement('tr');
      movieRow.innerHTML = `
        <td>
          <input type="checkbox" class="form-check-input" id="movie-${movie.imdb_id}" ${watchedMovie ? 'checked' : ''} />
        </td>
        <td>${movie.title}</td>
        <td id="watched-date-${movie.imdb_id}">${watchedDate}</td>
      `;

      // Set initial row color based on watched state
      if (watchedMovie) {
        movieRow.style.backgroundColor = 'rgba(144, 238, 144, 0.6)'; // Lighter light green with transparency
      } else {
        movieRow.style.backgroundColor = 'rgba(255, 99, 71, 0.6)'; // Lighter light red with transparency
      }

      movieTableBody.appendChild(movieRow);

      movieRow.addEventListener('click', (event) => {
        const checkbox = document.getElementById(`movie-${movie.imdb_id}`);
        if (event.target.tagName !== 'INPUT') {
          checkbox.checked = !checkbox.checked;
          checkbox.dispatchEvent(new Event('change'));
        }
      });

      const checkbox = document.getElementById(`movie-${movie.imdb_id}`);
      checkbox.addEventListener('change', async (event) => {
        const isChecked = event.target.checked;
        const watchedDateCell = document.getElementById(`watched-date-${movie.imdb_id}`);
        const row = event.target.closest('tr'); // Get the parent row

        if (isChecked) {
          watchedDateCell.textContent = new Date().toLocaleString();
          row.style.backgroundColor = 'rgba(144, 238, 144, 0.6)'; // Apply light green with transparency
        } else {
          watchedDateCell.textContent = '';
          row.style.backgroundColor = 'rgba(255, 99, 71, 0.6)'; // Apply light red with transparency
        }

        await fetch('/api/movies/users/updateWatchedMovies', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ imdb_id: movie.imdb_id, isChecked })
        });

        const updatedWatchedMoviesRes = await fetch('/api/movies/watchedMovies', {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (updatedWatchedMoviesRes.ok) {
          const updatedWatchedMovies = await updatedWatchedMoviesRes.json();
          watchedMoviesInYear = updatedWatchedMovies.filter((wm) => movieImdbIds.has(wm.imdb_id));
          const updatedWatchedCount = watchedMoviesInYear.length;
          const updatedPct = totalMoviesCount > 0 ? ((updatedWatchedCount / totalMoviesCount) * 100).toFixed(1) : '0.0';
          document.getElementById('watched-ratio').innerText = `Vu: ${updatedWatchedCount} / ${totalMoviesCount} (${updatedPct}%)`;
          updateProgressBar(updatedWatchedCount, totalMoviesCount);

          // Recalculate and update movies per day
          const moviesLeft = totalMoviesCount - updatedWatchedCount;
          const moviesPerDay = daysLeft > 0 ? (moviesLeft / daysLeft).toFixed(2) : moviesLeft;
          document.getElementById('movies-per-day').textContent = `À voir par jour: ${moviesPerDay} films`;
        }
      });
    });

    const moviesLeft = totalMoviesCount - watchedMoviesCount;
    const moviesPerDay = daysLeft > 0 ? (moviesLeft / daysLeft).toFixed(2) : moviesLeft;
    document.getElementById('movies-per-day').textContent = `À voir par jour: ${moviesPerDay} films`;

    document.getElementById('log-off').addEventListener('click', () => {
      localStorage.removeItem('auth_token');
      window.location.href = '/';
    });

    // Stop the video when the modal is closed
    const videoModal = document.getElementById("videoModal");
    const rewardVideo = document.getElementById("rewardVideo");
    videoModal.addEventListener("hidden.bs.modal", function () {
      rewardVideo.pause();
      rewardVideo.currentTime = 0;
    });
  };