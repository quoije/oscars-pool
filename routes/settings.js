const express = require("express");
const jwt = require("jsonwebtoken");

const Setting = require("../models/Setting");
const Movie = require("../models/Movie");

const router = express.Router();

const ACTIVE_YEAR_KEY = "active_oscar_year";

function parseOscarYear(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n)) return null;
  if (n < 1900 || n > 3000) return null;
  return n;
}

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

// Public: get current active Oscar year used by the site.
router.get("/year", async (req, res) => {
  try {
    const year = await getOrInitActiveYear();
    return res.status(200).json({ year });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Admin-only: set current active Oscar year.
router.put("/year", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Authentication token is required" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.admin) {
      return res.status(403).json({ message: "You do not have admin privileges" });
    }

    const year = parseOscarYear(req.body?.year);
    if (!year) {
      return res.status(400).json({ message: "Année invalide (ex: 2026)" });
    }

    const updated = await Setting.findOneAndUpdate(
      { key: ACTIVE_YEAR_KEY },
      { $set: { value: year } },
      { upsert: true, new: true }
    );

    return res.status(200).json({ year: updated.value });
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;

