const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const Movie = require("../models/Movie");
const MovieRating = require("../models/MovieRating");
const User = require("../models/User");
const PlaybackProgress = require("../models/PlaybackProgress");
const axios = require("axios");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const authenticate = require("../middleware/authMiddleware");

const router = express.Router();

// Small in-memory cache to reduce repeated DB reads on slow networks (Render).
// This is safe because movie lists are identical for all users and change rarely.
const MOVIES_CACHE_TTL_MS = Number(process.env.MOVIES_CACHE_TTL_MS || "30000"); // 30s
const _cache = new Map(); // key -> { expiresAt:number, value:any }
const SUBTITLE_FILES_DIR = path.resolve(process.env.SUBTITLE_FILES_DIR || path.join(process.cwd(), "subtitles"));
const MAX_SUBTITLE_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB

function cacheGet(key) {
  const hit = _cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    _cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value) {
  _cache.set(key, { expiresAt: Date.now() + MOVIES_CACHE_TTL_MS, value });
}

function cacheClear() {
  _cache.clear();
}

function parseOscarYear(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n)) return null;
  if (n < 1900 || n > 3000) return null;
  return n;
}

function isValidImdbId(value) {
  return typeof value === "string" && /^tt\d{5,}$/.test(value.trim());
}

function normalizeOptionalString(v, maxLen = 2048) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = String(v).trim();
  if (!s) return "";
  return s.slice(0, maxLen);
}

function normalizeVideoFile(v) {
  // Stored as a relative path (no leading slash) like: "my_movie.mp4" or "2026/my_movie.mp4"
  // Backend streaming endpoint enforces traversal protection too.
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = String(v).trim();
  if (!s) return "";
  return s.slice(0, 1024);
}

function normalizeSubtitleLang(v) {
  return normalizeOptionalString(v, 24);
}

function normalizeSubtitleLabel(v) {
  return normalizeOptionalString(v, 80);
}

function parseSubtitleDefault(v) {
  if (v === undefined) return undefined;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (!s) return undefined;
  if (["true", "1", "yes", "on"].includes(s)) return true;
  if (["false", "0", "no", "off"].includes(s)) return false;
  return undefined;
}

function parseBooleanFlag(v) {
  if (v === undefined) return undefined;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (!s) return undefined;
  if (["true", "1", "yes", "on"].includes(s)) return true;
  if (["false", "0", "no", "off"].includes(s)) return false;
  return undefined;
}

function parseFiveStarRating(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded < 1 || rounded > 5) return null;
  return rounded;
}

function normalizeSubtitleEntry({ file, lang, label, isDefault } = {}) {
  const safeFile = typeof file === "string" ? file.trim() : "";
  if (!safeFile) return null;
  return {
    file: safeFile,
    lang: normalizeSubtitleLang(lang) || null,
    label: normalizeSubtitleLabel(label) || null,
    default: !!isDefault,
  };
}

function getLegacySubtitle(movie) {
  const file = typeof movie?.subtitle_file === "string" ? movie.subtitle_file.trim() : "";
  if (!file) return null;
  return {
    _id: "legacy",
    file,
    lang: typeof movie?.subtitle_lang === "string" ? movie.subtitle_lang : null,
    label: typeof movie?.subtitle_label === "string" ? movie.subtitle_label : null,
    default: !!movie?.subtitle_default,
  };
}

function getSubtitlesForResponse(movie) {
  const subs = Array.isArray(movie?.subtitles) ? movie.subtitles.filter(Boolean) : [];
  if (subs.length > 0) return subs;
  const legacy = getLegacySubtitle(movie);
  return legacy ? [legacy] : [];
}

function syncLegacyFromSubtitles(movie) {
  const subs = Array.isArray(movie?.subtitles) ? movie.subtitles : [];
  if (!subs.length) {
    movie.subtitle_file = null;
    movie.subtitle_lang = null;
    movie.subtitle_label = null;
    movie.subtitle_default = false;
    return;
  }
  const preferred = subs.find((s) => s?.default) || subs[0];
  movie.subtitle_file = preferred?.file || null;
  movie.subtitle_lang = preferred?.lang || null;
  movie.subtitle_label = preferred?.label || null;
  movie.subtitle_default = !!preferred?.default;
}

async function ensureSubtitleDir() {
  await fs.promises.mkdir(SUBTITLE_FILES_DIR, { recursive: true });
}

function safeFilenameBase(raw) {
  return String(raw || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) || "movie";
}

const subtitleUpload = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, cb) => {
      try {
        await ensureSubtitleDir();
        cb(null, SUBTITLE_FILES_DIR);
      } catch (err) {
        cb(err);
      }
    },
    filename: (req, file, cb) => {
      const safeId = safeFilenameBase(req.params?.id);
      const ext = path.extname(file.originalname || "").toLowerCase() || ".vtt";
      const name = `${safeId}-${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`;
      cb(null, name);
    },
  }),
  limits: { fileSize: MAX_SUBTITLE_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (ext !== ".vtt" && ext !== ".srt") return cb(new Error("Only .srt or .vtt subtitle files are allowed"));
    return cb(null, true);
  },
});

async function convertSrtToVtt(filePath) {
  const content = await fs.promises.readFile(filePath, "utf8");
  const normalized = content.replace(/\r\n/g, "\n");
  const body = normalized.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
  const positioned = body.replace(
    /^(\d{2}:\d{2}:\d{2}\.\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}\.\d{3})(.*)$/gm,
    (_match, timing, settings) => {
      const tail = String(settings || "");
      if (/\bline:/i.test(tail)) return `${timing}${tail}`;
      return `${timing}${tail} line:90%`;
    },
  );
  const vtt = `WEBVTT\n\n${positioned.trim()}\n`;
  const vttPath = filePath.replace(/\.srt$/i, ".vtt");
  await fs.promises.writeFile(vttPath, vtt, "utf8");
  try { await fs.promises.unlink(filePath); } catch (_) {}
  return vttPath;
}

function normalizePlayerMode(v) {
  const s = String(v || "").trim().toLowerCase();
  if (!s) return "auto";
  if (s === "auto" || s === "video" || s === "embed") return s;
  return null;
}

function hasAnySource({ vod_link, video_src, embed_src }) {
  const a = typeof vod_link === "string" ? vod_link.trim() : "";
  const b = typeof video_src === "string" ? video_src.trim() : "";
  const c = typeof embed_src === "string" ? embed_src.trim() : "";
  return !!(a || b || c);
}

function hasAnySourceIncludingFile({ vod_link, video_src, embed_src, video_file }) {
  const a = typeof vod_link === "string" ? vod_link.trim() : "";
  const b = typeof video_src === "string" ? video_src.trim() : "";
  const c = typeof embed_src === "string" ? embed_src.trim() : "";
  const d = typeof video_file === "string" ? video_file.trim() : "";
  return !!(a || b || c || d);
}

// Fetch movie details from OMDb API
async function fetchMovieDetailsFromOmdb(imdb_id) {
  const apiKey = typeof process.env.OMDB_API === "string" ? process.env.OMDB_API.trim() : "";
  if (!apiKey) {
    const err = new Error("OMDb n'est pas configuré (env OMDB_API manquante).");
    err.code = "OMDB_NOT_CONFIGURED";
    throw err;
  }
  const omdbUrl = `https://www.omdbapi.com/?i=${encodeURIComponent(imdb_id)}&apikey=${apiKey}`;
  
  try {
    const response = await axios.get(omdbUrl);
    if (response.data.Response === "True") {
      return {
        title: response.data.Title,
        description: response.data.Plot,
        rating: response.data.imdbRating,
        runtime: response.data.Runtime,
        poster: response.data.Poster
      };
    } else {
      throw new Error('Movie not found on OMDb API');
    }
  } catch (error) {
    throw new Error(`Error fetching movie details: ${error.message}`);
  }
}

// Get available Oscar years (distinct years from movies)
router.get("/years", async (req, res) => {
  try {
    const cacheKey = "movies:years";
    const cached = cacheGet(cacheKey);
    if (cached) {
      res.set("Cache-Control", "public, max-age=60");
      return res.status(200).json(cached);
    }

    const years = await Movie.distinct("year");
    const cleaned = years
      .filter((y) => typeof y === "number" && Number.isFinite(y))
      .sort((a, b) => b - a);

    cacheSet(cacheKey, cleaned);
    res.set("Cache-Control", "public, max-age=60");
    res.status(200).json(cleaned);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all movies
router.get("/", async (req, res) => {
  try {
    const year = parseOscarYear(req.query.year);
    const filter = year ? { year } : {};

    // Clients:
    // - films page needs details (poster, description, player sources)
    // - checklist page only needs imdb_id + title
    const view = String(req.query.view || "").trim().toLowerCase();
    const isChecklist = view === "checklist" || view === "compact";

    const projection = isChecklist
      ? "imdb_id title"
      : "imdb_id title description rating runtime poster cam year category vod_link player_mode video_src embed_src video_file video_file_low subtitles subtitle_file subtitle_lang subtitle_label subtitle_default updatedAt createdAt";

    const cacheKey = `movies:list:${year || "all"}:${isChecklist ? "checklist" : "films"}`;
    const cached = cacheGet(cacheKey);

    let basePayload = cached;
    if (!basePayload) {
      const movies = await Movie.find(filter)
        .select(projection)
        .sort({ title: 1 })
        .lean();
      basePayload = movies.map((m) => ({ ...m, subtitles: getSubtitlesForResponse(m) }));
      cacheSet(cacheKey, basePayload);
    }

    if (isChecklist) {
      res.set("Cache-Control", "public, max-age=30");
      return res.status(200).json(basePayload);
    }

    const movieIds = basePayload.map((m) => m?._id).filter(Boolean);
    const ratingsAgg = movieIds.length
      ? await MovieRating.aggregate([
          { $match: { movieId: { $in: movieIds } } },
          { $group: { _id: "$movieId", avgRating: { $avg: "$rating" }, count: { $sum: 1 } } },
        ])
      : [];

    const ratingsByMovieId = new Map(
      (ratingsAgg || []).map((r) => [String(r._id), { avgRating: r.avgRating, count: r.count }])
    );

    let userId = null;
    const token = req.headers.authorization?.split(" ")[1];
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded?.id) userId = decoded.id;
      } catch (_) {}
    }

    let userRatingsByMovieId = new Map();
    if (userId && movieIds.length) {
      const userRatings = await MovieRating.find({ userId, movieId: { $in: movieIds } })
        .select("movieId rating")
        .lean();
      userRatingsByMovieId = new Map(
        (userRatings || []).map((r) => [String(r.movieId), r.rating])
      );
    }

    const payload = basePayload.map((m) => {
      const key = String(m?._id || "");
      const agg = ratingsByMovieId.get(key);
      const userRating = userRatingsByMovieId.get(key);
      return {
        ...m,
        user_rating_avg: agg && typeof agg.avgRating === "number" ? Number(agg.avgRating.toFixed(2)) : null,
        user_rating_count: agg && typeof agg.count === "number" ? agg.count : 0,
        user_rating: typeof userRating === "number" ? userRating : null,
      };
    });

    res.set("Cache-Control", "public, max-age=30");
    res.status(200).json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get latest movie update/add timestamp
router.get("/last-update", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Token is required" });

  try {
    jwt.verify(token, process.env.JWT_SECRET);

    const year = parseOscarYear(req.query.year);
    const filter = year ? { year } : {};

    const cacheKey = `movies:last-update:${year || "all"}`;
    const cached = cacheGet(cacheKey);
    if (cached) {
      res.set("Cache-Control", "public, max-age=30");
      return res.status(200).json(cached);
    }

    const latestMovie = await Movie.findOne(filter)
      .select("updatedAt createdAt")
      .sort({ updatedAt: -1, createdAt: -1, _id: -1 })
      .lean();
    if (!latestMovie) {
      return res.status(200).json({ lastUpdated: null });
    }

    const lastUpdated =
      latestMovie.updatedAt ||
      latestMovie.createdAt ||
      (typeof latestMovie._id?.getTimestamp === "function" ? latestMovie._id.getTimestamp() : null);

    const payload = { lastUpdated: lastUpdated ? new Date(lastUpdated).toISOString() : null };
    cacheSet(cacheKey, payload);
    res.set("Cache-Control", "public, max-age=30");
    return res.status(200).json(payload);
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }
    return res.status(500).json({ error: error.message });
  }
});

// Get lightweight per-year summary for fast UI (counts, watched-in-year, last update)
router.get("/summary", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Token is required" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const year = parseOscarYear(req.query.year);
    const filter = year ? { year } : {};

    // Base (year-wide) data can be cached (not user-specific).
    const cacheKey = `movies:summary-base:${year || "all"}`;
    let base = cacheGet(cacheKey);

    if (!base) {
      const [idDocs, latestMovie] = await Promise.all([
        Movie.find(filter).select("imdb_id").lean(),
        Movie.findOne(filter)
          .select("updatedAt createdAt")
          .sort({ updatedAt: -1, createdAt: -1, _id: -1 })
          .lean(),
      ]);

      const imdbIds = idDocs.map((d) => d.imdb_id).filter(Boolean);
      const imdbIdSet = new Set(imdbIds);

      const lastUpdated =
        latestMovie?.updatedAt ||
        latestMovie?.createdAt ||
        (typeof latestMovie?._id?.getTimestamp === "function" ? latestMovie._id.getTimestamp() : null);

      base = {
        year: year || null,
        totalMoviesCount: imdbIds.length,
        imdbIds,
        // Store ISO string so it's JSON-safe + stable
        lastUpdated: lastUpdated ? new Date(lastUpdated).toISOString() : null,
      };

      // Avoid storing a Set in cache (non-serializable and not needed elsewhere)
      cacheSet(cacheKey, base);
    }

    const user = await User.findById(decoded.id).select("watchedMovies").lean();
    if (!user) return res.status(404).json({ message: "User not found" });

    const imdbIdSet = new Set(base.imdbIds || []);
    const watchedMoviesAll = Array.isArray(user.watchedMovies) ? user.watchedMovies : [];
    const watchedMoviesInYear = watchedMoviesAll.filter((wm) => imdbIdSet.has(wm.imdb_id));

    // Since this is user-specific, don't encourage shared caching.
    res.set("Cache-Control", "private, max-age=5");
    return res.status(200).json({
      year: base.year,
      totalMoviesCount: base.totalMoviesCount,
      watchedMoviesCount: watchedMoviesInYear.length,
      watchedMovies: watchedMoviesInYear,
      lastUpdated: base.lastUpdated,
    });
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }
    return res.status(500).json({ error: error.message });
  }
});

// Get watched movies for the user
router.get("/watchedMovies", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1]; // Get token from header
  if (!token) return res.status(401).json({ message: "Token is required" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET); // Verify token
    const user = await User.findById(decoded.id).select("watchedMovies").lean(); // Get user by ID
    if (!user) return res.status(404).json({ message: "User not found" });

    // User-specific: never allow shared/proxy caching.
    res.set("Cache-Control", "private, no-store, must-revalidate");
    res.set("Vary", "Authorization");
    res.status(200).json(user.watchedMovies); // Return the list of watched movies
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update watched movies for the user
router.patch("/users/updateWatchedMovies", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1]; // Get token from header
  if (!token) return res.status(401).json({ message: "Token is required" });

  const { imdb_id, isChecked } = req.body;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET); // Verify token
    const user = await User.findById(decoded.id); // Get user by ID
    if (!user) return res.status(404).json({ message: "User not found" });

    if (isChecked) {
      // Add movie to watchedMovies with the watched date if not already added
      const movieIndex = user.watchedMovies.findIndex(movie => movie.imdb_id === imdb_id);
      if (movieIndex === -1) {
        user.watchedMovies.push({ imdb_id, watchedDate: new Date() });
      }
    } else {
      // Remove movie from watchedMovies array
      user.watchedMovies = user.watchedMovies.filter(movie => movie.imdb_id !== imdb_id);
    }

    await user.save(); // Save updated user
    res.status(200).json({ message: "Watched movies updated successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// Add movie
router.post("/add", async (req, res) => {
  const {
    imdb_id,
    category,
    vod_link,
    year,
    player_mode,
    video_src,
    embed_src,
    video_file,
    video_file_low,
    subtitle_lang,
    subtitle_label,
    subtitle_default,
    cam,
  } = req.body;

  try {
    // Get the token from the Authorization header
    const token = req.headers.authorization?.split(" ")[1];
    
    if (!token) {
      return res.status(401).json({ message: "Authentication token is required" });
    }

    // Verify and decode the token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Check if the user is an admin
    if (!decoded.admin) {
      return res.status(403).json({ message: "You do not have admin privileges" });
    }

    const parsedYear = parseOscarYear(year);
    if (!parsedYear) {
      return res.status(400).json({ message: "Année invalide (ex: 2026)" });
    }

    const normalizedVod = normalizeOptionalString(vod_link, 4096);
    const normalizedVideo = normalizeOptionalString(video_src, 4096);
    const normalizedEmbed = normalizeOptionalString(embed_src, 20000);
    const normalizedFile = normalizeVideoFile(video_file);
    const normalizedLowFile = normalizeVideoFile(video_file_low);
    const normalizedMode = normalizePlayerMode(player_mode);
    if (normalizedMode === null) {
      return res.status(400).json({ message: "player_mode invalide (auto|video|embed)" });
    }
    const normalizedSubtitleLang = normalizeSubtitleLang(subtitle_lang);
    const normalizedSubtitleLabel = normalizeSubtitleLabel(subtitle_label);
    const normalizedSubtitleDefault = parseSubtitleDefault(subtitle_default) ?? false;

    // Fetch movie details from OMDb API
    let movieDetails;
    try {
      movieDetails = await fetchMovieDetailsFromOmdb(imdb_id);
    } catch (err) {
      // If OMDb isn't configured, keep the feature usable: add with placeholders so admin can fill manually later.
      if (err?.code === "OMDB_NOT_CONFIGURED") {
        movieDetails = {
          title: String(imdb_id || "").trim() || "Untitled",
          description: "",
          rating: "",
          runtime: "",
          poster: ""
        };
      } else {
        throw err;
      }
    }
    
    // Proceed with adding the movie
    const movie = new Movie({
      imdb_id,
      title: movieDetails.title,
      description: movieDetails.description,
      rating: movieDetails.rating,
      runtime: movieDetails.runtime,
      poster: movieDetails.poster,
      cam: !!cam,
      year: parsedYear,
      category,
      vod_link: normalizedVod || undefined,
      player_mode: normalizedMode,
      video_src: normalizedVideo || undefined,
      embed_src: normalizedEmbed || undefined,
      video_file: normalizedFile || undefined,
      video_file_low: normalizedLowFile || undefined,
      subtitle_lang: normalizedSubtitleLang || undefined,
      subtitle_label: normalizedSubtitleLabel || undefined,
      subtitle_default: normalizedSubtitleDefault,
    });

    await movie.save();

    // Convenience: if admin provided a server video_file but no video_src, auto-wire video_src to our streaming endpoint.
    if ((normalizedFile || "").trim() && !String(movie.video_src || "").trim()) {
      movie.video_src = `/api/video/${movie._id}`;
      await movie.save();
    }
    cacheClear();

    res.status(201).json({ message: "Movie added successfully!", movie });
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }
    res.status(400).json({ error: err.message });
  }
});

// Admin: upload subtitles for a movie (VTT)
router.post("/:id/subtitles", (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Authentication token is required" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.admin) {
      return res.status(403).json({ message: "You do not have admin privileges" });
    }
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }
    return res.status(500).json({ error: err.message });
  }

  subtitleUpload.single("subtitle")(req, res, async (err) => {
    if (err) {
      const isSize = err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE";
      return res.status(isSize ? 413 : 400).json({ message: err.message || "Upload failed" });
    }

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      if (req.file?.path) {
        try { await fs.promises.unlink(req.file.path); } catch (_) {}
      }
      return res.status(400).json({ message: "Invalid movie id" });
    }

    const movie = await Movie.findById(id);
    if (!movie) {
      if (req.file?.path) {
        try { await fs.promises.unlink(req.file.path); } catch (_) {}
      }
      return res.status(404).json({ message: "Movie not found" });
    }

    if (!req.file?.path) {
      return res.status(400).json({ message: "No subtitle file uploaded" });
    }

    let storedPath = req.file.path;
    if (storedPath.toLowerCase().endsWith(".srt")) {
      try {
        storedPath = await convertSrtToVtt(storedPath);
      } catch (e) {
        return res.status(400).json({ message: "Failed to convert .srt to .vtt" });
      }
    }

    if (!Array.isArray(movie.subtitles)) movie.subtitles = [];
    if (movie.subtitles.length === 0) {
      const legacy = normalizeSubtitleEntry({
        file: movie.subtitle_file,
        lang: movie.subtitle_lang,
        label: movie.subtitle_label,
        isDefault: movie.subtitle_default,
      });
      if (legacy) movie.subtitles.push(legacy);
    }

    const rel = path.relative(SUBTITLE_FILES_DIR, storedPath).replace(/\\/g, "/");
    const incomingLang = normalizeSubtitleLang(req.body?.subtitle_lang);
    const incomingLabel = normalizeSubtitleLabel(req.body?.subtitle_label);
    const incomingDefault = parseSubtitleDefault(req.body?.subtitle_default);

    const shouldDefault = incomingDefault !== undefined
      ? incomingDefault
      : movie.subtitles.length === 0;

    if (shouldDefault) {
      movie.subtitles.forEach((s) => { s.default = false; });
    }

    const entry = normalizeSubtitleEntry({
      file: rel,
      lang: incomingLang,
      label: incomingLabel,
      isDefault: shouldDefault,
    });
    if (entry) movie.subtitles.push(entry);

    syncLegacyFromSubtitles(movie);
    await movie.save();
    cacheClear();
    return res.status(200).json(movie);
  });
});

// Admin: delete one subtitle track from a movie
router.delete("/:id/subtitles/:subtitleId", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Authentication token is required" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.admin) {
      return res.status(403).json({ message: "You do not have admin privileges" });
    }
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }
    return res.status(500).json({ error: err.message });
  }

  const { id, subtitleId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: "Invalid movie id" });
  }

  const movie = await Movie.findById(id);
  if (!movie) return res.status(404).json({ message: "Movie not found" });

  if (subtitleId === "legacy") {
    const existing = typeof movie.subtitle_file === "string" ? movie.subtitle_file.trim() : "";
    if (!existing) return res.status(404).json({ message: "Subtitle not found" });
    const oldPath = path.resolve(SUBTITLE_FILES_DIR, existing);
    if (oldPath.startsWith(SUBTITLE_FILES_DIR + path.sep)) {
      try { await fs.promises.unlink(oldPath); } catch (_) {}
    }
    movie.subtitle_file = null;
    movie.subtitle_lang = null;
    movie.subtitle_label = null;
    movie.subtitle_default = false;
    await movie.save();
    cacheClear();
    return res.status(200).json(movie);
  }

  const subs = Array.isArray(movie.subtitles) ? movie.subtitles : [];
  const idx = subs.findIndex((s) => String(s?._id || "") === String(subtitleId));
  if (idx < 0) {
    return res.status(404).json({ message: "Subtitle not found" });
  }

  const removed = subs[idx];
  if (removed?.file) {
    const full = path.resolve(SUBTITLE_FILES_DIR, String(removed.file));
    if (full.startsWith(SUBTITLE_FILES_DIR + path.sep)) {
      try { await fs.promises.unlink(full); } catch (_) {}
    }
  }

  subs.splice(idx, 1);
  if (subs.length > 0 && !subs.some((s) => s?.default)) {
    subs[0].default = true;
  }
  movie.subtitles = subs;
  syncLegacyFromSubtitles(movie);

  await movie.save();
  cacheClear();
  return res.status(200).json(movie);
});

// Admin: delete one or more movies (by Mongo _id or imdb_id)
router.delete("/delete", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Authentication token is required" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.admin) {
      return res.status(403).json({ message: "You do not have admin privileges" });
    }

    const { ids, imdb_ids } = req.body || {};
    const idList = Array.isArray(ids) ? ids.filter(Boolean) : [];
    const imdbList = Array.isArray(imdb_ids) ? imdb_ids.filter(Boolean) : [];

    if (idList.length === 0 && imdbList.length === 0) {
      return res.status(400).json({ message: "Aucun film sélectionné." });
    }

    const filter = idList.length
      ? { _id: { $in: idList } }
      : { imdb_id: { $in: imdbList } };

    const moviesToDelete = await Movie.find(filter).select("imdb_id");
    const deletedImdbIds = moviesToDelete.map((m) => m.imdb_id).filter(Boolean);

    const result = await Movie.deleteMany(filter);
    cacheClear();

    if (deletedImdbIds.length > 0) {
      await User.updateMany(
        {},
        { $pull: { watchedMovies: { imdb_id: { $in: deletedImdbIds } } } }
      );
    }

    return res.status(200).json({
      message: "Movies deleted successfully",
      deletedCount: result.deletedCount || 0,
    });
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }
    return res.status(500).json({ error: err.message });
  }
});

// Admin: update a movie (edit fields, optionally refresh from OMDb)
router.put("/:id", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Authentication token is required" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.admin) {
      return res.status(403).json({ message: "You do not have admin privileges" });
    }

    const { id } = req.params;
    const {
      imdb_id,
      title,
      description,
      rating,
      runtime,
      poster,
      year,
      category,
      vod_link,
      player_mode,
      video_src,
      embed_src,
      video_file,
      video_file_low,
      subtitle_lang,
      subtitle_label,
      subtitle_default,
      subtitle_remove,
      refreshOmdb,
      cam,
    } = req.body || {};

    if (imdb_id !== undefined && imdb_id !== null && !isValidImdbId(imdb_id)) {
      return res.status(400).json({ message: "IMDB ID invalide. Exemple attendu: tt1234567" });
    }

    if (year !== undefined && year !== null && year !== "") {
      const parsedYear = parseOscarYear(year);
      if (!parsedYear) {
        return res.status(400).json({ message: "Année invalide (ex: 2026)" });
      }
    }

    if (typeof category === "string" && category.trim() === "") {
      return res.status(400).json({ message: "Catégorie invalide." });
    }

    if (typeof vod_link === "string" && vod_link.trim() === "") {
      // Allow clearing vod_link; enforce "at least one source" after applying changes.
    }

    if (player_mode !== undefined) {
      const normalizedMode = normalizePlayerMode(player_mode);
      if (normalizedMode === null) {
        return res.status(400).json({ message: "player_mode invalide (auto|video|embed)" });
      }
    }

    const movie = await Movie.findById(id);
    if (!movie) return res.status(404).json({ message: "Movie not found" });

    if (imdb_id !== undefined) movie.imdb_id = String(imdb_id).trim();
    if (category !== undefined) movie.category = String(category).trim();
    if (vod_link !== undefined) {
      const v = normalizeOptionalString(vod_link, 4096);
      movie.vod_link = v ? v : null;
    }
    if (player_mode !== undefined) {
      const normalizedMode = normalizePlayerMode(player_mode);
      movie.player_mode = normalizedMode === null ? movie.player_mode : normalizedMode;
    }
    if (video_src !== undefined) {
      const v = normalizeOptionalString(video_src, 4096);
      movie.video_src = v ? v : null;
    }
    if (embed_src !== undefined) {
      const v = normalizeOptionalString(embed_src, 20000);
      movie.embed_src = v ? v : null;
    }
    if (video_file !== undefined) {
      const v = normalizeVideoFile(video_file);
      movie.video_file = v ? v : null;
      // If we have a server file and no explicit video_src, set it to our streaming endpoint.
      if (movie.video_file && !String(movie.video_src || "").trim()) {
        movie.video_src = `/api/video/${movie._id}`;
      }
    }
    if (video_file_low !== undefined) {
      const v = normalizeVideoFile(video_file_low);
      movie.video_file_low = v ? v : null;
    }

    const removeSubtitles = parseBooleanFlag(subtitle_remove);
    if (removeSubtitles) {
      const entries = Array.isArray(movie.subtitles) ? movie.subtitles : [];
      for (const entry of entries) {
        const rel = typeof entry?.file === "string" ? entry.file.trim() : "";
        if (!rel) continue;
        const full = path.resolve(SUBTITLE_FILES_DIR, rel);
        if (full.startsWith(SUBTITLE_FILES_DIR + path.sep)) {
          try { await fs.promises.unlink(full); } catch (_) {}
        }
      }

      const existing = typeof movie.subtitle_file === "string" ? movie.subtitle_file.trim() : "";
      if (existing) {
        const oldPath = path.resolve(SUBTITLE_FILES_DIR, existing);
        if (oldPath.startsWith(SUBTITLE_FILES_DIR + path.sep)) {
          try { await fs.promises.unlink(oldPath); } catch (_) {}
        }
      }

      movie.subtitles = [];
      movie.subtitle_file = null;
      movie.subtitle_lang = null;
      movie.subtitle_label = null;
      movie.subtitle_default = false;
    } else {
      const subs = Array.isArray(movie.subtitles) ? movie.subtitles : [];
      if (subs.length > 0) {
        const target = subs.find((s) => s?.default) || subs[0];
        if (subtitle_lang !== undefined) {
          const v = normalizeSubtitleLang(subtitle_lang);
          target.lang = v ? v : null;
        }
        if (subtitle_label !== undefined) {
          const v = normalizeSubtitleLabel(subtitle_label);
          target.label = v ? v : null;
        }
        if (subtitle_default !== undefined) {
          const v = parseSubtitleDefault(subtitle_default);
          if (v !== undefined) {
            subs.forEach((s) => { s.default = false; });
            target.default = !!v;
          }
        }
        syncLegacyFromSubtitles(movie);
      } else {
        if (subtitle_lang !== undefined) {
          const v = normalizeSubtitleLang(subtitle_lang);
          movie.subtitle_lang = v ? v : null;
        }

        if (subtitle_label !== undefined) {
          const v = normalizeSubtitleLabel(subtitle_label);
          movie.subtitle_label = v ? v : null;
        }

        if (subtitle_default !== undefined) {
          const v = parseSubtitleDefault(subtitle_default);
          if (v !== undefined) movie.subtitle_default = v;
        }
      }
    }

    if (year !== undefined && year !== null && year !== "") {
      movie.year = parseOscarYear(year);
    } else if (year === null || year === "") {
      // allow clearing the year explicitly
      movie.year = null;
    }

    // If refreshOmdb is true, overwrite OMDb-derived fields from the imdb_id
    if (cam !== undefined) movie.cam = !!cam;

    if (refreshOmdb) {
      try {
        const details = await fetchMovieDetailsFromOmdb(movie.imdb_id);
        movie.title = details.title;
        movie.description = details.description;
        movie.rating = details.rating;
        movie.runtime = details.runtime;
        movie.poster = details.poster;
      } catch (err) {
        if (err?.code === "OMDB_NOT_CONFIGURED") {
          return res.status(503).json({ message: "OMDb n'est pas configuré (env OMDB_API manquante)." });
        }
        throw err;
      }
    } else {
      if (title !== undefined) movie.title = title;
      if (description !== undefined) movie.description = description;
      if (rating !== undefined) movie.rating = rating;
      if (runtime !== undefined) movie.runtime = runtime;
      if (poster !== undefined) movie.poster = poster;
    }

    await movie.save();
    cacheClear();
    return res.status(200).json(movie);
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }
    return res.status(500).json({ error: err.message });
  }
});

// Get playback progress for the current user (seconds)
router.get("/:id/progress", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid movie id" });
    }

    const userId = req.user?.id;
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(401).json({ message: "Invalid user" });
    }

    const progress = await PlaybackProgress.findOne({ userId, movieId: id }).select("time duration updatedAt");
    // User-specific: never allow shared/proxy caching.
    res.set("Cache-Control", "private, no-store, must-revalidate");
    res.set("Vary", "Authorization");
    return res.status(200).json({
      time: typeof progress?.time === "number" ? progress.time : 0,
      duration: typeof progress?.duration === "number" ? progress.duration : null,
      updatedAt: progress?.updatedAt ? new Date(progress.updatedAt).toISOString() : null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Update playback progress for the current user (seconds)
router.put("/:id/progress", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid movie id" });
    }

    const userId = req.user?.id;
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(401).json({ message: "Invalid user" });
    }

    const rawTime = req.body?.time;
    const rawDuration = req.body?.duration;
    const rawImdbId = req.body?.imdb_id;

    let time = Number(rawTime);
    if (!Number.isFinite(time) || time < 0) time = 0;
    // Store whole seconds for stable, consistent resume behavior.
    time = Math.floor(time);

    // Duration is best-effort from the client.
    // IMPORTANT: if the client sends null/undefined (common before metadata loads),
    // do NOT wipe an existing duration in DB (we simply don't update the field).
    let durationCandidate = rawDuration === undefined || rawDuration === null ? null : Number(rawDuration);
    if (durationCandidate !== null && (!Number.isFinite(durationCandidate) || durationCandidate <= 0)) durationCandidate = null;
    if (durationCandidate !== null) durationCandidate = Math.floor(durationCandidate);

    if (durationCandidate !== null) {
      // Clamp into [0, duration]
      time = Math.min(Math.max(time, 0), durationCandidate);
    }

    // Defensive guard:
    // On some reload/startup sequences (especially on hosted environments),
    // the client can emit an early "time=0" save *before* it has restored the
    // user's previous progress (and before it knows duration).
    // If we already have a meaningful progress saved, never let a "0 with unknown duration"
    // overwrite it.
    if (time === 0 && durationCandidate === null) {
      const existing = await PlaybackProgress.findOne({ userId, movieId: id }).select("time duration updatedAt");
      if (existing && typeof existing.time === "number" && existing.time > 1) {
        return res.status(200).json({
          time: existing.time ?? 0,
          duration: typeof existing.duration === "number" ? existing.duration : null,
          updatedAt: existing.updatedAt ? new Date(existing.updatedAt).toISOString() : null,
        });
      }
    }

    // Auto-check the movie in the checklist when the user reaches the "credit roll".
    // Keep it simple: use the timestamp ratio (>= 95%).
    const reachedCreditRoll = durationCandidate !== null && durationCandidate > 0 && time / durationCandidate >= 0.95;

    // Best UX: if the user is basically at the end, reset to 0 so replay starts from the beginning.
    if (durationCandidate !== null && durationCandidate - time <= 3) {
      time = 0;
    }

    const updateSet = { time, updatedAt: new Date() };
    if (durationCandidate !== null) updateSet.duration = durationCandidate;

    const updated = await PlaybackProgress.findOneAndUpdate(
      { userId, movieId: id },
      { $set: updateSet },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).select("time duration updatedAt");

    // If they hit the 95% threshold, mark as watched for checklist.
    // Prefer imdb_id provided by the client; fall back to DB lookup if absent/invalid.
    if (reachedCreditRoll) {
      let imdbId = typeof rawImdbId === "string" ? rawImdbId.trim() : "";
      if (!isValidImdbId(imdbId)) imdbId = "";

      if (!imdbId) {
        const movieDoc = await Movie.findById(id).select("imdb_id").lean();
        const mImdb = typeof movieDoc?.imdb_id === "string" ? movieDoc.imdb_id.trim() : "";
        if (isValidImdbId(mImdb)) imdbId = mImdb;
      }

      if (imdbId) {
        // Only add if not already present; if user manually unchecked, it can be re-added on next 95% hit.
        await User.updateOne(
          { _id: userId, "watchedMovies.imdb_id": { $ne: imdbId } },
          { $push: { watchedMovies: { imdb_id: imdbId, watchedDate: new Date() } } }
        );
      }
    }

    return res.status(200).json({
      time: updated?.time ?? 0,
      duration: typeof updated?.duration === "number" ? updated.duration : null,
      updatedAt: updated?.updatedAt ? new Date(updated.updatedAt).toISOString() : null,
    });
  } catch (err) {
    // Handle rare unique-index races on first write
    if (err?.code === 11000) {
      return res.status(409).json({ message: "Progress already exists, retry." });
    }
    return res.status(500).json({ error: err.message });
  }
});

// Get playback progress for the current user (bulk, used by movies.html)
// Optional query: ?year=2026 (filters to that Oscar year)
router.get("/progress", authenticate, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(401).json({ message: "Invalid user" });
    }

    const year = parseOscarYear(req.query.year);
    let movieIds = null;

    if (year) {
      const idDocs = await Movie.find({ year }).select("_id").lean();
      movieIds = idDocs.map((d) => d?._id).filter(Boolean);
      if (movieIds.length === 0) {
        res.set("Cache-Control", "private, no-store, must-revalidate");
        res.set("Vary", "Authorization");
        return res.status(200).json([]);
      }
    }

    const filter = { userId, ...(movieIds ? { movieId: { $in: movieIds } } : {}) };
    const rows = await PlaybackProgress.find(filter).select("movieId time duration updatedAt").lean();

    // User-specific: never allow shared/proxy caching.
    res.set("Cache-Control", "private, no-store, must-revalidate");
    res.set("Vary", "Authorization");
    return res.status(200).json(
      (rows || []).map((r) => ({
        movieId: String(r.movieId),
        time: typeof r.time === "number" ? r.time : 0,
        duration: typeof r.duration === "number" ? r.duration : null,
        updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : null,
      }))
    );
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Get rating info for a movie (user-specific + global average)
router.get("/:id/ratings", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid movie id" });
    }
    const movieId = new mongoose.Types.ObjectId(id);
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "User not found" });

    const [agg, userRow] = await Promise.all([
      MovieRating.aggregate([
        { $match: { movieId } },
        { $group: { _id: "$movieId", avgRating: { $avg: "$rating" }, count: { $sum: 1 } } },
      ]),
      MovieRating.findOne({ movieId, userId }).select("rating").lean(),
    ]);

    const avg = agg?.[0]?.avgRating;
    const count = agg?.[0]?.count;

    res.set("Cache-Control", "private, no-store, must-revalidate");
    res.set("Vary", "Authorization");
    return res.status(200).json({
      averageRating: typeof avg === "number" ? Number(avg.toFixed(2)) : null,
      ratingsCount: typeof count === "number" ? count : 0,
      userRating: typeof userRow?.rating === "number" ? userRow.rating : null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Save/update a user rating (1-5)
router.put("/:id/ratings", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid movie id" });
    }
    const movieId = new mongoose.Types.ObjectId(id);
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "User not found" });

    const rating = parseFiveStarRating(req.body?.rating);
    if (!rating) {
      return res.status(400).json({ message: "Invalid rating (expected 1-5)" });
    }

    await MovieRating.findOneAndUpdate(
      { movieId, userId },
      { $set: { rating } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const agg = await MovieRating.aggregate([
      { $match: { movieId } },
      { $group: { _id: "$movieId", avgRating: { $avg: "$rating" }, count: { $sum: 1 } } },
    ]);

    const avg = agg?.[0]?.avgRating;
    const count = agg?.[0]?.count;

    res.set("Cache-Control", "private, no-store, must-revalidate");
    res.set("Vary", "Authorization");
    return res.status(200).json({
      averageRating: typeof avg === "number" ? Number(avg.toFixed(2)) : null,
      ratingsCount: typeof count === "number" ? count : 0,
      userRating: rating,
    });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ message: "Rating already exists, retry." });
    }
    return res.status(500).json({ error: err.message });
  }
});

// Remove a user rating
router.delete("/:id/ratings", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid movie id" });
    }
    const movieId = new mongoose.Types.ObjectId(id);
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "User not found" });

    await MovieRating.deleteOne({ movieId, userId });

    const agg = await MovieRating.aggregate([
      { $match: { movieId } },
      { $group: { _id: "$movieId", avgRating: { $avg: "$rating" }, count: { $sum: 1 } } },
    ]);

    const avg = agg?.[0]?.avgRating;
    const count = agg?.[0]?.count;

    res.set("Cache-Control", "private, no-store, must-revalidate");
    res.set("Vary", "Authorization");
    return res.status(200).json({
      averageRating: typeof avg === "number" ? Number(avg.toFixed(2)) : null,
      ratingsCount: typeof count === "number" ? count : 0,
      userRating: null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Get one movie by Mongo _id (used by the custom player page)
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid movie id" });
    }

    const movie = await Movie.findById(id).lean();
    if (!movie) return res.status(404).json({ message: "Movie not found" });

    let userId = null;
    const token = req.headers.authorization?.split(" ")[1];
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded?.id) userId = decoded.id;
      } catch (_) {}
    }

    let userRating = null;
    if (userId) {
      const row = await MovieRating.findOne({ movieId: movie._id, userId }).select("rating").lean();
      userRating = typeof row?.rating === "number" ? row.rating : null;
    }

    const agg = await MovieRating.aggregate([
      { $match: { movieId: movie._id } },
      { $group: { _id: "$movieId", avgRating: { $avg: "$rating" }, count: { $sum: 1 } } },
    ]);
    const avg = agg?.[0]?.avgRating;
    const count = agg?.[0]?.count;

    return res.status(200).json({
      ...movie,
      subtitles: getSubtitlesForResponse(movie),
      user_rating_avg: typeof avg === "number" ? Number(avg.toFixed(2)) : null,
      user_rating_count: typeof count === "number" ? count : 0,
      user_rating: userRating,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
