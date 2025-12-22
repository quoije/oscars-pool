const express = require("express");
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const Movie = require("../models/Movie");

const router = express.Router();

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

function isSafeRelativeFile(p) {
  if (typeof p !== "string") return false;
  const s = p.trim();
  if (!s) return false;
  if (s.includes("\0")) return false;
  // No absolute paths
  if (path.isAbsolute(s)) return false;
  // Normalize and prevent traversal
  const norm = path.posix.normalize(s.replaceAll("\\", "/"));
  if (norm.startsWith("../") || norm === "..") return false;
  return true;
}

function guessContentType(filePath) {
  const ext = String(path.extname(filePath) || "").toLowerCase();
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  if (ext === ".ogv" || ext === ".ogg") return "video/ogg";
  if (ext === ".m4v") return "video/x-m4v";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".m3u8") return "application/vnd.apple.mpegurl";
  if (ext === ".ts") return "video/mp2t";
  return "application/octet-stream";
}

function getVideoBaseDir() {
  // Default to your existing public/video folder.
  const fromEnv = typeof process.env.VIDEO_FILES_DIR === "string" ? process.env.VIDEO_FILES_DIR.trim() : "";
  const base = fromEnv || path.join(process.cwd(), "public", "video");
  return path.resolve(base);
}

function getAuthToken(req) {
  // <video> can't send Authorization headers, so we use a cookie.
  const cookies = parseCookies(req.headers.cookie);
  const cookieToken = cookies.video_auth ? String(cookies.video_auth) : "";
  if (cookieToken) return cookieToken;
  // Optional fallback for non-browser clients:
  const authHeader = String(req.headers.authorization || "");
  const headerToken = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  if (headerToken) return headerToken;
  // Last resort (not recommended, but handy for debugging):
  const qs = typeof req.query?.token === "string" ? req.query.token.trim() : "";
  return qs || "";
}

function requireAuth(req, res) {
  const token = getAuthToken(req);
  if (!token) return { ok: false, error: res.status(401).json({ message: "Missing video auth token" }) };
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return { ok: true, decoded };
  } catch (_) {
    return { ok: false, error: res.status(401).json({ message: "Invalid or expired video auth token" }) };
  }
}

// Called by player.html via fetch() (with Authorization header) to set a cookie usable by <video>.
router.post("/session", (req, res) => {
  const authHeader = String(req.headers.authorization || "");
  const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return res.status(401).json({ message: "Token is required" });

  try {
    jwt.verify(token, process.env.JWT_SECRET);
    // Cookie scoped to /api/video so it doesn't leak broadly.
    // httpOnly helps a bit, even though the JWT originally lives in localStorage.
    const maxAgeSecondsRaw = typeof process.env.VIDEO_SESSION_MAX_AGE_SECONDS === "string" ? process.env.VIDEO_SESSION_MAX_AGE_SECONDS.trim() : "";
    const maxAgeSeconds = Number.isFinite(Number(maxAgeSecondsRaw)) && Number(maxAgeSecondsRaw) > 0
      ? Math.floor(Number(maxAgeSecondsRaw))
      : 60 * 60 * 8; // 8h
    const cookie = [
      `video_auth=${encodeURIComponent(token)}`,
      "Path=/api/video",
      `Max-Age=${maxAgeSeconds}`,
      "SameSite=Lax",
      // If behind HTTPS (recommended), enable Secure.
      ...(req.secure || req.headers["x-forwarded-proto"] === "https" ? ["Secure"] : []),
      "HttpOnly",
    ].join("; ");

    res.setHeader("Set-Cookie", cookie);
    return res.status(204).end();
  } catch (_) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
});

async function streamMovieFile(req, res) {
  const auth = requireAuth(req, res);
  if (!auth.ok) return;

  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: "Invalid movie id" });
  }

  const movie = await Movie.findById(id).select("video_file").lean();
  const videoFile = typeof movie?.video_file === "string" ? movie.video_file.trim() : "";
  if (!videoFile) {
    return res.status(404).json({ message: "No server video file configured for this movie" });
  }
  if (!isSafeRelativeFile(videoFile)) {
    return res.status(400).json({ message: "Invalid video_file path" });
  }

  const baseDir = getVideoBaseDir();
  const fullPath = path.resolve(baseDir, videoFile);
  if (!fullPath.startsWith(baseDir + path.sep) && fullPath !== baseDir) {
    return res.status(400).json({ message: "Invalid video_file path" });
  }

  let stat;
  try {
    stat = await fs.promises.stat(fullPath);
  } catch (_) {
    return res.status(404).json({ message: "Video file not found on server" });
  }
  if (!stat.isFile()) return res.status(404).json({ message: "Video file not found on server" });

  const fileSize = stat.size;
  const range = String(req.headers.range || "");
  const contentType = guessContentType(fullPath);

  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");

  // HEAD: only headers (no body)
  if (req.method === "HEAD") {
    res.setHeader("Content-Length", String(fileSize));
    return res.status(200).end();
  }

  if (!range) {
    res.setHeader("Content-Length", String(fileSize));
    return fs.createReadStream(fullPath).pipe(res);
  }

  // Example: "bytes=0-1023"
  const match = /^bytes=(\d*)-(\d*)$/i.exec(range);
  if (!match) {
    res.setHeader("Content-Range", `bytes */${fileSize}`);
    return res.status(416).end();
  }

  const startRaw = match[1];
  const endRaw = match[2];
  let start = startRaw ? Number(startRaw) : 0;
  let end = endRaw ? Number(endRaw) : fileSize - 1;

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < 0 || start > end) {
    res.setHeader("Content-Range", `bytes */${fileSize}`);
    return res.status(416).end();
  }

  if (start >= fileSize) {
    res.setHeader("Content-Range", `bytes */${fileSize}`);
    return res.status(416).end();
  }

  end = Math.min(end, fileSize - 1);
  const chunkSize = end - start + 1;

  res.status(206);
  res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
  res.setHeader("Content-Length", String(chunkSize));

  return fs.createReadStream(fullPath, { start, end }).pipe(res);
}

router.get("/:id", (req, res) => {
  streamMovieFile(req, res).catch((err) => {
    return res.status(500).json({ error: err?.message || "Video streaming error" });
  });
});

router.head("/:id", (req, res) => {
  streamMovieFile(req, res).catch((err) => {
    return res.status(500).json({ error: err?.message || "Video streaming error" });
  });
});

module.exports = router;

