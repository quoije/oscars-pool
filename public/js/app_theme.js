// Theme toggle with system preference fallback.
(function () {
  const STORAGE_KEY = 'theme_preference';
  const LAST_KEY = 'theme_last_applied';
  const THEME_ATTR = 'data-theme';
  const SOURCE_ATTR = 'data-theme-source';
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const API_ENDPOINT = '/api/users/theme';

  function normalizeTheme(value) {
    return value === 'light' || value === 'dark' ? value : null;
  }

  function getSystemTheme() {
    return mediaQuery.matches ? 'dark' : 'light';
  }

  function setTheme(theme, source) {
    document.documentElement.setAttribute(THEME_ATTR, theme);
    document.documentElement.setAttribute(SOURCE_ATTR, source);
    try {
      sessionStorage.setItem(LAST_KEY, theme);
    } catch (_) {
      // Ignore storage errors.
    }
    updateToggleUi(theme, source);
  }

  function getAuthToken() {
    try {
      return localStorage.getItem('auth_token');
    } catch (_) {
      return null;
    }
  }

  async function savePreferenceToServer(themePreference) {
    const token = getAuthToken();
    if (!token) return;
    try {
      await fetch(API_ENDPOINT, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ themePreference: themePreference ?? null })
      });
    } catch (_) {
      // Ignore network errors to avoid blocking UI.
    }
  }

  async function syncPreferenceFromServer() {
    const token = getAuthToken();
    if (!token) return;
    try {
      const res = await fetch(API_ENDPOINT, {
        headers: { 'Authorization': `Bearer ${token}` },
        cache: 'no-store'
      });
      if (!res.ok) return;
      const data = await res.json();
      const pref = normalizeTheme(data?.themePreference);
      const currentPref = normalizeTheme(localStorage.getItem(STORAGE_KEY));
      const changed = pref !== currentPref;
      if (changed) {
        if (pref) {
          localStorage.setItem(STORAGE_KEY, pref);
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
        applyStoredOrSystem();
      }
    } catch (_) {
      // Ignore fetch errors.
    }
  }

  function applyStoredOrSystem() {
    const stored = normalizeTheme(localStorage.getItem(STORAGE_KEY));
    let last = null;
    try {
      last = normalizeTheme(sessionStorage.getItem(LAST_KEY));
    } catch (_) {
      last = null;
    }
    const theme = stored || last || getSystemTheme();
    const source = stored ? 'user' : (last ? 'session' : 'system');
    setTheme(theme, source);
  }

  function toggleTheme() {
    const stored = normalizeTheme(localStorage.getItem(STORAGE_KEY));
    const current = stored || getSystemTheme();
    const next = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem(STORAGE_KEY, next);
    setTheme(next, 'user');
    savePreferenceToServer(next);
  }

  function resetToSystem() {
    localStorage.removeItem(STORAGE_KEY);
    applyStoredOrSystem();
    savePreferenceToServer(null);
  }

  function updateToggleUi(theme, source) {
    const buttons = document.querySelectorAll('[data-theme-toggle]');
    const isDark = theme === 'dark';
    buttons.forEach((button) => {
      button.setAttribute('aria-checked', String(isDark));
      button.dataset.theme = theme;
      const label = isDark ? 'Mode sombre' : 'Mode clair';
      const sourceLabel = source === 'system' ? ' (système)' : '';
      button.setAttribute('title', `${label}${sourceLabel} — Shift+clic pour système`);
    });
  }

  applyStoredOrSystem();
  syncPreferenceFromServer();

  mediaQuery.addEventListener('change', () => {
    const stored = normalizeTheme(localStorage.getItem(STORAGE_KEY));
    if (!stored) {
      applyStoredOrSystem();
    }
  });

  function bindToggleButtons() {
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      if (button.dataset.themeBound === 'true') return;
      button.dataset.themeBound = 'true';
      button.addEventListener('click', (event) => {
        if (event.shiftKey) {
          resetToSystem();
          return;
        }
        toggleTheme();
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindToggleButtons);
  } else {
    bindToggleButtons();
  }
})();
