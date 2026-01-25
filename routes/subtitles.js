const express = require("express");
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const Movie = require("../models/Movie");

const router = express.Router();
const SUBTITLE_FILES_DIR = path.resolve(process.env.SUBTITLE_FILES_DIR || path.join(process.cwd(), "subtitles"));

function parseCookies(header) {
  const cookies = {};
  const raw = String(header || "");
  if (!raw) return cookies;
  raw.split(";").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx <= 0) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!k) return;
    cookies[k] = decodeURIComponent(v);
  });
  return cookies;
}

function getAuthToken(req) {
  const cookies = parseCookies(req.headers.cookie);
  const cookieToken = cookies.video_auth ? String(cookies.video_auth) : "";
  if (cookieToken) return cookieToken;
  const authHeader = String(req.headers.authorization || "");
  const headerToken = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  if (headerToken) return headerToken;
  const qs = typeof req.query?.token === "string" ? req.query.token.trim() : "";
  return qs || "";
}

function requireAuth(req, res) {
  const token = getAuthToken(req);
  if (!token) return { ok: false, error: res.status(401).json({ message: "Missing subtitle auth token" }) };
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return { ok: true, decoded };
  } catch (_) {
    return { ok: false, error: res.status(401).json({ message: "Invalid or expired subtitle auth token" }) };
  }
}

function isSafeRelativeFile(p) {
  if (typeof p !== "string") return false;
  const s = p.trim();
  if (!s) return false;
  if (s.includes("\0")) return false;
  if (path.isAbsolute(s)) return false;
  const norm = path.posix.normalize(s.replaceAll("\\", "/"));
  if (norm.startsWith("../") || norm === "..") return false;
  return true;
}

async function streamSubtitle(req, res) {
  const auth = requireAuth(req, res);
  if (!auth.ok) return;

  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: "Invalid movie id" });
  }

  const movie = await Movie.findById(id).select("subtitle_file").lean();
  const subtitleFile = typeof movie?.subtitle_file === "string" ? movie.subtitle_file.trim() : "";
  if (!subtitleFile) return res.status(404).json({ message: "No subtitles configured for this movie" });
  if (!isSafeRelativeFile(subtitleFile)) return res.status(400).json({ message: "Invalid subtitle_file path" });

  const fullPath = path.resolve(SUBTITLE_FILES_DIR, subtitleFile);
  if (!fullPath.startsWith(SUBTITLE_FILES_DIR + path.sep) && fullPath !== SUBTITLE_FILES_DIR) {
    return res.status(400).json({ message: "Invalid subtitle_file path" });
  }

  let stat;
  try {
    stat = await fs.promises.stat(fullPath);
  } catch (_) {
    return res.status(404).json({ message: "Subtitle file not found on server" });
  }
  if (!stat.isFile()) return res.status(404).json({ message: "Subtitle file not found on server" });

  res.setHeader("Content-Type", "text/vtt; charset=utf-8");
  res.setHeader("Content-Length", String(stat.size));
  res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");

  if (req.method === "HEAD") {
    return res.status(200).end();
  }

  return fs.createReadStream(fullPath).pipe(res);
}

router.get("/:id", (req, res) => {
  streamSubtitle(req, res).catch((err) => {
    return res.status(500).json({ error: err?.message || "Subtitle streaming error" });
  });
});

router.head("/:id", (req, res) => {
  streamSubtitle(req, res).catch((err) => {
    return res.status(500).json({ error: err?.message || "Subtitle streaming error" });
  });
});

module.exports = router;
