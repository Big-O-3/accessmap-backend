const express = require("express");
const cors = require("cors");

const authRouter = require("./routes/auth");
const venuesRouter = require("./routes/venues");
const reviewsRouter = require("./routes/reviews");
const photosRouter = require("./routes/photos");
const contributionsRouter = require("./routes/contributions");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "healthy" });
});

// Auth: register, login, and current-user (issues/validates JWTs).
app.use("/api/auth", authRouter);

// Prateek's venue endpoints (search, detail, score, route, create).
app.use("/api/venues", venuesRouter);

// Reviews read endpoint — the venue-detail page reads from this.
app.use("/api/reviews", reviewsRouter);

// Charles's photo + ML (Grounding DINO) detection endpoints.
app.use("/api/photos", photosRouter);

// Add Venue contribution submit (Step 4). Auth optional until the frontend
// ships a sign-in flow.
app.use("/api/contributions", contributionsRouter);

// TODO (team): mount verifications, users routers here.

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
