// Duplicate-venue detection shared by the venue-create and contribution paths.
//
// Venues get created from two places (POST /api/venues and the inline-venue
// branch of POST /api/contributions). Without a guard, submitting "Salesforce
// Tower" ten times makes ten rows. This finds a pre-existing venue that is
// almost certainly the same physical place so callers can reuse it instead.

const prisma = require("./prisma");

// Two venues count as the same place when they share a name (case-insensitive)
// AND sit within this many degrees of each other. ~0.0005° ≈ 55 meters — tight
// enough to keep genuinely different branches of a chain (e.g. two Joe & The
// Juice locations a mile apart) as separate venues.
const COORD_EPSILON = 0.0005;

// A matching placeId is a definitive duplicate regardless of distance.
async function findDuplicateVenue({ name, latitude, longitude, placeId }) {
  if (placeId) {
    const byPlace = await prisma.venue.findUnique({ where: { placeId } });
    if (byPlace) return byPlace;
  }

  if (!name || latitude == null || longitude == null) return null;

  const lat = parseFloat(latitude);
  const lng = parseFloat(longitude);

  // Same (case-insensitive) name within the coordinate box.
  const candidates = await prisma.venue.findMany({
    where: {
      name: { equals: name, mode: "insensitive" },
      latitude: { gte: lat - COORD_EPSILON, lte: lat + COORD_EPSILON },
      longitude: { gte: lng - COORD_EPSILON, lte: lng + COORD_EPSILON },
    },
    take: 1,
  });

  return candidates[0] ?? null;
}

module.exports = { findDuplicateVenue, COORD_EPSILON };
