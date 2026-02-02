function decodeJwt(token) {
  return JSON.parse(atob(token.split('.')[1]));
}

// i18n helper function
function t(key, fallback = '', params = {}) {
  if (window.i18n && typeof window.i18n.t === 'function') {
    return window.i18n.t(key, params);
  }
  let result = fallback;
  if (params && typeof params === 'object') {
    Object.keys(params).forEach(k => {
      result = result.replace(`{${k}}`, String(params[k]));
    });
  }
  return result;
}

function translateApiMessage(messageKey, message, fallbackKey, fallbackText) {
  try {
    if (window.i18n && typeof window.i18n.t === 'function') {
      if (messageKey) return window.i18n.t(messageKey);
      const map = {
        "L'utilisateur n'a pas été trouvé": 'auth.userNotFound',
        'User not found': 'auth.userNotFound',
        "Informations d'identification non valides": 'auth.invalidCredentials',
        'Invalid credentials': 'auth.invalidCredentials',
        "Le mot de passe temporaire a expiré. Demandez à un admin de réinitialiser votre mot de passe.": 'auth.tempPasswordExpired',
        'Temporary password expired. Ask an admin to reset your password.': 'auth.tempPasswordExpired',
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

// Check setup status first
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
  const setupCard = document.getElementById('setup-card');
  const loginCard = document.getElementById('login-card');

  // Check if setup is needed
  const status = await checkSetupStatus();

  if (status.needsSetup) {
    // Show setup card, hide login card
    if (setupCard) setupCard.classList.remove('d-none');
    if (loginCard) loginCard.classList.add('d-none');
    return;
  }

  // Check if the user is already logged in
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

// Handle setup form submission
const setupForm = document.getElementById('setup-form');
if (setupForm) {
  setupForm.addEventListener('submit', async function (e) {
    e.preventDefault();

    const setupError = document.getElementById('setup-error');
    const name = document.getElementById('setup-name').value.trim();
    const email = document.getElementById('setup-email').value.trim();
    const password = document.getElementById('setup-password').value;
    const passwordConfirm = document.getElementById('setup-password-confirm').value;

    // Hide previous error
    if (setupError) setupError.classList.add('d-none');

    // Validate passwords match
    if (password !== passwordConfirm) {
      if (setupError) {
        setupError.textContent = 'Les mots de passe ne correspondent pas';
        setupError.classList.remove('d-none');
      }
      return;
    }

    try {
      const res = await fetch('/api/users/setup/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password })
      });

      const data = await res.json();

      if (res.ok) {
        // Save the token and redirect
        localStorage.setItem('auth_token', data.token);
        window.location.href = '/movies.html';
      } else {
        if (setupError) {
          setupError.textContent = data.message || t('auth.errorCreatingAccount', 'Error creating account');
          setupError.classList.remove('d-none');
        }
      }
    } catch (err) {
      if (setupError) {
        setupError.textContent = t('auth.networkError', 'Network error. Please try again.');
        setupError.classList.remove('d-none');
      }
    }
  });
}

// Handle login form submission
document.getElementById('login-form').addEventListener('submit', async function (e) {
  e.preventDefault();

  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;

  const res = await fetch('/api/users/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });

  if (res.ok) {
    const data = await res.json();
    // Save the token to localStorage
    localStorage.setItem('auth_token', data.token);

    if (data.mustChangePassword) {
      window.location.href = '/change-password.html';
    } else {
      window.location.href = '/movies.html';  // Redirect to movies page on success
    }
  } else {
    const error = await res.json().catch(() => ({}));
    const msg = translateApiMessage(error.messageKey, error.message, 'auth.loginFailed', 'Login failed');
    alert(msg);
  }
});