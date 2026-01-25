const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const cors = require("cors");
const compression = require("compression");

dotenv.config();
const app = express();

// Middleware
app.use(cors());
app.use(compression());
app.use(express.json());

// Connect to MongoDB
mongoose
  .connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error(err));

// Routes
const userRoutes = require("./routes/users");
const movieRoutes = require("./routes/movies");
const versionRoutes = require("./routes/version");
const settingsRoutes = require("./routes/settings");
const adminDbRoutes = require("./routes/adminDb");
const videoRoutes = require("./routes/video");
const subtitlesRoutes = require("./routes/subtitles");
const picksRoutes = require("./routes/picks");
const categoriesRoutes = require("./routes/categories");

app.use(express.static('public'));
app.use("/api/users", userRoutes);
app.use("/api/movies", movieRoutes);
app.use("/api/version", versionRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/admin", adminDbRoutes);
app.use("/api/video", videoRoutes);
app.use("/api/subtitles", subtitlesRoutes);
app.use("/api/picks", picksRoutes);
app.use("/api/categories", categoriesRoutes);

// Start Server
const PORT = process.env.PORT || 5050;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
