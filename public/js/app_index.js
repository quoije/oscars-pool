// Check if the user is already logged in by looking for auth_token in localStorage
if (localStorage.getItem('auth_token')) {
    // If the token is found, redirect to /movies.html
    window.location.href = '/movies.html';
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
      window.location.href = '/movies.html';  // Redirect to movies page on success
    } else {
      const error = await res.json();
      alert(`${error.message}`);
    }
  });

  // Fetch version information from the API
  async function fetchVersionInfo() {
    const res = await fetch('/api/version');
    if (res.ok) {
      const data = await res.json();
      // Update footer with the fetched version info
      const footerText = `${data.date} - ${data.version} - ${data.message}`;
      document.getElementById('footer-text').textContent = footerText;
    } else {
      document.getElementById('footer-text').textContent = '';
    }
  }

  // Call the function to fetch and display the version info
  // Doesn't work on prod, will fix later
  fetchVersionInfo();