const express = require("express");
const jwt = require("jsonwebtoken");
const OscarCategory = require("../models/OscarCategory");
const OscarPick = require("../models/OscarPick");
const User = require("../models/User");
const Setting = require("../models/Setting");

const router = express.Router();

const ACTIVE_YEAR_KEY = "active_oscar_year";

async function getOrInitActiveYear() {
  const existing = await Setting.findOne({ key: ACTIVE_YEAR_KEY });
  if (existing && typeof existing.value === "number") return existing.value;
  return new Date().getFullYear();
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
    req.user = decoded;
    next();
  });
}

function isAdmin(decoded) {
  return !!decoded?.admin;
}

function parseOscarYear(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n)) return null;
  if (n < 1900 || n > 3000) return null;
  return n;
}

// Get all categories for a year (for users to see what to pick)
router.get("/categories", verifyToken, async (req, res) => {
  try {
    const year = parseOscarYear(req.query.year) || await getOrInitActiveYear();
    const categories = await OscarCategory.find({ year })
      .sort({ categoryNumber: 1 })
      .lean();
    
    res.json({ year, categories });
  } catch (err) {
    console.error("Error fetching categories:", err);
    res.status(500).json({ error: err.message });
  }
});

// Submit picks (user)
router.post("/submit", verifyToken, async (req, res) => {
  try {
    const { year, picks } = req.body;
    const userId = req.user.id;
    const yearNum = parseOscarYear(year) || await getOrInitActiveYear();

    if (!Array.isArray(picks)) {
      return res.status(400).json({ message: "Picks must be an array" });
    }

    // Verify categories exist for this year
    const categories = await OscarCategory.find({ year: yearNum });
    if (categories.length === 0) {
      return res.status(400).json({ message: "No categories found for this year. Please import categories first." });
    }

    // Filter and validate picks - remove picks for deleted categories
    const categoryMap = new Map(categories.map(c => [c.categoryNumber, c]));
    const validPicks = [];
    
    if (picks.length > 0) {
      for (const pick of picks) {
        if (!pick.categoryNumber || !pick.selectedNominee) {
          continue; // Skip invalid picks
        }
        const category = categoryMap.get(pick.categoryNumber);
        if (!category) {
          // Category was deleted - skip this pick
          continue;
        }
        const nomineeExists = category.nominees.some(n => n.name === pick.selectedNominee);
        if (!nomineeExists) {
          // Nominee doesn't exist in this category - skip this pick
          continue;
        }
        validPicks.push({
          categoryNumber: pick.categoryNumber,
          categoryName: category.categoryName,
          selectedNominee: pick.selectedNominee
        });
      }
    }

    // Create or update picks (only with valid picks)
    const pickData = {
      userId,
      year: yearNum,
      picks: validPicks
    };

    const existingPick = await OscarPick.findOne({ userId, year: yearNum });
    if (existingPick) {
      existingPick.picks = pickData.picks;
      existingPick.submittedAt = new Date();
      await existingPick.save();
      return res.json({ message: "Picks updated successfully", pick: existingPick });
    } else {
      const newPick = new OscarPick(pickData);
      await newPick.save();
      return res.json({ message: "Picks submitted successfully", pick: newPick });
    }
  } catch (err) {
    console.error("Error submitting picks:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get user's own picks
router.get("/my-picks", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const year = parseOscarYear(req.query.year) || await getOrInitActiveYear();
    
    const pick = await OscarPick.findOne({ userId, year });
    
    if (!pick) {
      return res.json({ pick: null, year });
    }
    
    // Clean up picks for deleted categories
    const categories = await OscarCategory.find({ year }).lean();
    const categoryMap = new Map(categories.map(c => [c.categoryNumber, c]));
    
    if (pick.picks && Array.isArray(pick.picks)) {
      const originalLength = pick.picks.length;
      pick.picks = pick.picks.filter(p => {
        const category = categoryMap.get(p.categoryNumber);
        if (!category) return false; // Category was deleted
        // Also check if nominee still exists in category
        return category.nominees.some(n => n.name === p.selectedNominee);
      });
      
      // If picks were cleaned up, save the updated pick
      if (pick.picks.length !== originalLength) {
        await pick.save();
      }
    }
    
    res.json({ pick: pick.toObject(), year });
  } catch (err) {
    console.error("Error fetching user picks:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get all picks (admin only) - for viewing all users' picks
router.get("/all", verifyToken, async (req, res) => {
  try {
    if (!isAdmin(req.user)) {
      return res.status(403).json({ message: "You do not have admin privileges" });
    }

    const year = parseOscarYear(req.query.year) || await getOrInitActiveYear();
    
    const picks = await OscarPick.find({ year })
      .populate('userId', 'name email')
      .sort({ submittedAt: -1 })
      .lean();
    
    // Also get categories to show nominee options
    const categories = await OscarCategory.find({ year })
      .sort({ categoryNumber: 1 })
      .lean();
    
    res.json({ year, picks, categories });
  } catch (err) {
    console.error("Error fetching all picks:", err);
    res.status(500).json({ error: err.message });
  }
});

// Calculate scores for all users (admin only)
router.post("/calculate-scores", verifyToken, async (req, res) => {
  try {
    if (!isAdmin(req.user)) {
      return res.status(403).json({ message: "You do not have admin privileges" });
    }

    const { year } = req.body;
    const yearNum = parseOscarYear(year) || await getOrInitActiveYear();

    // Get all categories with winners marked
    const categories = await OscarCategory.find({ year: yearNum }).lean();
    const categoryWinners = new Map();
    
    categories.forEach(cat => {
      const winner = cat.nominees.find(n => n.isWinner);
      if (winner) {
        categoryWinners.set(cat.categoryNumber, winner.name);
      }
    });

    if (categoryWinners.size === 0) {
      return res.status(400).json({ message: "No winners marked for any category. Please mark winners first." });
    }

    // Get all picks for this year with user info
    const allPicks = await OscarPick.find({ year: yearNum })
      .populate('userId', 'name email')
      .lean();

    // Create a map of all categories for reference
    const categoryMap = new Map(categories.map(c => [c.categoryNumber, c]));

    // Calculate scores
    const scores = [];
    for (const pick of allPicks) {
      let correctCount = 0;
      const pickDetails = [];

      // Only process picks for categories that still exist
      pick.picks.forEach(p => {
        const category = categoryMap.get(p.categoryNumber);
        if (!category) {
          // Category was deleted - skip this pick
          return;
        }
        
        const correctWinner = categoryWinners.get(p.categoryNumber);
        const isCorrect = correctWinner && p.selectedNominee === correctWinner;
        if (isCorrect) correctCount++;
        
        pickDetails.push({
          categoryNumber: p.categoryNumber,
          categoryName: p.categoryName,
          selectedNominee: p.selectedNominee,
          correctWinner: correctWinner || null,
          isCorrect
        });
      });

      // Update the pick with score and clean up deleted category picks
      const validPicks = pick.picks.filter(p => categoryMap.has(p.categoryNumber));
      await OscarPick.findByIdAndUpdate(pick._id, { 
        score: correctCount,
        picks: validPicks
      });

      scores.push({
        userId: pick.userId?._id || pick.userId,
        userName: pick.userId?.name || 'Unknown',
        userEmail: pick.userId?.email || '',
        score: correctCount,
        totalCategories: categories.length,
        pickDetails
      });
    }

    // Sort by score (descending)
    scores.sort((a, b) => b.score - a.score);

    res.json({ 
      message: "Scores calculated successfully", 
      year: yearNum,
      scores,
      totalCategories: categories.length,
      categoriesWithWinners: categoryWinners.size
    });
  } catch (err) {
    console.error("Error calculating scores:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get scores for all users (available to all authenticated users)
router.get("/scores", verifyToken, async (req, res) => {
  try {
    const year = parseOscarYear(req.query.year) || await getOrInitActiveYear();

    // Clean up picks for deleted categories before fetching scores
    const categories = await OscarCategory.find({ year }).lean();
    const categoryMap = new Map(categories.map(c => [c.categoryNumber, c]));
    
    const picksToClean = await OscarPick.find({ year });
    for (const pick of picksToClean) {
      if (pick.picks && Array.isArray(pick.picks)) {
        const originalLength = pick.picks.length;
        pick.picks = pick.picks.filter(p => {
          const category = categoryMap.get(p.categoryNumber);
          if (!category) return false; // Category was deleted
          // Also check if nominee still exists in category
          return category.nominees.some(n => n.name === p.selectedNominee);
        });
        
        if (pick.picks.length !== originalLength) {
          await pick.save();
        }
      }
    }

    const picks = await OscarPick.find({ year })
      .populate('userId', 'name email')
      .sort({ score: -1, submittedAt: 1 })
      .lean();

    // Reuse categories already fetched for cleanup
    const categoryWinners = new Map();
    categories.forEach(cat => {
      const winner = cat.nominees.find(n => n.isWinner);
      if (winner) {
        categoryWinners.set(cat.categoryNumber, winner.name);
      }
    });

    const scores = picks.map(pick => {
      let correctCount = 0;
      const pickDetails = [];

      // Create a map of all categories for reference
      const categoryMap = new Map(categories.map(c => [c.categoryNumber, c]));

      // Only process picks for categories that still exist
      pick.picks.forEach(p => {
        const category = categoryMap.get(p.categoryNumber);
        if (!category) {
          // Category was deleted - skip this pick
          return;
        }
        
        const correctWinner = categoryWinners.get(p.categoryNumber);
        const isCorrect = correctWinner && p.selectedNominee === correctWinner;
        if (isCorrect) correctCount++;
        
        const allNominees = category.nominees.map(n => n.name);
        
        pickDetails.push({
          categoryNumber: p.categoryNumber,
          categoryName: p.categoryName,
          selectedNominee: p.selectedNominee,
          correctWinner: correctWinner || null,
          isCorrect,
          allNominees: allNominees
        });
      });

      return {
        userId: pick.userId?._id || pick.userId,
        userName: pick.userId?.name || 'Unknown',
        userEmail: pick.userId?.email || '',
        score: correctCount, // Always use the calculated score from existing categories
        totalCategories: categories.length,
        pickDetails,
        submittedAt: pick.submittedAt
      };
    });

    scores.sort((a, b) => b.score - a.score);

    res.json({ year, scores, totalCategories: categories.length, categoriesWithWinners: categoryWinners.size });
  } catch (err) {
    console.error("Error fetching scores:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

