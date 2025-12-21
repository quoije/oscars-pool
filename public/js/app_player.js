function decodeJwt(token) {
  return JSON.parse(atob(token.split('.')[1]));
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
  return /\.(mp4|mkv|webm|ogg|ogv|mov|m4v)(\?|#|$)/.test(s);
}

function getAuthToken() {
  return localStorage.getItem('auth_token');
}

function withAuthTokenQuery(url) {
  const token = getAuthToken();
  if (!token) return url;
  try {
    const u = new URL(url, window.location.origin);
    const p = u.pathname || '';
    // Only attach tokens to our python video endpoints.
    if (!(p.startsWith('/media/') || p.startsWith('/hls/'))) return url;
    if (!u.searchParams.has('token')) u.searchParams.set('token', token);
    return u.toString();
  } catch (_) {
    return url;
  }
}

function isMkv(url) {
  try {
    const u = new URL(url, window.location.origin);
    return u.pathname.toLowerCase().endsWith('.mkv');
  } catch (_) {
    return /\.mkv(\?|#|$)/i.test(String(url || ''));
  }
}

async function tryGetGeneratedHlsPlaylist(rawUrl) {
  // Only supports the python server's /media/<path> URLs.
  try {
    const u = new URL(rawUrl, window.location.origin);
    if (!u.pathname.startsWith('/media/')) return null;
    const rel = decodeURIComponent(u.pathname.slice('/media/'.length));
    if (!rel) return null;

    const api = new URL('/api/hls', u.origin);
    api.searchParams.set('source', rel);
    const token = getAuthToken();
    const res = await fetch(api.toString(), {
      method: 'GET',
      headers: token ? { 'Authorization': `Bearer ${token}` } : undefined,
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const playlist = data?.playlist_abs_url || data?.playlist_url;
    if (!playlist) return null;
    const abs = playlist.startsWith('http') ? playlist : new URL(playlist, u.origin).toString();
    return withAuthTokenQuery(abs);
  } catch (_) {
    return null;
  }
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

async function playVodLink(vodLink) {
  const raw = normalizeVodLink(vodLink);
  if (!raw) {
    showAlert('No VOD link configured for this movie.');
    setSourceLabel('—');
    return;
  }

  // "Open original" button
  setOpenOriginal(withAuthTokenQuery(raw));

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

  // Direct video file
  if (looksLikeVideoFile(raw)) {
    // MKV is commonly not playable in browsers; try HLS generation first if it's from our python server.
    if (isMkv(raw)) {
      const playlist = await tryGetGeneratedHlsPlaylist(raw);
      if (playlist) {
        setSourceLabel('HLS (generated)');
        return await playVodLink(playlist);
      }
    }

    setSourceLabel('Direct video file');
    const videoEl = showVideoPlayer();
    if (!videoEl) return;
    videoEl.src = withAuthTokenQuery(raw);
    videoEl.addEventListener('error', () => {
      // If the browser can't play it (or CORS blocks), try HLS from the python server, then fall back to iframe.
      (async () => {
        const playlist = await tryGetGeneratedHlsPlaylist(raw);
        if (playlist) {
          setSourceLabel('HLS (generated)');
          await playVodLink(playlist);
          return;
        }
        setSourceLabel('Embed (fallback)');
        showEmbedPlayer(raw);
      })();
    }, { once: true });
    try { videoEl.load(); } catch (_) {}
    return;
  }

  // HLS (.m3u8)
  if (looksLikeHls(raw)) {
    setSourceLabel('HLS stream (.m3u8)');
    const videoEl = showVideoPlayer();
    if (!videoEl) return;
    const hlsUrl = withAuthTokenQuery(raw);

    // Native HLS (Safari) first
    if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      videoEl.src = hlsUrl;
      try { videoEl.load(); } catch (_) {}
      return;
    }

    // hls.js fallback (if supported)
    if (window.Hls && window.Hls.isSupported()) {
      const hls = new window.Hls({
        enableWorker: true,
      });
      hls.loadSource(hlsUrl);
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

  // Legacy should never embed in the player (open in new tab only).
  // So we only pick legacy if there is no other option, and mark it.
  let picked = null;
  if (mode === 'video') picked = video || null;
  else if (mode === 'embed') picked = embed || null;
  else picked = video || embed || null; // auto

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

  try {
    const decoded = decodeJwt(token);
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

    if (resolved.isLegacy) {
      // Legacy source: never embed it in the player.
      setOpenOriginal(resolved.src);
      setSourceLabel('Legacy link (opens in new tab)');
      hideAllPlayers();
      showAlertVariant('Legacy source: use “Open original” to watch in a new tab.', 'warning');
      return;
    }

    await playVodLink(resolved.src);
  } catch (err) {
    showAlert(err.message || 'Network error.');
  }
};

