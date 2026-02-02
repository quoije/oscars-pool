/**
 * Lightweight i18n module for Oscar Pool
 * Supports English (base) and French translations
 */
(function() {
  'use strict';

  const STORAGE_KEY = 'app_language';
  const DEFAULT_LANG = 'en';
  const SUPPORTED_LANGS = ['en', 'fr'];

  let currentLang = DEFAULT_LANG;
  let translations = {};
  let loadedLangs = new Set();
  let initPromise = null;

  /**
   * Detect language from: localStorage → browser → default
   */
  function detectLanguage() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && SUPPORTED_LANGS.includes(stored)) {
      return stored;
    }

    const browserLang = (navigator.language || navigator.userLanguage || '').split('-')[0].toLowerCase();
    if (SUPPORTED_LANGS.includes(browserLang)) {
      return browserLang;
    }

    return DEFAULT_LANG;
  }

  /**
   * Load translation file for a language
   */
  async function loadTranslations(lang) {
    if (loadedLangs.has(lang)) return true;

    try {
      const res = await fetch(`/locales/${lang}.json`, { cache: 'default' });
      if (!res.ok) {
        console.warn(`i18n: Failed to load ${lang}.json (${res.status})`);
        return false;
      }
      const data = await res.json();
      translations[lang] = data;
      loadedLangs.add(lang);
      return true;
    } catch (err) {
      console.warn(`i18n: Error loading ${lang}.json`, err);
      return false;
    }
  }

  /**
   * Translate a key with optional interpolation
   * @param {string} key - Translation key (e.g., 'nav.logout')
   * @param {Object} params - Optional parameters for interpolation
   * @returns {string} - Translated string or key if not found
   */
  function t(key, params = {}) {
    if (!key) return '';

    // Try current language, then fallback to default
    let text = translations[currentLang]?.[key];
    if (text === undefined && currentLang !== DEFAULT_LANG) {
      text = translations[DEFAULT_LANG]?.[key];
    }
    if (text === undefined) {
      // Return key as fallback (helps identify missing translations)
      return key;
    }

    // Simple interpolation: {varName} → value
    if (params && typeof params === 'object') {
      Object.keys(params).forEach(k => {
        const regex = new RegExp(`\\{${k}\\}`, 'g');
        text = text.replace(regex, String(params[k]));
      });
    }

    return text;
  }

  /**
   * Set the current language
   */
  function setLanguage(lang) {
    if (!SUPPORTED_LANGS.includes(lang)) {
      console.warn(`i18n: Unsupported language "${lang}"`);
      return false;
    }
    currentLang = lang;
    localStorage.setItem(STORAGE_KEY, lang);
    document.documentElement.lang = lang;
    return true;
  }

  /**
   * Get the current language
   */
  function getLanguage() {
    return currentLang;
  }

  /**
   * Get list of supported languages
   */
  function getSupportedLanguages() {
    return [...SUPPORTED_LANGS];
  }

  /**
   * Translate all elements with data-i18n attributes
   */
  function translatePage() {
    // Translate text content
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (!key) return;

      // Check for interpolation params
      const paramsAttr = el.getAttribute('data-i18n-params');
      let params = {};
      if (paramsAttr) {
        try {
          params = JSON.parse(paramsAttr);
        } catch (_) {
          // Ignore invalid JSON
        }
      }

      const translated = t(key, params);
      if (translated !== key) {
        el.textContent = translated;
      }
    });

    // Translate placeholders
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (!key) return;
      const translated = t(key);
      if (translated !== key) {
        el.placeholder = translated;
      }
    });

    // Translate aria-labels
    document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
      const key = el.getAttribute('data-i18n-aria-label');
      if (!key) return;
      const translated = t(key);
      if (translated !== key) {
        el.setAttribute('aria-label', translated);
      }
    });

    // Translate titles
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      const key = el.getAttribute('data-i18n-title');
      if (!key) return;
      const translated = t(key);
      if (translated !== key) {
        el.title = translated;
      }
    });

    // Translate option values in selects
    document.querySelectorAll('option[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (!key) return;
      const translated = t(key);
      if (translated !== key) {
        el.textContent = translated;
      }
    });

    // Mark body as ready (for CSS transitions)
    document.body.classList.add('i18n-ready');
  }

  /**
   * Update a single element's translation (for dynamic content)
   */
  function translateElement(el, key, params = {}) {
    if (!el || !key) return;
    el.textContent = t(key, params);
  }

  /**
   * Fetch language setting from server (optional, for admin-set language)
   */
  async function fetchServerLanguage() {
    try {
      const res = await fetch('/api/settings/language', {
        method: 'GET',
        cache: 'no-store'
      });
      if (res.ok) {
        const data = await res.json();
        if (data.language && SUPPORTED_LANGS.includes(data.language)) {
          return data.language;
        }
      }
    } catch (_) {
      // Silently fail - use local detection
    }
    return null;
  }

  /**
   * Initialize i18n system
   * @param {string} forceLang - Optional language to force (bypasses detection)
   */
  async function init(forceLang = null) {
    // Prevent multiple concurrent initializations
    if (initPromise) return initPromise;

    initPromise = (async () => {
      // Determine language to use
      let lang = forceLang;

      if (!lang) {
        // Try server setting first (if user is logged in and admin set a language)
        const serverLang = await fetchServerLanguage();
        if (serverLang) {
          lang = serverLang;
        } else {
          lang = detectLanguage();
        }
      }

      // Always load default language as fallback
      await loadTranslations(DEFAULT_LANG);

      // Load current language if different
      if (lang !== DEFAULT_LANG) {
        const loaded = await loadTranslations(lang);
        if (!loaded) {
          lang = DEFAULT_LANG;
        }
      }

      setLanguage(lang);
      translatePage();

      return lang;
    })();

    return initPromise;
  }

  /**
   * Change language and re-translate page
   */
  async function changeLanguage(lang) {
    if (!SUPPORTED_LANGS.includes(lang)) {
      console.warn(`i18n: Unsupported language "${lang}"`);
      return false;
    }

    // Load translations if not already loaded
    if (!loadedLangs.has(lang)) {
      const loaded = await loadTranslations(lang);
      if (!loaded) return false;
    }

    setLanguage(lang);
    translatePage();
    return true;
  }

  /**
   * Check if translations are loaded
   */
  function isReady() {
    return loadedLangs.size > 0;
  }

  // Expose globally
  window.i18n = {
    t,
    init,
    setLanguage,
    getLanguage,
    changeLanguage,
    getSupportedLanguages,
    translatePage,
    translateElement,
    loadTranslations,
    fetchServerLanguage,
    isReady,
    DEFAULT_LANG,
    SUPPORTED_LANGS
  };

  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init());
  } else {
    // DOM already loaded
    init();
  }
})();
