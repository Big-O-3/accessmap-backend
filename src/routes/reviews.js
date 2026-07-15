const express = require("express");
const prisma = require("../lib/prisma");

const router = express.Router();

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
    });

    res.json({ reviews });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
