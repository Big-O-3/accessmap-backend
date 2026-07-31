const express = require("express");
const prisma = require("../lib/prisma");
const { calculateAccessibilityScore } = require("../lib/score");
const { MODEL_VERSION } = require("../lib/mlService");
const { findExistingVenue } = require("../lib/venueDedup");
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
//     venue?: { name, address, city, state?, zipCode?, latitude?, longitude?,
//               venueType?, placeId? },  // create a new venue inline
//                                        // (coordinates optional; deduped by
//                                        //  placeId, else name+city)
//     features?: [                   // contributor-confirmed features (from AI
//       { featureType, mlDetected?, confidence?, notes? }  // review OR a manual
//     ],                             // checklist when there's no photo)
//     photos?: [                     // optional; only persisted if imageUrl set
//       { imageUrl, thumbnailUrl?, altText?,
//         detections?: [{ cocoLabel, accessibilityFeature, confidence,
//                         boundingBox }] }
//     ],
//     note?: string
//   }
//
// Must include at least one feature OR a note. Photos are always optional.
//
// Response: { id, venueId, accessibilityScore, featuresConfirmed,
//             photosAdded, status: "pending_verification" }
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const { venueId, venue: venueInput, features, photos, note } = req.body;
    const userId = req.userId;

    const featureList = Array.isArray(features) ? features : [];
    const trimmedNote = typeof note === "string" ? note.trim() : "";

    // A contribution has to say something: either confirmed features (from AI
    // review or a manual checklist) or a written note. Photos are optional now —
    // adding to an existing venue can be just a checklist and/or a note.
    if (featureList.length === 0 && !trimmedNote) {
      return res.status(400).json({
        error: "Add at least one feature or a note describing this venue",
      });
    }
    if (!venueId && !venueInput) {
      return res
        .status(400)
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
        // Coordinates are optional now (the venue just won't map). Name/address/
        // city still anchor a venue enough to find and display it.
        if (!v.name || !v.address || !v.city) {
          const err = new Error("venue requires name, address, city");
          err.status = 400;
          throw err;
        }
        // Don't create a duplicate: if this place already exists (by placeId,
        // else same name near the same coordinates, else name+city when there
        // are no coordinates), contribute to the existing venue instead of
        // adding a second card for it.
        const existing = await findExistingVenue(tx, {
          placeId: v.placeId,
          name: v.name,
          city: v.city,
          latitude: v.latitude,
          longitude: v.longitude,
        });
        venue =
          existing ??
          (await tx.venue.create({
            data: {
              name: v.name,
              address: v.address,
              city: v.city,
              state: v.state ?? "",
              zipCode: v.zipCode ?? "",
              latitude: v.latitude == null ? null : parseFloat(v.latitude),
              longitude: v.longitude == null ? null : parseFloat(v.longitude),
              placeId: v.placeId ?? null,
              venueType: v.venueType ?? "other",
            },
          }));
      }

      // 2. Upsert each confirmed feature. A contribution counts as one
      //    community verification, so verifiedCount increments and the feature
      //    is marked community-verified. Re-contributing the same feature bumps
      //    the count (feeding the community bonus in the score). Features may
      //    come from AI review OR a manual checklist (no photo) — either way a
      //    contributor-supplied feature is trusted at full weight when
      //    mlDetected is false (see the scoring model).
      let featuresConfirmed = 0;
      for (const f of featureList) {
        if (!f.featureType) continue;
        featuresConfirmed += 1;
        const mlDetected = f.mlDetected ?? false;
        const mlConfidence = mlDetected ? (f.confidence ?? null) : null;
        // Prefer a per-feature note, else fall back to the contribution note so
        // a written note isn't lost when there's a feature to hang it on.
        const featureNote = f.notes ?? (trimmedNote || null);

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
            notes: featureNote,
          },
          update: {
            verifiedCount: { increment: 1 },
            communityVerified: true,
            // Keep the best ML confidence we've seen for this feature.
            ...(mlConfidence != null ? { mlConfidence } : {}),
            // Only overwrite the stored note when this contribution supplied one.
            ...(featureNote != null ? { notes: featureNote } : {}),
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
        featuresConfirmed,
        photosAdded,
      };
    });

    res.status(201).json({
      id: `contribution-${result.venueId}`,
      status: "pending_verification",
      note: trimmedNote,
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
