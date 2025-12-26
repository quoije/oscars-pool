const express = require("express");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { PDFParse } = require("pdf-parse");
const OscarCategory = require("../models/OscarCategory");

const router = express.Router();

// Configure multer for PDF uploads
const upload = multer({
  dest: path.join(__dirname, '../uploads/'),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  }
});

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
  // Skip if it looks like a category header
  if (line.match(/^(.+?)[\t\s]+\d+$/) || line.match(/^\d+\./)) {
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
  
  const upperLine = nomineeName.toUpperCase();
  // Skip if it looks like a header (but allow category names that might appear in nominees with commas)
  const isHeader = upperLine.match(/^(YOUR|SCORE|NAME|COVERS|OSCARS|PARTY|PROPS|SHEET)$/) ||
                  (upperLine.match(/^(BEST|DOCUMENTARY|ANIMATED|LIVE|INTERNATIONAL|PRODUCTION|SOUND|MAKEUP|COSTUME|CINEMATOGRAPHY|ORIGINAL|ADAPTED|SCREENPLAY|FILM|EDITING|VISUAL|EFFECTS|SUPPORTING|ACTOR|ACTRESS|DIRECTOR|PICTURE)$/) && 
                   !nomineeName.includes(',') && nomineeName.length < 30);
  
  return !isHeader;
}

// Parse PDF text and extract categories/nominees
async function parsePDFText(pdfText) {
  const categories = [];
  const lines = pdfText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  
  // First pass: identify all category headers and their positions
  const categoryHeaders = [];
  const skipPatterns = /^(COVERS|OSCARS|PARTY|PROPS|SHEET|YOUR|NAME|SCORE|____|Your Name|Your Score)/i;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Skip header/metadata lines
    if (skipPatterns.test(line)) {
      continue;
    }
    
    // Match category in format: "Category Name\tNumber" or "Category Name Number"
    const categoryMatch = line.match(/^(.+?)[\t\s]+(\d+)$/);
    if (categoryMatch) {
      const categoryName = categoryMatch[1].trim().replace(/\*\*/g, '').trim();
      const categoryNumber = parseInt(categoryMatch[2]);
      
      // Skip invalid entries
      if (categoryName.length < 3 || categoryNumber < 1 || categoryNumber > 50) {
        continue;
      }
      
      // Filter out false positives - must contain common Oscar category keywords
      const upperName = categoryName.toUpperCase();
      const isOscarCategory = upperName.includes('BEST') || 
                             upperName.includes('DIRECTOR') ||
                             upperName.includes('ACTOR') ||
                             upperName.includes('ACTRESS') ||
                             upperName.includes('PICTURE') ||
                             upperName.includes('SCREENPLAY') ||
                             upperName.includes('EDITING') ||
                             upperName.includes('CINEMATOGRAPHY') ||
                             upperName.includes('COSTUME') ||
                             upperName.includes('SOUND') ||
                             upperName.includes('VISUAL') ||
                             upperName.includes('EFFECTS') ||
                             upperName.includes('ORIGINAL') ||
                             upperName.includes('ADAPTED') ||
                             upperName.includes('DOCUMENTARY') ||
                             upperName.includes('ANIMATED') ||
                             upperName.includes('INTERNATIONAL') ||
                             upperName.includes('PRODUCTION') ||
                             upperName.includes('MAKEUP') ||
                             upperName.includes('HAIRSTYLING') ||
                             upperName.includes('LIVE-ACTION') ||
                             upperName.includes('SHORT');
      
      // Also allow "Makeup and Hairstyling" format
      if (!isOscarCategory && !upperName.match(/^(MAKEUP|PRODUCTION|SOUND)$/)) {
        continue;
      }
      
      categoryHeaders.push({
        index: i,
        categoryNumber: categoryNumber,
        categoryName: categoryName,
        rawText: line
      });
      continue;
    }
    
    // Also try format: "Number. Category Name" (fallback)
    const altCategoryMatch = line.match(/^(\d+)\.\s*(?:\*\*)?(.+?)(?:\*\*)?(?:\s*-)?$/);
    if (altCategoryMatch) {
      const categoryNumber = parseInt(altCategoryMatch[1]);
      let categoryName = altCategoryMatch[2].trim().replace(/\*\*/g, '').replace(/^-\s*/, '').trim();
      
      if (categoryName.length < 3 || categoryNumber < 1 || categoryNumber > 50) {
        continue;
      }
      
      categoryHeaders.push({
        index: i,
        categoryNumber: categoryNumber,
        categoryName: categoryName,
        rawText: line
      });
    }
  }
  
  // Sort category headers by their position in the document
  categoryHeaders.sort((a, b) => a.index - b.index);
  
  // Second pass: collect nominees for each category
  // In the PDF, nominees can appear BEFORE their category header
  for (let h = 0; h < categoryHeaders.length; h++) {
    const header = categoryHeaders[h];
    const prevHeaderIndex = h > 0 ? categoryHeaders[h - 1].index : -1;
    const nextHeaderIndex = h < categoryHeaders.length - 1 ? categoryHeaders[h + 1].index : lines.length;
    
    const nominees = [];
    
    // Collect nominees that appear AFTER this category header (until next category)
    // Focus on nominees after the header for better accuracy
    for (let i = header.index + 1; i < nextHeaderIndex; i++) {
      const line = lines[i];
      if (isValidNomineeLine(line, skipPatterns)) {
        const nomineeName = cleanNomineeName(line);
        // Skip obviously wrong entries like "- 1 of 1 --"
        if (nomineeName && !nomineeName.match(/^-?\s*\d+\s*of\s*\d+\s*-?$/)) {
          nominees.push({ name: nomineeName, isWinner: false });
        }
      }
    }
    
    // Remove duplicates
    const uniqueNominees = [];
    const seen = new Set();
    for (const nom of nominees) {
      const key = nom.name.toLowerCase().trim();
      if (key && !seen.has(key)) {
        seen.add(key);
        uniqueNominees.push(nom);
      }
    }
    
    // Only add category if it has nominees
    if (uniqueNominees.length > 0) {
      categories.push({
        categoryNumber: header.categoryNumber,
        categoryName: header.categoryName,
        nominees: uniqueNominees,
        rawText: header.rawText
      });
    }
  }
  
  // Sort categories by category number
  categories.sort((a, b) => a.categoryNumber - b.categoryNumber);
  
  return categories;
}

// Import categories from PDF (admin only)
router.post("/import-pdf", verifyToken, upload.single('pdf'), async (req, res) => {
  try {
    if (!isAdmin(req.user)) {
      return res.status(403).json({ message: "You do not have admin privileges" });
    }

    if (!req.file) {
      return res.status(400).json({ message: "No PDF file uploaded" });
    }

    const year = parseOscarYear(req.body.year) || new Date().getFullYear();
    const pdfPath = req.file.path;

    // Parse PDF
    let pdfText;
    try {
      const pdfBuffer = fs.readFileSync(pdfPath);
      const parser = new PDFParse({ data: pdfBuffer });
      const textResult = await parser.getText();
      pdfText = textResult.text;
      
      // Cleanup parser
      await parser.destroy();
    } catch (err) {
      // Cleanup file
      fs.unlinkSync(pdfPath);
      return res.status(400).json({ message: `Error parsing PDF: ${err.message}` });
    }

    // Cleanup uploaded file
    fs.unlinkSync(pdfPath);

    // Parse categories from text
    const parsedCategories = await parsePDFText(pdfText);
    
    if (parsedCategories.length === 0) {
      return res.status(400).json({ message: "No categories found in PDF. Please check the format." });
    }

    // Save categories to database
    const savedCategories = [];
    for (const cat of parsedCategories) {
      const category = await OscarCategory.findOneAndUpdate(
        { year, categoryNumber: cat.categoryNumber },
        {
          year,
          categoryNumber: cat.categoryNumber,
          categoryName: cat.categoryName,
          nominees: cat.nominees,
          rawText: cat.rawText
        },
        { upsert: true, new: true }
      );
      savedCategories.push(category);
    }

    res.json({
      message: `Successfully imported ${savedCategories.length} categories`,
      year,
      categories: savedCategories
    });
  } catch (err) {
    console.error("Error importing PDF:", err);
    // Cleanup file if it exists
    if (req.file && req.file.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (_) {}
    }
    res.status(500).json({ error: err.message });
  }
});

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

// Update a category (admin only)
router.put("/:categoryId", verifyToken, async (req, res) => {
  try {
    if (!isAdmin(req.user)) {
      return res.status(403).json({ message: "You do not have admin privileges" });
    }

    const { categoryName, nominees } = req.body;

    if (!categoryName || !Array.isArray(nominees) || nominees.length === 0) {
      return res.status(400).json({ message: "categoryName and nominees array are required" });
    }

    const nomineesArray = nominees.map(n => ({
      name: typeof n === 'string' ? n : n.name,
      isWinner: typeof n === 'object' ? (n.isWinner || false) : false
    }));

    const category = await OscarCategory.findByIdAndUpdate(
      req.params.categoryId,
      {
        categoryName,
        nominees: nomineesArray
      },
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
    if (!winnerName) {
      return res.status(400).json({ message: "winnerName is required" });
    }

    const category = await OscarCategory.findById(req.params.categoryId);
    if (!category) {
      return res.status(404).json({ message: "Category not found" });
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

// Delete a category (admin only)
router.delete("/:categoryId", verifyToken, async (req, res) => {
  try {
    if (!isAdmin(req.user)) {
      return res.status(403).json({ message: "You do not have admin privileges" });
    }

    const category = await OscarCategory.findByIdAndDelete(req.params.categoryId);
    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

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

