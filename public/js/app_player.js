function decodeJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length < 2) throw new Error('Invalid token');
  // JWT uses base64url (not base64)
  const b64url = String(parts[1] || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64url + '='.repeat((4 - (b64url.length % 4)) % 4);
  return JSON.parse(atob(padded));
}

function safeJsonParse(v) {
  try { return JSON.parse(v); } catch (_) { return null; }
}

function progressStorageKey(userId, movieId) {
  return `playback_progress:${String(userId || '')}:${String(movieId || '')}`;
}

function normalizeUserId(raw) {
  // Expect a Mongo ObjectId string in the token payload.
  const v = raw?.id;
  if (typeof v === 'string' && /^[a-f0-9]{24}$/i.test(v)) return v;
  const s = v && typeof v === 'object' && typeof v.toString === 'function' ? v.toString() : String(v || '');
  return /^[a-f0-9]{24}$/i.test(s) ? s : null;
}

async function fetchActiveOscarYear() {
  try {
    const res = await fetch('/api/settings/year', { method: 'GET' });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const year = Number(data?.year);
    return Number.isInteger(year) ? year : null;
  } catch (_) {
    return null;
  }
}

async function fetchPlaybackProgress(movieId, token) {
  try {
    const res = await fetch(`/api/movies/${encodeURIComponent(movieId)}/progress`, {
      method: 'GET',
      headers: token ? { 'Authorization': `Bearer ${token}` } : undefined,
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (!data) return null;
    const time = Number(data.time);
    const duration = data.duration === null || data.duration === undefined ? null : Number(data.duration);
    return {
      time: Number.isFinite(time) && time >= 0 ? time : 0,
      duration: duration !== null && Number.isFinite(duration) && duration > 0 ? duration : null,
    };
  } catch (_) {
    return null;
  }
}

async function savePlaybackProgress(movieId, token, { time, duration, imdbId, keepalive } = {}) {
  try {
    // Retry once on rare upsert races (409).
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const payload = { time };
      // Don't send duration when unknown; avoids wiping server-side duration.
      if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) {
        payload.duration = duration;
      }
      const safeImdb = typeof imdbId === 'string' ? imdbId.trim() : '';
      if (safeImdb) payload.imdb_id = safeImdb;

      const res = await fetch(`/api/movies/${encodeURIComponent(movieId)}/progress`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
        keepalive: !!keepalive,
      });
      if (res.ok) return true;
      if (res.status === 409) continue;
      if (res.status === 401) return false;
      return true; // best-effort; don't break playback on other errors
    }
    return true;
  } catch (_) {
    // best-effort
    return true;
  }
}

function setupVideoProgress({ videoEl, movieId, token, userId, imdbId }) {
  if (!videoEl || !movieId || !token || !userId) return () => {};

  const key = progressStorageKey(userId, movieId);
  let restored = false;
  let restoreInProgress = false;
  let pendingRestoreTime = null; // number | null
  let restoreServerPromise = null;
  let intervalId = null;
  let lastSavedAt = 0;
  let lastSavedTime = -1;
  let lastSaveStatus = '—';
  let seekSaveTimer = null;
  let savedUiTimer = null;

  function getSnapshot() {
    const t = Number(videoEl.currentTime);
    const d = Number(videoEl.duration);
    return {
      // Use whole seconds to keep saved values stable.
      time: Number.isFinite(t) && t >= 0 ? Math.floor(t) : 0,
      duration: Number.isFinite(d) && d > 0 ? Math.floor(d) : null,
    };
  }

  async function tryRestoreProgress() {
    if (restored) return true;

    const dur = Number(videoEl.duration);
    // Don't mark restored until we have a usable duration: some sources report NaN/Infinity first.
    if (!Number.isFinite(dur) || dur <= 0 || dur === Infinity) return false;

    // Prefer server progress, fall back to localStorage if offline.
    if (!restoreServerPromise) restoreServerPromise = fetchPlaybackProgress(movieId, token);
    const server = await restoreServerPromise;
    let targetTime = server?.time ?? 0;

    if (!Number.isFinite(targetTime) || targetTime < 0) targetTime = 0;
    if (targetTime <= 1) {
      const local = safeJsonParse(localStorage.getItem(key));
      const lt = Number(local?.time);
      if (Number.isFinite(lt) && lt > 1) targetTime = lt;
    }

    // Clamp to avoid seeking beyond the end.
    const clamped = Math.min(Math.max(targetTime, 0), Math.max(0, dur - 3));
    restored = true;

    if (clamped > 1) {
      // Block any progress saves until the seek completes; otherwise we can overwrite
      // server progress with an early "0s" save during reload/startup.
      pendingRestoreTime = clamped;
      restoreInProgress = true;
      try { videoEl.currentTime = clamped; } catch (_) {}
      lastSaveStatus = `Reprise · ${formatClock(clamped)}`;
      setProgressUi({ state: 'info', text: lastSaveStatus, showText: true, ariaText: `Reprise à ${formatClock(clamped)}` });
    } else {
      pendingRestoreTime = null;
      restoreInProgress = false;
      lastSaveStatus = 'Début';
      setProgressUi({ state: 'info', text: 'Début', showText: true, ariaText: 'Lecture depuis le début' });
    }
    return true;
  }

  function scheduleRestore() {
    if (!restored) setProgressUi({ state: 'preparing', text: 'Reprise', showText: true, ariaText: 'Prépare la reprise…' });
    void tryRestoreProgress();
  }

  async function persist({ keepalive, force } = {}) {
    // Never persist until the resume logic finished; otherwise the first "0s" timeupdate
    // on reload can overwrite the user's saved progress on the server.
    if (!restored) {
      void tryRestoreProgress();
      return;
    }
    if (restoreInProgress) return;

    // Throttle to avoid spamming the API
    const now = Date.now();
    if (!force && !keepalive && now - lastSavedAt < 1500) return;

    const snap = getSnapshot();
    if (!Number.isFinite(snap.time)) return;

    if (pendingRestoreTime !== null) {
      // Some browsers may not fire seeked reliably. Only start saving once we
      // observe that currentTime actually reached the restored position.
      if (snap.time >= Math.max(0, Math.floor(pendingRestoreTime) - 1)) {
        pendingRestoreTime = null;
      } else {
        return;
      }
    }

    // Only save if it meaningfully changed (>= 1s)
    if (!force && lastSavedTime >= 0 && Math.abs(snap.time - lastSavedTime) < 1) return;

    lastSavedAt = now;
    lastSavedTime = snap.time;

    try {
      localStorage.setItem(key, JSON.stringify({ time: snap.time, duration: snap.duration, at: now }));
    } catch (_) {}

    // Icon-only saving indicator (avoid noisy text updates).
    setProgressUi({ state: 'saving', text: '', showText: false, ariaText: 'Sauvegarde…' });
    const ok = await savePlaybackProgress(movieId, token, { ...snap, imdbId, keepalive: !!keepalive });
    if (ok === false) {
      // Token expired mid-playback; stop spamming requests and prompt user.
      stopInterval();
      try { localStorage.removeItem('auth_token'); } catch (_) {}
      lastSaveStatus = 'Connexion requise pour sauvegarder.';
      setProgressUi({ state: 'warning', text: 'Connexion', showText: true, ariaText: lastSaveStatus });
      showAlertVariant('Session expirée. Reconnecte-toi pour continuer à sauvegarder la progression.', 'warning');
      return;
    }
    lastSaveStatus = `Sauvegardé à ${formatClock(snap.time)}.`;
    setProgressUi({ state: 'saved', text: '', showText: false, ariaText: lastSaveStatus });
    if (savedUiTimer) window.clearTimeout(savedUiTimer);
    savedUiTimer = window.setTimeout(() => {
      // Settle back to a quiet state (no spam), keep detail in aria-label.
      setProgressUi({ state: 'info', text: '—', showText: false, ariaText: lastSaveStatus });
    }, 900);
  }

  function startInterval() {
    if (intervalId) return;
    // Safety-net; primary saving happens via timeupdate throttling.
    intervalId = window.setInterval(() => {
      if (videoEl.paused || videoEl.seeking) return;
      void persist();
    }, 8000);
  }

  function stopInterval() {
    if (!intervalId) return;
    window.clearInterval(intervalId);
    intervalId = null;
  }

  const onPlay = () => startInterval();
  const onPause = () => { stopInterval(); void persist({ force: true }); };
  const onSeeking = () => {
    // While scrubbing, browsers fire many events; debounce a forced save so it lands quickly.
    if (seekSaveTimer) window.clearTimeout(seekSaveTimer);
    seekSaveTimer = window.setTimeout(() => { void persist({ force: true }); }, 400);
  };
  const onSeeked = () => {
    if (restoreInProgress) {
      restoreInProgress = false;
      pendingRestoreTime = null;
    }
    void persist({ force: true });
  };
  const onEnded = () => { stopInterval(); void persist(); };
  const onError = () => { stopInterval(); };
  const onTimeUpdate = () => {
    if (videoEl.paused || videoEl.seeking) return;
    void persist();
  };
  const onPageHide = () => { void persist({ keepalive: true, force: true }); };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') void persist({ keepalive: true, force: true });
  };

  // Restore may require multiple tries (duration may be unknown at first).
  videoEl.addEventListener('loadedmetadata', scheduleRestore);
  videoEl.addEventListener('durationchange', scheduleRestore);
  videoEl.addEventListener('loadeddata', scheduleRestore);
  videoEl.addEventListener('canplay', scheduleRestore);
  videoEl.addEventListener('play', onPlay);
  videoEl.addEventListener('pause', onPause);
  videoEl.addEventListener('seeking', onSeeking);
  videoEl.addEventListener('seeked', onSeeked);
  videoEl.addEventListener('ended', onEnded);
  videoEl.addEventListener('error', onError);
  videoEl.addEventListener('timeupdate', onTimeUpdate);

  window.addEventListener('pagehide', onPageHide);
  document.addEventListener('visibilitychange', onVisibility);

  // If metadata is already available, try immediately.
  if (videoEl.readyState >= 1) scheduleRestore();

  return () => {
    stopInterval();
    if (seekSaveTimer) window.clearTimeout(seekSaveTimer);
    if (savedUiTimer) window.clearTimeout(savedUiTimer);
    videoEl.removeEventListener('play', onPlay);
    videoEl.removeEventListener('pause', onPause);
    videoEl.removeEventListener('seeking', onSeeking);
    videoEl.removeEventListener('seeked', onSeeked);
    videoEl.removeEventListener('ended', onEnded);
    videoEl.removeEventListener('error', onError);
    videoEl.removeEventListener('timeupdate', onTimeUpdate);
    videoEl.removeEventListener('loadedmetadata', scheduleRestore);
    videoEl.removeEventListener('durationchange', scheduleRestore);
    videoEl.removeEventListener('loadeddata', scheduleRestore);
    videoEl.removeEventListener('canplay', scheduleRestore);
    window.removeEventListener('pagehide', onPageHide);
    document.removeEventListener('visibilitychange', onVisibility);
    if (lastSaveStatus) setProgressStatus(lastSaveStatus);
  };
}

function getQueryParam(name) {
  const url = new URL(window.location.href);
  return url.searchParams.get(name);
}

function showAlert(message) {
  const el = document.getElementById('alert');
  if (!el) return;
  el.textContent = message;
  // Ensure error styling (danger) when using the simple API.
  el.classList.remove('alert-primary', 'alert-secondary', 'alert-success', 'alert-danger', 'alert-warning', 'alert-info', 'alert-light', 'alert-dark');
  el.classList.add('alert-danger');
  el.classList.remove('d-none');
}

function showAlertVariant(message, variant) {
  const el = document.getElementById('alert');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('d-none');

  // Reset any prior bootstrap alert-* variants
  el.classList.remove('alert-primary', 'alert-secondary', 'alert-success', 'alert-danger', 'alert-warning', 'alert-info', 'alert-light', 'alert-dark');
  const v = String(variant || 'danger').trim().toLowerCase();
  el.classList.add(`alert-${v || 'danger'}`);
}

function setSourceLabel(text) {
  const el = document.getElementById('source-label');
  if (!el) return;
  el.textContent = text || '—';
  el.title = text || '';
}

function setProgressStatus(text) {
  // Back-compat: older calls pass a string. We render minimal UI.
  setProgressUi({ state: 'info', text: text || '—', showText: true });
}

function setProgressUi({ state, text, showText, ariaText } = {}) {
  const iconEl = document.getElementById('progress-status-icon');
  const textEl = document.getElementById('progress-status-text');
  const wrapEl = document.getElementById('progress-status');
  if (!iconEl || !textEl) return;

  const s = String(state || '').trim().toLowerCase();
  const t = typeof text === 'string' ? text : (text === null || text === undefined ? '' : String(text));
  const shouldShowText = showText === undefined ? true : !!showText;
  const a11y = typeof ariaText === 'string' ? ariaText : t;

  // Reset icon
  iconEl.classList.remove('progress-icon--spinner');
  iconEl.innerHTML = '';

  // Text
  textEl.textContent = t || '—';
  textEl.classList.toggle('is-hidden', !shouldShowText);

  // A11y label lives on the wrapper span.
  if (wrapEl) {
    if (a11y) wrapEl.setAttribute('aria-label', a11y);
    else wrapEl.removeAttribute('aria-label');
  }

  // Icon by state (no external deps)
  if (s === 'saving' || s === 'preparing') {
    iconEl.classList.add('progress-icon--spinner');
    return;
  }

  if (s === 'saved') {
    iconEl.innerHTML = `
      <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M13.485 1.929a.75.75 0 0 1 .086 1.057l-6.5 8a.75.75 0 0 1-1.1.06l-3.5-3.5a.75.75 0 1 1 1.06-1.06l2.91 2.91 5.98-7.36a.75.75 0 0 1 1.064-.107z"/>
      </svg>
    `;
    return;
  }

  if (s === 'warning' || s === 'error') {
    iconEl.innerHTML = `
      <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M8.982 1.566a1.13 1.13 0 0 0-1.964 0L.165 13.233c-.457.778.091 1.767.982 1.767h13.706c.89 0 1.438-.99.982-1.767L8.982 1.566zM8 5c.535 0 .954.462.9.995l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995A.905.905 0 0 1 8 5zm.002 7a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"/>
      </svg>
    `;
    return;
  }
}

function formatClock(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function setHeader(movie, { activeYear } = {}) {
  const titleEl = document.getElementById('movie-title');
  const categoryEl = document.getElementById('movie-category');
  const ratingEl = document.getElementById('movie-rating');

  const year = Number.isInteger(activeYear) ? activeYear : null;
  const titlePrefix = year ? `Pool Oscars (${year})` : 'Pool Oscars';

  if (titleEl) titleEl.textContent = movie?.title || titlePrefix;

  if (categoryEl) {
    const cat = movie?.category ? String(movie.category) : '';
    categoryEl.textContent = cat ? `${cat} · ` : '';
  }

  if (ratingEl) {
    const r = movie?.rating ? String(movie.rating) : '';
    ratingEl.textContent = r ? `⭐ ${r}` : '';
  }

  document.title = movie?.title ? `${titlePrefix} - ${movie.title}` : titlePrefix;
}

function normalizeVodLink(raw) {
  const v = String(raw || '').trim();
  if (!v) return null;

  // Support pasted iframe embed code (extract src)
  if (v.toLowerCase().includes('<iframe')) {
    try {
      const doc = new DOMParser().parseFromString(v, 'text/html');
      const iframe = doc.querySelector('iframe');
      const src = iframe?.getAttribute('src');
      return src ? String(src).trim() : null;
    } catch (_) {
      return null;
    }
  }

  return v;
}

function looksLikeHls(url) {
  try {
    const u = new URL(url, window.location.origin);
    return u.pathname.toLowerCase().endsWith('.m3u8');
  } catch (_) {
    return String(url).toLowerCase().includes('.m3u8');
  }
}

function looksLikeVideoFile(url) {
  const s = String(url || '').toLowerCase();
  // common direct file extensions
  return /\.(mp4|webm|ogg|ogv|mov|m4v)(\?|#|$)/.test(s);
}

function toYoutubeEmbed(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');

    if (host === 'youtu.be') {
      const id = u.pathname.split('/').filter(Boolean)[0];
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }

    if (host.endsWith('youtube.com')) {
      if (u.pathname.startsWith('/embed/')) return url;
      const id = u.searchParams.get('v');
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }

    return null;
  } catch (_) {
    return null;
  }
}

function toVimeoEmbed(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'player.vimeo.com' && u.pathname.startsWith('/video/')) return url;
    if (host === 'vimeo.com') {
      const id = u.pathname.split('/').filter(Boolean)[0];
      return id ? `https://player.vimeo.com/video/${id}` : null;
    }
    return null;
  } catch (_) {
    return null;
  }
}

function showVideoPlayer() {
  const videoEl = document.getElementById('video');
  const iframeEl = document.getElementById('embed');
  if (iframeEl) {
    iframeEl.classList.add('d-none');
    iframeEl.removeAttribute('src');
  }
  if (videoEl) videoEl.classList.remove('d-none');
  return videoEl;
}

function showEmbedPlayer(embedUrl) {
  const videoEl = document.getElementById('video');
  const iframeEl = document.getElementById('embed');

  if (videoEl) {
    try { videoEl.pause(); } catch (_) {}
    videoEl.classList.add('d-none');
    // best-effort: clear any previous src
    try { videoEl.removeAttribute('src'); videoEl.load(); } catch (_) {}
  }

  if (iframeEl) {
    iframeEl.classList.remove('d-none');
    iframeEl.setAttribute('src', embedUrl);
  }
}

function hideAllPlayers() {
  const videoEl = document.getElementById('video');
  const iframeEl = document.getElementById('embed');

  if (videoEl) {
    try { videoEl.pause(); } catch (_) {}
    videoEl.classList.add('d-none');
    try { videoEl.removeAttribute('src'); videoEl.load(); } catch (_) {}
  }
  if (iframeEl) {
    iframeEl.classList.add('d-none');
    iframeEl.removeAttribute('src');
  }
}

function isApiVideoUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return false;
  if (s.startsWith('/api/video/')) return true;
  try {
    const u = new URL(s);
    return u.pathname.startsWith('/api/video/');
  } catch (_) {
    return false;
  }
}

function toVideoSessionUrl(videoSrc) {
  const s = String(videoSrc || '').trim();
  if (!s) return null;
  if (s.startsWith('/')) return '/api/video/session';
  try {
    const u = new URL(s);
    return new URL('/api/video/session', u.origin).toString();
  } catch (_) {
    return null;
  }
}

// Best-effort cache to avoid spamming /api/video/session.
// Keyed by sessionUrl + token (token is already in-memory, not persisted here).
const _videoSessionCache = new Map(); // key -> expiresAt ms

async function ensureVideoSessionForSource(videoSrc, token) {
  // Only needed for our protected /api/video/* streams.
  if (!token) return;
  if (!isApiVideoUrl(videoSrc)) return;
  const sessionUrl = toVideoSessionUrl(videoSrc);
  if (!sessionUrl) return;

  // If sessionUrl is cross-origin, we need credentials so the cookie is stored for that domain.
  const isCrossOrigin = (() => {
    try {
      const u = new URL(sessionUrl, window.location.origin);
      return u.origin !== window.location.origin;
    } catch (_) {
      return false;
    }
  })();

  const cacheKey = `${sessionUrl}::${token}`;
  const cachedUntil = _videoSessionCache.get(cacheKey) || 0;
  if (Date.now() < cachedUntil) return;

  try {
    await fetch(sessionUrl, {
      method: 'POST',
      headers: token ? { 'Authorization': `Bearer ${token}` } : undefined,
      // Always include credentials so the cookie is stored even if the browser
      // treats this as cross-origin unexpectedly (hostname differences, etc).
      credentials: 'include',
      cache: 'no-store',
    });
    _videoSessionCache.set(cacheKey, Date.now() + 60_000); // 60s
  } catch (_) {
    // best-effort
  }
}

function addTokenToApiVideoUrl(rawUrl, token) {
  if (!rawUrl || !token) return rawUrl;
  try {
    const isRelative = String(rawUrl).trim().startsWith('/');
    const u = new URL(String(rawUrl), window.location.origin);
    u.searchParams.set('token', token);
    return isRelative ? `${u.pathname}${u.search}${u.hash}` : u.toString();
  } catch (_) {
    // Fallback: naive append
    const s = String(rawUrl);
    const join = s.includes('?') ? '&' : '?';
    return `${s}${join}token=${encodeURIComponent(token)}`;
  }
}

async function probeApiVideoReadable(rawUrl) {
  try {
    const res = await fetch(rawUrl, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      credentials: 'include',
      cache: 'no-store',
    });
    return res.status !== 401;
  } catch (_) {
    return true; // don't block playback if probe fails (CORS/network/etc)
  }
}

async function ensurePlayableApiVideoUrl(rawUrl, token) {
  if (!isApiVideoUrl(rawUrl) || !token) return rawUrl;
  // IMPORTANT: Prefer query-token auth for media elements.
  // Cookie-based auth is unreliable cross-origin (and even across ports in some setups)
  // and causes intermittent 401s + preflight noise. Both Node + Python servers already
  // support ?token=... so we use it consistently.
  return addTokenToApiVideoUrl(rawUrl, token);
}

async function playVodLink(vodLink, { token } = {}) {
  const raw = normalizeVodLink(vodLink);
  if (!raw) {
    showAlert('No VOD link configured for this movie.');
    setSourceLabel('—');
    return;
  }

  // Prefer known embed providers
  const yt = toYoutubeEmbed(raw);
  if (yt) {
    setSourceLabel('YouTube (embed)');
    showEmbedPlayer(yt);
    return;
  }

  const vimeo = toVimeoEmbed(raw);
  if (vimeo) {
    setSourceLabel('Vimeo (embed)');
    showEmbedPlayer(vimeo);
    return;
  }

  // App/Python protected video endpoint (no file extension, but it's still a direct <video> stream).
  if (isApiVideoUrl(raw)) {
    setSourceLabel('Server video stream (/api/video)');
    const videoEl = showVideoPlayer();
    if (!videoEl) return;
    const playable = await ensurePlayableApiVideoUrl(raw, token);
    videoEl.src = playable;
    videoEl.addEventListener('error', () => {
      // If the browser can't play it (or CORS blocks), fall back to iframe.
      setSourceLabel('Embed (fallback)');
      showEmbedPlayer(playable);
    }, { once: true });
    try { videoEl.load(); } catch (_) {}
    return;
  }

  // Direct video file
  if (looksLikeVideoFile(raw)) {
    setSourceLabel('Direct video file');
    const videoEl = showVideoPlayer();
    if (!videoEl) return;
    videoEl.src = raw;
    videoEl.addEventListener('error', () => {
      // If the browser can't play it (or CORS blocks), fall back to iframe.
      setSourceLabel('Embed (fallback)');
      showEmbedPlayer(raw);
    }, { once: true });
    try { videoEl.load(); } catch (_) {}
    return;
  }

  // HLS (.m3u8)
  if (looksLikeHls(raw)) {
    setSourceLabel('HLS stream (.m3u8)');
    const videoEl = showVideoPlayer();
    if (!videoEl) return;

    // Native HLS (Safari) first
    if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      videoEl.src = raw;
      try { videoEl.load(); } catch (_) {}
      return;
    }

    // hls.js fallback (if supported)
    if (window.Hls && window.Hls.isSupported()) {
      const hls = new window.Hls({
        enableWorker: true,
      });
      hls.loadSource(raw);
      hls.attachMedia(videoEl);
      hls.on(window.Hls.Events.ERROR, function (_evt, data) {
        if (data?.fatal) {
          try { hls.destroy(); } catch (_) {}
          setSourceLabel('Embed (fallback)');
          showEmbedPlayer(raw);
        }
      });
      return;
    }

    // Last resort
    setSourceLabel('Embed (fallback)');
    showEmbedPlayer(raw);
    return;
  }

  // Default: treat as embeddable URL
  setSourceLabel('Embed');
  showEmbedPlayer(raw);
}

function cleanUrlValue(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s : null;
}

function resolveMovieSource(movie) {
  const mode = String(movie?.player_mode || 'auto').toLowerCase();
  const legacy = cleanUrlValue(movie?.vod_link);
  const video = cleanUrlValue(movie?.video_src);
  const embed = cleanUrlValue(movie?.embed_src);
  const serverFile = cleanUrlValue(movie?.video_file);

  // Legacy should never embed in the player (open in new tab only).
  // So we only pick legacy if there is no other option, and mark it.
  let picked = null;
  const serverVideoUrl = serverFile ? `/api/video/${encodeURIComponent(String(movie?._id || ''))}` : null;

  if (mode === 'video') picked = video || serverVideoUrl || null;
  else if (mode === 'embed') picked = embed || null;
  else picked = video || serverVideoUrl || embed || null; // auto

  if (picked) return { src: picked, isLegacy: false };
  if (legacy) return { src: legacy, isLegacy: true };
  return { src: null, isLegacy: false };
}

window.onload = async function () {
  // Basic auth UX: require a valid local token (like the rest of the app).
  const token = localStorage.getItem('auth_token');
  if (!token) {
    window.location.href = '/';
    return;
  }

  // Load the active Oscar year in parallel with the movie fetch.
  const activeYearPromise = fetchActiveOscarYear();

  let decoded = null;
  try {
    decoded = decodeJwt(token);
    const currentTime = Math.floor(Date.now() / 1000);
    if (decoded.exp && decoded.exp < currentTime) {
      localStorage.removeItem('auth_token');
      window.location.href = '/';
      return;
    }
    if (decoded.mustChangePassword) {
      window.location.href = '/change-password.html';
      return;
    }
    const nameEl = document.getElementById('user-name');
    if (nameEl) nameEl.textContent = decoded.name || '';
    if (decoded.admin) {
      const adminLink = document.getElementById('admin-control-link');
      if (adminLink) adminLink.classList.remove('d-none');
    }

    const logoffBtn = document.getElementById('log-off');
    if (logoffBtn) {
      logoffBtn.addEventListener('click', function () {
        localStorage.removeItem('auth_token');
        window.location.href = '/';
      });
    }
  } catch (_) {
    localStorage.removeItem('auth_token');
    window.location.href = '/';
    return;
  }

  const id = getQueryParam('id');
  if (!id) {
    showAlert('Missing movie id.');
    return;
  }

  try {
    const res = await fetch(`/api/movies/${encodeURIComponent(id)}`, {
      method: 'GET',
      headers: token ? { 'Authorization': `Bearer ${token}` } : undefined,
    });
    const movie = await res.json().catch(() => ({}));
    if (!res.ok) {
      showAlert(movie?.message || movie?.error || `Failed to load movie (${res.status}).`);
      return;
    }

    const activeYear = await activeYearPromise;
    setHeader(movie, { activeYear });

    const resolved = resolveMovieSource(movie);
    if (!resolved?.src) {
      setSourceLabel('—');
      hideAllPlayers();
      showAlert('No playable source configured for this movie.');
      return;
    }

    // We use ?token=... for /api/video/* playback (more reliable than cookies cross-origin).

    if (resolved.isLegacy) {
      // Legacy source: never embed it in the player.
      setSourceLabel('Legacy link');
      hideAllPlayers();
      showAlertVariant('Legacy source: this link is not playable in the in-app player.', 'warning');
      return;
    }

    await playVodLink(resolved.src, { token });

    // Only the <video> player supports reliable progress tracking (mp4/hls).
    const videoEl = document.getElementById('video');
    if (videoEl && !videoEl.classList.contains('d-none')) {
      setProgressUi({ state: 'preparing', text: 'Reprise', showText: true, ariaText: 'Prépare la reprise…' });
      const userId = normalizeUserId(decoded);
      if (userId) {
        setupVideoProgress({ videoEl, movieId: id, token, userId, imdbId: movie?.imdb_id });
      } else {
        // Avoid a "stuck" progress state if the token payload is unexpected.
        setProgressUi({ state: 'warning', text: '—', showText: true, ariaText: "Impossible d'identifier l'utilisateur pour sauvegarder la progression." });
      }
    } else {
      setProgressUi({ state: 'info', text: '—', showText: true });
    }
  } catch (err) {
    showAlert(err.message || 'Network error.');
  }
};

