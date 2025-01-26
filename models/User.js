const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: Number, default: 0 },
  watchedMovies: [{
    imdb_id: { type: String, required: false },
    watchedDate: { type: Date, default: Date.now }  // Store the watched date
  }]
});

const User = mongoose.model("User", userSchema);
module.exports = User;
