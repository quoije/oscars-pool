const express = require("express");
const Movie = require("../models/Movie");
const User = require("../models/User");
const PlaybackProgress = require("../models/PlaybackProgress");
const axios = require("axios");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const authenticate = require("../middleware/authMiddleware");

const router = express.Router();

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

// Fetch movie details from OMDb API
async function fetchMovieDetailsFromOmdb(imdb_id) {
  const apiKey = process.env.OMDB_API;  // Replace with your actual OMDb API key
  const omdbUrl = `https://www.omdbapi.com/?i=${encodeURIComponent(imdb_id)}&apikey=${apiKey}`;
  
  try {
    const response = await axios.get(omdbUrl);
    if (response.data.Response === "True") {
      return {
        title: response.data.Title,
        description: response.data.Plot,
        rating: response.data.imdbRating,
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
    const years = await Movie.distinct("year");
    const cleaned = years
      .filter((y) => typeof y === "number" && Number.isFinite(y))
      .sort((a, b) => b - a);
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
    const movies = await Movie.find(filter);
    res.status(200).json(movies);
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

    const latestMovie = await Movie.findOne(filter).sort({ updatedAt: -1, createdAt: -1, _id: -1 });
    if (!latestMovie) {
      return res.status(200).json({ lastUpdated: null });
    }

    const lastUpdated =
      latestMovie.updatedAt ||
      latestMovie.createdAt ||
      (typeof latestMovie._id?.getTimestamp === "function" ? latestMovie._id.getTimestamp() : null);

    return res.status(200).json({ lastUpdated: lastUpdated ? new Date(lastUpdated).toISOString() : null });
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
    const user = await User.findById(decoded.id); // Get user by ID
    if (!user) return res.status(404).json({ message: "User not found" });

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
  const { imdb_id, category, vod_link, year, player_mode, video_src, embed_src } = req.body;

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
    const normalizedMode = normalizePlayerMode(player_mode);
    if (normalizedMode === null) {
      return res.status(400).json({ message: "player_mode invalide (auto|video|embed)" });
    }
    if (!hasAnySource({ vod_link: normalizedVod || "", video_src: normalizedVideo || "", embed_src: normalizedEmbed || "" })) {
      return res.status(400).json({ message: "Ajoute au moins une source (VOD / video_src / embed_src)." });
    }

    // Fetch movie details from OMDb API
    const movieDetails = await fetchMovieDetailsFromOmdb(imdb_id);
    
    // Proceed with adding the movie
    const movie = new Movie({
      imdb_id,
      title: movieDetails.title,
      description: movieDetails.description,
      rating: movieDetails.rating,
      poster: movieDetails.poster,
      year: parsedYear,
      category,
      vod_link: normalizedVod || undefined,
      player_mode: normalizedMode,
      video_src: normalizedVideo || undefined,
      embed_src: normalizedEmbed || undefined,
    });

    await movie.save();

    res.status(201).json({ message: "Movie added successfully!" });
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }
    res.status(400).json({ error: err.message });
  }
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
      poster,
      year,
      category,
      vod_link,
      player_mode,
      video_src,
      embed_src,
      refreshOmdb,
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

    if (year !== undefined && year !== null && year !== "") {
      movie.year = parseOscarYear(year);
    } else if (year === null || year === "") {
      // allow clearing the year explicitly
      movie.year = null;
    }

    // If refreshOmdb is true, overwrite OMDb-derived fields from the imdb_id
    if (refreshOmdb) {
      const details = await fetchMovieDetailsFromOmdb(movie.imdb_id);
      movie.title = details.title;
      movie.description = details.description;
      movie.rating = details.rating;
      movie.poster = details.poster;
    } else {
      if (title !== undefined) movie.title = title;
      if (description !== undefined) movie.description = description;
      if (rating !== undefined) movie.rating = rating;
      if (poster !== undefined) movie.poster = poster;
    }

    if (!hasAnySource({
      vod_link: movie.vod_link || "",
      video_src: movie.video_src || "",
      embed_src: movie.embed_src || "",
    })) {
      return res.status(400).json({ message: "Ajoute au moins une source (VOD / video_src / embed_src)." });
    }

    await movie.save();
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

    let time = Number(rawTime);
    if (!Number.isFinite(time) || time < 0) time = 0;

    let duration = rawDuration === undefined || rawDuration === null ? null : Number(rawDuration);
    if (duration !== null && (!Number.isFinite(duration) || duration <= 0)) duration = null;

    if (duration !== null) {
      // Clamp into [0, duration]
      time = Math.min(Math.max(time, 0), duration);
    }

    // Best UX: if the user is basically at the end, reset to 0 so replay starts from the beginning.
    if (duration !== null && duration - time <= 3) {
      time = 0;
    }

    const updated = await PlaybackProgress.findOneAndUpdate(
      { userId, movieId: id },
      { $set: { time, duration, updatedAt: new Date() } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).select("time duration updatedAt");

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

// Get one movie by Mongo _id (used by the custom player page)
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid movie id" });
    }

    const movie = await Movie.findById(id);
    if (!movie) return res.status(404).json({ message: "Movie not found" });
    return res.status(200).json(movie);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
