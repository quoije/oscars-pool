const mongoose = require("mongoose");

const oscarCategorySchema = new mongoose.Schema({
  year: { type: Number, required: true, index: true },
  categoryNumber: { type: Number, required: true }, // 1-23 from the sheet
  categoryName: { type: String, required: true }, // e.g., "Best Picture"
  nominees: [{
    name: { type: String, required: true }, // e.g., "Anora" or "Sean Baker, Anora"
    isWinner: { type: Boolean, default: false } // Set when results are known
  }],
  // Store the raw text from PDF for reference
  rawText: { type: String, required: false }
}, { timestamps: true });

// Ensure unique category per year
oscarCategorySchema.index({ year: 1, categoryNumber: 1 }, { unique: true });

module.exports = mongoose.model("OscarCategory", oscarCategorySchema);

