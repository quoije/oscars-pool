(function() {
  'use strict';

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

  async function fetchCategories() {
    try {
      // Use active year if not set
      if (!currentYear) {
        currentYear = await fetchActiveYear();
        document.title = `Pool Oscars (${currentYear}) - Mes picks`;
      }

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
      
      const data = await res.json();
      categories = data.categories || [];
      currentYear = data.year || currentYear;
      
      document.getElementById('current-year').textContent = currentYear;
      
      if (categories.length === 0) {
        document.getElementById('categories-container').innerHTML = `
          <div class="alert alert-warning">
            Aucune catégorie trouvée pour l'année ${currentYear}. 
            Un administrateur doit d'abord importer les catégories.
          </div>
        `;
        return;
      }
      
      renderCategories();
      await loadMyPicks();
    } catch (err) {
      console.error('Error fetching categories:', err);
      showAlert('Erreur lors du chargement des catégories: ' + err.message, 'danger');
    }
  }

  async function loadMyPicks() {
    try {
      const res = await fetch(`/api/picks/my-picks?year=${currentYear}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!res.ok && res.status !== 404) {
        throw new Error('Failed to load picks');
      }
      
      const data = await res.json();
      if (data.pick && data.pick.picks) {
        myPicks = {};
        data.pick.picks.forEach(p => {
          myPicks[p.categoryNumber] = p.selectedNominee;
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
      container.innerHTML = '<div class="text-center py-4 text-muted">Aucune catégorie disponible</div>';
      return;
    }
    
    container.innerHTML = `
      <div class="table-responsive">
        <table class="table table-sm table-hover align-middle mb-0">
          <thead class="table-light">
            <tr>
              <th style="width: 50px;">#</th>
              <th>Catégorie</th>
              <th>Choix</th>
              <th>Nommés</th>
            </tr>
          </thead>
          <tbody>
            ${categories.map(cat => {
              const selectedNominee = myPicks[cat.categoryNumber];
              return `
                <tr class="${selectedNominee ? 'table-primary' : ''}">
                  <td class="fw-semibold">${cat.categoryNumber}</td>
                  <td>${cat.categoryName}</td>
                  <td>
                    ${selectedNominee ? `<span class="badge bg-primary">${selectedNominee}</span>` : '<span class="text-muted">—</span>'}
                  </td>
                  <td>
                    <div class="d-flex flex-wrap gap-1">
                      ${cat.nominees.map(nominee => {
                        const isSelected = selectedNominee === nominee.name;
                        return `
                          <span class="nominee-option badge ${isSelected ? 'bg-primary' : 'bg-secondary'} ${isSelected ? '' : 'bg-opacity-50'}" 
                                 style="cursor: pointer; font-weight: normal;"
                                 data-category="${cat.categoryNumber}" 
                                 data-nominee="${nominee.name}">
                            ${nominee.name}
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
      });
    });
    
    updateProgress();
  }

  function updateProgress() {
    const total = categories.length;
    const completed = Object.keys(myPicks).length;
    document.getElementById('picks-progress').textContent = `${completed} / ${total}`;
  }

  async function submitPicks() {
    const picks = Object.keys(myPicks).map(catNum => ({
      categoryNumber: parseInt(catNum),
      selectedNominee: myPicks[catNum]
    }));
    
    if (picks.length === 0) {
      showAlert('Veuillez sélectionner au moins un choix', 'warning');
      return;
    }
    
    if (picks.length < categories.length) {
      if (!confirm(`Vous n'avez sélectionné que ${picks.length} sur ${categories.length} catégories. Voulez-vous enregistrer quand même?`)) {
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
      showAlert('Vos choix ont été enregistrés avec succès!', 'success');
    } catch (err) {
      console.error('Error submitting picks:', err);
      showAlert('Erreur lors de l\'enregistrement: ' + err.message, 'danger');
    }
  }

  // Event listeners
  document.getElementById('submit-picks')?.addEventListener('click', submitPicks);
  document.getElementById('load-my-picks')?.addEventListener('click', () => {
    loadMyPicks();
    showAlert('Choix rechargés', 'info');
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
      showAlert('Erreur lors du chargement des catégories: ' + err.message, 'danger');
    }
  }

  function renderWinnersCategories() {
    const container = document.getElementById('winners-container');
    if (!container) return;

    if (winnersCategories.length === 0) {
      container.innerHTML = '<div class="alert alert-warning">Aucune catégorie trouvée pour cette année.</div>';
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
              <th>Catégorie</th>
              <th style="width: 200px;">Sélection</th>
              <th>Gagnant</th>
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

          showAlert(winnerName ? 'Gagnant marqué avec succès' : 'Gagnant supprimé', 'success');
          await fetchWinnersCategories();
          // Auto-refresh scores after marking/clearing a winner (silent mode)
          await calculateScores(true);
        } catch (err) {
          console.error('Error updating winner:', err);
          showAlert('Erreur: ' + err.message, 'danger');
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
        btn.textContent = 'Calcul en cours...';
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
            showAlert('Aucun gagnant marqué. Les scores seront calculés une fois les gagnants définis.', 'info');
          }
          // Still try to fetch existing scores
          await fetchScores();
          return;
        }
        throw new Error(error.message || 'Failed to calculate scores');
      }

      const data = await res.json();
      if (!silent) {
        showAlert(`Scores calculés avec succès! ${data.scores.length} utilisateur(s) évalué(s).`, 'success');
      }
      await fetchScores();
    } catch (err) {
      console.error('Error calculating scores:', err);
      if (!silent) {
        showAlert('Erreur: ' + err.message, 'danger');
      }
    } finally {
      const btn = document.getElementById('calculate-scores');
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Calculer les scores';
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
        container.innerHTML = '<div class="text-danger">Erreur lors du chargement des scores.</div>';
      }
    }
  }

  function renderScores(scores, totalCategories) {
    const container = document.getElementById('scores-container');
    if (!container) return;

    // Filter out scores for removed users (Unknown users or null userId)
    const validScores = scores.filter(score => 
      score.userName && 
      score.userName !== 'Unknown' && 
      score.userId
    );

    if (validScores.length === 0) {
      container.innerHTML = '<div class="text-muted">Aucun score disponible. Les utilisateurs doivent d\'abord soumettre leurs choix.</div>';
      return;
    }

    container.innerHTML = `
      <div class="table-responsive">
        <table class="table table-sm table-striped table-hover mb-0">
          <thead class="table-light">
            <tr>
              <th style="width: 40px;">#</th>
              <th>Utilisateur</th>
              <th class="text-center" style="width: 80px;">Score</th>
              <th class="text-center" style="width: 70px;">Total</th>
              <th class="text-center" style="width: 70px;">%</th>
              <th class="text-center" style="width: 100px;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${validScores.map((score, index) => {
              const percentage = totalCategories > 0 ? Math.round((score.score / totalCategories) * 100) : 0;
              const rank = index + 1;
              const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '';
              return `
                <tr>
                  <td><strong>${rank}${medal ? ' ' + medal : ''}</strong></td>
                  <td>${score.userName}</td>
                  <td class="text-center"><strong class="text-success">${score.score}</strong></td>
                  <td class="text-center text-muted small">${totalCategories}</td>
                  <td class="text-center"><strong>${percentage}%</strong></td>
                  <td class="text-center">
                    <button class="btn btn-sm btn-outline-primary view-picks-btn" data-user-id="${score.userId}" data-user-name="${score.userName}" data-score-index="${index}">
                      Détails
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

    modalTitle.textContent = `Choix de ${score.userName}`;

    if (!score.pickDetails || score.pickDetails.length === 0) {
      modalContent.innerHTML = '<div class="text-muted">Aucun détail disponible.</div>';
      modal.show();
      return;
    }

    // Separate correct and incorrect picks
    const correctPicks = score.pickDetails.filter(p => p.isCorrect);
    const incorrectPicks = score.pickDetails.filter(p => !p.isCorrect);

    modalContent.innerHTML = `
      <div class="mb-4">
        <div class="d-flex justify-content-between align-items-center mb-3">
          <div>
            <h6 class="mb-1">Résumé</h6>
            <div class="text-muted small">
              <span class="text-success"><strong>${correctPicks.length}</strong> correct(s)</span> | 
              <span class="text-danger"><strong>${incorrectPicks.length}</strong> incorrect(s)</span> | 
              <span class="text-muted"><strong>${score.pickDetails.length}</strong> total</span>
            </div>
          </div>
          <div class="text-end">
            <div class="h4 mb-0 text-success">${score.score} / ${score.totalCategories}</div>
            <div class="text-muted small">${Math.round((score.score / score.totalCategories) * 100)}%</div>
          </div>
        </div>
      </div>

      ${correctPicks.length > 0 ? `
        <div class="mb-4">
          <h6 class="text-success mb-3">
            <span class="badge bg-success me-2">✓</span>
            Corrects (${correctPicks.length})
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
            Incorrects (${incorrectPicks.length})
          </h6>
          <div class="list-group">
            ${incorrectPicks.map(pick => `
              <div class="list-group-item list-group-item-danger">
                <div class="d-flex justify-content-between align-items-start">
                  <div class="flex-grow-1">
                    <strong>${pick.categoryNumber}. ${pick.categoryName}</strong>
                    <div class="mt-2">
                      <div class="mb-1">
                        <span class="badge bg-danger">✗ Choix: ${pick.selectedNominee}</span>
                      </div>
                      ${pick.correctWinner ? `
                        <div>
                          <span class="badge bg-success">✓ Gagnant: ${pick.correctWinner}</span>
                        </div>
                      ` : '<div class="text-muted small">Aucun gagnant marqué</div>'}
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
          Aucun choix à afficher.
        </div>
      ` : ''}
    `;

    modal.show();
  }

  // Event listeners for winners tab
  document.getElementById('calculate-scores')?.addEventListener('click', calculateScores);
  document.getElementById('refresh-winners')?.addEventListener('click', () => {
    fetchWinnersCategories();
    showAlert('Données rafraîchies', 'info');
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
    showAlert('Scores rafraîchis', 'info');
  });

  // Initial load
  (async () => {
    currentYear = await fetchActiveYear();
    document.title = `Pool Oscars (${currentYear}) - Mes choix`;
    await fetchCategories();
    
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
  })();
})();

