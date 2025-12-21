window.onload = async function () {
    const token = localStorage.getItem('auth_token');

    const DEFAULT_COMPLETION_MODAL = Object.freeze({
      title: 'Félicitations! very nice 🎉🎉🎉',
      bodyText: '',
      videoSrc: 'video/reward.mp4',
      bodyHtml: ''
    });

    function sanitizeHtml(raw) {
      const html = String(raw || '');
      const withoutScripts = html.replace(/<script\b[\s\S]*?<\/script>/gi, '');
      const withoutOnAttrs = withoutScripts
        .replace(/\son\w+="[^"]*"/gi, '')
        .replace(/\son\w+='[^']*'/gi, '')
        .replace(/\son\w+=\S+/gi, '');
      return withoutOnAttrs.trim();
    }

    async function fetchCompletionModalContent() {
      try {
        const res = await fetch('/api/settings/completion-modal', { method: 'GET' });
        if (!res.ok) throw new Error('Failed to fetch completion modal');
        const data = await res.json();
        return {
          title: typeof data?.title === 'string' ? data.title : DEFAULT_COMPLETION_MODAL.title,
          bodyText: typeof data?.bodyText === 'string' ? data.bodyText : DEFAULT_COMPLETION_MODAL.bodyText,
          videoSrc: typeof data?.videoSrc === 'string' ? data.videoSrc : DEFAULT_COMPLETION_MODAL.videoSrc,
          bodyHtml: typeof data?.bodyHtml === 'string' ? data.bodyHtml : DEFAULT_COMPLETION_MODAL.bodyHtml,
        };
      } catch (_) {
        return DEFAULT_COMPLETION_MODAL;
      }
    }

    function applyCompletionModalContent(content) {
      const titleEl = document.getElementById('videoModalLabel');
      const bodyTextEl = document.getElementById('completion-modal-text');
      const bodyCustomEl = document.getElementById('completion-modal-custom');
      const videoEl = document.getElementById('rewardVideo');
      const videoSourceEl = document.getElementById('rewardVideoSource');

      const title = String(content?.title || '').trim() || DEFAULT_COMPLETION_MODAL.title;
      const bodyText = String(content?.bodyText || '');
      const bodyHtml = sanitizeHtml(String(content?.bodyHtml || ''));
      const videoSrc = String(content?.videoSrc || '').trim();

      if (titleEl) titleEl.textContent = title;

      if (bodyCustomEl) {
        if (bodyHtml) {
          bodyCustomEl.innerHTML = bodyHtml;
          bodyCustomEl.classList.remove('d-none');
        } else {
          bodyCustomEl.innerHTML = '';
          bodyCustomEl.classList.add('d-none');
        }
      }

      if (bodyTextEl) {
        bodyTextEl.textContent = bodyText || '';
        bodyTextEl.classList.toggle('d-none', !bodyText);
      }

      if (videoEl && videoSourceEl) {
        if (videoSrc) {
          videoSourceEl.setAttribute('src', videoSrc);
          // reload source (so updated src is used)
          try { videoEl.load(); } catch (_) {}
          videoEl.classList.remove('d-none');
        } else {
          try { videoEl.pause(); } catch (_) {}
          videoEl.classList.add('d-none');
        }
      }
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
      const d = new Date(`${dateStr}T12:00:00`);
      return Number.isNaN(d.getTime()) ? null : d;
    }

    const activeYear = await fetchActiveYear();
    document.title = `Pool Oscars ${activeYear} - Checklist`;
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

    // Fetch remaining data in parallel (Render latency is high).
    const [completionModalContent, moviesRes, watchedRes] = await Promise.all([
      fetchCompletionModalContent(),
      fetch(`/api/movies?year=${encodeURIComponent(String(activeYear))}&view=checklist`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
      }),
      fetch('/api/movies/watchedMovies', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
      })
    ]);

    applyCompletionModalContent(completionModalContent);

    if (!moviesRes.ok) {
      localStorage.removeItem('auth_token');
      window.location.href = '/';
      return;
    }

    const movies = await moviesRes.json();

    // Sort movies alphabetically by title
    movies.sort((a, b) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' }));

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
        const rewardVideo = document.getElementById("rewardVideo");
        // Only attempt autoplay if we actually have a visible <video>.
        if (rewardVideo && !rewardVideo.classList.contains('d-none')) {
          rewardVideo.play().catch(() => {});
        }
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
      if (!rewardVideo) return;
      rewardVideo.pause();
      rewardVideo.currentTime = 0;
    });
  };