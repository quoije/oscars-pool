const mongoose = require("mongoose");

const playbackProgressSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    movieId: { type: mongoose.Schema.Types.ObjectId, ref: "Movie", required: true, index: true },
    // seconds
    time: { type: Number, default: 0 },
    // seconds (optional, best-effort from the client)
    duration: { type: Number, default: null },
    updatedAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

// One progress row per user + movie
playbackProgressSchema.index({ userId: 1, movieId: 1 }, { unique: true });

module.exports = mongoose.model("PlaybackProgress", playbackProgressSchema);

