const mongoose = require("mongoose");

// Simple key/value store for global site settings.
// We currently use it for the "active Oscar year" that drives filtering.
const settingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    value: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Setting", settingSchema);

