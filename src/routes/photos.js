const express = require("express");
const prisma = require("../lib/prisma");
const { analyzePhoto, MODEL_VERSION } = require("../lib/mlService");

const router = express.Router();

// Detections at or above this confidence are counted as "high confidence" and
// pre-checked for the contributor. Mirrors the ML service's threshold.
const HIGH_CONFIDENCE = 0.85;

// POST /api/photos
// Register a photo for a venue. Cloudinary upload isn't wired yet, so we accept
// an already-hosted image URL; swap for a real upload later without changing
// the analyze flow.
router.post("/", async (req, res, next) => {
  try {
    const { venueId, imageUrl, thumbnailUrl, userId } = req.body;

    if (!venueId || !imageUrl) {
      return res.status(400).json({ error: "venueId and imageUrl are required" });
    }

    const venue = await prisma.venue.findUnique({ where: { id: venueId } });
    if (!venue) {
      return res.status(404).json({ error: "Venue not found" });
    }

    const photo = await prisma.photo.create({
      data: {
        venueId,
        imageUrl,
        thumbnailUrl: thumbnailUrl ?? null,
        userId: userId ?? null,
      },
    });

    // Keep the venue's denormalized photo count in sync.
    await prisma.venue.update({
      where: { id: venueId },
      data: { totalPhotos: { increment: 1 } },
    });

    res.status(201).json(photo);
  } catch (err) {
    next(err);
  }
});

// GET /api/photos/:id
// Return a photo with its stored detections.
router.get("/:id", async (req, res, next) => {
  try {
    const photo = await prisma.photo.findUnique({
      where: { id: req.params.id },
      include: { detections: true },
    });

    if (!photo) {
      return res.status(404).json({ error: "Photo not found" });
    }

    res.json(photo);
  } catch (err) {
    next(err);
  }
});

// POST /api/photos/:id/analyze
// Run the YOLO-World ML service on the photo, then persist an MLAnalysis row and
// its Detection rows. Returns the detections shaped for the frontend.
router.post("/:id/analyze", async (req, res, next) => {
  try {
    const photo = await prisma.photo.findUnique({ where: { id: req.params.id } });
    if (!photo) {
      return res.status(404).json({ error: "Photo not found" });
    }

    // Call the Python ML service (may be slow / unavailable).
    let result;
    const startedAt = Date.now();
    try {
      result = await analyzePhoto(photo.imageUrl);
    } catch (mlErr) {
      console.error(mlErr);
      return res.status(503).json({ error: "ML service unavailable" });
    }
    const processingTime = (Date.now() - startedAt) / 1000;

    const detections = result.detections ?? [];
    const highConfidence = detections.filter((d) => d.confidence >= HIGH_CONFIDENCE).length;

    // Persist analysis + detections together; re-analyzing replaces the prior run.
    const analysis = await prisma.$transaction(async (tx) => {
      await tx.detection.deleteMany({ where: { photoId: photo.id } });
      await tx.mLAnalysis.deleteMany({ where: { photoId: photo.id } });

      const created = await tx.mLAnalysis.create({
        data: {
          photoId: photo.id,
          modelVersion: MODEL_VERSION,
          processingTime,
          totalDetections: detections.length,
          highConfidence,
        },
      });

      if (detections.length) {
        await tx.detection.createMany({
          data: detections.map((d) => ({
            photoId: photo.id,
            mlAnalysisId: created.id,
            cocoLabel: d.cocoLabel,
            accessibilityFeature: d.accessibilityFeature,
            confidence: d.confidence,
            boundingBox: d.boundingBox,
          })),
        });
      }

      await tx.photo.update({
        where: { id: photo.id },
        data: { mlAnalyzed: true },
      });

      return created;
    });

    res.json({
      photoId: photo.id,
      analysisId: analysis.id,
      modelVersion: MODEL_VERSION,
      totalDetections: detections.length,
      highConfidence,
      detections,
      altTextSuggestion: result.altTextSuggestion ?? null,
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/photos/:id/detections
// Confirm or reject individual detections by id.
// Body: { confirmed: [detectionId], rejected: [detectionId] }
router.patch("/:id/detections", async (req, res, next) => {
  try {
    const photo = await prisma.photo.findUnique({ where: { id: req.params.id } });
    if (!photo) {
      return res.status(404).json({ error: "Photo not found" });
    }

    const confirmed = Array.isArray(req.body.confirmed) ? req.body.confirmed : [];
    const rejected = Array.isArray(req.body.rejected) ? req.body.rejected : [];

    // Confirmed detections are marked verified; rejected ones are deleted.
    if (confirmed.length) {
      await prisma.detection.updateMany({
        where: { id: { in: confirmed }, photoId: photo.id },
        data: { verified: true },
      });
    }
    if (rejected.length) {
      await prisma.detection.deleteMany({
        where: { id: { in: rejected }, photoId: photo.id },
      });
    }

    const detections = await prisma.detection.findMany({
      where: { photoId: photo.id },
    });

    res.json({ photoId: photo.id, detections });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/photos/:id
router.delete("/:id", async (req, res, next) => {
  try {
    const photo = await prisma.photo.findUnique({ where: { id: req.params.id } });
    if (!photo) {
      return res.status(404).json({ error: "Photo not found" });
    }

    await prisma.photo.delete({ where: { id: photo.id } });
    await prisma.venue.update({
      where: { id: photo.venueId },
      data: { totalPhotos: { decrement: 1 } },
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
