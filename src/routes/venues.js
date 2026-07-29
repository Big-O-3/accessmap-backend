const express = require("express");
const prisma = require("../lib/prisma");
const { calculateAccessibilityScore } = require("../lib/score");
const { distanceMiles } = require("../lib/geo");
const { findExistingVenue } = require("../lib/venueDedup");
const { serializeReview } = require("./reviews");

const router = express.Router();

// Shape a Venue (+features) for API responses: compute a live score and a flat
// list of feature keys the frontend filters on.
function serializeVenue(venue) {
  // A venue is scored once it has real, human-vetted accessibility data: either
  // a photo the ML model analyzed, OR a community contribution (a contributor
  // confirming features from a photo or a manual checklist sets
  // communityVerified). Map-imported venues (features present but never
  // photo-analyzed or community-confirmed) stay "unscored" (null) — showing a
  // number would imply verification that never took place.
  const hasCommunityData = venue.features.some((f) => f.communityVerified);
  const score =
    venue.totalPhotos > 0 || hasCommunityData
      ? calculateAccessibilityScore(venue.features)
      : null;
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
    const { city, features, radius, lat, lng, types } = req.query;

    const where = {};
    if (city) where.city = { contains: city, mode: "insensitive" };

    // Filter by venue category (restaurant, museum, arena, ...). Comma-separated
    // list; a venue matches if its type is any of the requested ones.
    const requestedTypes = types
      ? types.split(",").map((t) => t.trim()).filter(Boolean)
      : [];
    if (requestedTypes.length) where.venueType = { in: requestedTypes };

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
        // Venues without coordinates have no distance; leave it null so they
        // aren't given a bogus 0-mile distance that would sort them to the top.
        distance:
          v.latitude != null && v.longitude != null
            ? distanceMiles(originLat, originLng, v.latitude, v.longitude)
            : null,
      }));
      if (radius) {
        const r = parseFloat(radius);
        // A radius search is inherently about location, so drop venues we can't
        // place (distance null) rather than including them arbitrarily.
        results = results.filter((v) => v.distance != null && v.distance <= r);
      }
      // Nearest first; un-locatable venues (distance null) sort to the end.
      results.sort(
        (a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity),
      );
    } else {
      // Highest score first; unscored venues (null) sort to the end.
      results.sort(
        (a, b) => (b.accessibilityScore ?? -1) - (a.accessibilityScore ?? -1),
      );
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
        // Join the author so each review carries a userName. Without this the
        // rows come back nameless and the venue page renders a blank name on
        // revisit — unlike a just-posted review, which is serialized with it.
        reviews: {
          orderBy: { createdAt: "desc" },
          include: { user: { select: { username: true } } },
        },
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
      // Uploader id so the client can show a delete control only on the
      // signed-in user's own photos (ownership is re-checked server-side in
      // DELETE /api/photos/:id — this is a UI hint, not a gate).
      userId: p.userId,
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
      // Shape reviews through the same serializer the reviews route uses, so a
      // review looks identical whether it arrives here or from GET /api/reviews
      // (notably: it keeps its userName).
      reviews: venue.reviews.map(serializeReview),
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

    // Unscored until there's a photo OR community-confirmed data (see
    // serializeVenue for the full rationale).
    const hasCommunityData = venue.features.some((f) => f.communityVerified);
    res.json({
      venueId: venue.id,
      accessibilityScore:
        venue.totalPhotos > 0 || hasCommunityData
          ? calculateAccessibilityScore(venue.features)
          : null,
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

    // Prefer routing to exact coordinates; fall back to the street address when
    // the venue has no coordinates (coords are optional now).
    const hasCoords = venue.latitude != null && venue.longitude != null;
    const destination = hasCoords
      ? `${venue.latitude},${venue.longitude}`
      : encodeURIComponent(
          `${venue.address}, ${venue.city}, ${venue.state} ${venue.zipCode}`.trim(),
        );

    const params = new URLSearchParams({ api: "1", destination });
    // Only pin the place id alongside a coordinate destination; with an address
    // destination the place id would refer to a point Maps can't resolve.
    if (venue.placeId && hasCoords) params.set("destination_place_id", venue.placeId);

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

    // Coordinates are optional now (the venue just won't appear on the map).
    if (!name || !address || !city) {
      return res
        .status(400)
        .json({ error: "name, address, city are required" });
    }

    // Don't create a second card for a place we already have. Match on placeId
    // first, else same name at nearly the same coordinates, else name+city when
    // there are no coordinates (see findExistingVenue). When we find one, return
    // it (200) so the caller adds to it instead of duplicating.
    const existing = await findExistingVenue(prisma, {
      placeId,
      name,
      city,
      latitude,
      longitude,
    });
    if (existing) {
      const full = await prisma.venue.findUnique({
        where: { id: existing.id },
        include: { features: true },
      });
      return res.status(200).json(serializeVenue(full));
    }

    const venue = await prisma.venue.create({
      data: {
        name,
        address,
        city,
        state: state ?? "",
        zipCode: zipCode ?? "",
        latitude: latitude == null ? null : parseFloat(latitude),
        longitude: longitude == null ? null : parseFloat(longitude),
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
