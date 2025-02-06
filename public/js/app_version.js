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