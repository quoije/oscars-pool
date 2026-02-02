function decodeJwt(token) {
  return JSON.parse(atob(token.split('.')[1]));
}

function translateApiMessage(messageKey, message, fallbackKey, fallbackText) {
  try {
    if (window.i18n && typeof window.i18n.t === 'function') {
      if (messageKey) return window.i18n.t(messageKey);
      const map = {
        'Mauvais nom de chien': 'auth.dogAnswerIncorrect',
        "L'utilisateur s'est enregistré avec succès !": 'auth.registrationSuccess',
        'User registered successfully!': 'auth.registrationSuccess',
      };
      if (message && map[message]) return window.i18n.t(map[message]);
      if (fallbackKey) return window.i18n.t(fallbackKey);
    }
  } catch (_) {}
  return message || fallbackText || '';
}

async function applyActiveOscarYearToTitle() {
  const base = 'Pool Oscars';
  const current = String(document.title || base);
  const sep = ' - ';
  const idx = current.indexOf(sep);
  const suffix = idx >= 0 ? current.slice(idx) : '';

  try {
    const res = await fetch('/api/settings/year', { method: 'GET' });
    const data = res.ok ? await res.json().catch(() => null) : null;
    const year = Number(data?.year);
    document.title = Number.isInteger(year) ? `${base} (${year})${suffix}` : `${base}${suffix}`;
  } catch (_) {
    document.title = `${base}${suffix}`;
  }
}

// Fire and forget.
applyActiveOscarYearToTitle();

// Check setup status
async function checkSetupStatus() {
  try {
    const res = await fetch('/api/users/setup/status', { method: 'GET', cache: 'no-store' });
    if (!res.ok) return { needsSetup: false };
    return await res.json();
  } catch (_) {
    return { needsSetup: false };
  }
}

async function initPage() {
  const setupNeededCard = document.getElementById('setup-needed-card');
  const registerCard = document.getElementById('register-card');

  // Check if setup is needed
  const status = await checkSetupStatus();

  if (status.needsSetup) {
    // Show setup-needed banner, hide registration form
    if (setupNeededCard) setupNeededCard.classList.remove('d-none');
    if (registerCard) registerCard.classList.add('d-none');
    return;
  }

  // Check if the user is already logged in by looking for auth_token in localStorage
  const existingToken = localStorage.getItem('auth_token');
  if (existingToken) {
    try {
      const decoded = decodeJwt(existingToken);
      const currentTime = Math.floor(Date.now() / 1000);
      if (decoded.exp && decoded.exp < currentTime) {
        localStorage.removeItem('auth_token');
      } else if (decoded.mustChangePassword) {
        window.location.href = '/change-password.html';
        return;
      } else {
        window.location.href = '/movies.html';
        return;
      }
    } catch (_) {
      localStorage.removeItem('auth_token');
    }
  }
}

// Initialize the page
initPage();

  // Handle registration form submission
  document.getElementById('register-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    
    const name = document.getElementById('name').value;
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const verifoof = document.getElementById('verifoof').value;
    
    const res = await fetch('/api/users/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, verifoof })
    });

    const responseMessageElement = document.getElementById('response-message');
    const modal = new bootstrap.Modal(document.getElementById('responseModal'));

    if (res.ok) {
      const data = await res.json();
      // Show success message in the modal
      responseMessageElement.textContent = translateApiMessage(
        data?.messageKey,
        data?.message,
        'auth.registrationSuccess',
        'User registered successfully!'
      );
      
      // Show the modal
      modal.show();

      // Redirect to login after the modal is dismissed
      document.getElementById('redirect-login').addEventListener('click', function () {
        window.location.href = '/';
      });
    } else {
      const error = await res.json();
      // Show error message in the modal
      const prefix = (window.i18n && typeof window.i18n.t === 'function')
        ? window.i18n.t('common.errorPrefix')
        : 'Error:';
      const msg = translateApiMessage(error?.messageKey, error?.message, 'common.errorOccurred', 'An error occurred');
      responseMessageElement.textContent = `${prefix} ${msg}`.trim();
      
      // Show the modal
      modal.show();
    }
  });