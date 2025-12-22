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

  // Version control tab elements
  const adminVersionTabBtn = document.getElementById('admin-version-tab');
  const appVersionAlertEl = document.getElementById('app_version_alert');
  const appVersionActiveSelectEl = document.getElementById('app_version_active_select');
  const appVersionReloadBtn = document.getElementById('app_version_reload');
  const appVersionSetActiveBtn = document.getElementById('app_version_set_active');
  const appVersionPreviewEl = document.getElementById('app_version_preview');
  const appVersionNewVersionEl = document.getElementById('app_version_new_version');
  const appVersionNewMessageEl = document.getElementById('app_version_new_message');
  const appVersionCreateBtn = document.getElementById('app_version_create');
  const appVersionCreateAndActivateBtn = document.getElementById('app_version_create_and_activate');
  const appVersionListEl = document.getElementById('app_version_list');

  // Oscar date per year (settings tab)
  const oscarDateYearSelect = document.getElementById('oscar_date_year');
  const oscarDateValueInput = document.getElementById('oscar_date_value');
  const saveOscarDateBtn = document.getElementById('save-oscar-date');
  const clearOscarDateBtn = document.getElementById('clear-oscar-date');
  const oscarDateCurrentEl = document.getElementById('oscar-date-current');

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

  // Winners tab elements
  const adminWinnersTabBtn = document.getElementById('admin-winners-tab');
  const winnerYearSelect = document.getElementById('winner_year');
  const winnerUserSelect = document.getElementById('winner_user');
  const winnerPointsEl = document.getElementById('winner_points');
  const winnerReloadBtn = document.getElementById('winner_reload');
  const winnerClearBtn = document.getElementById('winner_clear');
  const winnerSaveBtn = document.getElementById('winner_save');
  const winnerCurrentEl = document.getElementById('winner_current');

  const editMovieModalEl = document.getElementById('editMovieModal');
  const editMovieModal = editMovieModalEl ? new bootstrap.Modal(editMovieModalEl) : null;
  const editMovieModalTitleEl = document.getElementById('editMovieModalTitle');
  const saveMovieChangesBtn = document.getElementById('save-movie-changes');

  const editMovieIdEl = document.getElementById('edit_movie_id');
  const editMovieIdLabelEl = document.getElementById('edit_movie_id_label');
  const copyMovieIdBtn = document.getElementById('copy-movie-id');
  const editImdbIdEl = document.getElementById('edit_imdb_id');
  const editYearEl = document.getElementById('edit_year');
  const editCategoryEl = document.getElementById('edit_category');
  const editVodLinkEl = document.getElementById('edit_vod_link');
  const editPlayerModeEl = document.getElementById('edit_player_mode');
  const editVideoSrcEl = document.getElementById('edit_video_src');
  const editVideoFileEl = document.getElementById('edit_video_file');
  const editEmbedSrcEl = document.getElementById('edit_embed_src');
  const editRefreshOmdbEl = document.getElementById('edit_refresh_omdb');
  const editTitleEl = document.getElementById('edit_title');
  const editRatingEl = document.getElementById('edit_rating');
  const editPosterEl = document.getElementById('edit_poster');
  const editDescriptionEl = document.getElementById('edit_description');

  let moviesById = new Map();
  let activeYear = null;
  let winnersLoadedOnce = false;
  let winnerUsersLoadedOnce = false;
  let winnersByYear = new Map(); // year -> [{ year, userId, name, points }]
  let winnerUsers = []; // admin list: {id, name, email, ...}
  let oscarDatesLoadedOnce = false;
  let oscarDatesByYear = {}; // { "2026": "2026-03-15" }
  let appVersionLoadedOnce = false;
  let appVersionState = { active: null, versions: [] };

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

  function escapeHtml(raw) {
    return String(raw || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  async function copyToClipboard(text) {
    const t = String(text || '').trim();
    if (!t) return false;
    try {
      await navigator.clipboard.writeText(t);
      return true;
    } catch (_) {
      return false;
    }
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

  async function fetchAppVersionState() {
    const res = await fetch('/api/settings/app-version', { method: 'GET' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.message || data.error || `Erreur (${res.status})`;
      throw new Error(msg);
    }
    return {
      active: data?.active && typeof data.active === 'object' ? data.active : null,
      versions: Array.isArray(data?.versions) ? data.versions : [],
    };
  }

  async function createAppVersionEntry({ version, message, activate }) {
    const res = await fetch(`/api/settings/app-version?activate=${activate ? 'true' : 'false'}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ version, message }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.message || data.error || `Erreur (${res.status})`;
      throw new Error(msg);
    }
    return {
      active: data?.active && typeof data.active === 'object' ? data.active : null,
      versions: Array.isArray(data?.versions) ? data.versions : [],
    };
  }

  async function setActiveAppVersion(id) {
    const res = await fetch('/api/settings/app-version/active', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ id }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.message || data.error || `Erreur (${res.status})`;
      throw new Error(msg);
    }
    return {
      active: data?.active && typeof data.active === 'object' ? data.active : null,
      versions: Array.isArray(data?.versions) ? data.versions : [],
    };
  }

  async function deleteAppVersionEntry(id) {
    const res = await fetch(`/api/settings/app-version/${encodeURIComponent(String(id))}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.message || data.error || `Erreur (${res.status})`;
      throw new Error(msg);
    }
    return {
      active: data?.active && typeof data.active === 'object' ? data.active : null,
      versions: Array.isArray(data?.versions) ? data.versions : [],
    };
  }

  function setAppVersionAlert(kind, message) {
    if (!appVersionAlertEl) return;
    appVersionAlertEl.classList.remove('d-none', 'alert-success', 'alert-danger', 'alert-warning');
    appVersionAlertEl.classList.add(kind === 'success' ? 'alert-success' : kind === 'warning' ? 'alert-warning' : 'alert-danger');
    appVersionAlertEl.textContent = message;
  }

  function hideAppVersionAlert() {
    if (!appVersionAlertEl) return;
    appVersionAlertEl.classList.add('d-none');
    appVersionAlertEl.textContent = '';
  }

  async function refreshAppVersionPreview() {
    if (!appVersionPreviewEl) return;
    try {
      const res = await fetch('/api/version', { method: 'GET' });
      if (!res.ok) throw new Error(`Erreur (${res.status})`);
      const data = await res.json().catch(() => ({}));
      const line = `${data?.date || ''} - ${data?.version || ''} - ${data?.message || ''}`.trim();
      appVersionPreviewEl.textContent = line || '—';
      appVersionPreviewEl.style.whiteSpace = 'pre-wrap';
    } catch (_) {
      appVersionPreviewEl.textContent = '—';
    }
  }

  function renderAppVersionUI() {
    if (!appVersionActiveSelectEl || !appVersionListEl) return;
    const versions = Array.isArray(appVersionState.versions) ? appVersionState.versions : [];
    const activeId = appVersionState?.active?.id ? String(appVersionState.active.id) : '';

    const previous = String(appVersionActiveSelectEl.value || '');
    appVersionActiveSelectEl.innerHTML = '';

    if (!versions.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Aucune version (crée-en une)';
      opt.disabled = true;
      opt.selected = true;
      appVersionActiveSelectEl.appendChild(opt);
      appVersionActiveSelectEl.disabled = true;
      if (appVersionSetActiveBtn) appVersionSetActiveBtn.disabled = true;
    } else {
      versions.forEach((v) => {
        const opt = document.createElement('option');
        opt.value = String(v?.id || '');
        const dateLabel = v?.dateISO ? formatDateTime(v.dateISO) : '—';
        const msg = String(v?.message || '').trim();
        const shortMsg = msg.length > 80 ? `${msg.slice(0, 77)}...` : msg;
        opt.textContent = `${v?.version || '—'} — ${dateLabel}${shortMsg ? ` — ${shortMsg}` : ''}`;
        appVersionActiveSelectEl.appendChild(opt);
      });

      const stillExists = versions.map((v) => String(v?.id || '')).includes(previous);
      const desired = activeId || (stillExists ? previous : String(versions[0]?.id || ''));
      appVersionActiveSelectEl.value = desired;
      appVersionActiveSelectEl.disabled = false;
      if (appVersionSetActiveBtn) appVersionSetActiveBtn.disabled = false;
    }

    if (!versions.length) {
      appVersionListEl.textContent = '—';
      return;
    }

    const rows = versions.map((v) => {
      const id = String(v?.id || '');
      const isActive = activeId && id === activeId;
      const dateLabel = v?.dateISO ? formatDateTime(v.dateISO) : '—';
      const msg = escapeHtml(String(v?.message || '').trim());
      const versionLabel = escapeHtml(String(v?.version || '—'));
      const activeBadge = isActive ? '<span class="badge bg-warning text-dark">Active</span>' : '';

      // IMPORTANT: keep markup compact (no preserved whitespace surprises).
      return (
        `<div class="list-group-item d-flex justify-content-between align-items-start gap-3">` +
          `<div class="min-width-0 flex-grow-1">` +
            `<div class="d-flex align-items-center gap-2 flex-wrap">` +
              `<span class="fw-semibold text-break">${versionLabel}</span>` +
              `${activeBadge}` +
            `</div>` +
            `<div class="small text-muted text-break">${escapeHtml(dateLabel)}${msg ? ` — ${msg}` : ''}</div>` +
          `</div>` +
          `<div class="flex-shrink-0">` +
            `<button type="button" class="btn btn-sm btn-outline-danger" data-app-version-delete="${escapeHtml(id)}">Supprimer</button>` +
          `</div>` +
        `</div>`
      );
    }).join('');

    appVersionListEl.innerHTML = `<div class="list-group list-group-flush">${rows}</div>`;

    appVersionListEl.querySelectorAll('button[data-app-version-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-app-version-delete');
        if (!id) return;
        const ok = window.confirm('Supprimer cette version ?');
        if (!ok) return;
        btn.disabled = true;
        const old = btn.textContent;
        btn.textContent = '...';
        try {
          hideAppVersionAlert();
          appVersionState = await deleteAppVersionEntry(id);
          appVersionLoadedOnce = true;
          renderAppVersionUI();
          await refreshAppVersionPreview();
          setAppVersionAlert('success', 'Version supprimée.');
        } catch (err) {
          setAppVersionAlert('danger', err.message || 'Erreur réseau');
        } finally {
          btn.disabled = false;
          btn.textContent = old;
        }
      });
    });
  }

  async function loadAppVersionTab(options = {}) {
    const force = !!options.force;
    if (!appVersionActiveSelectEl || !appVersionListEl) return;
    if (appVersionLoadedOnce && !force) return;
    try {
      hideAppVersionAlert();
      appVersionState = await fetchAppVersionState();
      appVersionLoadedOnce = true;
      renderAppVersionUI();
      await refreshAppVersionPreview();
    } catch (err) {
      appVersionLoadedOnce = true;
      appVersionState = { active: null, versions: [] };
      renderAppVersionUI();
      await refreshAppVersionPreview();
      setAppVersionAlert('danger', err.message || 'Erreur réseau');
    }
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

  // Admin DB backup/restore elements
  const adminBackupTabBtn = document.getElementById('admin-backup-tab');
  const dbBackupCreateBtn = document.getElementById('db-backup-create');
  const dbBackupRefreshBtn = document.getElementById('db-backup-refresh');
  const dbBackupListBody = document.getElementById('db-backup-list');
  const dbRestoreFileEl = document.getElementById('db-restore-file');
  const dbRestoreDropEl = document.getElementById('db-restore-drop');
  const dbRestoreRunBtn = document.getElementById('db-restore-run');
  const dbRestoreResultEl = document.getElementById('db-restore-result');

  let backupsLoadedOnce = false;

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

  function isIsoDateString(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
  }

  async function fetchOscarDates() {
    const res = await fetch('/api/settings/oscar-dates', { method: 'GET' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.message || data.error || `Erreur (${res.status})`;
      throw new Error(msg);
    }
    return data?.dates && typeof data.dates === 'object' ? data.dates : {};
  }

  async function ensureOscarDatesLoaded(options = {}) {
    const force = !!options.force;
    if (oscarDatesLoadedOnce && !force) return;
    try {
      oscarDatesByYear = await fetchOscarDates();
      oscarDatesLoadedOnce = true;
    } catch (_) {
      oscarDatesByYear = {};
      oscarDatesLoadedOnce = true;
    }
  }

  async function setOscarDateForYear(year, dateStrOrEmpty) {
    const res = await fetch(`/api/settings/oscar-date/${encodeURIComponent(String(year))}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ date: dateStrOrEmpty }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.message || data.error || `Erreur (${res.status})`;
      throw new Error(msg);
    }
    return data;
  }

  function renderOscarDatesCurrent(cleanedYears) {
    if (!oscarDateCurrentEl) return;
    const years = Array.isArray(cleanedYears) ? cleanedYears : [];
    if (!years.length) {
      oscarDateCurrentEl.textContent = '—';
      return;
    }

    const lines = years.map((y) => {
      const key = String(y);
      const val = oscarDatesByYear && typeof oscarDatesByYear === 'object' ? oscarDatesByYear[key] : null;
      const date = (typeof val === 'string' && isIsoDateString(val)) ? val : '— (défaut: 03-15)';
      return `${key}: ${date}`;
    });

    oscarDateCurrentEl.textContent = lines.join('\n');
    oscarDateCurrentEl.style.whiteSpace = 'pre';
  }

  function applyOscarDateSelection() {
    if (!oscarDateYearSelect || !oscarDateValueInput) return;
    const y = parseYear(oscarDateYearSelect.value);
    if (!y) {
      oscarDateValueInput.value = '';
      return;
    }
    const key = String(y);
    const val = oscarDatesByYear && typeof oscarDatesByYear === 'object' ? oscarDatesByYear[key] : null;
    oscarDateValueInput.value = (typeof val === 'string' && isIsoDateString(val)) ? val : '';
  }

  async function fetchWinners() {
    const res = await fetch('/api/settings/winners', { method: 'GET' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.message || data.error || `Erreur (${res.status})`;
      throw new Error(msg);
    }
    return Array.isArray(data?.winners) ? data.winners : [];
  }

  async function addWinner(year, userId, points) {
    const res = await fetch(`/api/settings/winners/${encodeURIComponent(String(year))}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        userId: userId ? String(userId) : '',
        points: points === undefined ? null : points,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.message || data.error || `Erreur (${res.status})`;
      throw new Error(msg);
    }
    return data;
  }

  async function removeWinner(year, userId) {
    const res = await fetch(`/api/settings/winners/${encodeURIComponent(String(year))}/${encodeURIComponent(String(userId))}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.message || data.error || `Erreur (${res.status})`;
      throw new Error(msg);
    }
    return data;
  }

  function buildWinnerUsersOptions(users) {
    if (!winnerUserSelect) return;
    const list = Array.isArray(users) ? users : [];
    const previous = String(winnerUserSelect.value || '');
    winnerUserSelect.innerHTML = '';

    const emptyOpt = document.createElement('option');
    emptyOpt.value = '';
    emptyOpt.textContent = '—';
    winnerUserSelect.appendChild(emptyOpt);

    list.forEach((u) => {
      const opt = document.createElement('option');
      opt.value = String(u?.id || '');
      const label = u?.name ? u.name : u?.email ? u.email : '(sans nom)';
      opt.textContent = label;
      winnerUserSelect.appendChild(opt);
    });

    const stillExists = list.map((u) => String(u?.id || '')).includes(previous);
    winnerUserSelect.value = stillExists ? previous : '';
  }

  function setWinnerYearOptions(cleanedYears) {
    if (!winnerYearSelect) return;
    const years = Array.isArray(cleanedYears) ? cleanedYears : [];
    const previous = String(winnerYearSelect.value || '');
    winnerYearSelect.innerHTML = '';

    if (!years.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Aucune année (ajoute un film)';
      opt.disabled = true;
      opt.selected = true;
      winnerYearSelect.appendChild(opt);
      winnerYearSelect.disabled = true;
      if (winnerSaveBtn) winnerSaveBtn.disabled = true;
      if (winnerClearBtn) winnerClearBtn.disabled = true;
      return;
    }

    years.forEach((y) => {
      const opt = document.createElement('option');
      opt.value = String(y);
      opt.textContent = String(y);
      winnerYearSelect.appendChild(opt);
    });

    winnerYearSelect.disabled = false;
    if (winnerSaveBtn) winnerSaveBtn.disabled = false;
    if (winnerClearBtn) winnerClearBtn.disabled = false;

    const stillExists = years.map(String).includes(previous);
    const desired = stillExists
      ? previous
      : (activeYear && years.map(String).includes(String(activeYear)))
        ? String(activeYear)
        : String(years[0]);
    winnerYearSelect.value = desired;
  }

  function getWinnerForYear(year) {
    const y = parseYear(year);
    if (!y) return null;
    return winnersByYear.get(String(y)) || null;
  }

  function renderWinnerCurrent() {
    if (!winnerCurrentEl || !winnerYearSelect) return;
    const y = parseYear(winnerYearSelect.value);
    if (!y) {
      winnerCurrentEl.textContent = '—';
      return;
    }
    const list = getWinnerForYear(y);
    const winners = Array.isArray(list) ? list : [];
    if (!winners.length) {
      winnerCurrentEl.textContent = `${y}: (aucun gagnant)`;
      return;
    }

    // Sort for stable display: points desc (null last), then name
    const sorted = winners.slice().sort((a, b) => {
      const ap = a?.points === null || a?.points === undefined ? null : Number(a.points);
      const bp = b?.points === null || b?.points === undefined ? null : Number(b.points);
      if (ap === null && bp !== null) return 1;
      if (ap !== null && bp === null) return -1;
      if (ap !== null && bp !== null && ap !== bp) return bp - ap;
      return String(a?.name || '').localeCompare(String(b?.name || ''), 'fr', { sensitivity: 'base' });
    });

    const rows = sorted.map((w) => {
      const name = w?.name || '(utilisateur supprimé)';
      const pts = w?.points === null || w?.points === undefined ? null : Number(w.points);
      const ptsLabel = pts === null || Number.isNaN(pts) ? '' : ` <span class="text-muted">— ${pts} pts</span>`;
      const uid = String(w?.userId || '');
      return `
        <div class="d-flex justify-content-between align-items-center border rounded px-2 py-1 mb-2">
          <div class="me-2"><strong>${name}</strong>${ptsLabel}</div>
          <button type="button" class="btn btn-sm btn-outline-danger" data-winner-remove-year="${y}" data-winner-remove-user="${uid}">Retirer</button>
        </div>
      `;
    }).join('');

    const tieLabel = sorted.length > 1 ? ' <span class="text-muted fw-normal">(égalité)</span>' : '';
    winnerCurrentEl.innerHTML = `
      <div class="fw-semibold mb-2">${y}${tieLabel}</div>
      ${rows}
    `;

    winnerCurrentEl.querySelectorAll('button[data-winner-remove-year][data-winner-remove-user]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const yearRaw = btn.getAttribute('data-winner-remove-year');
        const userRaw = btn.getAttribute('data-winner-remove-user');
        const yy = parseYear(yearRaw);
        const uid = String(userRaw || '').trim();
        if (!yy || !uid) return;
        btn.disabled = true;
        const old = btn.textContent;
        btn.textContent = '...';
        try {
          await removeWinner(yy, uid);
          await loadWinners({ force: true });
          showResponse('success', `Gagnant retiré pour ${yy}.`);
        } catch (err) {
          showResponse('danger', err.message || 'Erreur réseau');
        } finally {
          btn.disabled = false;
          btn.textContent = old;
        }
      });
    });
  }

  function applyWinnerFormFromCache() {
    if (!winnerYearSelect) return;
    const y = parseYear(winnerYearSelect.value);
    if (!y) return;
    if (winnerUserSelect) {
      winnerUserSelect.value = '';
    }
    if (winnerPointsEl) {
      // Convenience: if all winners share the same non-null points, pre-fill it.
      const list = getWinnerForYear(y);
      const winners = Array.isArray(list) ? list : [];
      const ptsVals = winners
        .map((w) => (w?.points === null || w?.points === undefined) ? null : Number(w.points))
        .filter((n) => Number.isFinite(n));
      const unique = Array.from(new Set(ptsVals));
      winnerPointsEl.value = unique.length === 1 ? String(unique[0]) : '';
    }
    renderWinnerCurrent();
  }

  async function loadWinners(options = {}) {
    const force = !!options.force;
    if (winnersLoadedOnce && !force) return;
    const list = await fetchWinners();
    winnersLoadedOnce = true;
    const grouped = new Map();
    (Array.isArray(list) ? list : [])
      .filter((w) => parseYear(w?.year))
      .forEach((w) => {
        const key = String(w.year);
        const arr = grouped.get(key) || [];
        arr.push({
          year: Number(w.year),
          userId: String(w.userId || ''),
          name: w.name || null,
          points: w.points ?? null,
        });
        grouped.set(key, arr);
      });
    winnersByYear = grouped;
    applyWinnerFormFromCache();
  }

  async function loadWinnerUsers(options = {}) {
    const force = !!options.force;
    if (winnerUsersLoadedOnce && !force) return;
    const users = await fetchAdminUsers();
    winnerUsersLoadedOnce = true;
    winnerUsers = Array.isArray(users) ? users : [];
    winnerUsers.sort((a, b) => (a?.name || '').localeCompare((b?.name || ''), 'fr', { sensitivity: 'base' }));
    buildWinnerUsersOptions(winnerUsers);
    applyWinnerFormFromCache();
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

  // Oscar date (settings tab) wiring
  if (oscarDateYearSelect) {
    oscarDateYearSelect.addEventListener('change', () => {
      applyOscarDateSelection();
    });
  }

  if (saveOscarDateBtn && oscarDateYearSelect && oscarDateValueInput) {
    saveOscarDateBtn.addEventListener('click', async () => {
      const y = parseYear(oscarDateYearSelect.value);
      if (!y) {
        showResponse('warning', 'Année invalide. Exemple attendu: 2026');
        return;
      }

      const dateValue = String(oscarDateValueInput.value || '').trim();
      if (dateValue && !isIsoDateString(dateValue)) {
        showResponse('warning', 'Date invalide. Format attendu: YYYY-MM-DD');
        return;
      }

      saveOscarDateBtn.disabled = true;
      if (clearOscarDateBtn) clearOscarDateBtn.disabled = true;
      const oldText = saveOscarDateBtn.textContent;
      saveOscarDateBtn.textContent = 'Enregistrement...';

      try {
        const result = await setOscarDateForYear(y, dateValue);
        if (result?.date) {
          oscarDatesByYear[String(y)] = String(result.date);
          showResponse('success', `Date Oscars enregistrée pour ${y}: ${result.date}`);
        } else {
          delete oscarDatesByYear[String(y)];
          showResponse('success', `Date Oscars effacée pour ${y} (retour au défaut: 15 mars).`);
        }

        await refreshYears();
      } catch (err) {
        showResponse('danger', err.message || 'Erreur réseau');
      } finally {
        saveOscarDateBtn.disabled = false;
        if (clearOscarDateBtn) clearOscarDateBtn.disabled = false;
        saveOscarDateBtn.textContent = oldText;
        applyOscarDateSelection();
      }
    });
  }

  if (clearOscarDateBtn && oscarDateYearSelect && oscarDateValueInput) {
    clearOscarDateBtn.addEventListener('click', async () => {
      const y = parseYear(oscarDateYearSelect.value);
      if (!y) {
        showResponse('warning', 'Année invalide. Exemple attendu: 2026');
        return;
      }

      clearOscarDateBtn.disabled = true;
      if (saveOscarDateBtn) saveOscarDateBtn.disabled = true;
      const oldText = clearOscarDateBtn.textContent;
      clearOscarDateBtn.textContent = 'Effacement...';

      try {
        oscarDateValueInput.value = '';
        await setOscarDateForYear(y, '');
        delete oscarDatesByYear[String(y)];
        showResponse('success', `Date Oscars effacée pour ${y} (retour au défaut: 15 mars).`);
        await refreshYears();
      } catch (err) {
        showResponse('danger', err.message || 'Erreur réseau');
      } finally {
        clearOscarDateBtn.disabled = false;
        if (saveOscarDateBtn) saveOscarDateBtn.disabled = false;
        clearOscarDateBtn.textContent = oldText;
        applyOscarDateSelection();
      }
    });
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

  function formatBytes(n) {
    const v = Number(n);
    if (!Number.isFinite(v) || v < 0) return '—';
    if (v < 1024) return `${v} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let x = v / 1024;
    let idx = 0;
    while (x >= 1024 && idx < units.length - 1) {
      x /= 1024;
      idx += 1;
    }
    return `${x.toFixed(x >= 10 ? 1 : 2)} ${units[idx]}`;
  }

  function formatDateTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('fr-FR', { hour12: false });
  }

  async function fetchBackups() {
    const res = await fetch('/api/admin/db/backups', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.message || data.error || `Erreur (${res.status})`);
    }
    return Array.isArray(data.backups) ? data.backups : [];
  }

  function renderBackups(backups) {
    if (!dbBackupListBody) return;
    const list = Array.isArray(backups) ? backups : [];
    if (!list.length) {
      dbBackupListBody.innerHTML = '<tr><td colspan="4" class="text-muted">Aucune sauvegarde.</td></tr>';
      return;
    }

    dbBackupListBody.innerHTML = '';
    list.forEach((b) => {
      const name = String(b?.name || '');
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="font-monospace">${name || '—'}</td>
        <td class="text-nowrap">${formatBytes(b?.sizeBytes)}</td>
        <td class="text-nowrap">${formatDateTime(b?.mtime)}</td>
        <td class="text-end text-nowrap">
          <button type="button" class="btn btn-sm btn-outline-secondary me-1" data-backup-download="${name}">Télécharger</button>
          <button type="button" class="btn btn-sm btn-outline-danger" data-backup-delete="${name}">Supprimer</button>
        </td>
      `;
      dbBackupListBody.appendChild(tr);
    });

    dbBackupListBody.querySelectorAll('button[data-backup-download]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const name = btn.getAttribute('data-backup-download');
        if (!name) return;
        btn.disabled = true;
        const old = btn.textContent;
        btn.textContent = '...';
        try {
          const res = await fetch(`/api/admin/db/backups/${encodeURIComponent(name)}`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` },
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.message || data.error || `Erreur (${res.status})`);
          }
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = name;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
        } catch (err) {
          showResponse('danger', err.message || 'Erreur réseau');
        } finally {
          btn.disabled = false;
          btn.textContent = old;
        }
      });
    });

    dbBackupListBody.querySelectorAll('button[data-backup-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const name = btn.getAttribute('data-backup-delete');
        if (!name) return;
        const ok = window.confirm(`Supprimer la sauvegarde "${name}" ?`);
        if (!ok) return;
        btn.disabled = true;
        const old = btn.textContent;
        btn.textContent = '...';
        try {
          const res = await fetch(`/api/admin/db/backups/${encodeURIComponent(name)}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` },
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            throw new Error(data.message || data.error || `Erreur (${res.status})`);
          }
          showResponse('success', data.message || 'Sauvegarde supprimée.');
          await loadBackups({ force: true });
        } catch (err) {
          showResponse('danger', err.message || 'Erreur réseau');
        } finally {
          btn.disabled = false;
          btn.textContent = old;
        }
      });
    });
  }

  async function loadBackups(options = {}) {
    const force = !!options.force;
    if (!dbBackupListBody) return;
    if (backupsLoadedOnce && !force) return;
    dbBackupListBody.innerHTML = '<tr><td colspan="4" class="text-muted">Chargement…</td></tr>';
    try {
      const backups = await fetchBackups();
      backupsLoadedOnce = true;
      renderBackups(backups);
    } catch (err) {
      dbBackupListBody.innerHTML = `<tr><td colspan="4" class="text-danger">${err.message || 'Erreur réseau'}</td></tr>`;
    }
  }

  async function createBackup() {
    if (!dbBackupCreateBtn) return;
    dbBackupCreateBtn.disabled = true;
    const old = dbBackupCreateBtn.textContent;
    dbBackupCreateBtn.textContent = 'Création...';
    try {
      const res = await fetch('/api/admin/db/backup', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || data.error || `Erreur (${res.status})`);
      }
      showResponse('success', `Sauvegarde créée: ${data?.backup?.name || 'OK'}`);
      await loadBackups({ force: true });
    } catch (err) {
      showResponse('danger', err.message || 'Erreur réseau');
    } finally {
      dbBackupCreateBtn.disabled = false;
      dbBackupCreateBtn.textContent = old;
    }
  }

  async function runRestore() {
    if (!dbRestoreRunBtn || !dbRestoreFileEl) return;
    const file = dbRestoreFileEl.files && dbRestoreFileEl.files[0];
    if (!file) {
      showResponse('warning', 'Choisis un fichier de sauvegarde (.ndjson.gz).');
      return;
    }

    const drop = !!dbRestoreDropEl?.checked;
    const warning = drop
      ? 'RESTORE avec DROP: toutes les collections restaurées seront remplacées.'
      : 'RESTORE sans DROP: risque élevé de doublons/erreurs si la DB contient déjà des données.';

    const ok = window.confirm(`${warning}\n\nContinuer ?`);
    if (!ok) return;

    dbRestoreRunBtn.disabled = true;
    const old = dbRestoreRunBtn.textContent;
    dbRestoreRunBtn.textContent = 'Restauration...';
    if (dbRestoreResultEl) dbRestoreResultEl.textContent = '';

    try {
      const fd = new FormData();
      fd.append('backup', file);
      // drop passed as query (server supports both)
      const res = await fetch(`/api/admin/db/restore?drop=${drop ? 'true' : 'false'}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: fd,
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || data.error || `Erreur (${res.status})`);
      }

      showResponse('success', 'Restore terminé.');
      if (dbRestoreResultEl) {
        const inserted = data?.inserted && typeof data.inserted === 'object' ? data.inserted : {};
        const keys = Object.keys(inserted);
        const summary = keys.length
          ? keys.map((k) => `${k}: ${inserted[k]}`).join(' | ')
          : 'Aucun document inséré (ou backup vide).';
        dbRestoreResultEl.textContent = summary;
      }
    } catch (err) {
      showResponse('danger', err.message || 'Erreur réseau');
    } finally {
      dbRestoreRunBtn.disabled = false;
      dbRestoreRunBtn.textContent = old;
    }
  }

  if (adminBackupTabBtn) {
    adminBackupTabBtn.addEventListener('shown.bs.tab', () => loadBackups({ force: false }));
  }

  // Version tab wiring
  if (adminVersionTabBtn) {
    adminVersionTabBtn.addEventListener('shown.bs.tab', () => loadAppVersionTab({ force: false }));
  }
  if (appVersionReloadBtn) {
    appVersionReloadBtn.addEventListener('click', async () => {
      appVersionReloadBtn.disabled = true;
      const old = appVersionReloadBtn.textContent;
      appVersionReloadBtn.textContent = 'Chargement...';
      try {
        await loadAppVersionTab({ force: true });
        setAppVersionAlert('success', 'Rechargé.');
      } finally {
        appVersionReloadBtn.disabled = false;
        appVersionReloadBtn.textContent = old;
      }
    });
  }
  if (appVersionSetActiveBtn && appVersionActiveSelectEl) {
    appVersionSetActiveBtn.addEventListener('click', async () => {
      const id = String(appVersionActiveSelectEl.value || '').trim();
      if (!id) return;
      appVersionSetActiveBtn.disabled = true;
      const old = appVersionSetActiveBtn.textContent;
      appVersionSetActiveBtn.textContent = '...';
      try {
        hideAppVersionAlert();
        appVersionState = await setActiveAppVersion(id);
        appVersionLoadedOnce = true;
        renderAppVersionUI();
        await refreshAppVersionPreview();
        setAppVersionAlert('success', 'Version active mise à jour.');
      } catch (err) {
        setAppVersionAlert('danger', err.message || 'Erreur réseau');
      } finally {
        appVersionSetActiveBtn.disabled = false;
        appVersionSetActiveBtn.textContent = old;
      }
    });
  }

  async function handleCreateAppVersion(activate) {
    const version = String(appVersionNewVersionEl?.value || '').trim();
    const message = String(appVersionNewMessageEl?.value || '').trim();
    if (!version) {
      setAppVersionAlert('warning', 'Version requise (ex: 1.0.0).');
      return;
    }
    const btn = activate ? appVersionCreateAndActivateBtn : appVersionCreateBtn;
    if (!btn) return;
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = '...';
    try {
      hideAppVersionAlert();
      appVersionState = await createAppVersionEntry({ version, message, activate });
      appVersionLoadedOnce = true;
      if (appVersionNewVersionEl) appVersionNewVersionEl.value = '';
      if (appVersionNewMessageEl) appVersionNewMessageEl.value = '';
      renderAppVersionUI();
      await refreshAppVersionPreview();
      setAppVersionAlert('success', activate ? 'Version créée et activée.' : 'Version créée.');
    } catch (err) {
      setAppVersionAlert('danger', err.message || 'Erreur réseau');
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  if (appVersionCreateBtn) {
    appVersionCreateBtn.addEventListener('click', () => handleCreateAppVersion(false));
  }
  if (appVersionCreateAndActivateBtn) {
    appVersionCreateAndActivateBtn.addEventListener('click', () => handleCreateAppVersion(true));
  }

  if (dbBackupRefreshBtn) {
    dbBackupRefreshBtn.addEventListener('click', async () => {
      dbBackupRefreshBtn.disabled = true;
      const old = dbBackupRefreshBtn.textContent;
      dbBackupRefreshBtn.textContent = 'Chargement...';
      try {
        await loadBackups({ force: true });
      } finally {
        dbBackupRefreshBtn.disabled = false;
        dbBackupRefreshBtn.textContent = old;
      }
    });
  }
  if (dbBackupCreateBtn) {
    dbBackupCreateBtn.addEventListener('click', createBackup);
  }
  if (dbRestoreRunBtn) {
    dbRestoreRunBtn.addEventListener('click', runRestore);
  }

  // Winners tab wiring
  async function initWinnersTab(options = {}) {
    const force = !!options.force;
    try {
      await Promise.all([
        loadWinners({ force }),
        loadWinnerUsers({ force }),
      ]);
      renderWinnerCurrent();
    } catch (err) {
      showResponse('danger', err.message || 'Erreur réseau');
    }
  }

  if (adminWinnersTabBtn) {
    adminWinnersTabBtn.addEventListener('shown.bs.tab', () => initWinnersTab({ force: false }));
  }

  if (winnerYearSelect) {
    winnerYearSelect.addEventListener('change', () => applyWinnerFormFromCache());
  }

  if (winnerReloadBtn) {
    winnerReloadBtn.addEventListener('click', async () => {
      winnerReloadBtn.disabled = true;
      const old = winnerReloadBtn.textContent;
      winnerReloadBtn.textContent = 'Chargement...';
      try {
        await initWinnersTab({ force: true });
        showResponse('success', 'Gagnants rechargés.');
      } finally {
        winnerReloadBtn.disabled = false;
        winnerReloadBtn.textContent = old;
      }
    });
  }

  if (winnerClearBtn) {
    winnerClearBtn.addEventListener('click', async () => {
      if (!winnerYearSelect) return;
      const y = parseYear(winnerYearSelect.value);
      if (!y) return;
      const ok = window.confirm(`Supprimer tous les gagnants pour ${y} ?`);
      if (!ok) return;
      try {
        if (winnerUserSelect) winnerUserSelect.value = '';
        if (winnerPointsEl) winnerPointsEl.value = '';
        await addWinner(y, '', null);
        await loadWinners({ force: true });
        showResponse('success', `Gagnant supprimé pour ${y}.`);
      } catch (err) {
        showResponse('danger', err.message || 'Erreur réseau');
      }
    });
  }

  if (winnerSaveBtn) {
    winnerSaveBtn.addEventListener('click', async () => {
      if (!winnerYearSelect) return;
      const y = parseYear(winnerYearSelect.value);
      if (!y) {
        showResponse('warning', 'Année invalide.');
        return;
      }
      const userId = String(winnerUserSelect?.value || '').trim();
      if (!userId) {
        showResponse('warning', 'Choisis un utilisateur.');
        return;
      }
      const pointsRaw = String(winnerPointsEl?.value || '').trim();
      const points = pointsRaw === '' ? null : Number(pointsRaw);
      const pointsToSend = pointsRaw === '' || Number.isNaN(points) ? null : Math.round(points);

      winnerSaveBtn.disabled = true;
      const old = winnerSaveBtn.textContent;
      winnerSaveBtn.textContent = 'Enregistrement...';
      try {
        await addWinner(y, userId, pointsToSend);
        await loadWinners({ force: true });
        showResponse('success', `Gagnant ajouté pour ${y}.`);
      } catch (err) {
        showResponse('danger', err.message || 'Erreur réseau');
      } finally {
        winnerSaveBtn.disabled = false;
        winnerSaveBtn.textContent = old;
      }
    });
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();

    const year = parseYear(yearInput.value);
    const imdb_id = document.getElementById('imdb_id').value.trim();
    const category = document.getElementById('category').value.trim();
    const vod_link = document.getElementById('vod_link').value.trim();
    const player_mode = (document.getElementById('player_mode')?.value || 'auto').trim();
    const video_src = document.getElementById('video_src')?.value?.trim() || '';
    const video_file = document.getElementById('video_file')?.value?.trim() || '';
    const embed_src = document.getElementById('embed_src')?.value?.trim() || '';

    if (!year) {
      showResponse('warning', 'Année invalide. Exemple attendu: 2026');
      return;
    }

    if (!/^tt\d{5,}$/.test(imdb_id)) {
      showResponse('warning', 'IMDB ID invalide. Exemple attendu: tt1234567');
      return;
    }

    if (!vod_link && !video_src && !video_file && !embed_src) {
      showResponse('warning', 'Ajoute au moins une source (VOD / video_src / video_file / embed_src).');
      return;
    }

    try {
      const res = await fetch('/api/movies/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ year, imdb_id, category, vod_link, player_mode, video_src, video_file, embed_src })
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

      // Ensure Oscar dates cache is loaded (for settings UI).
      await ensureOscarDatesLoaded();

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

      // Oscar date year dropdown (settings tab)
      if (oscarDateYearSelect && oscarDateValueInput && saveOscarDateBtn && clearOscarDateBtn) {
        const previousOscarYearSelection = String(oscarDateYearSelect.value || '');
        oscarDateYearSelect.innerHTML = '';

        if (cleanedYears.length === 0) {
          const opt = document.createElement('option');
          opt.value = '';
          opt.textContent = 'Aucune année (ajoute un film)';
          opt.disabled = true;
          opt.selected = true;
          oscarDateYearSelect.appendChild(opt);
          oscarDateYearSelect.disabled = true;
          oscarDateValueInput.disabled = true;
          saveOscarDateBtn.disabled = true;
          clearOscarDateBtn.disabled = true;
        } else {
          cleanedYears.forEach((y) => {
            const opt = document.createElement('option');
            opt.value = String(y);
            opt.textContent = String(y);
            oscarDateYearSelect.appendChild(opt);
          });

          const desired =
            (previousOscarYearSelection && cleanedYears.map(String).includes(previousOscarYearSelection))
              ? previousOscarYearSelection
              : (activeYear && cleanedYears.map(String).includes(String(activeYear)))
                ? String(activeYear)
                : String(cleanedYears[0]);

          oscarDateYearSelect.disabled = false;
          oscarDateValueInput.disabled = false;
          saveOscarDateBtn.disabled = false;
          clearOscarDateBtn.disabled = false;
          oscarDateYearSelect.value = desired;
        }
      }

      applyOscarDateSelection();
      renderOscarDatesCurrent(cleanedYears);

      // Winners year dropdown (optional tab)
      setWinnerYearOptions(cleanedYears);
      applyWinnerFormFromCache();
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
    if (editMovieIdLabelEl) editMovieIdLabelEl.textContent = movie._id || '—';
    editImdbIdEl.value = movie.imdb_id || '';
    editYearEl.value = movie.year ? String(movie.year) : '';
    editCategoryEl.value = movie.category || '';
    editVodLinkEl.value = movie.vod_link || '';
    if (editPlayerModeEl) editPlayerModeEl.value = movie.player_mode || 'auto';
    if (editVideoSrcEl) editVideoSrcEl.value = movie.video_src || '';
    if (editVideoFileEl) editVideoFileEl.value = movie.video_file || '';
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
    const video_file = (editVideoFileEl?.value || '').trim();
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

    if (!vod_link && !video_src && !video_file && !embed_src) {
      showResponse('warning', 'Ajoute au moins une source (VOD / video_src / video_file / embed_src).');
      return;
    }

    const body = {
      imdb_id,
      year: yearRaw === '' ? null : year,
      category,
      vod_link,
      player_mode,
      video_src,
      video_file,
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
    adminMoviesBody.innerHTML = `<tr><td colspan="7" class="text-muted">Chargement…</td></tr>`;

    try {
      const res = await fetch(url, { method: 'GET' });
      if (!res.ok) {
        adminMoviesBody.innerHTML = `<tr><td colspan="7" class="text-danger">Erreur lors du chargement (${res.status})</td></tr>`;
        return;
      }
      const movies = await res.json();
      movies.sort((a, b) => (a.title || '').localeCompare((b.title || ''), 'fr', { sensitivity: 'base' }));
      moviesById = new Map(movies.map((m) => [m._id, m]));

      if (!movies.length) {
        adminMoviesBody.innerHTML = `<tr><td colspan="7" class="text-muted">Aucun film.</td></tr>`;
        updateSelectionUI();
        return;
      }

      function buildPlayerBadges(m) {
        const badges = [];
        const hasVideo = !!(m && m.video_src);
        const hasFile = !!(m && m.video_file);
        const hasEmbed = !!(m && m.embed_src);
        const hasLegacy = !!(m && m.vod_link);

        if (hasVideo) badges.push({ text: 'Video', cls: 'bg-primary' });
        if (hasFile) badges.push({ text: 'Server file', cls: 'bg-dark' });
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

        const movieId = String(m._id || '');
        const shortId = movieId ? `${movieId.slice(0, 6)}…${movieId.slice(-4)}` : '—';

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>
            <input type="checkbox" class="form-check-input" data-movie-id="${m._id}">
          </td>
          <td class="text-nowrap">
            <button type="button" class="btn btn-sm btn-outline-secondary font-monospace" data-copy-movie-id="${escapeHtml(movieId)}" title="${escapeHtml(movieId)}">
              ${escapeHtml(shortId)}
            </button>
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

      adminMoviesBody.querySelectorAll('button[data-copy-movie-id]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.getAttribute('data-copy-movie-id');
          if (!id) return;
          const ok = await copyToClipboard(id);
          if (ok) {
            showResponse('success', 'Movie ID copié.');
          } else {
            showResponse('warning', 'Impossible de copier automatiquement. Copie manuellement.');
          }
        });
      });

      updateSelectionUI();
    } catch (err) {
      adminMoviesBody.innerHTML = `<tr><td colspan="7" class="text-danger">${err.message || 'Erreur réseau'}</td></tr>`;
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

  if (copyMovieIdBtn) {
    copyMovieIdBtn.addEventListener('click', async () => {
      const id = String(editMovieIdEl?.value || '').trim();
      if (!id) return;
      const ok = await copyToClipboard(id);
      if (ok) {
        showResponse('success', 'Movie ID copié.');
      } else {
        showResponse('warning', 'Impossible de copier automatiquement. Copie manuellement.');
      }
    });
  }

  // Initial load
  activeYear = await fetchActiveYear();
  if (activeYear) {
    document.title = `Oscar Pool (${activeYear}) - Admin`;
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
        document.title = `Oscar Pool (${activeYear}) - Admin`;
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

