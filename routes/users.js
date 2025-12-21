const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const User = require("../models/User");
const Movie = require("../models/Movie");
const Setting = require("../models/Setting");
const PlaybackProgress = require("../models/PlaybackProgress");
const axios = require("axios");

const router = express.Router();

// Set password for verification

const woof =
  typeof process.env.DOG_NAMES === "string"
    ? process.env.DOG_NAMES.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

const ACTIVE_YEAR_KEY = "active_oscar_year";

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

function parseOscarYear(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n)) return null;
  if (n < 1900 || n > 3000) return null;
  return n;
}

function isAdminFromDecoded(decoded) {
  return !!decoded?.admin;
}

function signUserToken(user) {
  const isAdmin = user.role === 69;
  return jwt.sign(
    {
      id: user._id,
      name: user.name,
      admin: isAdmin,
      mustChangePassword: !!user.mustChangePassword,
    },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
}

function generateTempPassword() {
  // 12 chars, URL-safe (no spaces/specials that break copy/paste)
  return crypto.randomBytes(9).toString("base64url");
}

const TEMP_PASSWORD_TTL_MS = 24 * 60 * 60 * 1000; // 24h

async function getOrInitActiveYear() {
  const existing = await Setting.findOne({ key: ACTIVE_YEAR_KEY });
  if (existing && typeof existing.value === "number") return existing.value;

  // Initialize from latest movie year if available, else from current year.
  const latestMovie = await Movie.findOne({ year: { $type: "number" } })
    .sort({ year: -1 })
    .select("year");

  const fallbackYear = latestMovie?.year || new Date().getFullYear();
  const year = parseOscarYear(fallbackYear) || new Date().getFullYear();

  await Setting.findOneAndUpdate(
    { key: ACTIVE_YEAR_KEY },
    { $set: { value: year } },
    { upsert: true, new: true }
  );

  return year;
}

// Get user stats with watched movie titles and details from the movies collection
router.get("/stats", verifyToken, async (req, res) => {
  try {
    // Fetch all users
    const users = await User.find();
    
    // If a year is explicitly provided, use it; otherwise default to the global active year.
    const year = parseOscarYear(req.query.year) || await getOrInitActiveYear();

    // Fetch movies (optionally filtered by year)
    const allMovies = await Movie.find({ year });
    const totalMoviesCount = allMovies.length;

    if (totalMoviesCount === 0) {
      return res.status(400).json({ message: "Aucun films disponible." });
    }

    // Build stats for each user
    const userStats = users.map((user) => {
      const movieByImdbId = new Map(allMovies.map((m) => [m.imdb_id, m]));

      // Get watched movies with details from the database
      const watchedMovies = user.watchedMovies
        .map((wm) => movieByImdbId.get(wm.imdb_id)) // Match movie details
        .filter(Boolean); // Remove any `undefined` values (if movie is not found)

      const watchedCount = watchedMovies.length;
      const watchedRatio = ((watchedCount / totalMoviesCount) * 100).toFixed(1);

      const watchedMoviesDetails = watchedMovies.map((movie) => ({
        imdb_id: movie.imdb_id,
        title: movie.title
      }));

      return {
        name: user.name,
        year,
        watchedCount,
        totalMoviesCount,
        watchedRatio: `${watchedRatio}%`,
        watchedMovies: watchedMoviesDetails // Include movie details
      };
    });

    res.json(userStats);
  } catch (err) {
    console.error("Erreur dans l'extraction des statistiques sur les utilisateurs :", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Register User
router.post("/register", async (req, res) => {
  const { name, email, password, role, verifoof } = req.body;
  const dogCheckEnabled = woof.length > 0;

  function registerVerification() {
    // If DOG_NAMES isn't configured, skip the "dog name" verification entirely.
    if (!dogCheckEnabled) return true;
    return woof.includes(verifoof);
  }

  try {
    if (!password) {
      throw new Error("Le mot de passe est obligatoire et ne peut être indéfini");
    }
    if (dogCheckEnabled && !verifoof) {
      throw new Error("Le nom du chien doit être défini");
    }
    if (!registerVerification()) {
      return res.status(400).json({ message: "Mauvais nom de chien" });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ message: "L'email existe déjà, veuillez en choisir un autre." });
    }
    
    // Hash password and create user
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ name, email, password: hashedPassword, role });
    await user.save();

    res.status(201).json({ message: "L'utilisateur s'est enregistré avec succès !" });
  } catch (err) {
    return res.status(400).json({ message: err?.message || "Erreur interne" });
  }
});

// Login User
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "L'utilisateur n'a pas été trouvé" });

    // If this account is in "temp password" mode and the temp password has expired, block login.
    if (user.mustChangePassword && user.tempPasswordExpiresAt && user.tempPasswordExpiresAt instanceof Date) {
      if (Date.now() > user.tempPasswordExpiresAt.getTime()) {
        return res.status(401).json({
          message: "Le mot de passe temporaire a expiré. Demandez à un admin de réinitialiser votre mot de passe.",
        });
      }
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ message: "Informations d'identification non valides" });

    console.log("[debug] " + user.name + " logged in")

    const token = signUserToken(user);
    res.status(200).json({ token, mustChangePassword: !!user.mustChangePassword });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Admin: reset a user's password to a random temp password and force change on next login.
router.post("/admin/reset-temp-password", verifyToken, async (req, res) => {
  if (!isAdminFromDecoded(req.user)) {
    return res.status(403).json({ message: "You do not have admin privileges" });
  }

  const { email, userId } = req.body || {};
  const emailNorm = typeof email === "string" ? email.trim() : "";
  const idNorm = typeof userId === "string" ? userId.trim() : "";

  if (!emailNorm && !idNorm) {
    return res.status(400).json({ message: "Email ou userId requis." });
  }

  try {
    const user = emailNorm ? await User.findOne({ email: emailNorm }) : await User.findById(idNorm);
    if (!user) return res.status(404).json({ message: "User not found" });

    const tempPassword = generateTempPassword();
    const hashedPassword = await bcrypt.hash(tempPassword, 10);
    const expiresAt = new Date(Date.now() + TEMP_PASSWORD_TTL_MS);

    user.password = hashedPassword;
    user.mustChangePassword = true;
    user.tempPasswordIssuedAt = new Date();
    user.tempPasswordExpiresAt = expiresAt;
    await user.save();

    return res.status(200).json({
      message: "Mot de passe temporaire généré. L'utilisateur devra le changer à sa prochaine connexion.",
      tempPassword,
      expiresAt: expiresAt.toISOString(),
      user: { id: String(user._id), name: user.name, email: user.email },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Admin: list users (safe fields only)
router.get("/admin/list", verifyToken, async (req, res) => {
  if (!isAdminFromDecoded(req.user)) {
    return res.status(403).json({ message: "You do not have admin privileges" });
  }

  try {
    const users = await User.find()
      .select("name email role mustChangePassword")
      .sort({ name: 1, email: 1 });

    return res.status(200).json(
      users.map((u) => ({
        id: String(u._id),
        name: u.name,
        email: u.email,
        admin: u.role === 69,
        mustChangePassword: !!u.mustChangePassword,
      }))
    );
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Admin: create a user with a random temp password (forces change on first login).
router.post("/admin/create", verifyToken, async (req, res) => {
  if (!isAdminFromDecoded(req.user)) {
    return res.status(403).json({ message: "You do not have admin privileges" });
  }

  const { name, email, admin } = req.body || {};
  const nameNorm = typeof name === "string" ? name.trim() : "";
  const emailNorm = typeof email === "string" ? email.trim() : "";
  const makeAdmin = !!admin;

  if (!nameNorm) {
    return res.status(400).json({ message: "Nom requis." });
  }
  if (!emailNorm) {
    return res.status(400).json({ message: "Email requis." });
  }
  // Basic sanity check (not a full RFC validator)
  if (!/^\S+@\S+\.\S+$/.test(emailNorm)) {
    return res.status(400).json({ message: "Email invalide." });
  }

  try {
    const existingUser = await User.findOne({ email: emailNorm });
    if (existingUser) {
      return res.status(409).json({ message: "L'email existe déjà, veuillez en choisir un autre." });
    }

    const tempPassword = generateTempPassword();
    const hashedPassword = await bcrypt.hash(tempPassword, 10);
    const expiresAt = new Date(Date.now() + TEMP_PASSWORD_TTL_MS);

    const user = new User({
      name: nameNorm,
      email: emailNorm,
      password: hashedPassword,
      role: makeAdmin ? 69 : 0,
      mustChangePassword: true,
      tempPasswordIssuedAt: new Date(),
      tempPasswordExpiresAt: expiresAt,
    });

    await user.save();

    return res.status(201).json({
      message: "Utilisateur créé. Mot de passe temporaire généré.",
      tempPassword,
      expiresAt: expiresAt.toISOString(),
      user: { id: String(user._id), name: user.name, email: user.email, admin: user.role === 69, mustChangePassword: true },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Admin: delete a user (and related playback progress)
router.post("/admin/delete", verifyToken, async (req, res) => {
  if (!isAdminFromDecoded(req.user)) {
    return res.status(403).json({ message: "You do not have admin privileges" });
  }

  const { email, userId } = req.body || {};
  const emailNorm = typeof email === "string" ? email.trim() : "";
  const idNorm = typeof userId === "string" ? userId.trim() : "";

  if (!emailNorm && !idNorm) {
    return res.status(400).json({ message: "Email ou userId requis." });
  }

  try {
    const user = emailNorm ? await User.findOne({ email: emailNorm }) : await User.findById(idNorm);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Safety: prevent deleting yourself from the admin UI.
    if (String(user._id) === String(req.user?.id || "")) {
      return res.status(400).json({ message: "Impossible de supprimer ton propre compte." });
    }

    // Safety: prevent deleting admin accounts via the UI endpoint.
    if (user.role === 69) {
      return res.status(400).json({ message: "Impossible de supprimer un compte admin via cette interface." });
    }

    await PlaybackProgress.deleteMany({ userId: user._id });
    await User.deleteOne({ _id: user._id });

    return res.status(200).json({
      message: "Utilisateur supprimé.",
      user: { id: String(user._id), name: user.name, email: user.email },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// User: change password (used after temp-password login). Returns a fresh token.
router.post("/change-password", verifyToken, async (req, res) => {
  const { newPassword } = req.body || {};
  const pw = typeof newPassword === "string" ? newPassword : "";

  if (!pw || pw.length < 8) {
    return res.status(400).json({ message: "Le nouveau mot de passe doit contenir au moins 8 caractères." });
  }

  try {
    const user = await User.findById(req.user?.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const hashedPassword = await bcrypt.hash(pw, 10);
    user.password = hashedPassword;
    user.mustChangePassword = false;
    user.tempPasswordIssuedAt = null;
    user.tempPasswordExpiresAt = null;
    await user.save();

    const token = signUserToken(user);
    return res.status(200).json({ message: "Mot de passe mis à jour.", token });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Protected route to get movies (example)
router.get("/movies", verifyToken, async (req, res) => {
  // Only authorized users will reach this point
  const movies = await Movie.find();  // Assuming Movie model exists
  res.json(movies);
});

module.exports = router;
