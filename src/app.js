const express = require("express");
const cors = require("cors");

const venuesRouter = require("./routes/venues");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "healthy" });
});

// Prateek's venue endpoints (search, detail, score, create).
app.use("/api/venues", venuesRouter);

// TODO (team): mount auth, photos, ml, reviews, verifications, users routers here.

// 404 for unknown routes.
app.use((req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
});

// Central error handler.
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

module.exports = app;
