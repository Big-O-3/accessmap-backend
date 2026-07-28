const express = require("express");
const prisma = require("../lib/prisma");

const router = express.Router();

// Yelp Fusion proxy. The API key stays server-side (never shipped to the
// browser). Yelp's terms forbid storing review text, so these are fetched live
// and never written to our DB — they're supplementary context alongside our own
// community reviews.
const YELP_API_KEY = process.env.YELP_API_KEY;
const YELP_BASE = "https://api.yelp.com/v3";

async function yelpFetch(path) {
  const res = await fetch(`${YELP_BASE}${path}`, {
    headers: { Authorization: `Bearer ${YELP_API_KEY}` },
  });
  if (!res.ok) {
    const err = new Error(`Yelp ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// GET /api/external/venues/:id/reviews
// Best-effort: match our venue to a Yelp business by name + location, then
// return up to 3 live review excerpts. Always 200 with a `reviews` array (maybe
// empty) plus an `available` flag, so the frontend can degrade gracefully and
// never breaks the venue page if Yelp is unconfigured or the match fails.
router.get("/venues/:id/reviews", async (req, res, next) => {
  try {
    if (!YELP_API_KEY) {
      return res.json({ available: false, reason: "not_configured", reviews: [] });
    }

    const venue = await prisma.venue.findUnique({ where: { id: req.params.id } });
    if (!venue) {
      return res.status(404).json({ error: "Venue not found" });
    }

    // 1. Match to a Yelp business. Coordinates + name make the match precise.
    const params = new URLSearchParams({
      term: venue.name,
      latitude: String(venue.latitude),
      longitude: String(venue.longitude),
      limit: "1",
      sort_by: "distance",
    });
    const match = await yelpFetch(`/businesses/search?${params.toString()}`);
    const business = match.businesses?.[0];
    if (!business) {
      return res.json({ available: true, matched: false, reviews: [] });
    }

    // 2. Fetch that business's review excerpts (Yelp returns up to 3).
    const data = await yelpFetch(`/businesses/${business.id}/reviews`);
    const reviews = (data.reviews ?? []).map((r) => ({
      id: r.id,
      text: r.text, // excerpt (~160 chars) — live only, never stored
      rating: r.rating,
      userName: r.user?.name ?? "Yelp user",
      timeCreated: r.time_created,
      url: r.url,
    }));

    res.json({
      available: true,
      matched: true,
      source: "Yelp",
      business: {
        name: business.name,
        rating: business.rating,
        reviewCount: business.review_count,
        url: business.url,
      },
      reviews,
    });
  } catch (err) {
    // Never let a Yelp hiccup break the venue page — degrade to "no excerpts".
    if (err.status) {
      return res.json({ available: true, matched: false, reviews: [], error: `yelp_${err.status}` });
    }
    next(err);
  }
});

module.exports = router;
