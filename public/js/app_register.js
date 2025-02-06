// Check if the user is already logged in by looking for auth_token in localStorage
if (localStorage.getItem('auth_token')) {
    // If the token is found, redirect to /movies.html
    window.location.href = '/movies.html';
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