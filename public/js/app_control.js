window.onload = async function () {
  const token = localStorage.getItem('auth_token');
  if (!token) {
    window.location.href = '/';
    return;
  }

  let decoded;
  try {
    decoded = JSON.parse(atob(token.split('.')[1]));
  } catch (e) {
    localStorage.removeItem('auth_token');
    window.location.href = '/';
    return;
  }

  const currentTime = Math.floor(Date.now() / 1000);
  if (decoded.exp && decoded.exp < currentTime) {
    localStorage.removeItem('auth_token');
    window.location.href = '/';
    return;
  }

  document.getElementById('user-name').textContent = decoded.name || '';

  // Admin-only page: if token doesn't contain admin flag, bounce.
  if (!decoded.admin) {
    window.location.href = '/movies.html';
    return;
  }

  const responseEl = document.getElementById('response');
  const form = document.getElementById('add-movie-form');
  const yearInput = document.getElementById('oscar_year');

  const manageYearSelect = document.getElementById('manage_year');
  const adminMoviesBody = document.getElementById('admin-movies-body');
  const refreshMoviesBtn = document.getElementById('refresh-movies');
  const deleteSelectedBtn = document.getElementById('delete-selected');
  const selectAllBox = document.getElementById('select-all-movies');
  const selectedCountEl = document.getElementById('selected-count');

  const editMovieModalEl = document.getElementById('editMovieModal');
  const editMovieModal = editMovieModalEl ? new bootstrap.Modal(editMovieModalEl) : null;
  const editMovieModalTitleEl = document.getElementById('editMovieModalTitle');
  const saveMovieChangesBtn = document.getElementById('save-movie-changes');

  const editMovieIdEl = document.getElementById('edit_movie_id');
  const editImdbIdEl = document.getElementById('edit_imdb_id');
  const editYearEl = document.getElementById('edit_year');
  const editCategoryEl = document.getElementById('edit_category');
  const editVodLinkEl = document.getElementById('edit_vod_link');
  const editRefreshOmdbEl = document.getElementById('edit_refresh_omdb');
  const editTitleEl = document.getElementById('edit_title');
  const editRatingEl = document.getElementById('edit_rating');
  const editPosterEl = document.getElementById('edit_poster');
  const editDescriptionEl = document.getElementById('edit_description');

  let moviesById = new Map();

  function showResponse(kind, message) {
    responseEl.classList.remove('d-none', 'alert-success', 'alert-danger', 'alert-warning');
    responseEl.classList.add(kind === 'success' ? 'alert-success' : kind === 'warning' ? 'alert-warning' : 'alert-danger');
    responseEl.textContent = message;
  }

  function parseYear(value) {
    const n = Number(value);
    if (!Number.isInteger(n)) return null;
    if (n < 1900 || n > 3000) return null;
    return n;
  }

  function isValidImdbId(value) {
    return /^tt\d{5,}$/.test(String(value || '').trim());
  }

  document.getElementById('reset-form').addEventListener('click', function () {
    form.reset();
    responseEl.classList.add('d-none');
  });

  document.getElementById('log-off').addEventListener('click', function () {
    localStorage.removeItem('auth_token');
    window.location.href = '/';
  });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();

    const year = parseYear(yearInput.value);
    const imdb_id = document.getElementById('imdb_id').value.trim();
    const category = document.getElementById('category').value.trim();
    const vod_link = document.getElementById('vod_link').value.trim();

    if (!year) {
      showResponse('warning', 'Année invalide. Exemple attendu: 2026');
      return;
    }

    if (!/^tt\d{5,}$/.test(imdb_id)) {
      showResponse('warning', 'IMDB ID invalide. Exemple attendu: tt1234567');
      return;
    }

    try {
      const res = await fetch('/api/movies/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ year, imdb_id, category, vod_link })
      });

      if (res.ok) {
        showResponse('success', 'Film ajouté avec succès.');
        form.reset();
        await refreshYears();
        await loadMoviesForManagement();
        return;
      }

      let errMessage = `Erreur (${res.status})`;
      try {
        const data = await res.json();
        errMessage = data.message || data.error || errMessage;
      } catch (_) {
        // ignore JSON parse errors
      }
      showResponse('danger', errMessage);
    } catch (err) {
      showResponse('danger', err.message || 'Erreur réseau');
    }
  });

  async function refreshYears() {
    try {
      const yearsRes = await fetch('/api/movies/years');
      const years = yearsRes.ok ? await yearsRes.json() : [];

      // Rebuild manage dropdown from scratch (so removed years disappear)
      const previousSelection = manageYearSelect.value;
      manageYearSelect.innerHTML = '';
      const allOpt = document.createElement('option');
      allOpt.value = '';
      allOpt.textContent = 'Toutes';
      manageYearSelect.appendChild(allOpt);

      years.forEach((y) => {
        const opt = document.createElement('option');
        opt.value = String(y);
        opt.textContent = String(y);
        manageYearSelect.appendChild(opt);
      });

      const stillExists = years.map(String).includes(previousSelection);
      manageYearSelect.value = stillExists ? previousSelection : '';

      // Default add-year to latest year if empty
      if (years.length > 0 && !yearInput.value) {
        yearInput.value = String(years[0]);
      }
    } catch (_) {
      // ignore
    }
  }

  function getSelectedMovieIds() {
    return Array.from(adminMoviesBody.querySelectorAll('input[type="checkbox"][data-movie-id]:checked'))
      .map((el) => el.getAttribute('data-movie-id'))
      .filter(Boolean);
  }

  function updateSelectionUI() {
    const selectedIds = getSelectedMovieIds();
    selectedCountEl.textContent = String(selectedIds.length);
    deleteSelectedBtn.disabled = selectedIds.length === 0;

    const allBoxes = Array.from(adminMoviesBody.querySelectorAll('input[type="checkbox"][data-movie-id]'));
    const checked = allBoxes.filter((b) => b.checked).length;
    selectAllBox.indeterminate = checked > 0 && checked < allBoxes.length;
    selectAllBox.checked = allBoxes.length > 0 && checked === allBoxes.length;
  }

  function openEditModal(movieId) {
    if (!editMovieModal) return;
    const movie = moviesById.get(movieId);
    if (!movie) return;

    editMovieIdEl.value = movie._id || '';
    editImdbIdEl.value = movie.imdb_id || '';
    editYearEl.value = movie.year ? String(movie.year) : '';
    editCategoryEl.value = movie.category || '';
    editVodLinkEl.value = movie.vod_link || '';
    editRefreshOmdbEl.checked = false;

    editTitleEl.value = movie.title || '';
    editRatingEl.value = movie.rating || '';
    editPosterEl.value = movie.poster || '';
    editDescriptionEl.value = movie.description || '';

    if (editMovieModalTitleEl) {
      const label = movie.title ? `Modifier: ${movie.title}` : 'Modifier le film';
      editMovieModalTitleEl.textContent = label;
    }

    editMovieModal.show();
  }

  async function saveMovieChanges() {
    const movieId = (editMovieIdEl.value || '').trim();
    if (!movieId) return;

    const imdb_id = (editImdbIdEl.value || '').trim();
    const yearRaw = (editYearEl.value || '').trim();
    const category = (editCategoryEl.value || '').trim();
    const vod_link = (editVodLinkEl.value || '').trim();
    const refreshOmdb = !!editRefreshOmdbEl.checked;

    const title = editTitleEl.value;
    const rating = editRatingEl.value;
    const poster = editPosterEl.value;
    const description = editDescriptionEl.value;

    if (!isValidImdbId(imdb_id)) {
      showResponse('warning', 'IMDB ID invalide. Exemple attendu: tt1234567');
      return;
    }

    let year = null;
    if (yearRaw !== '') {
      year = parseYear(yearRaw);
      if (!year) {
        showResponse('warning', 'Année invalide. Exemple attendu: 2026');
        return;
      }
    }

    if (!category) {
      showResponse('warning', 'Catégorie invalide.');
      return;
    }

    if (!vod_link) {
      showResponse('warning', 'Lien VOD invalide.');
      return;
    }

    const body = {
      imdb_id,
      year: yearRaw === '' ? null : year,
      category,
      vod_link,
      refreshOmdb
    };

    // Only send manual fields if we're not refreshing from OMDb
    if (!refreshOmdb) {
      body.title = title;
      body.description = description;
      body.rating = rating;
      body.poster = poster;
    }

    try {
      saveMovieChangesBtn.disabled = true;
      saveMovieChangesBtn.textContent = 'Enregistrement...';

      const res = await fetch(`/api/movies/${encodeURIComponent(movieId)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        let msg = `Erreur (${res.status})`;
        try {
          const data = await res.json();
          msg = data.message || data.error || msg;
        } catch (_) {}
        showResponse('danger', msg);
        return;
      }

      const updated = await res.json();
      moviesById.set(updated._id, updated);
      showResponse('success', 'Film mis à jour avec succès.');
      editMovieModal.hide();
      await refreshYears();
      await loadMoviesForManagement();
    } catch (err) {
      showResponse('danger', err.message || 'Erreur réseau');
    } finally {
      saveMovieChangesBtn.disabled = false;
      saveMovieChangesBtn.textContent = 'Enregistrer';
    }
  }

  async function loadMoviesForManagement() {
    const year = manageYearSelect.value;
    const url = year ? `/api/movies?year=${encodeURIComponent(year)}` : '/api/movies';
    adminMoviesBody.innerHTML = `<tr><td colspan="5" class="text-muted">Chargement…</td></tr>`;

    try {
      const res = await fetch(url, { method: 'GET' });
      if (!res.ok) {
        adminMoviesBody.innerHTML = `<tr><td colspan="5" class="text-danger">Erreur lors du chargement (${res.status})</td></tr>`;
        return;
      }
      const movies = await res.json();
      movies.sort((a, b) => (a.title || '').localeCompare((b.title || ''), 'fr', { sensitivity: 'base' }));
      moviesById = new Map(movies.map((m) => [m._id, m]));

      if (!movies.length) {
        adminMoviesBody.innerHTML = `<tr><td colspan="5" class="text-muted">Aucun film.</td></tr>`;
        updateSelectionUI();
        return;
      }

      adminMoviesBody.innerHTML = '';
      movies.forEach((m) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>
            <input type="checkbox" class="form-check-input" data-movie-id="${m._id}">
          </td>
          <td>
            <div class="fw-semibold">${m.title || '(sans titre)'}</div>
            <div class="text-muted small">${m.imdb_id || ''}</div>
          </td>
          <td>${m.category || ''}</td>
          <td>${m.year || ''}</td>
          <td class="text-end">
            <button type="button" class="btn btn-sm btn-outline-secondary" data-edit-movie-id="${m._id}">
              Éditer
            </button>
          </td>
        `;
        adminMoviesBody.appendChild(tr);
      });

      adminMoviesBody.querySelectorAll('input[type="checkbox"][data-movie-id]').forEach((cb) => {
        cb.addEventListener('change', updateSelectionUI);
      });

      adminMoviesBody.querySelectorAll('button[data-edit-movie-id]').forEach((btn) => {
        btn.addEventListener('click', () => openEditModal(btn.getAttribute('data-edit-movie-id')));
      });

      updateSelectionUI();
    } catch (err) {
      adminMoviesBody.innerHTML = `<tr><td colspan="5" class="text-danger">${err.message || 'Erreur réseau'}</td></tr>`;
    }
  }

  refreshMoviesBtn.addEventListener('click', loadMoviesForManagement);
  manageYearSelect.addEventListener('change', loadMoviesForManagement);

  selectAllBox.addEventListener('change', () => {
    const checked = selectAllBox.checked;
    adminMoviesBody.querySelectorAll('input[type="checkbox"][data-movie-id]').forEach((cb) => {
      cb.checked = checked;
    });
    updateSelectionUI();
  });

  deleteSelectedBtn.addEventListener('click', async () => {
    const selectedIds = getSelectedMovieIds();
    if (!selectedIds.length) return;

    const yearLabel = manageYearSelect.value ? ` (${manageYearSelect.value})` : '';
    const ok = window.confirm(`Supprimer ${selectedIds.length} film(s)${yearLabel} ? Cette action est irréversible.`);
    if (!ok) return;

    try {
      const res = await fetch('/api/movies/delete', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ ids: selectedIds })
      });

      if (!res.ok) {
        let msg = `Erreur (${res.status})`;
        try {
          const data = await res.json();
          msg = data.message || data.error || msg;
        } catch (_) {}
        showResponse('danger', msg);
        return;
      }

      showResponse('success', 'Film(s) supprimé(s) avec succès.');
      await refreshYears();
      await loadMoviesForManagement();
    } catch (err) {
      showResponse('danger', err.message || 'Erreur réseau');
    }
  });

  if (saveMovieChangesBtn) {
    saveMovieChangesBtn.addEventListener('click', saveMovieChanges);
  }

  // Initial load
  await refreshYears();
  await loadMoviesForManagement();
};

