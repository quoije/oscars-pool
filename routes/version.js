const axios = require("axios");
const express = require("express");
const moment = require("moment-timezone");

const router = express.Router();

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds
const TIMEZONE = "America/New_York";

// Cache is stored in the exact response shape expected by the client.
let latestCommitCache = null;

// Avoid noisy logs when GitHub isn't configured or is temporarily unavailable.
let lastLogTime = 0;
const LOG_THROTTLE_MS = 60 * 60 * 1000; // 1h

function nowFormatted() {
  return moment(Date.now()).tz(TIMEZONE).format("YYYY-MM-DD HH:mm:ss");
}

function getGitHubConfig() {
  const owner = typeof process.env.GITHUB_OWNER === "string" ? process.env.GITHUB_OWNER.trim() : "";
  const repo = typeof process.env.GITHUB_REPO === "string" ? process.env.GITHUB_REPO.trim() : "";
  return { owner, repo, configured: !!owner && !!repo };
}

function getPackageVersion() {
  try {
    // routes/version.js -> ../package.json
    const pkg = require("../package.json");
    return typeof pkg?.version === "string" && pkg.version.trim() ? pkg.version.trim() : "dev";
  } catch (_) {
    return "dev";
  }
}

function setFallbackCache(message, { configured } = { configured: false }) {
  latestCommitCache = {
    version: getPackageVersion(),
    message: message || "Version info not available.",
    author: "",
    date: nowFormatted(),
    configured: !!configured,
    source: "fallback",
  };
}

function logThrottled(...args) {
  const t = Date.now();
  if (t - lastLogTime < LOG_THROTTLE_MS) return;
  lastLogTime = t;
  // eslint-disable-next-line no-console
  console.error(...args);
}

async function fetchLatestCommitFromGitHub() {
  const { owner, repo, configured } = getGitHubConfig();
  if (!configured) {
    // Never attempt GitHub calls if not configured.
    setFallbackCache("Version endpoint is not configured.", { configured: false });
    return;
  }

  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/commits`;
    const response = await axios.get(url, {
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (response.data && response.data.length > 0) {
      const latestCommit = response.data[0];
      latestCommitCache = {
        version: String(latestCommit.sha || "").substring(0, 5),
        message: latestCommit?.commit?.message || "",
        author: latestCommit?.commit?.author?.name || "",
        date: moment(latestCommit?.commit?.author?.date || Date.now())
          .tz(TIMEZONE)
          .format("YYYY-MM-DD HH:mm:ss"),
        configured: true,
        source: "github",
      };
    } else {
      throw new Error("No commits found.");
    }
  } catch (error) {
    // Keep serving a non-500 response, and don't spam logs.
    logThrottled("Error fetching commit:", error?.message || error);
    setFallbackCache("GitHub commit data is not available.", { configured: true });
  }
}

// Initialize cache (without crashing / spamming when not configured).
const initialCfg = getGitHubConfig();
if (!initialCfg.configured) {
  setFallbackCache("Version endpoint is not configured.", { configured: false });
} else {
  fetchLatestCommitFromGitHub();
  const timer = setInterval(fetchLatestCommitFromGitHub, CACHE_DURATION);
  // Don't keep the process alive just for this polling.
  if (typeof timer.unref === "function") timer.unref();
}

// Route to get the latest commit (cached)
router.get("/", async (req, res) => {
  // Always return something (client clears footer on non-2xx).
  if (!latestCommitCache) {
    const cfg = getGitHubConfig();
    setFallbackCache("Version info not available.", { configured: cfg.configured });
  }
  return res.status(200).json(latestCommitCache);
});

module.exports = router;