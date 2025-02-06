const axios = require("axios");
const express = require("express");
const router = express.Router();

// Fetch the latest commit from a GitHub repository
async function fetchLatestCommitFromGitHub() {
    const githubOwner = process.env.GITHUB_OWNER;  // Your GitHub username or org
    const githubRepo = process.env.GITHUB_REPO;    // Your repository name
  
    try {
      const url = `https://api.github.com/repos/${githubOwner}/${githubRepo}/commits`;
  
      // Removed the unnecessary "body" property from the request
      const response = await axios.get(url, {
        headers: {
          'Content-Type': 'application/json',
        }
      });
  
      if (response.data && response.data.length > 0) {
        const latestCommit = response.data[0];
        return {
          sha: latestCommit.sha,
          message: latestCommit.commit.message,
          author: latestCommit.commit.author.name,
          date: latestCommit.commit.author.date,
        };
      } else {
        throw new Error('No commits found.');
      }
    } catch (error) {
      throw new Error(`Error fetching commit: ${error.message}`);
    }
  }  
  
  // Route to get the version (latest commit from GitHub)
  router.get("/", async (req, res) => {
    try {
      const latestCommit = await fetchLatestCommitFromGitHub();
      res.json({
        version: (latestCommit.sha).substring(0,5),
        message: latestCommit.message,
        author: latestCommit.author,
        date: latestCommit.date,
      });
    } catch (error) {
      console.error("Error fetching latest commit:", error);
      res.status(500).json({ message: "Error retrieving version information" });
    }
  });

  module.exports = router;