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

  // Check if admin
  if (!decoded.admin) {
    window.location.href = '/picks.html';
    return;
  }

  // Logout
  const logOffBtn = document.getElementById('log-off');
  if (logOffBtn) {
    logOffBtn.addEventListener('click', () => {
      localStorage.removeItem('auth_token');
      window.location.href = '/';
    });
  }

  let allPicks = [];
  let categories = [];
  let currentYear = new Date().getFullYear();

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

  function getLocale() {
    return (window.i18n && typeof window.i18n.getLanguage === 'function')
      ? window.i18n.getLanguage()
      : (document.documentElement.lang || 'en');
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

  async function fetchAllPicks() {
    try {
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
          window.location.href = '/picks.html';
          return;
        }
        throw new Error('Failed to fetch picks');
      }
      
      const data = await res.json();
      allPicks = data.picks || [];
      categories = data.categories || [];
      currentYear = data.year || currentYear;
      
      document.getElementById('current-year').textContent = currentYear;
      document.getElementById('users-count').textContent = allPicks.length;
      
      renderPicks();
    } catch (err) {
      console.error('Error fetching picks:', err);
      showAlert(t('viewPicks.errorLoading', 'Error loading picks: {error}', { error: err.message }), 'danger');
    }
  }

  function renderPicks() {
    const container = document.getElementById('picks-container');
    if (!container) return;
    
    if (allPicks.length === 0) {
      container.innerHTML = `
        <div class="alert alert-info">
          ${t('viewPicks.noPicks', 'No user has submitted picks for year {year} yet.', { year: currentYear })}
        </div>
      `;
      return;
    }
    
    // Create a map of category info
    const categoryMap = new Map();
    categories.forEach(cat => {
      categoryMap.set(cat.categoryNumber, cat);
    });
    
    container.innerHTML = allPicks.map(pick => {
      const userName = pick.userId?.name || t('viewPicks.unknownUser', 'Unknown user');
      const userEmail = pick.userId?.email || '';
      let submittedDate = '—';
      if (pick.submittedAt) {
        const d = new Date(pick.submittedAt);
        if (!Number.isNaN(d.getTime())) {
          try {
            submittedDate = d.toLocaleString(getLocale(), { dateStyle: 'medium', timeStyle: 'short' });
          } catch (_) {
            submittedDate = d.toLocaleString();
          }
        }
      }
      
      // Create a map of picks by category
      const picksMap = new Map();
      pick.picks.forEach(p => {
        picksMap.set(p.categoryNumber, p.selectedNominee);
      });
      
      // Build picks list
      const picksList = categories.map(cat => {
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
              ${isWinner ? `<span class="badge bg-success">${t('viewPicks.winnerBadge', 'Winner')}</span>` : ''}
            </div>
          </div>
        `;
      }).filter(Boolean).join('');
      
      return `
        <div class="card user-picks-card shadow-sm">
          <div class="card-header">
            <div class="d-flex justify-content-between align-items-center">
              <div>
                <h5 class="mb-0">${userName}</h5>
                <small class="text-muted">${userEmail}</small>
              </div>
              <div class="text-end">
                <small class="text-muted">${t('viewPicks.submittedOn', 'Submitted on: {date}', { date: submittedDate })}</small><br>
                <span class="badge bg-primary">${t('viewPicks.categoriesCount', '{count} / {total} categories', { count: pick.picks.length, total: categories.length })}</span>
              </div>
            </div>
          </div>
          <div class="card-body">
            ${picksList || `<div class="text-muted">${t('viewPicks.noPicks2', 'No picks recorded')}</div>`}
          </div>
        </div>
      `;
    }).join('');
  }

  // Event listeners
  document.getElementById('refresh-picks')?.addEventListener('click', () => {
    fetchAllPicks();
    showAlert(t('viewPicks.picksRefreshed', 'Picks refreshed'), 'info');
  });

  // Initial load
  fetchAllPicks();
})();

