const express = require("express");
const prisma = require("../lib/prisma");
const { calculateAccessibilityScore } = require("../lib/score");
const { distanceMiles } = require("../lib/geo");

const router = express.Router();

// Shape a Venue (+features) for API responses: compute a live score and a flat
// list of feature keys the frontend filters on.
function serializeVenue(venue) {
  const score = calculateAccessibilityScore(venue.features);
  return {
    id: venue.id,
    name: venue.name,
    address: venue.address,
    city: venue.city,
    state: venue.state,
    zipCode: venue.zipCode,
    latitude: venue.latitude,
    longitude: venue.longitude,
    venueType: venue.venueType,
    accessibilityScore: score,
    totalReviews: venue.totalReviews,
    totalPhotos: venue.totalPhotos,
    features: venue.features.map((f) => ({
      type: f.featureType,
      mlDetected: f.mlDetected,
      confidence: f.mlConfidence,
      verifiedCount: f.verifiedCount,
    })),
    featureKeys: venue.features.map((f) => f.featureType),
  };
}

// GET /api/venues/search?city=&features=a,b&radius=&lat=&lng=
router.get("/search", async (req, res, next) => {
  try {
    const { city, features, radius, lat, lng } = req.query;

    const where = {};
    if (city) where.city = { contains: city, mode: "insensitive" };

    // Require all requested features to be present on the venue.
    const requested = features
      ? features.split(",").map((f) => f.trim()).filter(Boolean)
      : [];
    if (requested.length) {
      where.AND = requested.map((type) => ({
        features: { some: { featureType: type } },
      }));
    }

    const venues = await prisma.venue.findMany({
      where,
      include: { features: true },
    });

    let results = venues.map(serializeVenue);

    // Distance filter + sort when a coordinate is supplied; otherwise sort by
    // accessibility score (best first).
    const hasCoords = lat !== undefined && lng !== undefined;
    if (hasCoords) {
      const originLat = parseFloat(lat);
      const originLng = parseFloat(lng);
      results = results.map((v) => ({
        ...v,
        distance: distanceMiles(originLat, originLng, v.latitude, v.longitude),
      }));
      if (radius) {
        const r = parseFloat(radius);
        results = results.filter((v) => v.distance <= r);
      }
      results.sort((a, b) => a.distance - b.distance);
    } else {
      results.sort((a, b) => b.accessibilityScore - a.accessibilityScore);
    }

    res.json({ venues: results, total: results.length });
  } catch (err) {
    next(err);
  }
});

// GET /api/venues/:id
router.get("/:id", async (req, res, next) => {
  try {
    const venue = await prisma.venue.findUnique({
      where: { id: req.params.id },
      include: {
        features: true,
        reviews: { orderBy: { createdAt: "desc" } },
        photos: {
          orderBy: { uploadedAt: "desc" },
          include: { detections: true },
        },
      },
    });

    if (!venue) {
      return res.status(404).json({ error: "Venue not found" });
    }

    // Shape photos + their detections for the frontend's DetectionImage
    // (needs imageUrl and detections[].{ accessibilityFeature, confidence,
    // boundingBox }). Only confirmed detections are shown so rejected false
    // positives don't appear as bounding boxes on the public venue page.
    const photos = venue.photos.map((p) => ({
      id: p.id,
      imageUrl: p.imageUrl,
      thumbnailUrl: p.thumbnailUrl,
      detections: p.detections
        .filter((d) => d.verified)
        .map((d) => ({
          id: d.id,
          cocoLabel: d.cocoLabel,
          accessibilityFeature: d.accessibilityFeature,
          confidence: d.confidence,
          boundingBox: d.boundingBox,
        })),
    }));

    res.json({
      ...serializeVenue(venue),
      photos,
      reviews: venue.reviews,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/venues/:id/score
router.get("/:id/score", async (req, res, next) => {
  try {
    const venue = await prisma.venue.findUnique({
      where: { id: req.params.id },
      include: { features: true },
    });

    if (!venue) {
      return res.status(404).json({ error: "Venue not found" });
    }

    res.json({
      venueId: venue.id,
      accessibilityScore: calculateAccessibilityScore(venue.features),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/venues/:id/route
// Returns a Google Maps directions deep-link to the venue. (The frontend can
// build this itself, but exposing it as an endpoint keeps directions logic in
// one place and satisfies the venue-route requirement.)
router.get("/:id/route", async (req, res, next) => {
  try {
    const venue = await prisma.venue.findUnique({
      where: { id: req.params.id },
    });

    if (!venue) {
      return res.status(404).json({ error: "Venue not found" });
    }

    // Prefer routing to the exact place; fall back to the street address.
    const destination = venue.placeId
      ? `${venue.latitude},${venue.longitude}`
      : encodeURIComponent(
          `${venue.address}, ${venue.city}, ${venue.state} ${venue.zipCode}`.trim(),
        );

    const params = new URLSearchParams({ api: "1", destination });
    if (venue.placeId) params.set("destination_place_id", venue.placeId);

    res.json({
      venueId: venue.id,
      directionsUrl: `https://www.google.com/maps/dir/?${params.toString()}`,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/venues
router.post("/", async (req, res, next) => {
  try {
    const {
      name,
      address,
      city,
      state,
      zipCode,
      latitude,
      longitude,
      placeId,
      venueType,
    } = req.body;

    if (!name || !address || !city || latitude == null || longitude == null) {
      return res
        .status(400)
        .json({ error: "name, address, city, latitude, longitude are required" });
    }

    const venue = await prisma.venue.create({
      data: {
        name,
        address,
        city,
        state: state ?? "",
        zipCode: zipCode ?? "",
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        placeId: placeId ?? null,
        venueType: venueType ?? "other",
      },
      include: { features: true },
    });

    res.status(201).json(serializeVenue(venue));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
