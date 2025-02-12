const axios = require("axios");
const express = require("express");
const moment = require("moment-timezone");

const router = express.Router();

let latestCommitCache = null;
let lastFetchedTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds

async function fetchLatestCommitFromGitHub() {
  const githubOwner = process.env.GITHUB_OWNER;
  const githubRepo = process.env.GITHUB_REPO;

  try {
    const url = `https://api.github.com/repos/${githubOwner}/${githubRepo}/commits`;
    const response = await axios.get(url, {
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (response.data && response.data.length > 0) {
      const latestCommit = response.data[0];
      latestCommitCache = {
        sha: latestCommit.sha,
        message: latestCommit.commit.message,
        author: latestCommit.commit.author.name,
        date: latestCommit.commit.author.date,
      };
      lastFetchedTime = Date.now();
    } else {
      throw new Error("No commits found.");
    }
  } catch (error) {
    console.error("Error fetching commit:", error.message);
  }
}

// Initial fetch to populate cache
fetchLatestCommitFromGitHub();

// Refresh cache every 5 minutes
setInterval(fetchLatestCommitFromGitHub, CACHE_DURATION);

// Route to get the latest commit (cached)
router.get("/", async (req, res) => {
  if (!latestCommitCache) {
    return res.status(500).json({ message: "Commit data is not available yet." });
  }

  res.json({
    version: latestCommitCache.sha.substring(0, 5),
    message: latestCommitCache.message,
    author: latestCommitCache.author,
    date: moment(latestCommitCache.date)
      .tz("America/New_York")
      .format("YYYY-MM-DD HH:mm:ss"),
  });
});

module.exports = router;