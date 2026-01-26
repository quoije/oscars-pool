const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: Number, default: 0 },
  // If true, user must change password on next login (e.g. after admin reset)
  mustChangePassword: { type: Boolean, default: false },
  tempPasswordIssuedAt: { type: Date, default: null },
  tempPasswordExpiresAt: { type: Date, default: null },
  // Optional. When unset, UI follows system preference.
  themePreference: { type: String, enum: ["light", "dark"], default: undefined },
  watchedMovies: [{
    imdb_id: { type: String, required: false },
    watchedDate: { type: Date, default: Date.now }  // Store the watched date
  }]
});

const User = mongoose.model("User", userSchema);
module.exports = User;
