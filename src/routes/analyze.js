const express = require("express");
const multer = require("multer");

const { ML_SERVICE_URL, fetchWithTimeout, ML_FETCH_TIMEOUT_MS } = require("../lib/mlService");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// POST /api/analyze
// Proxy an unsaved image straight through to the ML service. Used by the
// Analyze page to preview detections BEFORE the photo is uploaded to
// Cloudinary. Keeps the ML service URL a server-side concern so the browser
// never talks to it directly.
router.post("/", upload.single("image"), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No image file provided (field 'image')" });
    }

    const form = new FormData();
    const blob = new Blob([req.file.buffer], {
      type: req.file.mimetype || "application/octet-stream",
    });
    form.append("image", blob, req.file.originalname || "photo.jpg");

    let mlResponse;
    try {
      mlResponse = await fetchWithTimeout(
        `${ML_SERVICE_URL}/analyze`,
        { method: "POST", body: form },
        ML_FETCH_TIMEOUT_MS,
      );
    } catch (err) {
      // A timeout is retryable (model busy/cold-starting); a connection error
      // means the service is down. Both are 503s the client can act on, rather
      // than a hung request or an opaque 500.
      const timedOut = err.name === "AbortError";
      return res.status(503).json({
        error: timedOut
          ? "The analyzer took too long to respond. Please try again."
          : "ML service unavailable. Please try again shortly.",
      });
    }
    if (!mlResponse.ok) {
      // Pass the ML service's own message through rather than flattening every
      // failure into an opaque 502. It sends a real explanation in the body,
      // and its 503 (model still cold-starting) is retryable — the client can
      // only offer "try again" if we keep that status intact.
      const detail = await mlResponse.json().catch(() => null);
      return res.status(mlResponse.status === 503 ? 503 : 502).json({
        error: detail?.error || `ML service error (${mlResponse.status})`,
      });
    }

    res.json(await mlResponse.json());
  } catch (err) {
    next(err);
  }
});

module.exports = router;
