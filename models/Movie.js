const mongoose = require("mongoose");

const movieSchema = new mongoose.Schema({
  imdb_id: { type: String, required: true },
  title: { type: String, required: false },
  description: { type: String, required: false },
  rating: { type: String, required: false },
  poster: { type: String, required: false },
  category: { type: String, required: true },
  vod_link: { type: String, required: true },
  watchedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true });

module.exports = mongoose.model("Movie", movieSchema);
