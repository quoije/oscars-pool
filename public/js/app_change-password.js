function decodeJwt(token) {
  return JSON.parse(atob(token.split('.')[1]));
}

function isTokenExpired(decoded) {
  const currentTime = Math.floor(Date.now() / 1000);
  return !!decoded.exp && decoded.exp < currentTime;
}

window.onload = function () {
  const token = localStorage.getItem('auth_token');
  if (!token) {
    window.location.href = '/';
    return;
  }

  let decoded;
  try {
    decoded = decodeJwt(token);
  } catch (e) {
    localStorage.removeItem('auth_token');
    window.location.href = '/';
    return;
  }

  if (isTokenExpired(decoded)) {
    localStorage.removeItem('auth_token');
    window.location.href = '/';
    return;
  }

  // Only show this page if user must change password.
  if (!decoded.mustChangePassword) {
    window.location.href = '/movies.html';
    return;
  }

  const errorEl = document.getElementById('change-password-error');
  const form = document.getElementById('change-password-form');

  function showError(message) {
    errorEl.classList.remove('d-none');
    errorEl.textContent = message;
  }

  function clearError() {
    errorEl.classList.add('d-none');
    errorEl.textContent = '';
  }

  document.getElementById('log-off').addEventListener('click', function () {
    localStorage.removeItem('auth_token');
    window.location.href = '/';
  });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    clearError();

    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-password').value;

    if (newPassword.length < 8) {
      showError('Le mot de passe doit contenir au moins 8 caractères.');
      return;
    }
    if (newPassword !== confirmPassword) {
      showError('Les mots de passe ne correspondent pas.');
      return;
    }

    try {
      const res = await fetch('/api/users/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ newPassword }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError(data.message || data.error || `Erreur (${res.status})`);
        return;
      }

      if (data.token) {
        localStorage.setItem('auth_token', data.token);
      } else {
        // Fallback: force re-login if no token is returned.
        localStorage.removeItem('auth_token');
        window.location.href = '/';
        return;
      }

      window.location.href = '/movies.html';
    } catch (err) {
      showError(err.message || 'Erreur réseau');
    }
  });
};

