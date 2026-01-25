const mongoose = require("mongoose");

const movieRatingSchema = new mongoose.Schema({
  movieId: { type: mongoose.Schema.Types.ObjectId, ref: "Movie", required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
}, { timestamps: true });

movieRatingSchema.index({ movieId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model("MovieRating", movieRatingSchema);
