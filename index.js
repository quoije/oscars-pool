const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const cors = require("cors");

dotenv.config();
const app = express();

// Middleware
app.use(cors());
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

app.use(express.static('public'));
app.use("/api/users", userRoutes);
app.use("/api/movies", movieRoutes);
app.use("/api/version", versionRoutes);
app.use("/api/settings", settingsRoutes);

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
