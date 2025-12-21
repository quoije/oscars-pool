const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const Setting = require("../models/Setting");
const Movie = require("../models/Movie");
const User = require("../models/User");

const router = express.Router();

const ACTIVE_YEAR_KEY = "active_oscar_year";
const COMPLETION_MODAL_KEY = "completion_modal_content";
const WINNERS_BY_YEAR_KEY = "winners_by_year";

const DEFAULT_COMPLETION_MODAL = Object.freeze({
  title: "Félicitations! very nice 🎉🎉🎉",
  bodyText: "",
  videoSrc: "video/reward.mp4",
  bodyHtml: "",
});

function parseOscarYear(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n)) return null;
  if (n < 1900 || n > 3000) return null;
  return n;
}

function parseOptionalPoints(raw) {
  if (raw === undefined) return null;
  if (raw === null) return null;
  if (raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  // Points can be any finite number, but we store a rounded int for consistency.
  return Math.round(n);
}

function normalizeWinnersByYear(rawValue) {
  const value = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) ? rawValue : {};
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const year = parseOscarYear(k);
    if (!year) continue;
    const entry = v && typeof v === "object" && !Array.isArray(v) ? v : {};
    const userId = typeof entry.userId === "string" ? entry.userId.trim() : "";
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) continue;
    const points = parseOptionalPoints(entry.points);
    out[String(year)] = { userId, points };
  }
  return out;
}

function sanitizeHtml(raw) {
  // Basic, defensive sanitization (admin-controlled input, rendered for all users).
  // We remove script tags and inline event handlers. This is not a complete HTML sanitizer.
  const html = String(raw || "");
  const withoutScripts = html.replace(/<script\b[\s\S]*?<\/script>/gi, "");
  const withoutOnAttrs = withoutScripts
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "")
    .replace(/\son\w+=\S+/gi, "");
  return withoutOnAttrs.trim();
}

function normalizeCompletionModal(rawValue) {
  const value = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) ? rawValue : {};

  const title = typeof value.title === "string" ? value.title : DEFAULT_COMPLETION_MODAL.title;
  const bodyText = typeof value.bodyText === "string" ? value.bodyText : DEFAULT_COMPLETION_MODAL.bodyText;
  const videoSrc = typeof value.videoSrc === "string" ? value.videoSrc : DEFAULT_COMPLETION_MODAL.videoSrc;
  const bodyHtml = typeof value.bodyHtml === "string" ? value.bodyHtml : DEFAULT_COMPLETION_MODAL.bodyHtml;

  return {
    title: String(title || "").slice(0, 200).trim() || DEFAULT_COMPLETION_MODAL.title,
    bodyText: String(bodyText || "").slice(0, 8000),
    videoSrc: String(videoSrc || "").slice(0, 2048).trim(),
    bodyHtml: sanitizeHtml(String(bodyHtml || "").slice(0, 20000)),
  };
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

// Public: get the "100% completion" modal content for checklist.
router.get("/completion-modal", async (req, res) => {
  try {
    const existing = await Setting.findOne({ key: COMPLETION_MODAL_KEY }).select("value");
    const normalized = normalizeCompletionModal(existing?.value);
    return res.status(200).json(normalized);
  } catch (err) {
    // If DB is down, still return a sane default so the client can render.
    return res.status(200).json(DEFAULT_COMPLETION_MODAL);
  }
});

// Admin-only: set the "100% completion" modal content for checklist.
router.put("/completion-modal", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Authentication token is required" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.admin) {
      return res.status(403).json({ message: "You do not have admin privileges" });
    }

    const normalized = normalizeCompletionModal(req.body);
    const updated = await Setting.findOneAndUpdate(
      { key: COMPLETION_MODAL_KEY },
      { $set: { value: normalized } },
      { upsert: true, new: true }
    ).select("value");

    return res.status(200).json(normalizeCompletionModal(updated?.value));
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }
    return res.status(500).json({ error: err.message });
  }
});

// Public: get winners by year (optionally with points)
router.get("/winners", async (req, res) => {
  try {
    const existing = await Setting.findOne({ key: WINNERS_BY_YEAR_KEY }).select("value");
    const normalized = normalizeWinnersByYear(existing?.value);

    const entries = Object.entries(normalized)
      .map(([yearStr, v]) => ({
        year: Number(yearStr),
        userId: v.userId,
        points: v.points ?? null,
      }))
      .filter((e) => parseOscarYear(e.year))
      .sort((a, b) => b.year - a.year);

    const userIds = entries.map((e) => e.userId).filter(Boolean);
    const users = userIds.length
      ? await User.find({ _id: { $in: userIds } }).select("name").lean()
      : [];
    const nameById = new Map(users.map((u) => [String(u._id), u.name]));

    return res.status(200).json({
      winners: entries.map((e) => ({
        year: e.year,
        userId: e.userId,
        name: nameById.get(String(e.userId)) || null,
        points: e.points ?? null,
      })),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Admin-only: set/clear winner for a given year. Points optional.
// Body: { userId: "<mongoId>" | "" | null, points?: number|null }
router.put("/winners/:year", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Authentication token is required" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.admin) {
      return res.status(403).json({ message: "You do not have admin privileges" });
    }

    const year = parseOscarYear(req.params?.year);
    if (!year) {
      return res.status(400).json({ message: "Année invalide (ex: 2026)" });
    }

    const rawUserId = req.body?.userId;
    const userId = typeof rawUserId === "string" ? rawUserId.trim() : rawUserId === null ? "" : "";
    const points = parseOptionalPoints(req.body?.points);

    const existing = await Setting.findOne({ key: WINNERS_BY_YEAR_KEY }).select("value");
    const winners = normalizeWinnersByYear(existing?.value);

    // Clear winner for year
    if (!userId) {
      delete winners[String(year)];
      await Setting.findOneAndUpdate(
        { key: WINNERS_BY_YEAR_KEY },
        { $set: { value: winners } },
        { upsert: true, new: true }
      );
      return res.status(200).json({ year, winner: null });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "userId invalide" });
    }

    const winnerUser = await User.findById(userId).select("name").lean();
    if (!winnerUser) {
      return res.status(404).json({ message: "User not found" });
    }

    winners[String(year)] = { userId: String(userId), points };

    await Setting.findOneAndUpdate(
      { key: WINNERS_BY_YEAR_KEY },
      { $set: { value: winners } },
      { upsert: true, new: true }
    );

    return res.status(200).json({
      year,
      winner: {
        year,
        userId: String(userId),
        name: winnerUser.name || null,
        points: points ?? null,
      },
    });
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;

