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
    const adminTabAllPicks = document.getElementById('tab-all-picks');
    if (adminTabAllPicks) adminTabAllPicks.classList.remove('d-none');
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
        document.title = `Pool Oscars (${currentYear}) - Mes choix`;
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
      if (document.getElementById('all-picks-year')) {
        document.getElementById('all-picks-year').textContent = currentYear;
      }
      
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
    
    container.innerHTML = categories.map(cat => `
      <div class="card category-card shadow-sm">
        <div class="card-header">
          <h5 class="mb-0">${cat.categoryNumber}. ${cat.categoryName}</h5>
        </div>
        <div class="card-body">
          <div class="row g-2">
            ${cat.nominees.map(nominee => {
              const isSelected = myPicks[cat.categoryNumber] === nominee.name;
              return `
                <div class="col-12 col-md-6 col-lg-4">
                  <div class="nominee-option p-3 border rounded ${isSelected ? 'selected' : ''}" 
                       data-category="${cat.categoryNumber}" 
                       data-nominee="${nominee.name}">
                    ${nominee.name}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `).join('');
    
    // Add click handlers
    container.querySelectorAll('.nominee-option').forEach(el => {
      el.addEventListener('click', function() {
        const category = parseInt(this.dataset.category);
        const nominee = this.dataset.nominee;
        
        // Remove selection from other options in same category
        container.querySelectorAll(`[data-category="${category}"]`).forEach(opt => {
          opt.classList.remove('selected');
        });
        
        // Select this option
        this.classList.add('selected');
        myPicks[category] = nominee;
        updateProgress();
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

  // All picks functionality (admin only)
  let allPicks = [];
  let allPicksCategories = [];

  async function fetchAllPicks() {
    try {
      // Use active year if not set
      if (!currentYear) {
        currentYear = await fetchActiveYear();
      }

      const res = await fetch(`/api/picks/all?year=${currentYear}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!res.ok) {
        if (res.status === 401) {
          localStorage.removeItem('auth_token');
          window.location.href = '/';
          return;
        }
        if (res.status === 403) {
          showAlert('Vous n\'avez pas les privilèges administrateur', 'warning');
          return;
        }
        throw new Error('Failed to fetch picks');
      }
      
      const data = await res.json();
      allPicks = data.picks || [];
      allPicksCategories = data.categories || [];
      currentYear = data.year || currentYear;
      
      const yearEl = document.getElementById('all-picks-year');
      if (yearEl) yearEl.textContent = currentYear;
      
      const countEl = document.getElementById('users-count');
      if (countEl) countEl.textContent = allPicks.length;
      
      renderAllPicks();
    } catch (err) {
      console.error('Error fetching all picks:', err);
      showAlert('Erreur lors du chargement des choix: ' + err.message, 'danger');
    }
  }

  function renderAllPicks() {
    const container = document.getElementById('all-picks-container');
    if (!container) return;
    
    if (allPicks.length === 0) {
      container.innerHTML = `
        <div class="alert alert-info">
          Aucun utilisateur n'a encore soumis ses choix pour l'année ${currentYear}.
        </div>
      `;
      return;
    }
    
    // Create a map of category info
    const categoryMap = new Map();
    allPicksCategories.forEach(cat => {
      categoryMap.set(cat.categoryNumber, cat);
    });
    
    container.innerHTML = allPicks.map(pick => {
      const userName = pick.userId?.name || 'Utilisateur inconnu';
      const userEmail = pick.userId?.email || '';
      const submittedDate = pick.submittedAt ? new Date(pick.submittedAt).toLocaleString('fr-FR') : '—';
      
      // Create a map of picks by category
      const picksMap = new Map();
      pick.picks.forEach(p => {
        picksMap.set(p.categoryNumber, p.selectedNominee);
      });
      
      // Build picks list
      const picksList = allPicksCategories.map(cat => {
        const selected = picksMap.get(cat.categoryNumber);
        if (!selected) return null;
        
        // Check if it's a winner (if winners are set)
        const nominee = cat.nominees.find(n => n.name === selected);
        const isWinner = nominee?.isWinner || false;
        
        return `
          <div class="pick-item ${isWinner ? 'correct-pick' : ''}">
            <div class="d-flex justify-content-between align-items-start">
              <div>
                <strong>${cat.categoryNumber}. ${cat.categoryName}</strong><br>
                <span class="text-muted">${selected}</span>
              </div>
              ${isWinner ? '<span class="badge bg-success">Gagnant</span>' : ''}
            </div>
          </div>
        `;
      }).filter(Boolean).join('');
      
      return `
        <div class="card user-picks-card shadow-sm mb-3">
          <div class="card-header">
            <div class="d-flex justify-content-between align-items-center">
              <div>
                <h5 class="mb-0">${userName}</h5>
                <small class="text-muted">${userEmail}</small>
              </div>
              <div class="text-end">
                <small class="text-muted">Soumis le: ${submittedDate}</small><br>
                <span class="badge bg-primary">${pick.picks.length} / ${allPicksCategories.length} catégories</span>
              </div>
            </div>
          </div>
          <div class="card-body">
            ${picksList || '<div class="text-muted">Aucun choix enregistré</div>'}
          </div>
        </div>
      `;
    }).join('');
  }

  // Event listeners
  document.getElementById('submit-picks')?.addEventListener('click', submitPicks);
  document.getElementById('load-my-picks')?.addEventListener('click', () => {
    loadMyPicks();
    showAlert('Choix rechargés', 'info');
  });
  document.getElementById('refresh-all-picks')?.addEventListener('click', () => {
    fetchAllPicks();
    showAlert('Choix rafraîchis', 'info');
  });

  // Load all picks when admin tab is shown
  const allPicksTab = document.getElementById('tab-all-picks');
  if (allPicksTab) {
    allPicksTab.addEventListener('shown.bs.tab', () => {
      fetchAllPicks();
    });
  }

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

    container.innerHTML = winnersCategories.map(cat => {
      const winner = cat.nominees.find(n => n.isWinner);
      return `
        <div class="card category-winner-card shadow-sm mb-3">
          <div class="card-header">
            <h5 class="mb-0">${cat.categoryNumber}. ${cat.categoryName}</h5>
          </div>
          <div class="card-body">
            <div class="mb-2">
              <label class="form-label fw-semibold">Gagnant:</label>
              <select class="form-select winner-select" data-category-id="${cat._id}" data-category-number="${cat.categoryNumber}">
                <option value="">-- Sélectionner un gagnant --</option>
                ${cat.nominees.map(nominee => `
                  <option value="${nominee.name}" ${nominee.isWinner ? 'selected' : ''}>${nominee.name}</option>
                `).join('')}
              </select>
            </div>
            ${winner ? `<div class="alert alert-success mb-0 mt-2"><strong>Gagnant actuel:</strong> ${winner.name}</div>` : ''}
          </div>
        </div>
      `;
    }).join('');

    // Add event listeners for winner selection
    container.querySelectorAll('.winner-select').forEach(select => {
      select.addEventListener('change', async function() {
        const categoryId = this.dataset.categoryId;
        const winnerName = this.value;

        if (!winnerName) return;

        try {
          const res = await fetch(`/api/categories/${categoryId}/winner`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ winnerName })
          });

          if (!res.ok) {
            const error = await res.json();
            throw new Error(error.message || 'Failed to mark winner');
          }

          showAlert('Gagnant marqué avec succès', 'success');
          await fetchWinnersCategories();
        } catch (err) {
          console.error('Error marking winner:', err);
          showAlert('Erreur: ' + err.message, 'danger');
        }
      });
    });
  }

  async function calculateScores() {
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
        throw new Error(error.message || 'Failed to calculate scores');
      }

      const data = await res.json();
      showAlert(`Scores calculés avec succès! ${data.scores.length} utilisateur(s) évalué(s).`, 'success');
      await fetchScores();
    } catch (err) {
      console.error('Error calculating scores:', err);
      showAlert('Erreur: ' + err.message, 'danger');
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

      const res = await fetch(`/api/picks/scores?year=${currentYear}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!res.ok) {
        if (res.status === 403) {
          return; // Not admin, skip
        }
        throw new Error('Failed to fetch scores');
      }

      const data = await res.json();
      renderScores(data.scores || [], data.totalCategories || 0);
    } catch (err) {
      console.error('Error fetching scores:', err);
    }
  }

  function renderScores(scores, totalCategories) {
    const container = document.getElementById('scores-container');
    if (!container) return;

    if (scores.length === 0) {
      container.innerHTML = '<div class="text-muted">Aucun score disponible. Les utilisateurs doivent d\'abord soumettre leurs choix.</div>';
      return;
    }

    container.innerHTML = `
      <div class="table-responsive">
        <table class="table table-striped table-hover">
          <thead>
            <tr>
              <th style="width: 50px;">#</th>
              <th>Utilisateur</th>
              <th class="text-center">Score</th>
              <th class="text-center">Total</th>
              <th class="text-center">%</th>
              <th class="text-center" style="width: 120px;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${scores.map((score, index) => {
              const percentage = totalCategories > 0 ? Math.round((score.score / totalCategories) * 100) : 0;
              const rank = index + 1;
              const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '';
              return `
                <tr>
                  <td><strong>${rank}${medal ? ' ' + medal : ''}</strong></td>
                  <td>${score.userName}${score.userEmail ? ` <small class="text-muted">(${score.userEmail})</small>` : ''}</td>
                  <td class="text-center"><strong class="text-success">${score.score}</strong></td>
                  <td class="text-center text-muted">${totalCategories}</td>
                  <td class="text-center"><strong>${percentage}%</strong></td>
                  <td class="text-center">
                    <button class="btn btn-sm btn-outline-primary view-picks-btn" data-user-id="${score.userId}" data-user-name="${score.userName}" data-score-index="${index}">
                      Voir détails
                    </button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;

    // Store scores data globally for modal access
    window.scoresData = scores;

    // Add event listeners for view picks buttons
    container.querySelectorAll('.view-picks-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        const scoreIndex = parseInt(this.dataset.scoreIndex);
        const score = scores[scoreIndex];
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

  // Load winners when admin tab is shown
  const winnersTab = document.getElementById('tab-winners');
  if (winnersTab) {
    winnersTab.addEventListener('shown.bs.tab', () => {
      fetchWinnersCategories();
    });
  }

  // Initial load
  (async () => {
    currentYear = await fetchActiveYear();
    document.title = `Pool Oscars (${currentYear}) - Mes choix`;
    await fetchCategories();
  })();
})();

