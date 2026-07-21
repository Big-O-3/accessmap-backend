const express = require("express");
const prisma = require("../lib/prisma");
const { calculateAccessibilityScore } = require("../lib/score");
const { MODEL_VERSION } = require("../lib/mlService");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();

// Detections at or above this confidence are counted as "high confidence".
// Mirrors the threshold in photos.js and the ML service.
const HIGH_CONFIDENCE = 0.85;

// POST /api/contributions
// Commit a completed "Add Venue" contribution (the stepper's Step 4).
//
// Requires authentication. req.userId (from requireAuth) is used to attribute
// the contribution — a signed-in user is a load-bearing part of the schema now,
// so anonymous writes are rejected before any DB work happens.
//
// Body:
//   {
//     venueId?: string,              // contribute to an existing venue, OR
//     venue?: { name, address, city, state?, zipCode?, latitude, longitude,
//               venueType?, placeId? },  // create a new venue inline
//     features: [                    // the contributor-confirmed features
//       { featureType, mlDetected?, confidence?, notes? }
//     ],
//     photos?: [                     // optional; only persisted if imageUrl set
//       { imageUrl, thumbnailUrl?, altText?,
//         detections?: [{ cocoLabel, accessibilityFeature, confidence,
//                         boundingBox }] }
//     ],
//     note?: string
//   }
//
// Response: { id, venueId, accessibilityScore, featuresConfirmed,
//             photosAdded, status: "pending_verification" }
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const { venueId, venue: venueInput, features, photos, note } = req.body;
    const userId = req.userId;

    if (!Array.isArray(features) || features.length === 0) {
      return res
        .status(422)
        .json({ error: "At least one confirmed feature is required" });
    }
    if (!venueId && !venueInput) {
      return res
        .status(422)
        .json({ error: "Provide venueId (existing) or venue (to create)" });
    }

    // Everything is written together so a failure leaves no partial state.
    const result = await prisma.$transaction(async (tx) => {
      // 1. Resolve the venue — look up an existing one or create a new one.
      let venue;
      if (venueId) {
        venue = await tx.venue.findUnique({ where: { id: venueId } });
        if (!venue) {
          const err = new Error("Venue not found");
          err.status = 404;
          throw err;
        }
      } else {
        const v = venueInput;
        if (
          !v.name ||
          !v.address ||
          !v.city ||
          v.latitude == null ||
          v.longitude == null
        ) {
          const err = new Error(
            "venue requires name, address, city, latitude, longitude",
          );
          err.status = 422;
          throw err;
        }
        venue = await tx.venue.create({
          data: {
            name: v.name,
            address: v.address,
            city: v.city,
            state: v.state ?? "",
            zipCode: v.zipCode ?? "",
            latitude: parseFloat(v.latitude),
            longitude: parseFloat(v.longitude),
            placeId: v.placeId ?? null,
            venueType: v.venueType ?? "other",
          },
        });
      }

      // 2. Upsert each confirmed feature. A contribution counts as one
      //    community verification, so verifiedCount increments and the feature
      //    is marked community-verified. Re-contributing the same feature bumps
      //    the count (feeding the community bonus in the score).
      for (const f of features) {
        if (!f.featureType) continue;
        const mlDetected = f.mlDetected ?? false;
        const mlConfidence = mlDetected ? (f.confidence ?? null) : null;

        await tx.venueFeature.upsert({
          where: {
            venueId_featureType: {
              venueId: venue.id,
              featureType: f.featureType,
            },
          },
          create: {
            venueId: venue.id,
            featureType: f.featureType,
            mlDetected,
            mlConfidence,
            communityVerified: true,
            verifiedCount: 1,
            notes: f.notes ?? null,
          },
          update: {
            verifiedCount: { increment: 1 },
            communityVerified: true,
            // Keep the best ML confidence we've seen for this feature.
            ...(mlConfidence != null ? { mlConfidence } : {}),
          },
        });
      }

      // 3. Persist any photos that carry a hosted URL, along with their ML
      //    analysis + detection rows (same shape as the photos route). Photos
      //    without a URL (e.g. local-only blobs) are skipped — the feature data
      //    above is still recorded.
      let photosAdded = 0;
      for (const p of photos ?? []) {
        if (!p?.imageUrl) continue;

        const photo = await tx.photo.create({
          data: {
            venueId: venue.id,
            userId,
            imageUrl: p.imageUrl,
            thumbnailUrl: p.thumbnailUrl ?? null,
            mlAnalyzed: Array.isArray(p.detections) && p.detections.length > 0,
          },
        });
        photosAdded += 1;

        const detections = Array.isArray(p.detections) ? p.detections : [];
        if (detections.length > 0) {
          const analysis = await tx.mLAnalysis.create({
            data: {
              photoId: photo.id,
              modelVersion: MODEL_VERSION,
              totalDetections: detections.length,
              highConfidence: detections.filter(
                (d) => (d.confidence ?? 0) >= HIGH_CONFIDENCE,
              ).length,
            },
          });

          await tx.detection.createMany({
            data: detections.map((d) => ({
              photoId: photo.id,
              mlAnalysisId: analysis.id,
              cocoLabel: d.cocoLabel ?? "",
              accessibilityFeature: d.accessibilityFeature,
              confidence: d.confidence ?? 0,
              boundingBox: d.boundingBox ?? {},
              // Contributor confirmed these in the review step.
              verified: true,
              verificationCount: 1,
            })),
          });
        }
      }

      // 4. Recompute the venue's score from its (now-updated) features and keep
      //    the denormalized counters in sync.
      const allFeatures = await tx.venueFeature.findMany({
        where: { venueId: venue.id },
      });
      const accessibilityScore = calculateAccessibilityScore(allFeatures);

      const updated = await tx.venue.update({
        where: { id: venue.id },
        data: {
          accessibilityScore,
          totalPhotos: { increment: photosAdded },
        },
      });

      return {
        venueId: updated.id,
        accessibilityScore,
        featuresConfirmed: features.length,
        photosAdded,
      };
    });

    res.status(201).json({
      id: `contribution-${result.venueId}`,
      status: "pending_verification",
      note: note ?? "",
      ...result,
    });
  } catch (err) {
    // Surface the validation/not-found statuses we threw inside the transaction.
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

module.exports = router;
