const express = require("express");
const prisma = require("../lib/prisma");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();

// Shape a Review row for the frontend, which renders review.userName. The
// `userId` is included so the client can tell whose review this is and show a
// delete control only on the signed-in user's own reviews (ownership is still
// re-checked server-side in DELETE — the client value is a UI hint, not a gate).
function serializeReview(review) {
  return {
    id: review.id,
    venueId: review.venueId,
    userId: review.userId,
    rating: review.rating,
    comment: review.comment,
    visitDate: review.visitDate,
    helpfulCount: review.helpfulCount,
    createdAt: review.createdAt,
    userName: review.user?.username ?? "Anonymous",
  };
}

// GET /api/reviews?venueId=
// Reviews for a venue, newest first. The frontend venue-detail page depends on
// this (see frontend src/lib/api.js getReviews).
router.get("/", async (req, res, next) => {
  try {
    const { venueId } = req.query;
    if (!venueId) {
      return res.status(400).json({ error: "venueId query param is required" });
    }

    const reviews = await prisma.review.findMany({
      where: { venueId },
      orderBy: { createdAt: "desc" },
      include: { user: { select: { username: true } } },
    });

    res.json({ reviews: reviews.map(serializeReview) });
  } catch (err) {
    next(err);
  }
});

// POST /api/reviews
// Leave a review on a venue. Requires auth; attributed to the signed-in user
// (req.userId from requireAuth). Body: { venueId, rating (1-5), comment,
// visitDate? }. Increments the venue's denormalized totalReviews counter.
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const { venueId, rating, comment, visitDate } = req.body;

    if (!venueId) {
      return res.status(422).json({ error: "venueId is required" });
    }
    const numericRating = Number(rating);
    if (
      !Number.isInteger(numericRating) ||
      numericRating < 1 ||
      numericRating > 5
    ) {
      return res.status(422).json({ error: "rating must be an integer 1-5" });
    }
    if (!comment || !comment.trim()) {
      return res.status(422).json({ error: "comment is required" });
    }

    // Write the review and bump the venue's counter together so a failure
    // leaves no partial state.
    const review = await prisma.$transaction(async (tx) => {
      const venue = await tx.venue.findUnique({ where: { id: venueId } });
      if (!venue) {
        const err = new Error("Venue not found");
        err.status = 404;
        throw err;
      }

      const created = await tx.review.create({
        data: {
          venueId,
          userId: req.userId,
          rating: numericRating,
          comment: comment.trim(),
          visitDate: visitDate ? new Date(visitDate) : null,
        },
        include: { user: { select: { username: true } } },
      });

      await tx.venue.update({
        where: { id: venueId },
        data: { totalReviews: { increment: 1 } },
      });

      return created;
    });

    res.status(201).json(serializeReview(review));
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

// DELETE /api/reviews/:id
// Remove a review. Requires auth, and only the review's author may delete it —
// req.userId (from the verified token) must match the stored userId, so one
// user can't delete another's review by guessing an id. Decrements the venue's
// denormalized totalReviews counter in the same transaction as the delete so a
// failure leaves no partial state.
router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const review = await prisma.review.findUnique({
      where: { id: req.params.id },
    });
    if (!review) {
      return res.status(404).json({ error: "Review not found" });
    }
    if (review.userId !== req.userId) {
      return res
        .status(403)
        .json({ error: "You can only delete your own reviews" });
    }

    await prisma.$transaction(async (tx) => {
      await tx.review.delete({ where: { id: review.id } });
      await tx.venue.update({
        where: { id: review.venueId },
        data: { totalReviews: { decrement: 1 } },
      });
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
