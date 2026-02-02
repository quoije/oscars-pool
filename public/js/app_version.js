  // Fetch version information from the API
  async function fetchVersionInfo() {
    const res = await fetch('/api/version');
    if (res.ok) {
      const data = await res.json();
      if (window.i18n && typeof window.i18n.init === 'function') {
        try {
          await window.i18n.init();
        } catch (_) {}
      }
      const hasI18n = window.i18n && typeof window.i18n.t === 'function';
      let message = data.message || '';
      if (data && data.configured === false) {
        if (hasI18n) {
          message = window.i18n.t('footer.versionNotConfigured');
        }
      }
      // Update footer with the fetched version info
      const footerText = `${data.date} - ${data.version} - ${message}`;
      document.getElementById('footer-text').textContent = footerText;
    } else {
      document.getElementById('footer-text').textContent = '';
    }
  }

  // Call the function to fetch and display the version info
  // Doesn't work on prod, will fix later
  fetchVersionInfo();