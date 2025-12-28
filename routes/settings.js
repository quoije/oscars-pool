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
const OSCAR_DATES_BY_YEAR_KEY = "oscar_date_by_year";
const APP_VERSION_KEY = "app_version_control";
const PLAYER_ADMIN_STATUS_UI_KEY = "player_admin_status_ui";
const POINTS_CONFIG_KEY = "points_config";
const VISIBILITY_CONFIG_KEY = "visibility_config";

const crypto = require("crypto");

const DEFAULT_COMPLETION_MODAL = Object.freeze({
  title: "Félicitations! very nice 🎉🎉🎉",
  bodyText: "",
  videoSrc: "video/reward.mp4",
  bodyHtml: "",
});

const DEFAULT_PLAYER_ADMIN_STATUS_UI = Object.freeze({
  // Controls the admin-only debug/status block in player.html
  showSource: true,
  showProgress: true,
});

const DEFAULT_POINTS_CONFIG = Object.freeze({
  pointsPerMovie: 1,
  pointsPerCorrectPick: 1,
});

const DEFAULT_VISIBILITY_CONFIG = Object.freeze({
  showPicksButton: true,
  showBonPicksColumn: true,
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

function parseIsoDateString(raw) {
  // Expected format: YYYY-MM-DD
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);

  if (!Number.isInteger(year) || year < 1900 || year > 3000) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;

  // Validate calendar date (handles month/day overflow like Feb 30).
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null;
  }

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeOscarDatesByYear(rawValue) {
  // Stored format: { "2026": "2026-03-15" }
  const value = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) ? rawValue : {};
  const out = {};

  for (const [k, v] of Object.entries(value)) {
    const year = parseOscarYear(k);
    if (!year) continue;
    const date = parseIsoDateString(v);
    if (!date) continue;
    out[String(year)] = date;
  }

  return out;
}

function normalizeWinnersByYear(rawValue) {
  // Stored format:
  // - New: { "2026": [ { userId, points? }, { userId, points? } ] }
  // - Legacy: { "2026": { userId, points? } }
  const value = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) ? rawValue : {};
  const out = {};

  for (const [k, v] of Object.entries(value)) {
    const year = parseOscarYear(k);
    if (!year) continue;

    const list = Array.isArray(v) ? v : v && typeof v === "object" ? [v] : [];
    const dedup = new Map(); // userId -> {userId, points}

    for (const rawEntry of list) {
      const entry = rawEntry && typeof rawEntry === "object" && !Array.isArray(rawEntry) ? rawEntry : {};
      const userId = typeof entry.userId === "string" ? entry.userId.trim() : "";
      if (!userId || !mongoose.Types.ObjectId.isValid(userId)) continue;
      const points = parseOptionalPoints(entry.points);
      dedup.set(String(userId), { userId: String(userId), points });
    }

    const normalizedList = Array.from(dedup.values());
    if (normalizedList.length) {
      out[String(year)] = normalizedList;
    }
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

function normalizePlayerAdminStatusUi(rawValue) {
  const v = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) ? rawValue : {};
  const showSource = v.showSource === undefined ? DEFAULT_PLAYER_ADMIN_STATUS_UI.showSource : !!v.showSource;
  const showProgress = v.showProgress === undefined ? DEFAULT_PLAYER_ADMIN_STATUS_UI.showProgress : !!v.showProgress;
  return { showSource, showProgress };
}

function createId() {
  try {
    // Node 16+ / 18+: randomUUID
    if (crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch (_) {}
  // Fallback: time-based
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function normalizeAppVersionControl(rawValue) {
  const v = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) ? rawValue : {};
  const versions = Array.isArray(v.versions) ? v.versions : [];

  const cleaned = versions
    .map((e) => (e && typeof e === "object" && !Array.isArray(e) ? e : {}))
    .map((e) => {
      const id = typeof e.id === "string" ? e.id.trim() : "";
      const version = typeof e.version === "string" ? e.version.trim() : "";
      const message = typeof e.message === "string" ? e.message : "";
      const dateISO = typeof e.dateISO === "string" ? e.dateISO.trim() : "";
      const d = new Date(dateISO);
      const safeDateISO = dateISO && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
      return {
        id: id || null,
        version: version ? version.slice(0, 80) : null,
        message: String(message || "").slice(0, 500),
        dateISO: safeDateISO,
      };
    })
    .filter((e) => e.id && e.version)
    .sort((a, b) => {
      const ad = a.dateISO ? new Date(a.dateISO).getTime() : 0;
      const bd = b.dateISO ? new Date(b.dateISO).getTime() : 0;
      return bd - ad;
    });

  const activeId = typeof v.activeId === "string" ? v.activeId.trim() : "";
  const active = cleaned.find((e) => String(e.id) === String(activeId)) || null;

  return {
    activeId: active ? String(active.id) : cleaned[0]?.id ? String(cleaned[0].id) : null,
    versions: cleaned,
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

// Public: get Oscar date for a given year (with fallback).
// - If no custom date is configured, fallback is March 15 of that year (legacy behavior).
router.get("/oscar-date", async (req, res) => {
  try {
    const year = parseOscarYear(req.query?.year);
    if (!year) {
      return res.status(400).json({ message: "Année invalide (ex: 2026)" });
    }

    const existing = await Setting.findOne({ key: OSCAR_DATES_BY_YEAR_KEY }).select("value");
    const dates = normalizeOscarDatesByYear(existing?.value);
    const configured = dates[String(year)] || null;
    const effectiveDate = configured || `${String(year)}-03-15`;

    return res.status(200).json({
      year,
      date: configured, // configured value (null if unset)
      effectiveDate, // always present
    });
  } catch (err) {
    // Even if DB is down, keep the legacy fallback.
    const year = parseOscarYear(req.query?.year);
    if (year) {
      return res.status(200).json({ year, date: null, effectiveDate: `${String(year)}-03-15` });
    }
    return res.status(500).json({ error: err.message });
  }
});

// Public: get all configured Oscar dates.
router.get("/oscar-dates", async (req, res) => {
  try {
    const existing = await Setting.findOne({ key: OSCAR_DATES_BY_YEAR_KEY }).select("value");
    const dates = normalizeOscarDatesByYear(existing?.value);
    return res.status(200).json({ dates });
  } catch (err) {
    return res.status(200).json({ dates: {} });
  }
});

// Admin-only: set/clear Oscar date for a given year.
// Body: { date: "YYYY-MM-DD" } or { date: "" } to clear.
router.put("/oscar-date/:year", async (req, res) => {
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

    const rawDate = req.body?.date;
    const date = parseIsoDateString(rawDate);
    const wantsClear = rawDate === "" || rawDate === null || rawDate === undefined || (typeof rawDate === "string" && rawDate.trim() === "");

    if (!wantsClear && !date) {
      return res.status(400).json({ message: "Date invalide (format attendu: YYYY-MM-DD)" });
    }

    const existing = await Setting.findOne({ key: OSCAR_DATES_BY_YEAR_KEY }).select("value");
    const dates = normalizeOscarDatesByYear(existing?.value);

    if (wantsClear) {
      delete dates[String(year)];
    } else {
      dates[String(year)] = date;
    }

    await Setting.findOneAndUpdate(
      { key: OSCAR_DATES_BY_YEAR_KEY },
      { $set: { value: dates } },
      { upsert: true, new: true }
    );

    return res.status(200).json({ year, date: dates[String(year)] || null });
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }
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
      .flatMap(([yearStr, list]) =>
        (Array.isArray(list) ? list : []).map((v) => ({
          year: Number(yearStr),
          userId: v.userId,
          points: v.points ?? null,
        }))
      )
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

// Public: get app version control (active + list)
router.get("/app-version", async (req, res) => {
  try {
    const existing = await Setting.findOne({ key: APP_VERSION_KEY }).select("value").lean();
    const control = normalizeAppVersionControl(existing?.value);
    const active = control.activeId
      ? control.versions.find((v) => String(v.id) === String(control.activeId)) || null
      : null;
    return res.status(200).json({ active, versions: control.versions });
  } catch (_) {
    return res.status(200).json({ active: null, versions: [] });
  }
});

// Public: get player admin status UI flags (source/progress visibility)
router.get("/player-admin-status-ui", async (req, res) => {
  try {
    const existing = await Setting.findOne({ key: PLAYER_ADMIN_STATUS_UI_KEY }).select("value");
    const normalized = normalizePlayerAdminStatusUi(existing?.value);
    return res.status(200).json(normalized);
  } catch (_) {
    return res.status(200).json(DEFAULT_PLAYER_ADMIN_STATUS_UI);
  }
});

// Admin-only: update player admin status UI flags
// Body: { showSource?: boolean, showProgress?: boolean }
router.put("/player-admin-status-ui", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Authentication token is required" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.admin) {
      return res.status(403).json({ message: "You do not have admin privileges" });
    }

    const normalized = normalizePlayerAdminStatusUi(req.body);
    const updated = await Setting.findOneAndUpdate(
      { key: PLAYER_ADMIN_STATUS_UI_KEY },
      { $set: { value: normalized } },
      { upsert: true, new: true }
    ).select("value");

    return res.status(200).json(normalizePlayerAdminStatusUi(updated?.value));
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }
    return res.status(500).json({ error: err.message });
  }
});

// Admin-only: create a new version entry (optionally activates if none or if activate=true)
// Body: { version: "1.2.3", message?: "..." }
router.post("/app-version", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Authentication token is required" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.admin) {
      return res.status(403).json({ message: "You do not have admin privileges" });
    }

    const version = typeof req.body?.version === "string" ? req.body.version.trim() : "";
    const message = typeof req.body?.message === "string" ? req.body.message : "";
    if (!version) return res.status(400).json({ message: "Version requise (ex: 1.0.0)" });

    const existing = await Setting.findOne({ key: APP_VERSION_KEY }).select("value").lean();
    const control = normalizeAppVersionControl(existing?.value);

    const entry = {
      id: createId(),
      version: version.slice(0, 80),
      message: String(message || "").slice(0, 500),
      dateISO: new Date().toISOString(),
    };

    const next = {
      activeId: control.activeId,
      versions: [entry, ...(Array.isArray(control.versions) ? control.versions : [])],
    };

    const wantsActivate = String(req.query?.activate || "").toLowerCase() === "true";
    if (!next.activeId || wantsActivate) {
      next.activeId = entry.id;
    }

    const updated = await Setting.findOneAndUpdate(
      { key: APP_VERSION_KEY },
      { $set: { value: next } },
      { upsert: true, new: true }
    ).select("value");

    const normalized = normalizeAppVersionControl(updated?.value);
    const active = normalized.activeId
      ? normalized.versions.find((v) => String(v.id) === String(normalized.activeId)) || null
      : null;
    return res.status(200).json({ active, versions: normalized.versions });
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }
    return res.status(500).json({ error: err.message });
  }
});

// Admin-only: set active version by id
// Body: { id: "<versionId>" }
router.put("/app-version/active", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Authentication token is required" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.admin) {
      return res.status(403).json({ message: "You do not have admin privileges" });
    }

    const id = typeof req.body?.id === "string" ? req.body.id.trim() : "";
    if (!id) return res.status(400).json({ message: "id requis" });

    const existing = await Setting.findOne({ key: APP_VERSION_KEY }).select("value").lean();
    const control = normalizeAppVersionControl(existing?.value);
    const exists = control.versions.find((v) => String(v.id) === String(id));
    if (!exists) return res.status(404).json({ message: "Version introuvable" });

    const next = { activeId: String(id), versions: control.versions };
    const updated = await Setting.findOneAndUpdate(
      { key: APP_VERSION_KEY },
      { $set: { value: next } },
      { upsert: true, new: true }
    ).select("value");

    const normalized = normalizeAppVersionControl(updated?.value);
    const active = normalized.activeId
      ? normalized.versions.find((v) => String(v.id) === String(normalized.activeId)) || null
      : null;
    return res.status(200).json({ active, versions: normalized.versions });
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }
    return res.status(500).json({ error: err.message });
  }
});

// Admin-only: delete a version entry by id (re-picks active if needed)
router.delete("/app-version/:id", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Authentication token is required" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.admin) {
      return res.status(403).json({ message: "You do not have admin privileges" });
    }

    const id = typeof req.params?.id === "string" ? req.params.id.trim() : "";
    if (!id) return res.status(400).json({ message: "id requis" });

    const existing = await Setting.findOne({ key: APP_VERSION_KEY }).select("value").lean();
    const control = normalizeAppVersionControl(existing?.value);
    const nextVersions = control.versions.filter((v) => String(v.id) !== String(id));
    const next = {
      activeId: control.activeId && String(control.activeId) === String(id) ? null : control.activeId,
      versions: nextVersions,
    };
    if (!next.activeId && nextVersions.length) next.activeId = String(nextVersions[0].id);

    const updated = await Setting.findOneAndUpdate(
      { key: APP_VERSION_KEY },
      { $set: { value: next } },
      { upsert: true, new: true }
    ).select("value");

    const normalized = normalizeAppVersionControl(updated?.value);
    const active = normalized.activeId
      ? normalized.versions.find((v) => String(v.id) === String(normalized.activeId)) || null
      : null;
    return res.status(200).json({ active, versions: normalized.versions });
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }
    return res.status(500).json({ error: err.message });
  }
});

// Admin-only: add/upsert/clear winners for a given year. Points optional.
// - Clear all for year: { userId: "" } (legacy behavior)
// - Add/upsert winner for year: { userId: "<mongoId>", points?: number|null }
// - Replace full list for year: { winners: [{ userId, points? }, ...] }
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

    const existing = await Setting.findOne({ key: WINNERS_BY_YEAR_KEY }).select("value");
    const winners = normalizeWinnersByYear(existing?.value);

    // Replace list mode: { winners: [...] }
    if (Array.isArray(req.body?.winners)) {
      const replacement = normalizeWinnersByYear({ [String(year)]: req.body.winners })[String(year)] || [];
      if (!replacement.length) {
        delete winners[String(year)];
      } else {
        winners[String(year)] = replacement;
      }
      await Setting.findOneAndUpdate(
        { key: WINNERS_BY_YEAR_KEY },
        { $set: { value: winners } },
        { upsert: true, new: true }
      );
      return res.status(200).json({ year, winners: winners[String(year)] || [] });
    }

    // Add/upsert/clear mode (legacy-compatible): { userId, points? }
    const rawUserId = req.body?.userId;
    const userId = typeof rawUserId === "string" ? rawUserId.trim() : rawUserId === null ? "" : "";
    const points = parseOptionalPoints(req.body?.points);

    // Clear all for year
    if (!userId) {
      delete winners[String(year)];
      await Setting.findOneAndUpdate(
        { key: WINNERS_BY_YEAR_KEY },
        { $set: { value: winners } },
        { upsert: true, new: true }
      );
      return res.status(200).json({ year, winners: [] });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "userId invalide" });
    }

    const winnerUser = await User.findById(userId).select("name").lean();
    if (!winnerUser) return res.status(404).json({ message: "User not found" });

    const key = String(year);
    const current = Array.isArray(winners[key]) ? winners[key] : [];
    const next = current.filter((w) => String(w?.userId || "") !== String(userId));
    next.push({ userId: String(userId), points });
    winners[key] = next;

    await Setting.findOneAndUpdate(
      { key: WINNERS_BY_YEAR_KEY },
      { $set: { value: winners } },
      { upsert: true, new: true }
    );

    return res.status(200).json({
      year,
      winner: { year, userId: String(userId), name: winnerUser.name || null, points: points ?? null },
      winners: winners[String(year)] || [],
    });
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }
    return res.status(500).json({ error: err.message });
  }
});

// Admin-only: remove a specific winner for a given year.
router.delete("/winners/:year/:userId", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Authentication token is required" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.admin) {
      return res.status(403).json({ message: "You do not have admin privileges" });
    }

    const year = parseOscarYear(req.params?.year);
    if (!year) return res.status(400).json({ message: "Année invalide (ex: 2026)" });

    const userId = typeof req.params?.userId === "string" ? req.params.userId.trim() : "";
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "userId invalide" });
    }

    const existing = await Setting.findOne({ key: WINNERS_BY_YEAR_KEY }).select("value");
    const winners = normalizeWinnersByYear(existing?.value);
    const key = String(year);
    const current = Array.isArray(winners[key]) ? winners[key] : [];
    const next = current.filter((w) => String(w?.userId || "") !== String(userId));
    if (next.length) winners[key] = next;
    else delete winners[key];

    await Setting.findOneAndUpdate(
      { key: WINNERS_BY_YEAR_KEY },
      { $set: { value: winners } },
      { upsert: true, new: true }
    );

    return res.status(200).json({ year, winners: winners[key] || [] });
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }
    return res.status(500).json({ error: err.message });
  }
});

function normalizePointsConfig(rawValue) {
  const v = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) ? rawValue : {};
  const pointsPerMovie = typeof v.pointsPerMovie === "number" && v.pointsPerMovie >= 0 ? Math.round(v.pointsPerMovie) : DEFAULT_POINTS_CONFIG.pointsPerMovie;
  const pointsPerCorrectPick = typeof v.pointsPerCorrectPick === "number" && v.pointsPerCorrectPick >= 0 ? Math.round(v.pointsPerCorrectPick) : DEFAULT_POINTS_CONFIG.pointsPerCorrectPick;
  return { pointsPerMovie, pointsPerCorrectPick };
}

function normalizeVisibilityConfig(rawValue) {
  const v = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) ? rawValue : {};
  const showPicksButton = typeof v.showPicksButton === "boolean" ? v.showPicksButton : DEFAULT_VISIBILITY_CONFIG.showPicksButton;
  const showBonPicksColumn = typeof v.showBonPicksColumn === "boolean" ? v.showBonPicksColumn : DEFAULT_VISIBILITY_CONFIG.showBonPicksColumn;
  return { showPicksButton, showBonPicksColumn };
}

// Public: get points configuration
router.get("/points-config", async (req, res) => {
  try {
    const existing = await Setting.findOne({ key: POINTS_CONFIG_KEY }).select("value");
    const normalized = normalizePointsConfig(existing?.value);
    return res.status(200).json(normalized);
  } catch (err) {
    return res.status(200).json(DEFAULT_POINTS_CONFIG);
  }
});

// Admin-only: set points configuration
router.put("/points-config", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Authentication token is required" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.admin) {
      return res.status(403).json({ message: "You do not have admin privileges" });
    }

    const normalized = normalizePointsConfig(req.body);
    const updated = await Setting.findOneAndUpdate(
      { key: POINTS_CONFIG_KEY },
      { $set: { value: normalized } },
      { upsert: true, new: true }
    ).select("value");

    return res.status(200).json(normalizePointsConfig(updated?.value));
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }
    return res.status(500).json({ error: err.message });
  }
});

// Public: get visibility configuration
router.get("/visibility-config", async (req, res) => {
  try {
    const existing = await Setting.findOne({ key: VISIBILITY_CONFIG_KEY }).select("value");
    const normalized = normalizeVisibilityConfig(existing?.value);
    return res.status(200).json(normalized);
  } catch (err) {
    return res.status(200).json(DEFAULT_VISIBILITY_CONFIG);
  }
});

// Admin-only: set visibility configuration
router.put("/visibility-config", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Authentication token is required" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.admin) {
      return res.status(403).json({ message: "You do not have admin privileges" });
    }

    const normalized = normalizeVisibilityConfig(req.body);
    const updated = await Setting.findOneAndUpdate(
      { key: VISIBILITY_CONFIG_KEY },
      { $set: { value: normalized } },
      { upsert: true, new: true }
    ).select("value");

    return res.status(200).json(normalizeVisibilityConfig(updated?.value));
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;

