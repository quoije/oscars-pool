function decodeJwt(token) {
  return JSON.parse(atob(token.split('.')[1]));
}

async function applyActiveOscarYearToTitle() {
  const base = 'Oscar Pool';
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
    } else {
      window.location.href = '/movies.html';
    }
  } catch (_) {
    localStorage.removeItem('auth_token');
  }
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
      const error = await res.json();
      alert(`${error.message}`);
    }
  });