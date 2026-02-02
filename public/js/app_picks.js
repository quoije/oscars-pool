(function() {
  'use strict';

  function createPageLoader(options = {}) {
    const title = String(options.title || t('common.loading', 'Loading…'));
    // Subtitle kept for backwards-compat with callers, but we no longer render text in the UI.
    const subtitle = String(options.subtitle || t('picks.preparingPage', 'Preparing page…'));

    let progress = 0;
    let removed = false;
    let navResizeObserver = null;

    // Reuse a preloaded overlay if present (prevents initial "clear" flash).
    const preloadedOverlay = document.getElementById('page-loader-overlay');
    const overlay = preloadedOverlay || document.createElement('div');
    if (!preloadedOverlay) {
      overlay.className = 'page-loader-overlay';
      overlay.setAttribute('role', 'status');
      overlay.setAttribute('aria-live', 'polite');
      overlay.setAttribute('aria-busy', 'true');

      overlay.innerHTML = `
        <div class="page-loader-card page-loader-card--baronly">
          <span class="visually-hidden">${title}</span>
          <div class="page-loader-progress" aria-hidden="true">
            <div class="page-loader-bar" id="page-loader-bar"></div>
          </div>
        </div>
      `;
    } else {
      // Keep screen reader label up to date.
      const label = overlay.querySelector('.visually-hidden');
      if (label) label.textContent = title;
    }

    const barEl = () => overlay.querySelector('#page-loader-bar');

    function clampPct(p) {
      const n = Number(p);
      if (!Number.isFinite(n)) return 0;
      return Math.max(0, Math.min(100, n));
    }

    function setProgress(p) {
      progress = clampPct(p);
      const bar = barEl();
      if (bar) bar.style.width = `${progress}%`;
    }

    function setSubtitle(_) {
      // Intentionally no-op (we only show the bar now).
    }

    function getNavHeightPx() {
      const nav = document.querySelector('nav.navbar');
      if (!nav) return 0;
      const rect = nav.getBoundingClientRect();
      const h = Number(rect?.height) || 0;
      return h > 0 ? Math.round(h) : 0;
    }

    function updateOverlayTopOffset() {
      // Scope the offset to this overlay instance (no global CSS var).
      overlay.style.setProperty('--page-loader-top', `${getNavHeightPx()}px`);
    }

    function ensureMounted() {
      if (removed) return;
      // IMPORTANT: even if the overlay is preloaded in HTML (already connected),
      // we still need to compute the navbar offset. Otherwise it defaults to 0px
      // and the blur covers the header.
      updateOverlayTopOffset();
      document.body.classList.add('page-loading');

      if (!overlay.isConnected) document.body.appendChild(overlay);

      // Keep the overlay aligned if the navbar height changes (mobile collapse, resize, etc.)
      if (!navResizeObserver) {
        const nav = document.querySelector('nav.navbar');
        if (nav && typeof ResizeObserver !== 'undefined') {
          try {
            navResizeObserver = new ResizeObserver(() => updateOverlayTopOffset());
            navResizeObserver.observe(nav);
          } catch (_) {
            navResizeObserver = null;
          }
        }
      }
    }

    function hideAndRemoveSoon() {
      if (removed) return;
      overlay.classList.add('page-loader-hide');
      overlay.setAttribute('aria-busy', 'false');
      document.body.classList.remove('page-loading');
      window.setTimeout(() => {
        removed = true;
        if (navResizeObserver) {
          try { navResizeObserver.disconnect(); } catch (_) {}
          navResizeObserver = null;
        }
        try { overlay.remove(); } catch (_) {}
      }, 220);
    }

    function done() {
      setProgress(100);
      hideAndRemoveSoon();
    }

    function fail(_) {
      // Don't block the UI on errors: let the page render its own error message.
      setProgress(Math.max(progress, 95));
      window.setTimeout(() => hideAndRemoveSoon(), 200);
    }

    ensureMounted();
    setProgress(8);

    return { setProgress, setSubtitle, done, fail };
  }

  function t(key, fallback, params) {
    try {
      if (window.i18n && typeof window.i18n.t === 'function') {
        return window.i18n.t(key, params || {});
      }
    } catch (_) {}
    let out = (typeof fallback === 'string') ? fallback : String(key);
    if (params && typeof params === 'object') {
      Object.keys(params).forEach((k) => {
        out = out.replace(new RegExp(`\\{${k}\\}`, 'g'), String(params[k]));
      });
    }
    return out;
  }

  const token = localStorage.getItem('auth_token');
  if (!token) {
    window.location.href = '/';
    return;
  }

  function decodeJwt(token) {
    try {
      return JSON.parse(atob(token.split('.')[1]));
    } catch {
      return null;
    }
  }

  const decoded = decodeJwt(token);
  if (!decoded) {
    localStorage.removeItem('auth_token');
    window.location.href = '/';
    return;
  }

  // Check if admin and show admin tabs
  if (decoded.admin) {
    const adminTabWinners = document.getElementById('tab-winners');
    if (adminTabWinners) adminTabWinners.classList.remove('d-none');
  }

  // Logout
  const logOffBtn = document.getElementById('log-off');
  if (logOffBtn) {
    logOffBtn.addEventListener('click', () => {
      localStorage.removeItem('auth_token');
      window.location.href = '/';
    });
  }

  let categories = [];
  let myPicks = {};
  let currentYear = null;
  let isSaving = false; // Prevent multiple simultaneous saves

  async function fetchActiveYear() {
    try {
      const res = await fetch('/api/settings/year');
      if (!res.ok) throw new Error('Failed to fetch active year');
      const data = await res.json();
      return Number(data.year) || new Date().getFullYear();
    } catch (err) {
      console.error('Error fetching active year:', err);
      return new Date().getFullYear();
    }
  }

  function showAlert(message, type = 'info') {
    const container = document.getElementById('alert-container');
    if (!container) return;
    
    container.innerHTML = `
      <div class="alert alert-${type} alert-dismissible fade show" role="alert">
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
      </div>
    `;
    
    setTimeout(() => {
      const alert = container.querySelector('.alert');
      if (alert) {
        const bsAlert = new bootstrap.Alert(alert);
        bsAlert.close();
      }
    }, 5000);
  }

  async function fetchCategories(pageLoader) {
    try {
      // Use active year if not set
      if (!currentYear) {
        currentYear = await fetchActiveYear();
        document.title = t('picks.pageTitleWithYear', 'Oscar Pool ({year}) - My picks', { year: currentYear });
      }

      if (pageLoader) pageLoader.setProgress(18);

      const res = await fetch(`/api/picks/categories?year=${currentYear}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!res.ok) {
        if (res.status === 401) {
          localStorage.removeItem('auth_token');
          window.location.href = '/';
          return;
        }
        throw new Error('Failed to fetch categories');
      }
      
      if (pageLoader) pageLoader.setProgress(40);
      
      const data = await res.json();
      categories = data.categories || [];
      currentYear = data.year || currentYear;
      
      document.getElementById('current-year').textContent = currentYear;
      
      if (categories.length === 0) {
        const noCats = t('picks.noCategoriesFound', 'No categories found for year {year}', { year: currentYear });
        const adminHint = t('picks.adminMustImportCategories', 'An administrator must first import the categories.');
        document.getElementById('categories-container').innerHTML = `
          <div class="alert alert-warning">
            ${noCats}
            ${adminHint}
          </div>
        `;
        if (pageLoader) pageLoader.done();
        return;
      }
      
      if (pageLoader) pageLoader.setProgress(60);
      
      renderCategories();
      await loadMyPicks(pageLoader);
      
      if (pageLoader) pageLoader.setProgress(85);
    } catch (err) {
      console.error('Error fetching categories:', err);
      showAlert(t('picks.errorLoadingCategories', 'Error loading categories: {error}', { error: err.message }), 'danger');
      if (pageLoader) pageLoader.fail();
    }
  }

  async function loadMyPicks(pageLoader) {
    try {
      if (pageLoader) pageLoader.setProgress(70);
      
      const res = await fetch(`/api/picks/my-picks?year=${currentYear}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!res.ok && res.status !== 404) {
        throw new Error('Failed to load picks');
      }
      
      if (pageLoader) pageLoader.setProgress(80);
      
      const data = await res.json();
      if (data.pick && data.pick.picks) {
        myPicks = {};
        // Create a map of existing category numbers
        const existingCategoryNumbers = new Set(categories.map(c => c.categoryNumber));
        
        // Only load picks for categories that still exist
        data.pick.picks.forEach(p => {
          if (existingCategoryNumbers.has(p.categoryNumber)) {
            myPicks[p.categoryNumber] = p.selectedNominee;
          }
        });
        renderCategories();
        updateProgress();
      }
    } catch (err) {
      console.error('Error loading picks:', err);
    }
  }

  function renderCategories() {
    const container = document.getElementById('categories-container');
    if (!container) return;
    
    if (categories.length === 0) {
      container.innerHTML = `<div class="text-center py-4 text-muted">${t('picks.noCategoriesAvailable', 'No categories available')}</div>`;
      return;
    }
    
    container.innerHTML = `
      <div class="table-responsive">
        <table class="table table-sm picks-table align-middle mb-0">
          <thead class="table-light">
            <tr>
              <th style="width: 50px;">#</th>
              <th>${t('picks.category', 'Category')}</th>
              <th style="width: 200px;">${t('picks.choice', 'Choice')}</th>
              <th>${t('picks.nominees', 'Nominees')}</th>
            </tr>
          </thead>
          <tbody>
            ${categories.map(cat => {
              const selectedNominee = myPicks[cat.categoryNumber];
              return `
                <tr class="${selectedNominee ? 'has-selection' : ''}">
                  <td class="fw-semibold text-muted">${cat.categoryNumber}</td>
                  <td class="fw-semibold">${cat.categoryName}</td>
                  <td>
                    ${selectedNominee ? `
                      <span class="selected-choice-badge badge bg-success">
                        <span>${selectedNominee}</span>
                      </span>
                    ` : `<span class="text-muted fst-italic">${t('picks.noChoice', 'No choice')}</span>`}
                  </td>
                  <td>
                    <div class="d-flex flex-wrap gap-2">
                      ${cat.nominees.map(nominee => {
                        const isSelected = selectedNominee === nominee.name;
                        return `
                          <span class="nominee-option badge ${isSelected ? 'bg-primary selected' : 'bg-secondary bg-opacity-50'}" 
                                 data-category="${cat.categoryNumber}" 
                                 data-nominee="${nominee.name}">
                            ${isSelected ? '<span class="nominee-checkmark">✓</span>' : ''}
                            <span>${nominee.name}</span>
                          </span>
                        `;
                      }).join('')}
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
    
    // Add click handlers
    container.querySelectorAll('.nominee-option').forEach(el => {
      el.addEventListener('click', function() {
        const category = parseInt(this.dataset.category);
        const nominee = this.dataset.nominee;
        
        // Toggle selection
        if (myPicks[category] === nominee) {
          // Deselect if clicking the same nominee
          delete myPicks[category];
        } else {
          // Select this nominee
          myPicks[category] = nominee;
        }
        
        // Re-render to update the display
        renderCategories();
        
        // Auto-save after selection change
        autoSavePicks();
      });
    });
    
    updateProgress();
  }

  async function autoSavePicks() {
    // Clear any existing timeout to reset the debounce
    if (autoSavePicks.timeout) {
      clearTimeout(autoSavePicks.timeout);
    }
    
    // Debounce: wait for user to stop clicking before saving
    autoSavePicks.timeout = setTimeout(async () => {
      // Skip if already saving (will retry after current save completes)
      if (isSaving) {
        // Retry after a short delay
        setTimeout(() => autoSavePicks(), 200);
        return;
      }
      
      isSaving = true;
      try {
        await submitPicks(true); // Pass true for silent mode (no alert)
      } catch (err) {
        console.error('Auto-save failed:', err);
        // Show error alert only on failure
        showAlert(t('picks.errorAutoSaving', 'Error auto-saving: {error}', { error: err.message }), 'danger');
      } finally {
        isSaving = false;
      }
    }, 250); // Reduced to 250ms for better responsiveness
  }

  function updateProgress() {
    const total = categories.length;
    const completed = Object.keys(myPicks).length;
    document.getElementById('picks-progress').textContent = `${completed} / ${total}`;
  }

  async function submitPicks(silent = false) {
    const picks = Object.keys(myPicks).map(catNum => ({
      categoryNumber: parseInt(catNum),
      selectedNominee: myPicks[catNum]
    }));
    
    // Allow empty picks to be saved (to clear all selections)
    // Only show warning in non-silent mode if user explicitly tries to submit with no picks
    if (picks.length === 0 && !silent) {
      // Don't block - allow saving empty picks to clear selections
    }
    
    // Skip confirmation dialog in silent mode (auto-save)
    if (!silent && picks.length < categories.length) {
      if (!confirm(t('picks.incompleteSelection', `You have selected only ${picks.length} out of ${categories.length} categories. Do you want to save anyway?`, { selected: picks.length, total: categories.length }))) {
        return;
      }
    }
    
    try {
      const res = await fetch('/api/picks/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          year: currentYear,
          picks
        })
      });
      
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Failed to submit picks');
      }
      
      const data = await res.json();
      if (!silent) {
        showAlert(t('picks.successSaved', 'Your picks have been saved successfully!'), 'success');
      }
    } catch (err) {
      console.error('Error submitting picks:', err);
      showAlert(t('picks.errorSubmitting', 'Error submitting picks: {error}', { error: err.message }), 'danger');
    }
  }

  // Event listeners
  document.getElementById('load-my-picks')?.addEventListener('click', () => {
    loadMyPicks();
    showAlert(t('picks.reloaded', 'Picks reloaded'), 'info');
  });

  // Winners & Scores functionality (admin only)
  let winnersCategories = [];

  async function fetchWinnersCategories() {
    try {
      if (!currentYear) {
        currentYear = await fetchActiveYear();
      }

      const res = await fetch(`/api/picks/categories?year=${currentYear}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!res.ok) {
        throw new Error('Failed to fetch categories');
      }

      const data = await res.json();
      winnersCategories = data.categories || [];
      currentYear = data.year || currentYear;

      const yearEl = document.getElementById('winners-year');
      if (yearEl) yearEl.textContent = currentYear;

      renderWinnersCategories();
      await fetchScores();
    } catch (err) {
      console.error('Error fetching winners categories:', err);
      showAlert(t('picks.errorLoadingCategories', 'Error loading categories: {error}', { error: err.message }), 'danger');
    }
  }

  function renderWinnersCategories() {
    const container = document.getElementById('winners-container');
    if (!container) return;

    if (winnersCategories.length === 0) {
      container.innerHTML = `<div class="alert alert-warning">${t('picks.noCategoriesFound', 'No categories found for year {year}', { year: currentYear })}</div>`;
      return;
    }

    const winnersCount = winnersCategories.filter(cat => 
      cat.nominees.some(n => n.isWinner)
    ).length;

    const progressEl = document.getElementById('winners-progress');
    if (progressEl) progressEl.textContent = `${winnersCount} / ${winnersCategories.length}`;

    container.innerHTML = `
      <div class="table-responsive">
        <table class="table table-sm table-hover align-middle mb-0">
          <thead class="table-light">
            <tr>
              <th style="width: 50px;">#</th>
              <th>${t('picks.categoryHeader', 'Category')}</th>
              <th style="width: 200px;">${t('picks.selectionHeader', 'Selection')}</th>
              <th>${t('picks.winnerHeader', 'Winner')}</th>
            </tr>
          </thead>
          <tbody>
            ${winnersCategories.map(cat => {
              const winner = cat.nominees.find(n => n.isWinner);
              return `
                <tr class="${winner ? 'table-success' : ''}">
                  <td class="fw-semibold">${cat.categoryNumber}</td>
                  <td>${cat.categoryName}</td>
                  <td>
                    <select class="form-select form-select-sm winner-select" data-category-id="${cat._id}" data-category-number="${cat.categoryNumber}">
                      <option value="">—</option>
                      ${cat.nominees.map(nominee => `
                        <option value="${nominee.name}" ${nominee.isWinner ? 'selected' : ''}>${nominee.name}</option>
                      `).join('')}
                    </select>
                  </td>
                  <td>
                    ${winner ? `<span class="badge bg-success">${winner.name}</span>` : '<span class="text-muted">—</span>'}
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;

    // Add event listeners for winner selection
    container.querySelectorAll('.winner-select').forEach(select => {
      select.addEventListener('change', async function() {
        const categoryId = this.dataset.categoryId;
        const winnerName = this.value;

        try {
          // If empty value, clear the winner (set to null/empty)
          const res = await fetch(`/api/categories/${categoryId}/winner`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ winnerName: winnerName || null })
          });

          if (!res.ok) {
            const error = await res.json();
            throw new Error(error.message || 'Failed to update winner');
          }

          showAlert(
            winnerName 
              ? t('picks.winnerMarked', 'Winner marked successfully') 
              : t('picks.winnerDeleted', 'Winner deleted'),
            'success'
          );
          await fetchWinnersCategories();
          // Auto-refresh scores after marking/clearing a winner (silent mode)
          await calculateScores(true);
        } catch (err) {
          console.error('Error updating winner:', err);
          showAlert(t('picks.errorUpdatingWinner', 'Error: {error}', { error: err.message }), 'danger');
        }
      });
    });
  }

  async function calculateScores(silent = false) {
    try {
      if (!currentYear) {
        currentYear = await fetchActiveYear();
      }

      const btn = document.getElementById('calculate-scores');
      if (btn) {
        btn.disabled = true;
        btn.textContent = t('picks.calculatingScores', 'Calculating scores…');
      }

      const res = await fetch('/api/picks/calculate-scores', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ year: currentYear })
      });

      if (!res.ok) {
        const error = await res.json();
        // If no winners marked, handle gracefully (especially for auto-refresh)
        if (error.message && error.message.includes('No winners marked')) {
          if (!silent) {
            // Only show as info/warning, not error
            showAlert(t('picks.noWinnersMarked', 'No winners marked. Scores will be calculated once winners are defined.'), 'info');
          }
          // Still try to fetch existing scores
          await fetchScores();
          return;
        }
        throw new Error(error.message || 'Failed to calculate scores');
      }

      const data = await res.json();
      if (!silent) {
        showAlert(
          t('picks.scoresCalculated', 'Scores calculated successfully! {count} user(s) evaluated.', { count: data.scores.length }),
          'success'
        );
      }
      await fetchScores();
    } catch (err) {
      console.error('Error calculating scores:', err);
      if (!silent) {
        showAlert(t('picks.errorCalculatingScores', 'Error: {error}', { error: err.message }), 'danger');
      }
    } finally {
      const btn = document.getElementById('calculate-scores');
      if (btn) {
        btn.disabled = false;
        btn.textContent = t('picks.calculateScores', 'Calculate scores');
      }
    }
  }

  async function fetchScores() {
    try {
      if (!currentYear) {
        currentYear = await fetchActiveYear();
      }

      // Update scores year display
      const scoresYearEl = document.getElementById('scores-year');
      if (scoresYearEl) {
        scoresYearEl.textContent = currentYear;
      }

      const res = await fetch(`/api/picks/scores?year=${currentYear}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ message: 'Failed to fetch scores' }));
        throw new Error(errorData.message || 'Failed to fetch scores');
      }

      const data = await res.json();
      renderScores(data.scores || [], data.totalCategories || 0);
    } catch (err) {
      console.error('Error fetching scores:', err);
      const container = document.getElementById('scores-container');
      if (container) {
        container.innerHTML = `<div class="text-danger">${t('picks.errorLoadingScores', 'Error loading scores.')}</div>`;
      }
    }
  }

  function renderScores(scores, totalCategories) {
    const container = document.getElementById('scores-container');
    if (!container) return;

    // Filter out scores for removed users (Unknown users or null userId)
    let validScores = scores.filter(score => 
      score.userName && 
      score.userName !== 'Unknown' && 
      score.userId
    );

    // Calculate actual scores and sort by them
    validScores = validScores.map(score => {
      // Always calculate actual score from pickDetails if available (more accurate than stored score)
      let actualScore;
      if (score.pickDetails && Array.isArray(score.pickDetails) && score.pickDetails.length > 0) {
        // Calculate from pickDetails - this is the source of truth
        actualScore = score.pickDetails.filter(p => p.isCorrect === true).length;
      } else {
        // Fallback to stored score only if pickDetails not available
        actualScore = score.score || 0;
      }
      return { ...score, actualScore };
    }).sort((a, b) => b.actualScore - a.actualScore);

    if (validScores.length === 0) {
      container.innerHTML = `<div class="text-muted">${t('picks.noScoresAvailable', 'No scores available. Users must first submit their picks.')}</div>`;
      return;
    }

    container.innerHTML = `
      <div class="table-responsive">
        <table class="table table-sm table-striped table-hover mb-0">
          <thead class="table-light">
            <tr>
              <th style="width: 40px;">#</th>
              <th>${t('picks.userHeader', 'User')}</th>
              <th class="text-center" style="width: 80px;">Score</th>
              <th class="text-center" style="width: 70px;">Total</th>
              <th class="text-center" style="width: 100px;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${validScores.map((score, index) => {
              // Use the pre-calculated actualScore (always use it, even if 0)
              const actualScore = score.actualScore !== undefined ? score.actualScore : (score.score || 0);
              const rank = index + 1;
              const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '';
              return `
                <tr>
                  <td><strong>${rank}${medal ? ' ' + medal : ''}</strong></td>
                  <td>${score.userName}</td>
                  <td class="text-center"><strong class="text-success">${actualScore}</strong></td>
                  <td class="text-center text-muted small">${totalCategories}</td>
                  <td class="text-center">
                    <button class="btn btn-sm btn-outline-primary view-picks-btn" data-user-id="${score.userId}" data-user-name="${score.userName}" data-score-index="${index}">
                      ${t('picks.detailsButton', 'Details')}
                    </button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;

    // Store valid scores data globally for modal access
    window.scoresData = validScores;

    // Add event listeners for view picks buttons
    container.querySelectorAll('.view-picks-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        const scoreIndex = parseInt(this.dataset.scoreIndex);
        const score = validScores[scoreIndex];
        showUserPicksModal(score);
      });
    });
  }

  function showUserPicksModal(score) {
    const modal = new bootstrap.Modal(document.getElementById('userPicksModal'));
    const modalTitle = document.getElementById('userPicksModalLabel');
    const modalContent = document.getElementById('user-picks-modal-content');

    modalTitle.textContent = t('picks.userChoicesTitle', 'Picks for {user}', { user: score.userName });

    if (!score.pickDetails || score.pickDetails.length === 0) {
      modalContent.innerHTML = `<div class="text-muted">${t('picks.noDetailsAvailable', 'No details available.')}</div>`;
      modal.show();
      return;
    }

    // Separate correct and incorrect picks
    const correctPicks = score.pickDetails.filter(p => p.isCorrect);
    const incorrectPicks = score.pickDetails.filter(p => !p.isCorrect);
    
    // Calculate actual score from pickDetails (more accurate than stored score)
    const actualScore = correctPicks.length;
    const totalCategories = score.totalCategories || score.pickDetails.length;

    modalContent.innerHTML = `
      <div class="mb-4">
        <div class="d-flex justify-content-between align-items-center mb-3">
          <div>
            <h6 class="mb-1">${t('picks.summaryTitle', 'Summary')}</h6>
            <div class="text-muted small">
              <span class="text-success"><strong>${correctPicks.length}</strong> ${t('picks.correctCountLabel', 'correct')}</span> | 
              <span class="text-danger"><strong>${incorrectPicks.length}</strong> ${t('picks.incorrectCountLabel', 'incorrect')}</span> | 
              <span class="text-muted"><strong>${score.pickDetails.length}</strong> ${t('picks.totalCountLabel', 'total')}</span>
            </div>
          </div>
          <div class="text-end">
            <div class="h4 mb-0 text-success">${actualScore} / ${totalCategories}</div>
            <div class="text-muted small">${totalCategories > 0 ? Math.round((actualScore / totalCategories) * 100) : 0}%</div>
          </div>
        </div>
      </div>

      ${correctPicks.length > 0 ? `
        <div class="mb-4">
          <h6 class="text-success mb-3">
            <span class="badge bg-success me-2">✓</span>
            ${t('picks.correctSectionTitle', 'Correct ({count})', { count: correctPicks.length })}
          </h6>
          <div class="list-group">
            ${correctPicks.map(pick => `
              <div class="list-group-item list-group-item-success">
                <div class="d-flex justify-content-between align-items-start">
                  <div>
                    <strong>${pick.categoryNumber}. ${pick.categoryName}</strong>
                    <div class="mt-1">
                      <span class="badge bg-success">✓ ${pick.selectedNominee}</span>
                    </div>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      ${incorrectPicks.length > 0 ? `
        <div class="mb-4">
          <h6 class="text-danger mb-3">
            <span class="badge bg-danger me-2">✗</span>
            ${t('picks.incorrectSectionTitle', 'Incorrect ({count})', { count: incorrectPicks.length })}
          </h6>
          <div class="list-group">
            ${incorrectPicks.map(pick => `
              <div class="list-group-item list-group-item-danger">
                <div class="d-flex justify-content-between align-items-start">
                  <div class="flex-grow-1">
                    <strong>${pick.categoryNumber}. ${pick.categoryName}</strong>
                    <div class="mt-2">
                      <div class="mb-1">
                        <span class="badge bg-danger">✗ ${t('picks.choiceLabel', 'Choice')}: ${pick.selectedNominee}</span>
                      </div>
                      ${pick.correctWinner ? `
                        <div>
                          <span class="badge bg-success">✓ ${t('picks.winnerLabel', 'Winner')}: ${pick.correctWinner}</span>
                        </div>
                      ` : `<div class="text-muted small">${t('picks.noWinnerMarkedShort', 'No winner marked')}</div>`}
                    </div>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      ${correctPicks.length === 0 && incorrectPicks.length === 0 ? `
        <div class="alert alert-info">
          ${t('picks.noChoicesToShow', 'No picks to show.')}
        </div>
      ` : ''}
    `;

    modal.show();
  }

  // Event listeners for winners tab
  document.getElementById('refresh-winners')?.addEventListener('click', () => {
    fetchWinnersCategories();
    showAlert(t('picks.dataRefreshed', 'Data refreshed'), 'info');
  });

  // Load scores when scores tab is shown
  const scoresTab = document.getElementById('tab-scores');
  if (scoresTab) {
    scoresTab.addEventListener('shown.bs.tab', async () => {
      await fetchScores();
    });
  }

  // Load winners when admin tab is shown
  const winnersTab = document.getElementById('tab-winners');
  if (winnersTab) {
    winnersTab.addEventListener('shown.bs.tab', async () => {
      await fetchWinnersCategories();
      // Auto-refresh scores when entering the winners tab (silent mode)
      await calculateScores(true);
    });
  }

  // Refresh scores button
  document.getElementById('refresh-scores')?.addEventListener('click', async () => {
    await fetchScores();
    showAlert(t('picks.scoresRefreshed', 'Scores refreshed'), 'info');
  });

  // Initial load
  window.addEventListener('DOMContentLoaded', async function() {
    const pageLoader = createPageLoader({
      title: t('picks.loadingTitle', 'Loading picks'),
      subtitle: t('picks.loadingSubtitle', 'Fetching data…')
    });

    try {
      currentYear = await fetchActiveYear();
      document.title = t('picks.pageTitleChoicesWithYear', 'Oscar Pool ({year}) - My picks', { year: currentYear });
      
      pageLoader.setProgress(12);
      await fetchCategories(pageLoader);
      
      // Auto-refresh scores on page load if scores tab is active
      const scoresTab = document.getElementById('tab-scores');
      const scoresPane = document.getElementById('pane-scores');
      if (scoresTab && scoresPane && (scoresTab.classList.contains('active') || scoresPane.classList.contains('active'))) {
        await fetchScores();
      }
      
      // Auto-refresh winners on page load if admin and winners tab is active
      if (decoded.admin) {
        const winnersTab = document.getElementById('tab-winners');
        const winnersPane = document.getElementById('pane-winners');
        // Check if winners tab is active (either by default or if it becomes active)
        if (winnersTab && winnersPane && (winnersTab.classList.contains('active') || winnersPane.classList.contains('active'))) {
          await fetchWinnersCategories();
          await calculateScores(true); // Silent mode for auto-refresh
        }
      }
      
      pageLoader.done();
    } catch (err) {
      console.error('Error during initial load:', err);
      pageLoader.fail();
    }
  });
})();

