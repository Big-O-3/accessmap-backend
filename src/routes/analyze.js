const express = require("express");
const multer = require("multer");

const { ML_SERVICE_URL } = require("../lib/mlService");

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

    const mlResponse = await fetch(`${ML_SERVICE_URL}/analyze`, {
      method: "POST",
      body: form,
    });
    if (!mlResponse.ok) {
      return res.status(502).json({ error: `ML service error (${mlResponse.status})` });
    }

    res.json(await mlResponse.json());
  } catch (err) {
    next(err);
  }
});

module.exports = router;
