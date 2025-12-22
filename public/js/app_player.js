function decodeJwt(token) {
  return JSON.parse(atob(token.split('.')[1]));
}

function safeJsonParse(v) {
  try { return JSON.parse(v); } catch (_) { return null; }
}

function progressStorageKey(userId, movieId) {
  return `playback_progress:${String(userId || '')}:${String(movieId || '')}`;
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

async function savePlaybackProgress(movieId, token, { time, duration, keepalive } = {}) {
  try {
    // Retry once on rare upsert races (409).
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const res = await fetch(`/api/movies/${encodeURIComponent(movieId)}/progress`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ time, duration }),
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

function setupVideoProgress({ videoEl, movieId, token, userId }) {
  if (!videoEl || !movieId || !token || !userId) return () => {};

  const key = progressStorageKey(userId, movieId);
  let restored = false;
  let intervalId = null;
  let lastSavedAt = 0;
  let lastSavedTime = -1;
  let lastSaveStatus = '—';

  function getSnapshot() {
    const t = Number(videoEl.currentTime);
    const d = Number(videoEl.duration);
    return {
      // Use whole seconds to keep saved values stable.
      time: Number.isFinite(t) && t >= 0 ? Math.floor(t) : 0,
      duration: Number.isFinite(d) && d > 0 ? Math.floor(d) : null,
    };
  }

  async function restoreProgressOnce() {
    if (restored) return;
    restored = true;

    // Prefer server progress, fall back to localStorage if offline.
    const server = await fetchPlaybackProgress(movieId, token);
    let targetTime = server?.time ?? 0;

    if (!Number.isFinite(targetTime) || targetTime < 0) targetTime = 0;
    if (targetTime <= 1) {
      const local = safeJsonParse(localStorage.getItem(key));
      const lt = Number(local?.time);
      if (Number.isFinite(lt) && lt > 1) targetTime = lt;
    }

    const dur = Number(videoEl.duration);
    if (!Number.isFinite(dur) || dur <= 0) return;

    // Clamp to avoid seeking beyond the end.
    const clamped = Math.min(Math.max(targetTime, 0), Math.max(0, dur - 3));
    if (clamped > 1) {
      try { videoEl.currentTime = clamped; } catch (_) {}
      lastSaveStatus = `Reprise à ${formatClock(clamped)}.`;
      setProgressStatus(lastSaveStatus);
    } else {
      lastSaveStatus = 'Lecture depuis le début.';
      setProgressStatus(lastSaveStatus);
    }
  }

  async function persist({ keepalive, force } = {}) {
    // Throttle to avoid spamming the API
    const now = Date.now();
    if (!force && !keepalive && now - lastSavedAt < 3000) return;

    const snap = getSnapshot();
    if (!Number.isFinite(snap.time)) return;

    // Only save if it meaningfully changed (>= 1s)
    if (lastSavedTime >= 0 && Math.abs(snap.time - lastSavedTime) < 1) return;

    lastSavedAt = now;
    lastSavedTime = snap.time;

    try {
      localStorage.setItem(key, JSON.stringify({ time: snap.time, duration: snap.duration, at: now }));
    } catch (_) {}

    setProgressStatus('Sauvegarde…');
    const ok = await savePlaybackProgress(movieId, token, { ...snap, keepalive: !!keepalive });
    if (ok === false) {
      // Token expired mid-playback; stop spamming requests and prompt user.
      stopInterval();
      try { localStorage.removeItem('auth_token'); } catch (_) {}
      lastSaveStatus = 'Connexion requise pour sauvegarder.';
      setProgressStatus(lastSaveStatus);
      showAlertVariant('Session expirée. Reconnecte-toi pour continuer à sauvegarder la progression.', 'warning');
      return;
    }
    lastSaveStatus = `Sauvegardé à ${formatClock(snap.time)}.`;
    setProgressStatus(lastSaveStatus);
  }

  function startInterval() {
    if (intervalId) return;
    // Safety-net; primary saving happens via timeupdate throttling.
    intervalId = window.setInterval(() => {
      if (videoEl.paused || videoEl.seeking) return;
      void persist();
    }, 15000);
  }

  function stopInterval() {
    if (!intervalId) return;
    window.clearInterval(intervalId);
    intervalId = null;
  }

  const onPlay = () => startInterval();
  const onPause = () => { stopInterval(); void persist({ force: true }); };
  const onSeeked = () => { void persist({ force: true }); };
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

  videoEl.addEventListener('loadedmetadata', restoreProgressOnce, { once: true });
  videoEl.addEventListener('play', onPlay);
  videoEl.addEventListener('pause', onPause);
  videoEl.addEventListener('seeked', onSeeked);
  videoEl.addEventListener('ended', onEnded);
  videoEl.addEventListener('error', onError);
  videoEl.addEventListener('timeupdate', onTimeUpdate);

  window.addEventListener('pagehide', onPageHide);
  document.addEventListener('visibilitychange', onVisibility);

  // If metadata is already available, try immediately.
  if (videoEl.readyState >= 1) void restoreProgressOnce();

  return () => {
    stopInterval();
    videoEl.removeEventListener('play', onPlay);
    videoEl.removeEventListener('pause', onPause);
    videoEl.removeEventListener('seeked', onSeeked);
    videoEl.removeEventListener('ended', onEnded);
    videoEl.removeEventListener('error', onError);
    videoEl.removeEventListener('timeupdate', onTimeUpdate);
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
  const el = document.getElementById('progress-status');
  if (!el) return;
  el.textContent = text || '—';
}

function formatClock(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function setHeader(movie) {
  const titleEl = document.getElementById('movie-title');
  const categoryEl = document.getElementById('movie-category');
  const ratingEl = document.getElementById('movie-rating');

  if (titleEl) titleEl.textContent = movie?.title || 'Player';

  if (categoryEl) {
    const cat = movie?.category ? String(movie.category) : '';
    categoryEl.textContent = cat ? `${cat} · ` : '';
  }

  if (ratingEl) {
    const r = movie?.rating ? String(movie.rating) : '';
    ratingEl.textContent = r ? `⭐ ${r}` : '';
  }

  document.title = movie?.title ? `Player - ${movie.title}` : 'Player';
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

function setOpenOriginal(raw) {
  const openOriginal = document.getElementById('open-original');
  if (!openOriginal) return;
  if (raw) {
    openOriginal.href = raw;
    openOriginal.classList.remove('d-none');
  } else {
    openOriginal.removeAttribute('href');
    openOriginal.classList.add('d-none');
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

  try {
    await fetch(sessionUrl, {
      method: 'POST',
      headers: token ? { 'Authorization': `Bearer ${token}` } : undefined,
      ...(isCrossOrigin ? { credentials: 'include' } : {}),
    });
  } catch (_) {
    // best-effort
  }
}

async function playVodLink(vodLink) {
  const raw = normalizeVodLink(vodLink);
  if (!raw) {
    showAlert('No VOD link configured for this movie.');
    setSourceLabel('—');
    return;
  }

  // "Open original" button
  setOpenOriginal(raw);

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
    videoEl.src = raw;
    videoEl.addEventListener('error', () => {
      // If the browser can't play it (or CORS blocks), fall back to iframe.
      setSourceLabel('Embed (fallback)');
      showEmbedPlayer(raw);
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

    setHeader(movie);

    const resolved = resolveMovieSource(movie);
    if (!resolved?.src) {
      setOpenOriginal(null);
      setSourceLabel('—');
      hideAllPlayers();
      showAlert('No playable source configured for this movie.');
      return;
    }

    // Allow <video> to call protected /api/video/* sources without Authorization headers by using a cookie.
    // If the source is on a different origin (Python video host), we call THAT host’s /api/video/session.
    await ensureVideoSessionForSource(resolved.src, token);

    if (resolved.isLegacy) {
      // Legacy source: never embed it in the player.
      setOpenOriginal(resolved.src);
      setSourceLabel('Legacy link (opens in new tab)');
      hideAllPlayers();
      showAlertVariant('Legacy source: use “Open original” to watch in a new tab.', 'warning');
      return;
    }

    await playVodLink(resolved.src);

    // Only the <video> player supports reliable progress tracking (mp4/hls).
    const videoEl = document.getElementById('video');
    if (videoEl && !videoEl.classList.contains('d-none')) {
      setProgressStatus('Prépare la reprise…');
      setupVideoProgress({ videoEl, movieId: id, token, userId: decoded?.id });
    } else {
      setProgressStatus('—');
    }
  } catch (err) {
    showAlert(err.message || 'Network error.');
  }
};

