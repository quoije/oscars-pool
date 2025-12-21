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

  if (decoded.mustChangePassword) {
    window.location.href = '/change-password.html';
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

  const activeYearInput = document.getElementById('active_oscar_year');
  const saveActiveYearBtn = document.getElementById('save-active-year');

  // Modal 100% elements
  const completionModalTitleEl = document.getElementById('completion_modal_title');
  const completionModalBodyTextEl = document.getElementById('completion_modal_body_text');
  const completionModalBodyHtmlEl = document.getElementById('completion_modal_body_html');
  const completionModalVideoSrcEl = document.getElementById('completion_modal_video_src');
  const completionModalReloadBtn = document.getElementById('completion_modal_reload');
  const completionModalSaveBtn = document.getElementById('completion_modal_save');

  const completionModalPreviewTitleEl = document.getElementById('completion_modal_preview_title');
  const completionModalPreviewTextEl = document.getElementById('completion_modal_preview_text');
  const completionModalPreviewCustomEl = document.getElementById('completion_modal_preview_custom');
  const completionModalPreviewVideoEl = document.getElementById('completion_modal_preview_video');
  const completionModalPreviewVideoSourceEl = document.getElementById('completion_modal_preview_video_source');

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
  const editPlayerModeEl = document.getElementById('edit_player_mode');
  const editVideoSrcEl = document.getElementById('edit_video_src');
  const editEmbedSrcEl = document.getElementById('edit_embed_src');
  const editRefreshOmdbEl = document.getElementById('edit_refresh_omdb');
  const editTitleEl = document.getElementById('edit_title');
  const editRatingEl = document.getElementById('edit_rating');
  const editPosterEl = document.getElementById('edit_poster');
  const editDescriptionEl = document.getElementById('edit_description');

  let moviesById = new Map();
  let activeYear = null;

  const DEFAULT_COMPLETION_MODAL = Object.freeze({
    title: 'Félicitations! very nice 🎉🎉🎉',
    bodyText: '',
    videoSrc: 'video/reward.mp4',
    bodyHtml: '',
  });

  function showResponse(kind, message) {
    responseEl.classList.remove('d-none', 'alert-success', 'alert-danger', 'alert-warning');
    responseEl.classList.add(kind === 'success' ? 'alert-success' : kind === 'warning' ? 'alert-warning' : 'alert-danger');
    responseEl.textContent = message;
  }

  function sanitizeHtml(raw) {
    const html = String(raw || '');
    const withoutScripts = html.replace(/<script\b[\s\S]*?<\/script>/gi, '');
    const withoutOnAttrs = withoutScripts
      .replace(/\son\w+="[^"]*"/gi, '')
      .replace(/\son\w+='[^']*'/gi, '')
      .replace(/\son\w+=\S+/gi, '');
    return withoutOnAttrs.trim();
  }

  function normalizeCompletionModal(value) {
    const v = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const title = typeof v.title === 'string' ? v.title : DEFAULT_COMPLETION_MODAL.title;
    const bodyText = typeof v.bodyText === 'string' ? v.bodyText : DEFAULT_COMPLETION_MODAL.bodyText;
    const videoSrc = typeof v.videoSrc === 'string' ? v.videoSrc : DEFAULT_COMPLETION_MODAL.videoSrc;
    const bodyHtml = typeof v.bodyHtml === 'string' ? v.bodyHtml : DEFAULT_COMPLETION_MODAL.bodyHtml;
    return {
      title: String(title || '').trim().slice(0, 200) || DEFAULT_COMPLETION_MODAL.title,
      bodyText: String(bodyText || '').slice(0, 8000),
      videoSrc: String(videoSrc || '').trim().slice(0, 2048),
      bodyHtml: String(bodyHtml || '').slice(0, 20000),
    };
  }

  async function fetchCompletionModal() {
    const res = await fetch('/api/settings/completion-modal', { method: 'GET' });
    if (!res.ok) throw new Error(`Erreur (${res.status})`);
    const data = await res.json().catch(() => ({}));
    return normalizeCompletionModal(data);
  }

  async function saveCompletionModal(payload) {
    const res = await fetch('/api/settings/completion-modal', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.message || data.error || `Erreur (${res.status})`;
      throw new Error(msg);
    }
    return normalizeCompletionModal(data);
  }

  function setCompletionModalForm(value) {
    if (!completionModalTitleEl || !completionModalBodyTextEl || !completionModalBodyHtmlEl || !completionModalVideoSrcEl) return;
    completionModalTitleEl.value = value.title || '';
    completionModalBodyTextEl.value = value.bodyText || '';
    completionModalBodyHtmlEl.value = value.bodyHtml || '';
    completionModalVideoSrcEl.value = value.videoSrc || '';
  }

  function getCompletionModalFormValue() {
    return normalizeCompletionModal({
      title: completionModalTitleEl ? completionModalTitleEl.value : '',
      bodyText: completionModalBodyTextEl ? completionModalBodyTextEl.value : '',
      bodyHtml: completionModalBodyHtmlEl ? completionModalBodyHtmlEl.value : '',
      videoSrc: completionModalVideoSrcEl ? completionModalVideoSrcEl.value : '',
    });
  }

  function updateCompletionModalPreview(value) {
    if (completionModalPreviewTitleEl) {
      completionModalPreviewTitleEl.textContent = value.title || DEFAULT_COMPLETION_MODAL.title;
    }

    const text = String(value.bodyText || '');
    if (completionModalPreviewTextEl) {
      completionModalPreviewTextEl.textContent = text;
      completionModalPreviewTextEl.classList.toggle('d-none', !text);
    }

    const safeHtml = sanitizeHtml(value.bodyHtml || '');
    if (completionModalPreviewCustomEl) {
      if (safeHtml) {
        completionModalPreviewCustomEl.innerHTML = safeHtml;
        completionModalPreviewCustomEl.classList.remove('d-none');
      } else {
        completionModalPreviewCustomEl.innerHTML = '';
        completionModalPreviewCustomEl.classList.add('d-none');
      }
    }

    const videoSrc = String(value.videoSrc || '').trim();
    if (completionModalPreviewVideoEl && completionModalPreviewVideoSourceEl) {
      if (videoSrc) {
        completionModalPreviewVideoSourceEl.setAttribute('src', videoSrc);
        try { completionModalPreviewVideoEl.load(); } catch (_) {}
        completionModalPreviewVideoEl.classList.remove('d-none');
      } else {
        try { completionModalPreviewVideoEl.pause(); } catch (_) {}
        completionModalPreviewVideoEl.classList.add('d-none');
      }
    }
  }

  async function loadCompletionModalIntoUi() {
    // If the tab isn't in DOM (older HTML), just skip gracefully.
    if (!completionModalTitleEl) return;
    try {
      const value = await fetchCompletionModal();
      setCompletionModalForm(value);
      updateCompletionModalPreview(getCompletionModalFormValue());
    } catch (err) {
      // Still show defaults so admin can edit even if network hiccups.
      setCompletionModalForm(DEFAULT_COMPLETION_MODAL);
      updateCompletionModalPreview(getCompletionModalFormValue());
      showResponse('warning', err.message || 'Impossible de charger le contenu du modal.');
    }
  }

  // Admin users list elements
  const adminUsersBody = document.getElementById('admin-users-body');
  const refreshUsersBtn = document.getElementById('refresh-users');
  const adminUsersCountEl = document.getElementById('admin-users-count');
  const adminUsersTabBtn = document.getElementById('admin-users-tab');

  // Admin: add user form elements
  const openAddUserModalBtn = document.getElementById('open-add-user-modal');
  const addUserModalEl = document.getElementById('addUserModal');
  const addUserModal = addUserModalEl ? new bootstrap.Modal(addUserModalEl) : null;
  const addUserForm = document.getElementById('add-user-form');
  const addUserNameEl = document.getElementById('add_user_name');
  const addUserEmailEl = document.getElementById('add_user_email');
  const addUserAdminEl = document.getElementById('add_user_admin');
  const addUserResponseEl = document.getElementById('add-user-response');
  const addUserResultEl = document.getElementById('add-user-result');
  const addUserTempPasswordEl = document.getElementById('add-user-temp-password');
  const addUserExpiresAtEl = document.getElementById('add-user-expires-at');
  const addUserSubmitBtn = document.getElementById('add-user-submit');
  const addUserResetBtn = document.getElementById('add-user-reset');
  const copyAddUserTempPasswordBtn = document.getElementById('copy-add-user-temp-password');

  // Admin user modals
  const resetUserPasswordModalEl = document.getElementById('resetUserPasswordModal');
  const resetUserPasswordModal = resetUserPasswordModalEl ? new bootstrap.Modal(resetUserPasswordModalEl) : null;
  const resetUserLabelEl = document.getElementById('reset_user_label');
  const resetUserEmailLabelEl = document.getElementById('reset_user_email_label');
  const resetUserModalResponseEl = document.getElementById('reset-user-modal-response');
  const resetUserModalResultEl = document.getElementById('reset-user-modal-result');
  const resetUserTempPasswordEl = document.getElementById('reset-user-temp-password');
  const resetUserExpiresAtEl = document.getElementById('reset-user-expires-at');
  const confirmResetUserPasswordBtn = document.getElementById('confirm-reset-user-password');
  const copyTempPasswordBtn = document.getElementById('copy-temp-password');

  const deleteUserModalEl = document.getElementById('deleteUserModal');
  const deleteUserModal = deleteUserModalEl ? new bootstrap.Modal(deleteUserModalEl) : null;
  const deleteUserLabelEl = document.getElementById('delete_user_label');
  const deleteUserEmailLabelEl = document.getElementById('delete_user_email_label');
  const deleteUserVerifyInputEl = document.getElementById('delete_user_verify_input');
  const deleteUserModalResponseEl = document.getElementById('delete-user-modal-response');
  const confirmDeleteUserBtn = document.getElementById('confirm-delete-user');

  let usersLoadedOnce = false;
  let currentResetTarget = null;
  let currentDeleteTarget = null;

  function setAlert(el, kind, message) {
    if (!el) return;
    el.classList.remove('d-none', 'alert-success', 'alert-danger', 'alert-warning');
    el.classList.add(kind === 'success' ? 'alert-success' : kind === 'warning' ? 'alert-warning' : 'alert-danger');
    el.textContent = message;
  }

  function hideAlert(el) {
    if (!el) return;
    el.classList.add('d-none');
    el.textContent = '';
  }

  function resetAddUserUi(options = {}) {
    hideAlert(addUserResponseEl);
    if (addUserResultEl) addUserResultEl.classList.add('d-none');
    if (addUserTempPasswordEl) addUserTempPasswordEl.textContent = '—';
    if (addUserExpiresAtEl) addUserExpiresAtEl.textContent = '';
    if (options.resetForm && addUserForm) {
      try { addUserForm.reset(); } catch (_) {}
    }
    if (addUserSubmitBtn) addUserSubmitBtn.disabled = false;
  }

  function openAddUserModal() {
    if (!addUserModal) return;
    resetAddUserUi({ resetForm: true });
    try { addUserModal.show(); } catch (_) {}
    // Focus name field (best effort)
    setTimeout(() => {
      try { addUserNameEl?.focus(); } catch (_) {}
    }, 50);
  }

  function resetResetUserModalUi() {
    hideAlert(resetUserModalResponseEl);
    if (resetUserModalResultEl) resetUserModalResultEl.classList.add('d-none');
    if (resetUserTempPasswordEl) resetUserTempPasswordEl.textContent = '—';
    if (resetUserExpiresAtEl) resetUserExpiresAtEl.textContent = '';
    if (confirmResetUserPasswordBtn) confirmResetUserPasswordBtn.disabled = false;
  }

  function openResetUserModal(user) {
    currentResetTarget = user || null;
    if (!resetUserPasswordModal) return;
    resetResetUserModalUi();
    if (resetUserLabelEl) resetUserLabelEl.textContent = user?.name ? user.name : '(sans nom)';
    if (resetUserEmailLabelEl) resetUserEmailLabelEl.textContent = user?.email || '';
    resetUserPasswordModal.show();
  }

  function resetDeleteUserModalUi() {
    hideAlert(deleteUserModalResponseEl);
    if (deleteUserVerifyInputEl) deleteUserVerifyInputEl.value = '';
    if (confirmDeleteUserBtn) confirmDeleteUserBtn.disabled = true;
  }

  function openDeleteUserModal(user) {
    currentDeleteTarget = user || null;
    if (!deleteUserModal) return;
    resetDeleteUserModalUi();
    if (deleteUserLabelEl) deleteUserLabelEl.textContent = user?.name ? user.name : '(sans nom)';
    if (deleteUserEmailLabelEl) deleteUserEmailLabelEl.textContent = user?.email || '';
    deleteUserModal.show();
  }

  function setUsersCount(count) {
    if (!adminUsersCountEl) return;
    adminUsersCountEl.textContent = Number.isInteger(count) ? String(count) : '—';
  }

  function renderAdminUsers(users) {
    if (!adminUsersBody) return;
    const list = Array.isArray(users) ? users : [];
    setUsersCount(list.length);

    if (!list.length) {
      adminUsersBody.innerHTML = '<tr><td colspan="4" class="text-muted">Aucun utilisateur.</td></tr>';
      return;
    }

    adminUsersBody.innerHTML = '';

    list.forEach((u) => {
      const tr = document.createElement('tr');

      const tdName = document.createElement('td');
      tdName.textContent = u?.name || '(sans nom)';

      const tdEmail = document.createElement('td');
      tdEmail.textContent = u?.email || '';

      const tdStatus = document.createElement('td');
      tdStatus.className = 'text-nowrap';

      const badges = [];
      if (u?.admin) badges.push({ text: 'Admin', cls: 'bg-warning text-dark' });
      if (u?.mustChangePassword) badges.push({ text: 'Reset MDP', cls: 'bg-danger' });

      if (!badges.length) {
        const span = document.createElement('span');
        span.className = 'badge bg-secondary';
        span.textContent = 'OK';
        tdStatus.appendChild(span);
      } else {
        badges.forEach((b, idx) => {
          const span = document.createElement('span');
          span.className = `badge ${b.cls}`;
          span.textContent = b.text;
          tdStatus.appendChild(span);
          if (idx < badges.length - 1) {
            tdStatus.appendChild(document.createTextNode(' '));
          }
        });
      }

      const tdActions = document.createElement('td');
      tdActions.className = 'text-nowrap';

      const resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.className = 'btn btn-outline-danger btn-sm me-1';
      resetBtn.textContent = 'Reset MDP';
      resetBtn.addEventListener('click', () => openResetUserModal(u));

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn btn-outline-danger btn-sm';
      deleteBtn.textContent = 'Supprimer';

      const isSelf = String(u?.id || '') && String(u.id) === String(decoded?.id || '');
      if (isSelf || u?.admin) {
        deleteBtn.disabled = true;
        deleteBtn.title = isSelf ? 'Impossible de supprimer ton propre compte' : 'Suppression des admins désactivée';
      }

      deleteBtn.addEventListener('click', () => openDeleteUserModal(u));
      tdActions.appendChild(resetBtn);
      tdActions.appendChild(deleteBtn);

      tr.appendChild(tdName);
      tr.appendChild(tdEmail);
      tr.appendChild(tdStatus);
      tr.appendChild(tdActions);
      adminUsersBody.appendChild(tr);
    });
  }

  async function fetchAdminUsers() {
    const res = await fetch('/api/users/admin/list', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      }
    });

    const data = await res.json().catch(() => ([]));
    if (!res.ok) {
      const msg = data?.message || data?.error || `Erreur (${res.status})`;
      throw new Error(msg);
    }
    return Array.isArray(data) ? data : [];
  }

  async function loadAdminUsers(options = {}) {
    const force = !!options.force;
    if (!adminUsersBody) return;
    if (usersLoadedOnce && !force) return;

    adminUsersBody.innerHTML = '<tr><td colspan="4" class="text-muted">Chargement…</td></tr>';
    setUsersCount(null);

    try {
      const users = await fetchAdminUsers();
      usersLoadedOnce = true;
      users.sort((a, b) => (a?.name || '').localeCompare((b?.name || ''), 'fr', { sensitivity: 'base' }));
      renderAdminUsers(users);
    } catch (err) {
      adminUsersBody.innerHTML = `<tr><td colspan="4" class="text-danger">${err.message || 'Erreur réseau'}</td></tr>`;
      setUsersCount(null);
    }
  }

  function parseYear(value) {
    const n = Number(value);
    if (!Number.isInteger(n)) return null;
    if (n < 1900 || n > 3000) return null;
    return n;
  }

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

  async function setActiveYear(newYear) {
    const res = await fetch('/api/settings/year', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ year: newYear })
    });
    if (!res.ok) {
      let msg = `Erreur (${res.status})`;
      try {
        const data = await res.json();
        msg = data.message || data.error || msg;
      } catch (_) {}
      throw new Error(msg);
    }
    const data = await res.json();
    const year = Number(data?.year);
    return Number.isInteger(year) ? year : newYear;
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

  // Modal 100% live preview wiring
  function hookModal100Inputs() {
    if (!completionModalTitleEl) return;
    const inputs = [completionModalTitleEl, completionModalBodyTextEl, completionModalBodyHtmlEl, completionModalVideoSrcEl].filter(Boolean);
    inputs.forEach((el) => {
      el.addEventListener('input', () => {
        updateCompletionModalPreview(getCompletionModalFormValue());
      });
    });

    if (completionModalReloadBtn) {
      completionModalReloadBtn.addEventListener('click', async () => {
        completionModalReloadBtn.disabled = true;
        const oldText = completionModalReloadBtn.textContent;
        completionModalReloadBtn.textContent = 'Chargement...';
        try {
          await loadCompletionModalIntoUi();
          showResponse('success', 'Contenu rechargé.');
        } catch (_) {
          // loadCompletionModalIntoUi already handles messaging
        } finally {
          completionModalReloadBtn.disabled = false;
          completionModalReloadBtn.textContent = oldText;
        }
      });
    }

    if (completionModalSaveBtn) {
      completionModalSaveBtn.addEventListener('click', async () => {
        completionModalSaveBtn.disabled = true;
        const oldText = completionModalSaveBtn.textContent;
        completionModalSaveBtn.textContent = 'Enregistrement...';
        try {
          const value = getCompletionModalFormValue();
          // send raw HTML; server sanitizes/caps it
          const saved = await saveCompletionModal(value);
          setCompletionModalForm(saved);
          updateCompletionModalPreview(getCompletionModalFormValue());
          showResponse('success', 'Modal 100% enregistré.');
        } catch (err) {
          showResponse('danger', err.message || 'Erreur réseau');
        } finally {
          completionModalSaveBtn.disabled = false;
          completionModalSaveBtn.textContent = oldText;
        }
      });
    }
  }

  if (deleteUserVerifyInputEl && confirmDeleteUserBtn) {
    deleteUserVerifyInputEl.addEventListener('input', () => {
      const expected = String(currentDeleteTarget?.email || '').trim();
      const typed = String(deleteUserVerifyInputEl.value || '').trim();
      confirmDeleteUserBtn.disabled = !(expected && typed && expected === typed);
    });
  }

  if (copyTempPasswordBtn) {
    copyTempPasswordBtn.addEventListener('click', async () => {
      const text = String(resetUserTempPasswordEl?.textContent || '').trim();
      if (!text || text === '—') return;
      try {
        await navigator.clipboard.writeText(text);
        setAlert(resetUserModalResponseEl, 'success', 'Copié.');
        setTimeout(() => hideAlert(resetUserModalResponseEl), 1200);
      } catch (_) {
        // Fallback: select text for manual copy
        setAlert(resetUserModalResponseEl, 'warning', 'Impossible de copier automatiquement. Copie manuellement.');
      }
    });
  }

  if (copyAddUserTempPasswordBtn) {
    copyAddUserTempPasswordBtn.addEventListener('click', async () => {
      const text = String(addUserTempPasswordEl?.textContent || '').trim();
      if (!text || text === '—') return;
      try {
        await navigator.clipboard.writeText(text);
        setAlert(addUserResponseEl, 'success', 'Copié.');
        setTimeout(() => hideAlert(addUserResponseEl), 1200);
      } catch (_) {
        setAlert(addUserResponseEl, 'warning', 'Impossible de copier automatiquement. Copie manuellement.');
      }
    });
  }

  if (openAddUserModalBtn) {
    openAddUserModalBtn.addEventListener('click', () => openAddUserModal());
  }

  if (addUserModalEl) {
    // Whenever the modal is opened, clear previous result/state.
    addUserModalEl.addEventListener('shown.bs.modal', () => {
      resetAddUserUi({ resetForm: true });
    });
  }

  if (addUserResetBtn) {
    addUserResetBtn.addEventListener('click', () => {
      resetAddUserUi({ resetForm: true });
    });
  }

  if (addUserForm) {
    addUserForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      resetAddUserUi({ resetForm: false });

      const name = String(addUserNameEl?.value || '').trim();
      const email = String(addUserEmailEl?.value || '').trim();
      const admin = !!addUserAdminEl?.checked;

      if (!name) {
        setAlert(addUserResponseEl, 'warning', 'Nom requis.');
        return;
      }
      if (!email) {
        setAlert(addUserResponseEl, 'warning', 'Email requis.');
        return;
      }

      if (addUserSubmitBtn) addUserSubmitBtn.disabled = true;
      setAlert(addUserResponseEl, 'warning', 'Création...');

      try {
        const res = await fetch('/api/users/admin/create', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ name, email, admin }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setAlert(addUserResponseEl, 'danger', data.message || data.error || `Erreur (${res.status})`);
          if (addUserSubmitBtn) addUserSubmitBtn.disabled = false;
          return;
        }

        // Show temp password once
        if (addUserTempPasswordEl) addUserTempPasswordEl.textContent = data?.tempPassword || '—';
        if (addUserExpiresAtEl) addUserExpiresAtEl.textContent = data?.expiresAt ? `Expire: ${data.expiresAt}` : '';
        if (addUserResultEl) addUserResultEl.classList.remove('d-none');
        setAlert(addUserResponseEl, 'success', data.message || 'Utilisateur créé.');
        if (addUserSubmitBtn) addUserSubmitBtn.disabled = false;

        // Refresh list if already loaded or when user tab is active
        await loadAdminUsers({ force: true });
      } catch (err) {
        setAlert(addUserResponseEl, 'danger', err.message || 'Erreur réseau');
        if (addUserSubmitBtn) addUserSubmitBtn.disabled = false;
      }
    });
  }

  if (confirmResetUserPasswordBtn) {
    confirmResetUserPasswordBtn.addEventListener('click', async () => {
      const target = currentResetTarget;
      const userId = String(target?.id || '').trim();
      if (!userId) return;

      confirmResetUserPasswordBtn.disabled = true;
      resetResetUserModalUi();
      setAlert(resetUserModalResponseEl, 'warning', 'Génération du mot de passe temporaire...');

      try {
        const res = await fetch('/api/users/admin/reset-temp-password', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ userId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setAlert(resetUserModalResponseEl, 'danger', data.message || data.error || `Erreur (${res.status})`);
          confirmResetUserPasswordBtn.disabled = false;
          return;
        }

        hideAlert(resetUserModalResponseEl);
        if (resetUserTempPasswordEl) resetUserTempPasswordEl.textContent = data?.tempPassword || '—';
        if (resetUserExpiresAtEl) {
          resetUserExpiresAtEl.textContent = data?.expiresAt ? `Expire: ${data.expiresAt}` : '';
        }
        if (resetUserModalResultEl) resetUserModalResultEl.classList.remove('d-none');
        setAlert(resetUserModalResponseEl, 'success', 'Mot de passe temporaire généré. Copie-le et envoie-le à l’utilisateur.');
        confirmResetUserPasswordBtn.disabled = false;
        await loadAdminUsers({ force: true });
      } catch (err) {
        setAlert(resetUserModalResponseEl, 'danger', err.message || 'Erreur réseau');
        confirmResetUserPasswordBtn.disabled = false;
      }
    });
  }

  if (confirmDeleteUserBtn) {
    confirmDeleteUserBtn.addEventListener('click', async () => {
      const target = currentDeleteTarget;
      const userId = String(target?.id || '').trim();
      if (!userId) return;

      confirmDeleteUserBtn.disabled = true;
      hideAlert(deleteUserModalResponseEl);
      setAlert(deleteUserModalResponseEl, 'warning', 'Suppression...');

      try {
        const res = await fetch('/api/users/admin/delete', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ userId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setAlert(deleteUserModalResponseEl, 'danger', data.message || data.error || `Erreur (${res.status})`);
          // Keep disabled until the input matches again.
          const expected = String(target?.email || '').trim();
          const typed = String(deleteUserVerifyInputEl?.value || '').trim();
          confirmDeleteUserBtn.disabled = !(expected && typed && expected === typed);
          return;
        }

        setAlert(deleteUserModalResponseEl, 'success', data.message || 'Utilisateur supprimé.');
        await loadAdminUsers({ force: true });
        // Close shortly after success
        setTimeout(() => {
          try { deleteUserModal?.hide(); } catch (_) {}
        }, 600);
      } catch (err) {
        setAlert(deleteUserModalResponseEl, 'danger', err.message || 'Erreur réseau');
      }
    });
  }

  if (refreshUsersBtn) {
    refreshUsersBtn.addEventListener('click', async () => {
      refreshUsersBtn.disabled = true;
      const oldText = refreshUsersBtn.textContent;
      refreshUsersBtn.textContent = 'Chargement...';
      try {
        await loadAdminUsers({ force: true });
      } finally {
        refreshUsersBtn.disabled = false;
        refreshUsersBtn.textContent = oldText;
      }
    });
  }

  if (adminUsersTabBtn) {
    // Only load when the tab is shown (and then cache), to keep initial load snappy.
    adminUsersTabBtn.addEventListener('shown.bs.tab', () => loadAdminUsers({ force: false }));
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();

    const year = parseYear(yearInput.value);
    const imdb_id = document.getElementById('imdb_id').value.trim();
    const category = document.getElementById('category').value.trim();
    const vod_link = document.getElementById('vod_link').value.trim();
    const player_mode = (document.getElementById('player_mode')?.value || 'auto').trim();
    const video_src = document.getElementById('video_src')?.value?.trim() || '';
    const embed_src = document.getElementById('embed_src')?.value?.trim() || '';

    if (!year) {
      showResponse('warning', 'Année invalide. Exemple attendu: 2026');
      return;
    }

    if (!/^tt\d{5,}$/.test(imdb_id)) {
      showResponse('warning', 'IMDB ID invalide. Exemple attendu: tt1234567');
      return;
    }

    if (!vod_link && !video_src && !embed_src) {
      showResponse('warning', 'Ajoute au moins une source (VOD / video_src / embed_src).');
      return;
    }

    try {
      const res = await fetch('/api/movies/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ year, imdb_id, category, vod_link, player_mode, video_src, embed_src })
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
      const cleanedYears = (Array.isArray(years) ? years : [])
        .map((y) => Number(y))
        .filter((y) => Number.isInteger(y) && y >= 1900 && y <= 3000)
        .sort((a, b) => b - a);

      // Rebuild manage dropdown from scratch (so removed years disappear)
      const previousSelection = manageYearSelect.value;
      manageYearSelect.innerHTML = '';
      const allOpt = document.createElement('option');
      allOpt.value = '';
      allOpt.textContent = 'Toutes';
      manageYearSelect.appendChild(allOpt);

      cleanedYears.forEach((y) => {
        const opt = document.createElement('option');
        opt.value = String(y);
        opt.textContent = String(y);
        manageYearSelect.appendChild(opt);
      });

      const stillExists = cleanedYears.map(String).includes(previousSelection);
      manageYearSelect.value = stillExists ? previousSelection : '';

      // Prefer defaulting UI to active year (if selection is empty/invalid).
      const hasSelection = !!manageYearSelect.value;
      if (!hasSelection && activeYear && cleanedYears.map(String).includes(String(activeYear))) {
        manageYearSelect.value = String(activeYear);
      }

      // Default add-year to active year (or latest year) if empty
      if (!yearInput.value) {
        if (activeYear) {
          yearInput.value = String(activeYear);
        } else if (cleanedYears.length > 0) {
          yearInput.value = String(cleanedYears[0]);
        }
      }

      // Rebuild active-year dropdown from distinct movie years
      if (activeYearInput && saveActiveYearBtn) {
        const previousActiveSelection = String(activeYearInput.value || '');
        activeYearInput.innerHTML = '';

        if (cleanedYears.length === 0) {
          const opt = document.createElement('option');
          opt.value = '';
          opt.textContent = 'Aucune année (ajoute un film)';
          opt.disabled = true;
          opt.selected = true;
          activeYearInput.appendChild(opt);
          activeYearInput.disabled = true;
          saveActiveYearBtn.disabled = true;
        } else {
          cleanedYears.forEach((y) => {
            const opt = document.createElement('option');
            opt.value = String(y);
            opt.textContent = String(y);
            activeYearInput.appendChild(opt);
          });

          // Keep current selection if still valid, else use activeYear, else latest.
          const desired =
            (previousActiveSelection && cleanedYears.map(String).includes(previousActiveSelection))
              ? previousActiveSelection
              : (activeYear && cleanedYears.map(String).includes(String(activeYear)))
                ? String(activeYear)
                : String(cleanedYears[0]);

          activeYearInput.disabled = false;
          saveActiveYearBtn.disabled = false;
          activeYearInput.value = desired;
        }
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
    if (editPlayerModeEl) editPlayerModeEl.value = movie.player_mode || 'auto';
    if (editVideoSrcEl) editVideoSrcEl.value = movie.video_src || '';
    if (editEmbedSrcEl) editEmbedSrcEl.value = movie.embed_src || '';
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
    const player_mode = (editPlayerModeEl?.value || 'auto').trim();
    const video_src = (editVideoSrcEl?.value || '').trim();
    const embed_src = (editEmbedSrcEl?.value || '').trim();
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

    if (!vod_link && !video_src && !embed_src) {
      showResponse('warning', 'Ajoute au moins une source (VOD / video_src / embed_src).');
      return;
    }

    const body = {
      imdb_id,
      year: yearRaw === '' ? null : year,
      category,
      vod_link,
      player_mode,
      video_src,
      embed_src,
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
    adminMoviesBody.innerHTML = `<tr><td colspan="6" class="text-muted">Chargement…</td></tr>`;

    try {
      const res = await fetch(url, { method: 'GET' });
      if (!res.ok) {
        adminMoviesBody.innerHTML = `<tr><td colspan="6" class="text-danger">Erreur lors du chargement (${res.status})</td></tr>`;
        return;
      }
      const movies = await res.json();
      movies.sort((a, b) => (a.title || '').localeCompare((b.title || ''), 'fr', { sensitivity: 'base' }));
      moviesById = new Map(movies.map((m) => [m._id, m]));

      if (!movies.length) {
        adminMoviesBody.innerHTML = `<tr><td colspan="6" class="text-muted">Aucun film.</td></tr>`;
        updateSelectionUI();
        return;
      }

      function buildPlayerBadges(m) {
        const badges = [];
        const hasVideo = !!(m && m.video_src);
        const hasEmbed = !!(m && m.embed_src);
        const hasLegacy = !!(m && m.vod_link);

        if (hasVideo) badges.push({ text: 'Video', cls: 'bg-primary' });
        if (hasEmbed) badges.push({ text: 'Embed', cls: 'bg-info text-dark' });
        if (hasLegacy) badges.push({ text: 'Legacy', cls: 'bg-secondary' });

        const modeRaw = String(m?.player_mode || 'auto').toLowerCase();
        const mode = (modeRaw === 'video' || modeRaw === 'embed' || modeRaw === 'auto') ? modeRaw : 'auto';
        const modeText = mode === 'auto' ? 'Auto' : mode === 'video' ? 'Mode: Video' : 'Mode: Embed';
        badges.push({ text: modeText, cls: 'bg-light text-dark border' });

        if (!hasVideo && !hasEmbed && !hasLegacy) {
          return [{ text: '—', cls: 'bg-light text-dark border' }];
        }
        return badges;
      }

      adminMoviesBody.innerHTML = '';
      movies.forEach((m) => {
        const badges = buildPlayerBadges(m);
        const badgesHtml = badges
          .map((b) => `<span class="badge ${b.cls} me-1 mb-1">${b.text}</span>`)
          .join('');

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>
            <input type="checkbox" class="form-check-input" data-movie-id="${m._id}">
          </td>
          <td>
            <div class="fw-semibold">${m.title || '(sans titre)'}</div>
            <div class="text-muted small">${m.imdb_id || ''}</div>
          </td>
          <td>${badgesHtml}</td>
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
      adminMoviesBody.innerHTML = `<tr><td colspan="6" class="text-danger">${err.message || 'Erreur réseau'}</td></tr>`;
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
  activeYear = await fetchActiveYear();
  if (activeYear) {
    document.title = `Pool Oscars ${activeYear} - Admin`;
  }

  hookModal100Inputs();
  await loadCompletionModalIntoUi();

  if (saveActiveYearBtn && activeYearInput) {
    saveActiveYearBtn.addEventListener('click', async () => {
      const y = parseYear(activeYearInput.value);
      if (!y) {
        showResponse('warning', 'Année invalide. Exemple attendu: 2026');
        return;
      }
      saveActiveYearBtn.disabled = true;
      const oldText = saveActiveYearBtn.textContent;
      saveActiveYearBtn.textContent = 'Application...';
      try {
        activeYear = await setActiveYear(y);
        activeYearInput.value = String(activeYear);
        yearInput.value = String(activeYear);
        document.title = `Pool Oscars ${activeYear} - Admin`;
        showResponse('success', `Année active appliquée: ${activeYear}`);
        await refreshYears();
        await loadMoviesForManagement();
      } catch (err) {
        showResponse('danger', err.message || 'Erreur réseau');
      } finally {
        saveActiveYearBtn.disabled = false;
        saveActiveYearBtn.textContent = oldText;
      }
    });
  }

  await refreshYears();
  await loadMoviesForManagement();
};

