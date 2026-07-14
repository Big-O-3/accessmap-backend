const express = require("express");
const cors = require("cors");

const venuesRouter = require("./routes/venues");
const reviewsRouter = require("./routes/reviews");
const photosRouter = require("./routes/photos");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "healthy" });
});

// Prateek's venue endpoints (search, detail, score, route, create).
app.use("/api/venues", venuesRouter);

// Reviews read endpoint — the venue-detail page reads from this.
app.use("/api/reviews", reviewsRouter);

// Charles's photo + ML (YOLO-World) detection endpoints.
app.use("/api/photos", photosRouter);

// TODO (team): mount auth, verifications, users routers here.

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
