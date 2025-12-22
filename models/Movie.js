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
  // Server-hosted file (relative path under VIDEO_FILES_DIR, default public/video)
  // If set, the backend can stream it via /api/video/:movieId (Range/seek supported).
  video_file: { type: String, required: false },
  watchedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true });

// Common read patterns:
// - list movies for a year, sorted by title
// - check "last update" per year (sort by updatedAt)
movieSchema.index({ year: 1, title: 1 });
movieSchema.index({ year: 1, updatedAt: -1 });
movieSchema.index({ year: 1, imdb_id: 1 });

module.exports = mongoose.model("Movie", movieSchema);
