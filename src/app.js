const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const authRouter = require("./routes/auth");
const venuesRouter = require("./routes/venues");
const reviewsRouter = require("./routes/reviews");
const photosRouter = require("./routes/photos");
const contributionsRouter = require("./routes/contributions");

const app = express();

// Cross-origin requests must be allowlisted explicitly because we send
// credentials (httpOnly session cookies). "*" + credentials is rejected by
// browsers. Set CORS_ORIGINS as a comma-separated list to support both
// localhost and the LAN URL used by phones.
const ALLOWED_ORIGINS = (
  process.env.CORS_ORIGINS || "https://localhost:5173"
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
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieParser());

app.get("/health", (_req, res) => {
  res.json({ status: "healthy" });
});

// Auth: register, login, logout, and current-user (issues/validates JWTs
// via an httpOnly cookie; the Bearer header still works for CLI/test tools).
app.use("/api/auth", authRouter);

// Prateek's venue endpoints (search, detail, score, route, create).
app.use("/api/venues", venuesRouter);

// Reviews read endpoint — the venue-detail page reads from this.
app.use("/api/reviews", reviewsRouter);

// Charles's photo + ML (Grounding DINO) detection endpoints.
app.use("/api/photos", photosRouter);

// Add Venue contribution submit (Step 4). Writes now require auth so we can
// attribute contributions to the signed-in user.
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
