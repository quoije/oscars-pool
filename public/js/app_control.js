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

  document.getElementById('user-name').textContent = decoded.name || '';

  // Admin-only page: if token doesn't contain admin flag, bounce.
  if (!decoded.admin) {
    window.location.href = '/movies.html';
    return;
  }

  const responseEl = document.getElementById('response');
  const form = document.getElementById('add-movie-form');

  function showResponse(kind, message) {
    responseEl.classList.remove('d-none', 'alert-success', 'alert-danger', 'alert-warning');
    responseEl.classList.add(kind === 'success' ? 'alert-success' : kind === 'warning' ? 'alert-warning' : 'alert-danger');
    responseEl.textContent = message;
  }

  document.getElementById('reset-form').addEventListener('click', function () {
    form.reset();
    responseEl.classList.add('d-none');
  });

  document.getElementById('log-off').addEventListener('click', function () {
    localStorage.removeItem('auth_token');
    window.location.href = '/';
  });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();

    const imdb_id = document.getElementById('imdb_id').value.trim();
    const category = document.getElementById('category').value.trim();
    const vod_link = document.getElementById('vod_link').value.trim();

    if (!/^tt\d{5,}$/.test(imdb_id)) {
      showResponse('warning', 'IMDB ID invalide. Exemple attendu: tt1234567');
      return;
    }

    try {
      const res = await fetch('/api/movies/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ imdb_id, category, vod_link })
      });

      if (res.ok) {
        showResponse('success', 'Film ajouté avec succès.');
        form.reset();
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
};

