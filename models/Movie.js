const mongoose = require("mongoose");

const movieSchema = new mongoose.Schema({
  imdb_id: { type: String, required: true },
  title: { type: String, required: false },
  description: { type: String, required: false },
  rating: { type: String, required: false },
  poster: { type: String, required: false },
  // Oscar pool year / edition (used to segment movies + stats)
  year: { type: Number, required: false, index: true },
  category: { type: String, required: true },
  // Legacy "one field" player source.
  // Kept for backwards-compat. New UI prefers video_src / embed_src.
  vod_link: { type: String, required: false },

  // Player configuration (optional; used by player.html)
  player_mode: { type: String, required: false, enum: ["auto", "video", "embed"], default: "auto" },
  video_src: { type: String, required: false }, // direct video file URL or HLS (.m3u8)
  embed_src: { type: String, required: false }, // URL or iframe code
  watchedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true });

module.exports = mongoose.model("Movie", movieSchema);
