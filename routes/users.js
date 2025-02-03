const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Movie = require("../models/Movie");
const axios = require("axios");

const router = express.Router();

// Set password for verification

const woof = process.env.DOG_NAMES ? process.env.DOG_NAMES.split(",") : [];

// Fetch movie details from OMDb API
async function fetchMovieDetailsFromOmdb(imdb_id) {
  const apiKey = process.env.OMDB_API;  // Replace with your actual OMDb API key
  const omdbUrl = `https://www.omdbapi.com/?i=${encodeURIComponent(imdb_id)}&apikey=${apiKey}`;
  
  try {
    const response = await axios.get(omdbUrl);
    if (response.data.Response === "True") {
      return {
        title: response.data.Title.replace(/'/g, "")
      };
    } else {
      throw new Error('Movie not found on OMDb API');
    }
  } catch (error) {
    throw new Error(`Error fetching movie details: ${error.message}`);
  }
}

// Middleware to verify token
function verifyToken(req, res, next) {
  const token = req.headers['authorization'] && req.headers['authorization'].startsWith('Bearer ') 
    ? req.headers['authorization'].split(' ')[1] 
    : null;

  if (!token) {
    return res.status(403).json({ message: "No token provided, access denied." });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }
    req.user = decoded;  // Store decoded user info for use in routes
    next();
  });
}

// Get user stats with watched movie titles and details from OMDb
router.get("/stats", verifyToken, async (req, res) => {
  try {
    // Fetch all users
    const users = await User.find();
    
    // Fetch all movies
    const allMovies = await Movie.find();
    const totalMoviesCount = allMovies.length;

    if (totalMoviesCount === 0) {
      return res.status(400).json({ message: "No movies available in the database." });
    }

    // Build stats for each user
    const userStats = await Promise.all(users.map(async (user) => {
      // Get watched movie IMDb IDs
      const watchedMovies = user.watchedMovies
        .map((wm) => wm.imdb_id) // Extract IMDb ID
        .filter((imdb_id) => allMovies.some((m) => m.imdb_id === imdb_id)); // Ensure the movie exists in the database

      const watchedCount = watchedMovies.length;
      const watchedRatio = ((watchedCount / totalMoviesCount) * 100).toFixed(1);

      // Fetch movie details from OMDb for each watched movie
      const movieDetailsPromises = watchedMovies.map(async (imdb_id) => {
        try {
          const movieTitle = (await fetchMovieDetailsFromOmdb(imdb_id)).title;
          return {
            imdb_id,
            movieTitle
          };
        } catch (err) {
          console.error(`Error fetching details for movie with IMDb ID: ${imdb_id}`);
          return { imdb_id, error: err.message };
        }
      });

      const movieTitle = await Promise.all(movieDetailsPromises);

      return {
        name: user.name,
        watchedCount,
        totalMoviesCount,
        watchedRatio: `${watchedRatio}%`,
        watchedMovies: movieTitle // Include movie details
      };
    }));

    res.json(userStats);
  } catch (err) {
    console.error("Erreur dans l'extraction des statistiques sur les utilisateurs :", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Register User
router.post("/register", async (req, res) => {
  const { name, email, password, role } = req.body;

  try {
    if (!password) {
        throw new Error("Le mot de passe est obligatoire et ne peut être indéfini");
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ name, email, password: hashedPassword, role });
    await user.save();
    res.status(201).json({ message: "L'utilisateur s'est enregistré avec succès !" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Login User
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "L'utilisateur n'a pas été trouvé" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ message: "Informations d'identification non valides" });

    // Check if the user role is 69 and set the admin flag
    const isAdmin = user.role === 69;

    // Create a token with the user ID, name, and admin flag if the user is an admin
    const token = jwt.sign(
      { id: user._id, name: user.name, admin: isAdmin },  // Include name in the token payload
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    res.status(200).json({ token });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Protected route to get movies (example)
router.get("/movies", verifyToken, async (req, res) => {
  // Only authorized users will reach this point
  const movies = await Movie.find();  // Assuming Movie model exists
  res.json(movies);
});

module.exports = router;
