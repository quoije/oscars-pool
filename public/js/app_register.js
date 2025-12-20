function decodeJwt(token) {
  return JSON.parse(atob(token.split('.')[1]));
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
    } else {
      window.location.href = '/movies.html';
    }
  } catch (_) {
    localStorage.removeItem('auth_token');
  }
}

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
      responseMessageElement.textContent = data.message;
      
      // Show the modal
      modal.show();

      // Redirect to login after the modal is dismissed
      document.getElementById('redirect-login').addEventListener('click', function () {
        window.location.href = '/';
      });
    } else {
      const error = await res.json();
      // Show error message in the modal
      responseMessageElement.textContent = `Error: ${error.message}`;
      
      // Show the modal
      modal.show();
    }
  });