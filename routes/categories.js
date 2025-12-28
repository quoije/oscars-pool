const express = require("express");
const jwt = require("jsonwebtoken");
const path = require("path");
const fs = require("fs");
const OscarCategory = require("../models/OscarCategory");
const OscarPick = require("../models/OscarPick");

const router = express.Router();

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

// Helper function to clean nominee name
function cleanNomineeName(line) {
  return line.replace(/^[-☐•]\s*/g, '').replace(/^-\s*☐\s*/, '').trim();
}

// Helper function to check if a line is a valid nominee
function isValidNomineeLine(line, skipPatterns) {
  // Skip if it looks like a category header (number first or name first with number)
  if (line.match(/^(\d+)[\t\s]+(BEST|DOCUMENTARY|ANIMATED|LIVE|INTERNATIONAL|PRODUCTION|SOUND|MAKEUP|COSTUME|CINEMATOGRAPHY|ORIGINAL|ADAPTED|SCREENPLAY|FILM|EDITING|VISUAL|EFFECTS|SUPPORTING|ACTOR|ACTRESS|DIRECTOR|PICTURE)/i) ||
      line.match(/^(.+?)[\t\s]+\d+$/) || 
      line.match(/^\d+\./)) {
    return false;
  }
  
  // Skip header/metadata lines
  if (skipPatterns.test(line)) {
    return false;
  }
  
  const nomineeName = cleanNomineeName(line);
  if (!nomineeName || nomineeName.length === 0 || nomineeName.length >= 200) {
    return false;
  }
  
  // Skip lines that are just numbers or dashes
  if (nomineeName.match(/^-?\s*\d+\s*-?$/) || nomineeName.match(/^-+\s*$/)) {
    return false;
  }
  
  const upperLine = nomineeName.toUpperCase();
  // Skip if it looks like a header (but allow category names that might appear in nominees with commas)
  const isHeader = upperLine.match(/^(YOUR|SCORE|NAME|COVERS|OSCARS|PARTY|PROPS|SHEET)$/) ||
                  (upperLine.match(/^(BEST|DOCUMENTARY|ANIMATED|LIVE|INTERNATIONAL|PRODUCTION|SOUND|MAKEUP|COSTUME|CINEMATOGRAPHY|ORIGINAL|ADAPTED|SCREENPLAY|FILM|EDITING|VISUAL|EFFECTS|SUPPORTING|ACTOR|ACTRESS|DIRECTOR|PICTURE)$/) && 
                   !nomineeName.includes(',') && nomineeName.length < 30);
  
  return !isHeader;
}



// Manually create/update categories (admin only)
router.post("/create", verifyToken, async (req, res) => {
  try {
    if (!isAdmin(req.user)) {
      return res.status(403).json({ message: "You do not have admin privileges" });
    }

    const { year, categoryNumber, categoryName, nominees } = req.body;
    const yearNum = parseOscarYear(year) || new Date().getFullYear();

    if (!categoryNumber || !categoryName || !Array.isArray(nominees) || nominees.length === 0) {
      return res.status(400).json({ message: "categoryNumber, categoryName, and nominees array are required" });
    }

    const nomineesArray = nominees.map(n => ({
      name: typeof n === 'string' ? n : n.name,
      isWinner: typeof n === 'object' ? (n.isWinner || false) : false
    }));

    const category = await OscarCategory.findOneAndUpdate(
      { year: yearNum, categoryNumber },
      {
        year: yearNum,
        categoryNumber,
        categoryName,
        nominees: nomineesArray
      },
      { upsert: true, new: true }
    );

    res.json({ message: "Category saved successfully", category });
  } catch (err) {
    console.error("Error creating category:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get all categories for a year (admin view with management)
router.get("/list", verifyToken, async (req, res) => {
  try {
    if (!isAdmin(req.user)) {
      return res.status(403).json({ message: "You do not have admin privileges" });
    }

    const year = parseOscarYear(req.query.year) || new Date().getFullYear();
    const categories = await OscarCategory.find({ year })
      .sort({ categoryNumber: 1 })
      .lean();
    
    res.json({ year, categories });
  } catch (err) {
    console.error("Error fetching categories:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get a single category by ID (admin only) - must come after /list route
router.get("/:categoryId", verifyToken, async (req, res) => {
  try {
    if (!isAdmin(req.user)) {
      return res.status(403).json({ message: "You do not have admin privileges" });
    }

    const category = await OscarCategory.findById(req.params.categoryId).lean();
    
    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }
    
    res.json({ category });
  } catch (err) {
    console.error("Error fetching category:", err);
    res.status(500).json({ error: err.message });
  }
});

// Update a category (admin only)
router.put("/:categoryId", verifyToken, async (req, res) => {
  try {
    if (!isAdmin(req.user)) {
      return res.status(403).json({ message: "You do not have admin privileges" });
    }

    const { categoryNumber, categoryName, nominees } = req.body;

    if (!categoryName || !Array.isArray(nominees) || nominees.length === 0) {
      return res.status(400).json({ message: "categoryName and nominees array are required" });
    }

    if (categoryNumber !== undefined && categoryNumber !== null) {
      const categoryNum = parseInt(categoryNumber);
      if (!Number.isInteger(categoryNum) || categoryNum < 1 || categoryNum > 50) {
        return res.status(400).json({ message: "categoryNumber must be between 1 and 50" });
      }
    }

    const nomineesArray = nominees.map(n => ({
      name: typeof n === 'string' ? n : n.name,
      isWinner: typeof n === 'object' ? (n.isWinner || false) : false
    }));

    // Get the current category to check year and handle categoryNumber conflicts
    const currentCategory = await OscarCategory.findById(req.params.categoryId);
    if (!currentCategory) {
      return res.status(404).json({ message: "Category not found" });
    }

    const year = currentCategory.year;
    const updateData = {
      categoryName,
      nominees: nomineesArray
    };

    // If categoryNumber is being changed, check for conflicts and update existing picks
    if (categoryNumber !== undefined && categoryNumber !== null) {
      const newCategoryNum = parseInt(categoryNumber);
      if (newCategoryNum !== currentCategory.categoryNumber) {
        const oldCategoryNum = currentCategory.categoryNumber;
        
        // Check if another category with this number already exists for this year
        const existingCategory = await OscarCategory.findOne({
          year,
          categoryNumber: newCategoryNum,
          _id: { $ne: req.params.categoryId }
        });
        
        if (existingCategory) {
          return res.status(400).json({ 
            message: `Category number ${newCategoryNum} already exists for year ${year}` 
          });
        }
        
        // Update all existing picks that reference the old category number
        // Match by old categoryNumber and old categoryName to ensure we're updating the right picks
        const picksToUpdate = await OscarPick.find({ year });
        let updatedPicksCount = 0;
        
        for (const pick of picksToUpdate) {
          if (pick.picks && Array.isArray(pick.picks)) {
            let needsUpdate = false;
            const updatedPicks = pick.picks.map(p => {
              // Match by both old categoryNumber and old categoryName to be safe
              if (p.categoryNumber === oldCategoryNum && p.categoryName === currentCategory.categoryName) {
                needsUpdate = true;
                return {
                  ...p,
                  categoryNumber: newCategoryNum,
                  categoryName: categoryName // Update categoryName too if it changed
                };
              }
              return p;
            });
            
            if (needsUpdate) {
              pick.picks = updatedPicks;
              await pick.save();
              updatedPicksCount++;
            }
          }
        }
        
        updateData.categoryNumber = newCategoryNum;
        
        // Log the update (optional, for debugging)
        if (updatedPicksCount > 0) {
          console.log(`Updated ${updatedPicksCount} pick(s) when changing category number from ${oldCategoryNum} to ${newCategoryNum}`);
        }
      }
    }

    const category = await OscarCategory.findByIdAndUpdate(
      req.params.categoryId,
      updateData,
      { new: true }
    );

    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    res.json({ message: "Category updated successfully", category });
  } catch (err) {
    console.error("Error updating category:", err);
    res.status(500).json({ error: err.message });
  }
});

// Mark winner for a category (admin only)
router.put("/:categoryId/winner", verifyToken, async (req, res) => {
  try {
    if (!isAdmin(req.user)) {
      return res.status(403).json({ message: "You do not have admin privileges" });
    }

    const { winnerName } = req.body;
    const isClearing = !winnerName || winnerName === '' || winnerName === null;

    const category = await OscarCategory.findById(req.params.categoryId);
    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    if (isClearing) {
      // Clear all winners (set all nominees to not winners)
      category.nominees = category.nominees.map(n => ({
        ...n.toObject(),
        isWinner: false
      }));
      await category.save();
      return res.json({ message: "Winner cleared successfully", category });
    }

    // Mark all nominees as not winners, then mark the selected one as winner
    category.nominees = category.nominees.map(n => ({
      ...n.toObject(),
      isWinner: n.name === winnerName
    }));

    await category.save();

    res.json({ message: "Winner marked successfully", category });
  } catch (err) {
    console.error("Error marking winner:", err);
    res.status(500).json({ error: err.message });
  }
});

// Helper function to clean up picks for deleted categories
async function cleanupPicksForDeletedCategories(year) {
  try {
    const categories = await OscarCategory.find({ year }).lean();
    const categoryMap = new Map(categories.map(c => [c.categoryNumber, c]));
    
    const allPicks = await OscarPick.find({ year });
    let totalCleaned = 0;
    
    for (const pick of allPicks) {
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
          totalCleaned += (originalLength - pick.picks.length);
        }
      }
    }
    
    if (totalCleaned > 0) {
      console.log(`Cleaned up ${totalCleaned} pick(s) for deleted categories in year ${year}`);
    }
    
    return totalCleaned;
  } catch (err) {
    console.error("Error cleaning up picks:", err);
    throw err;
  }
}

// Delete a category (admin only)
router.delete("/:categoryId", verifyToken, async (req, res) => {
  try {
    if (!isAdmin(req.user)) {
      return res.status(403).json({ message: "You do not have admin privileges" });
    }

    const category = await OscarCategory.findById(req.params.categoryId);
    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    const year = category.year;
    
    // Delete the category
    await OscarCategory.findByIdAndDelete(req.params.categoryId);
    
    // Clean up picks for deleted categories
    await cleanupPicksForDeletedCategories(year);

    res.json({ message: "Category deleted successfully" });
  } catch (err) {
    console.error("Error deleting category:", err);
    res.status(500).json({ error: err.message });
  }
});

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../uploads/');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

module.exports = router;

