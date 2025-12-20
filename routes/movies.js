const express = require("express");
const Movie = require("../models/Movie");
const User = require("../models/User");
const axios = require("axios");
const jwt = require("jsonwebtoken");

const router = express.Router();

function parseOscarYear(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n)) return null;
  if (n < 1900 || n > 3000) return null;
  return n;
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

    const latestMovie = await Movie.findOne().sort({ updatedAt: -1, createdAt: -1, _id: -1 });
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
  const { imdb_id, category, vod_link, year } = req.body;

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
      vod_link
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

module.exports = router;
