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
  el.classList.remove('d-none');
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

async function playVodLink(vodLink) {
  const raw = normalizeVodLink(vodLink);
  if (!raw) {
    showAlert('No VOD link configured for this movie.');
    setSourceLabel('—');
    return;
  }

  // "Open original" button
  const openOriginal = document.getElementById('open-original');
  if (openOriginal) {
    openOriginal.href = raw;
    openOriginal.classList.remove('d-none');
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
    const nameEl = document.getElementById('player-user-name');
    if (nameEl) nameEl.textContent = decoded.name || '';
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
    const res = await fetch(`/api/movies/${encodeURIComponent(id)}`, { method: 'GET' });
    const movie = await res.json().catch(() => ({}));
    if (!res.ok) {
      showAlert(movie?.message || movie?.error || `Failed to load movie (${res.status}).`);
      return;
    }

    setHeader(movie);
    await playVodLink(movie?.vod_link);
  } catch (err) {
    showAlert(err.message || 'Network error.');
  }
};

