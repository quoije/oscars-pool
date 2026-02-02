const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const User = require("../models/User");
const Movie = require("../models/Movie");
const Setting = require("../models/Setting");
const PlaybackProgress = require("../models/PlaybackProgress");
const OscarPick = require("../models/OscarPick");
const OscarCategory = require("../models/OscarCategory");
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
  const expiresIn = typeof process.env.JWT_EXPIRES_IN === "string" && process.env.JWT_EXPIRES_IN.trim()
    ? process.env.JWT_EXPIRES_IN.trim()
    : "8h";
  return jwt.sign(
    {
      id: user._id,
      name: user.name,
      admin: isAdmin,
      mustChangePassword: !!user.mustChangePassword,
    },
    process.env.JWT_SECRET,
    { expiresIn }
  );
}

function normalizeThemePreference(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "light" || raw === "dark") return raw;
  return null;
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

// ============================================================================
// FIRST-TIME SETUP ENDPOINTS
// These allow creating the first admin user when the database is empty/new
// ============================================================================

// Check if the app needs initial setup (no admin users exist)
router.get("/setup/status", async (req, res) => {
  try {
    const totalUsers = await User.countDocuments({});
    const adminCount = await User.countDocuments({ role: 69 });

    res.set("Cache-Control", "no-store");
    return res.status(200).json({
      needsSetup: adminCount === 0,
      hasUsers: totalUsers > 0,
      hasAdmin: adminCount > 0,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Create the first admin user (only works if no admin exists)
router.post("/setup/admin", async (req, res) => {
  try {
    // Check if an admin already exists
    const adminCount = await User.countDocuments({ role: 69 });
    if (adminCount > 0) {
      return res.status(403).json({
        message: "Un administrateur existe déjà. Cette fonctionnalité est désactivée.",
      });
    }

    const { name, email, password } = req.body;

    // Validate input
    const nameNorm = typeof name === "string" ? name.trim() : "";
    const emailNorm = typeof email === "string" ? email.trim().toLowerCase() : "";

    if (!nameNorm) {
      return res.status(400).json({ message: "Le nom est obligatoire" });
    }
    if (!emailNorm) {
      return res.status(400).json({ message: "L'email est obligatoire" });
    }
    if (!/^\S+@\S+\.\S+$/.test(emailNorm)) {
      return res.status(400).json({ message: "Email invalide" });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ message: "Le mot de passe doit contenir au moins 6 caractères" });
    }

    // Check if email is already taken
    const existing = await User.findOne({ email: emailNorm });
    if (existing) {
      return res.status(409).json({ message: "Cet email est déjà utilisé" });
    }

    // Create the admin user
    const hashedPassword = await bcrypt.hash(password, 10);
    const adminUser = new User({
      name: nameNorm,
      email: emailNorm,
      password: hashedPassword,
      role: 69, // Admin role
      mustChangePassword: false,
    });

    await adminUser.save();

    console.log(`[setup] First admin user created: ${emailNorm}`);

    // Return a token so the admin is logged in immediately
    const token = signUserToken(adminUser);

    return res.status(201).json({
      message: "Administrateur créé avec succès",
      token,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Get user stats with watched movie titles and details from the movies collection
router.get("/stats", verifyToken, async (req, res) => {
  try {
    // Auth-scoped response: never allow caching.
    res.set("Cache-Control", "private, no-store, must-revalidate");
    res.set("Vary", "Authorization");

    // Fetch all users (only needed fields)
    const users = await User.find().select("name watchedMovies").lean();
    
    // If a year is explicitly provided, use it; otherwise default to the global active year.
    const year = parseOscarYear(req.query.year) || await getOrInitActiveYear();

    // Fetch movies (optionally filtered by year)
    const allMovies = await Movie.find({ year })
      .select("imdb_id title poster rating category year vod_link player_mode video_src embed_src video_file")
      .lean();
    const totalMoviesCount = allMovies.length;

    if (totalMoviesCount === 0) {
      return res.status(400).json({ message: "Aucun films disponible." });
    }

    // Get points configuration
    const POINTS_CONFIG_KEY = "points_config";
    const pointsConfigSetting = await Setting.findOne({ key: POINTS_CONFIG_KEY }).select("value").lean();
    const pointsConfig = pointsConfigSetting?.value && typeof pointsConfigSetting.value === "object" 
      ? {
          pointsPerMovie: typeof pointsConfigSetting.value.pointsPerMovie === "number" ? pointsConfigSetting.value.pointsPerMovie : 1,
          pointsPerCorrectPick: typeof pointsConfigSetting.value.pointsPerCorrectPick === "number" ? pointsConfigSetting.value.pointsPerCorrectPick : 1,
        }
      : { pointsPerMovie: 1, pointsPerCorrectPick: 1 };

    // Get all categories with winners marked for this year
    const categories = await OscarCategory.find({ year }).lean();
    const categoryWinners = new Map();
    categories.forEach(cat => {
      const winner = cat.nominees.find(n => n.isWinner);
      if (winner) {
        categoryWinners.set(cat.categoryNumber, winner.name);
      }
    });

    // Get all picks for this year and calculate correct picks on-the-fly
    let picksByUserId = new Map();
    try {
      const allPicks = await OscarPick.find({ year })
        .select("userId picks")
        .lean();

      allPicks.forEach(pick => {
        const userId = String(pick.userId);
        let correctCount = 0;
        
        // Calculate correct picks based on current winners
        if (Array.isArray(pick.picks)) {
          pick.picks.forEach(p => {
            const correctWinner = categoryWinners.get(p.categoryNumber);
            if (correctWinner && p.selectedNominee === correctWinner) {
              correctCount++;
            }
          });
        }
        
        picksByUserId.set(userId, correctCount);
      });
    } catch (err) {
      console.error("Error fetching picks for stats:", err);
      // Continue without picks - users will just have 0 pick points
    }

    // Build stats for each user
    const userStats = users.map((user) => {
      const movieByImdbId = new Map(allMovies.map((m) => [m.imdb_id, m]));

      // Join watched movies with movie details for the selected year (keep watchedDate)
      const watchedRaw = Array.isArray(user?.watchedMovies) ? user.watchedMovies : [];
      const watchedMoviesDetails = watchedRaw
        .map((wm) => {
          const imdbId = typeof wm?.imdb_id === "string" ? wm.imdb_id : "";
          if (!imdbId) return null;
          const movie = movieByImdbId.get(imdbId);
          if (!movie) return null;
          return {
            movieId: movie?._id ? String(movie._id) : null,
            imdb_id: movie.imdb_id,
            title: movie.title || "",
            poster: movie.poster || "",
            rating: movie.rating || "",
            category: movie.category || "",
            year: Number.isInteger(movie.year) ? movie.year : year,
            vod_link: movie.vod_link || "",
            player_mode: movie.player_mode || "auto",
            video_src: movie.video_src || "",
            embed_src: movie.embed_src || "",
            video_file: movie.video_file || "",
            watchedDate: wm?.watchedDate ? new Date(wm.watchedDate).toISOString() : null,
          };
        })
        .filter(Boolean);

      const watchedCount = watchedMoviesDetails.length;
      const watchedRatio = ((watchedCount / totalMoviesCount) * 100).toFixed(1);

      // Calculate the last watched date (used for ranking tiebreakers - earlier completion = better)
      let lastWatchedAt = null;
      watchedMoviesDetails.forEach((wm) => {
        if (wm.watchedDate) {
          const d = new Date(wm.watchedDate);
          if (!lastWatchedAt || d > lastWatchedAt) {
            lastWatchedAt = d;
          }
        }
      });

      // Calculate points
      const userId = String(user._id);
      const correctPicks = picksByUserId.get(userId) || 0;
      const moviePoints = watchedCount * pointsConfig.pointsPerMovie;
      const pickPoints = correctPicks * pointsConfig.pointsPerCorrectPick;
      const totalPoints = moviePoints + pickPoints;

      return {
        name: user.name,
        userId: userId,
        year,
        watchedCount,
        totalMoviesCount,
        watchedRatio: `${watchedRatio}%`,
        watchedMovies: watchedMoviesDetails, // Include movie details
        correctPicks: correctPicks,
        moviePoints: moviePoints,
        pickPoints: pickPoints,
        totalPoints: totalPoints,
        pointsConfig: pointsConfig,
        lastWatchedAt: lastWatchedAt ? lastWatchedAt.toISOString() : null,
      };
    });

    res.json(userStats);
  } catch (err) {
    console.error("Erreur dans l'extraction des statistiques sur les utilisateurs :", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get users who have 100% completion per year (across all years in DB)
// Returns: { years: number[], totals: { [year]: number }, completersByYear: { [year]: {name, watchedCount, totalMoviesCount}[] } }
router.get("/completions", verifyToken, async (req, res) => {
  try {
    // Auth-scoped response: never allow caching.
    res.set("Cache-Control", "private, no-store, must-revalidate");
    res.set("Vary", "Authorization");

    const yearsRaw = await Movie.distinct("year");
    const years = (Array.isArray(yearsRaw) ? yearsRaw : [])
      .map((y) => Number(y))
      .filter((y) => parseOscarYear(y))
      .sort((a, b) => b - a);

    if (years.length === 0) {
      return res.status(200).json({ years: [], totals: {}, completersByYear: {} });
    }

    // Fetch imdb_id + year for all movies that have a valid year
    const movies = await Movie.find({ year: { $in: years } }).select("imdb_id year").lean();

    const imdbIdsByYear = new Map();
    const totals = {};

    movies.forEach((m) => {
      const year = Number(m?.year);
      if (!parseOscarYear(year)) return;
      const imdb = typeof m?.imdb_id === "string" ? m.imdb_id : "";
      if (!imdb) return;
      if (!imdbIdsByYear.has(year)) imdbIdsByYear.set(year, new Set());
      imdbIdsByYear.get(year).add(imdb);
    });

    for (const y of years) {
      const set = imdbIdsByYear.get(y);
      totals[String(y)] = set ? set.size : 0;
    }

    const users = await User.find().select("name watchedMovies.imdb_id watchedMovies.watchedDate").lean();

    const completersByYear = {};
    for (const y of years) {
      const total = totals[String(y)] || 0;
      if (total <= 0) {
        completersByYear[String(y)] = [];
        continue;
      }
      const yearSet = imdbIdsByYear.get(y) || new Set();

      const completers = [];
      users.forEach((u) => {
        const watched = Array.isArray(u?.watchedMovies) ? u.watchedMovies : [];

        // Build a map of imdb_id -> watchedDate for this user's movies in this year
        const watchedInYear = [];
        watched.forEach((wm) => {
          const imdb = typeof wm?.imdb_id === "string" ? wm.imdb_id : "";
          if (!imdb || !yearSet.has(imdb)) return;
          watchedInYear.push({
            imdb_id: imdb,
            watchedDate: wm?.watchedDate ? new Date(wm.watchedDate) : null,
          });
        });

        // Count unique movies watched in this year
        const uniqueImdbIds = new Set(watchedInYear.map((w) => w.imdb_id));
        const count = uniqueImdbIds.size;

        if (count === total) {
          // Find the completion date (the latest watchedDate among movies for this year)
          // This is when the user completed 100% of the checklist
          let completedAt = null;
          watchedInYear.forEach((w) => {
            if (w.watchedDate && (!completedAt || w.watchedDate > completedAt)) {
              completedAt = w.watchedDate;
            }
          });

          completers.push({
            name: u?.name || "(sans nom)",
            watchedCount: count,
            totalMoviesCount: total,
            completedAt: completedAt ? completedAt.toISOString() : null,
          });
        }
      });

      // Sort by completion date (earliest first = higher rank), then alphabetically for ties
      completers.sort((a, b) => {
        // Users with a completion date come before those without
        if (a.completedAt && !b.completedAt) return -1;
        if (!a.completedAt && b.completedAt) return 1;
        // Both have dates: earliest first
        if (a.completedAt && b.completedAt) {
          const dateA = new Date(a.completedAt).getTime();
          const dateB = new Date(b.completedAt).getTime();
          if (dateA !== dateB) return dateA - dateB;
        }
        // Tie-breaker: alphabetical
        return String(a.name).localeCompare(String(b.name), "fr", { sensitivity: "base" });
      });
      completersByYear[String(y)] = completers;
    }

    return res.status(200).json({ years, totals, completersByYear });
  } catch (err) {
    console.error("Erreur dans l'extraction des completers:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Register User
router.post("/register", async (req, res) => {
  const { name, email, password, verifoof } = req.body;
  const dogCheckEnabled = woof.length > 0;

  function registerVerification() {
    // If DOG_NAMES isn't configured, skip the "dog name" verification entirely.
    if (!dogCheckEnabled) return true;
    return woof.includes(verifoof);
  }

  try {
    const nameNorm = typeof name === "string" ? name.trim() : "";
    const emailNorm = typeof email === "string" ? email.trim() : "";

    if (!nameNorm) {
      throw new Error("Le nom est obligatoire");
    }
    if (!emailNorm) {
      throw new Error("L'email est obligatoire");
    }
    // Basic sanity check (not a full RFC validator)
    if (!/^\S+@\S+\.\S+$/.test(emailNorm)) {
      throw new Error("Email invalide.");
    }
    if (!password) {
      throw new Error("Le mot de passe est obligatoire et ne peut être indéfini");
    }
    if (dogCheckEnabled && !verifoof) {
      throw new Error("Le nom du chien doit être défini");
    }
    if (!registerVerification()) {
      return res.status(400).json({
        messageKey: 'auth.dogAnswerIncorrect',
        message: 'Incorrect dog name.',
      });
    }

    const existingUser = await User.findOne({ email: emailNorm });
    if (existingUser) {
      return res.status(409).json({ message: "L'email existe déjà, veuillez en choisir un autre." });
    }
    
    // Hash password and create user
    const hashedPassword = await bcrypt.hash(password, 10);
    // SECURITY: never accept role escalation from a public endpoint.
    const user = new User({ name: nameNorm, email: emailNorm, password: hashedPassword, role: 0 });
    await user.save();

    res.status(201).json({
      messageKey: 'auth.registrationSuccess',
      message: 'User registered successfully!',
    });
  } catch (err) {
    return res.status(400).json({ message: err?.message || "Erreur interne" });
  }
});

// Login User
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({
        messageKey: 'auth.userNotFound',
        message: 'User not found',
      });
    }

    // If this account is in "temp password" mode and the temp password has expired, block login.
    if (user.mustChangePassword && user.tempPasswordExpiresAt && user.tempPasswordExpiresAt instanceof Date) {
      if (Date.now() > user.tempPasswordExpiresAt.getTime()) {
        return res.status(401).json({
          messageKey: 'auth.tempPasswordExpired',
          message: 'Temporary password expired. Ask an admin to reset your password.',
        });
      }
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({
        messageKey: 'auth.invalidCredentials',
        message: 'Invalid credentials',
      });
    }

    console.log("[debug] " + user.name + " logged in")

    const token = signUserToken(user);
    res.status(200).json({ token, mustChangePassword: !!user.mustChangePassword });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// User: get theme preference
router.get("/theme", verifyToken, async (req, res) => {
  try {
    res.set("Cache-Control", "private, no-store, must-revalidate");
    res.set("Vary", "Authorization");

    const user = await User.findById(req.user.id).select("themePreference").lean();
    if (!user) return res.status(404).json({ message: "User not found" });
    return res.status(200).json({ themePreference: user.themePreference || null });
  } catch (err) {
    return res.status(400).json({ message: err?.message || "Erreur interne" });
  }
});

// User: update theme preference (light/dark or null for system)
router.put("/theme", verifyToken, async (req, res) => {
  try {
    const preference = normalizeThemePreference(req.body?.themePreference);
    const provided = req.body?.themePreference;
    if (provided !== null && provided !== undefined && preference === null) {
      return res.status(400).json({ message: "Préférence invalide (light/dark/null)." });
    }

    const update = preference ? { $set: { themePreference: preference } } : { $unset: { themePreference: 1 } };

    const user = await User.findByIdAndUpdate(req.user.id, update, { new: true, select: "themePreference" }).lean();

    if (!user) return res.status(404).json({ message: "User not found" });
    return res.status(200).json({ themePreference: user.themePreference || null });
  } catch (err) {
    return res.status(400).json({ message: err?.message || "Erreur interne" });
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
      message: "Temporary password generated. The user must change it on next login.",
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
    // Admin + auth-scoped data: never allow caching.
    res.set("Cache-Control", "private, no-store, must-revalidate");
    res.set("Vary", "Authorization");

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
      message: "User created. Temporary password generated.",
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
