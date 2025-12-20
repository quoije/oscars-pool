const express = require("express");
const Movie = require("../models/Movie");
const User = require("../models/User");
const axios = require("axios");
const jwt = require("jsonwebtoken");

const router = express.Router();

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

// Get all movies
router.get("/", async (req, res) => {
  try {
    const movies = await Movie.find();
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
  const { imdb_id, category, vod_link } = req.body;

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

    // Fetch movie details from OMDb API
    const movieDetails = await fetchMovieDetailsFromOmdb(imdb_id);
    
    // Proceed with adding the movie
    const movie = new Movie({
      imdb_id,
      title: movieDetails.title,
      description: movieDetails.description,
      rating: movieDetails.rating,
      poster: movieDetails.poster,
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

module.exports = router;
