const express = require("express");
const cors = require("cors");

const venuesRouter = require("./routes/venues");
const reviewsRouter = require("./routes/reviews");
const photosRouter = require("./routes/photos");
const contributionsRouter = require("./routes/contributions");

const app = express();

// Cross-origin allowlist. Auth is a Bearer header (Supabase access token), so
// we don't need `credentials: true` and can be strict about origins. Set
// CORS_ORIGINS as a comma-separated list to support both localhost and any LAN
// URL used by phones.
const ALLOWED_ORIGINS = (
  process.env.CORS_ORIGINS || "http://localhost:5173"
)
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      // Same-origin, curl, and server-to-server calls have no Origin header.
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      cb(new Error(`CORS: origin ${origin} not allowed`));
    },
  }),
);
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "healthy" });
});

// Prateek's venue endpoints (search, detail, score, route, create).
app.use("/api/venues", venuesRouter);

// Reviews read endpoint — the venue-detail page reads from this.
app.use("/api/reviews", reviewsRouter);

// Charles's photo + ML (Grounding DINO) detection endpoints.
app.use("/api/photos", photosRouter);

// Add Venue contribution submit (Step 4). Writes require a Supabase-issued
// access token via the requireAuth middleware.
app.use("/api/contributions", contributionsRouter);

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
