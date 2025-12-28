const mongoose = require("mongoose");

const oscarPickSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  year: { type: Number, required: true, index: true },
  picks: [{
    categoryNumber: { type: Number, required: true },
    categoryName: { type: String, required: true },
    selectedNominee: { type: String, required: true } // The nominee name they selected
  }],
  submittedAt: { type: Date, default: Date.now },
  score: { type: Number, default: null } // Calculated after winners are set
}, { timestamps: true });

// Ensure one pick submission per user per year
oscarPickSchema.index({ userId: 1, year: 1 }, { unique: true });

module.exports = mongoose.model("OscarPick", oscarPickSchema);

